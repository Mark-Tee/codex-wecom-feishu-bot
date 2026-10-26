import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildDutyPrompt } from "../core/duty-prompt.mjs";
import {
  inferShiftDateFromSpec,
  normalizeDutySpec,
  validateDutySpec,
} from "../core/duty-spec.mjs";
import { taskNumberToShortId } from "../core/task-workflow.mjs";
import {
  inferFillCardFromSpec,
  formatFillCard,
  normalizeFillCard,
} from "../core/fill-card.mjs";
import { validateDutyIdentifiers } from "../core/duty-identifiers.mjs";
import {
  likelyOperatorMatch,
  matchOperator,
  parseOperatorRequest,
} from "../core/operator-identity.mjs";
import { buildDutyContext } from "../providers/tencent-docs/duty-context.mjs";
import { requestId } from "../request-id.mjs";
import { extractDutyJson } from "./duty-output.mjs";
import { formatHelpText } from "./help-entries.mjs";
import {
  formatBrowserFillSummary,
  formatPendingTasks,
  formatStatus,
} from "./output-format.mjs";
import { PendingTaskStore } from "./pending-task-store.mjs";
import { TaskQueue } from "./task-queue.mjs";

function isDutyIntent(text, images) {
  return images.length > 0 || /工单|周报|交接班|草稿|值班|直接记录|按计划预录|当前进展/.test(text);
}

export class ConversationService {
  constructor({
    config,
    dutyConfig,
    runner,
    docsClient,
    draftRepository,
    state,
    access,
    logger,
    pendingTasks,
    browserFiller,
  }) {
    this.config = config;
    this.dutyConfig = dutyConfig;
    this.runner = runner;
    this.docsClient = docsClient;
    this.draftRepository = draftRepository;
    this.state = state;
    this.access = access;
    this.logger = logger;
    this.pendingTasks = pendingTasks || new PendingTaskStore(state);
    this.browserFiller = browserFiller;
    this.queue = new TaskQueue((task) => this.#processTask(task), { logger });
    this.startedAt = Date.now();
    this.currentTask = null;
  }

  start() {
    if (this.config.duty.prewarm) this.#warm();
    this.access.ensurePairingCode();
  }

  stop() {
    this.queue.clear();
    this.runner.stop();
  }

  async handle(message, responder) {
    const text = String(message.text || "").trim();
    if (text.startsWith("/pair")) {
      const code = text.split(/\s+/)[1] || "";
      const result = this.access.pair(message.userId, code);
      await responder.replyText(result.message);
      return;
    }
    if (!this.access.isAuthorized(message.userId)) {
      await responder.replyText(
        "你还没有配对。请在电脑上查看 pairing-code.txt，然后发送 /pair <配对码>。",
      );
      return;
    }

    this.state.set("__lastChat__", {
      chatId: message.chatId,
      chatType: message.chatType,
      userId: message.userId,
      platform: message.platform,
      at: message.receivedAt,
    });

    if (text === "/help" || text === "帮助") {
      await responder.replyText(this.#helpText());
      return;
    }
    if (text === "/status" || text === "状态") {
      await responder.replyText(formatStatus({
        startedAt: this.startedAt,
        queueSize: this.queue.size,
        queueRunning: this.queue.running,
        operator: this.#operatorForChat(message.chatId),
        workflowMode: this.config.duty.workflowMode,
        browserEnabled: this.browserFiller?.enabled,
        pendingCount: this.pendingTasks.activeCount(message.chatId),
      }));
      return;
    }
    if (text === "/stop" || text === "停止") {
      this.queue.clear();
      this.runner.stop();
      await responder.replyText("已停止当前任务并清空队列。");
      return;
    }
    if (text === "/new" || text === "新会话") {
      this.#setChatValue("threads", message.chatId, "");
      await responder.replyText("已清空当前会话上下文，使用人身份保留。");
      return;
    }
    if (text === "/operators" || text === "操作者") {
      await responder.replyText(`当前操作者：${this.access.operators().join("、") || "无"}`);
      return;
    }
    if (text.startsWith("/invite") || text === "/paircode") {
      const code = this.access.createInvite();
      await responder.replyText(`配对码：${code}\n10 分钟内有效。`);
      return;
    }
    const done = text.match(/^\/done(?:\s+#?(\d{1,8}))?$/i);
    if (done) {
      if (!done[1]) {
        await responder.replyText("请在 /done 后填写本地短号，例如：/done 42");
        return;
      }
      this.#enqueue({
        id: requestId("done"),
        kind: "done",
        localTaskId: done[1],
        message,
        responder,
      });
      return;
    }
    if (text === "/pending" || text === "待办") {
      await responder.replyText(formatPendingTasks(this.pendingTasks.list(message.chatId)));
      return;
    }
    const fill = text.match(/^\/fill(?:\s+#?(\d{1,8}))?$/i);
    if (fill) {
      if (!fill[1]) {
        await responder.replyText("请在 /fill 后填写本地短号，例如：/fill 42");
        return;
      }
      this.#enqueue({
        id: requestId("browser-fill"),
        kind: "browser-fill",
        localTaskId: fill[1],
        message,
        responder,
      });
      return;
    }
    const cancel = text.match(/^\/cancel(?:\s+#?(\d{1,8}))?$/i);
    if (cancel) {
      await responder.replyText(this.#cancelTask(message.chatId, cancel[1]));
      return;
    }

    const identity = await this.#handleIdentity(message, text, responder);
    if (identity.handled) return;
    if (identity.cleanedText !== undefined) {
      message = { ...message, text: identity.cleanedText };
    }

    const pendingDuty = await this.#handlePendingDuty(message, responder);
    if (pendingDuty.handled) return;
    if (pendingDuty.task) message = pendingDuty.task;

    const task = {
      id: requestId("task"),
      kind: this.config.duty.enabled && isDutyIntent(message.text, message.images)
        ? "duty"
        : "general",
      message,
      responder,
      operator: this.#operatorForChat(message.chatId),
    };
    await this.#enqueue(task, responder);
  }

  async #enqueue(task, responder) {
    const wasRunning = this.queue.running;
    this.queue.push(task);
    if (wasRunning) {
      await responder.replyProgress(
        requestId("queue"),
        `已排队，前面还有 ${Math.max(0, this.queue.size - 1)} 个任务。`,
        true,
      );
    }
  }

  async #handleIdentity(message, text, responder) {
    const members = this.dutyConfig.line.team_members;
    const pending = this.#getChatValue("operatorConfirm", message.chatId);
    if (pending?.expiresAt > Date.now()) {
      if (/^(是|是的|对|对的|没错|确定|嗯)$/i.test(text)) {
        this.#setChatValue("operator", message.chatId, pending.name);
        this.#setChatValue("operatorConfirm", message.chatId, null);
        await responder.replyText(`已确认，本会话使用人切换为：${pending.name}\n请继续发送工单。`);
        return { handled: true };
      }
      if (/^(不是|不对|否|错了|不正确)$/i.test(text)) {
        this.#setChatValue("operatorConfirm", message.chatId, null);
        await responder.replyText(`请重新发送正确姓名，可选：${members.join("、")}`);
        return { handled: true };
      }
      this.#setChatValue("operatorConfirm", message.chatId, null);
    }

    const request = parseOperatorRequest(text);
    if (!request) return { handled: false };
    if (members.includes(request.name)) {
      this.#setChatValue("operator", message.chatId, request.name);
      if (message.images?.length) {
        return {
          handled: false,
          cleanedText: request.remainder || "按默认工单流程生成腾讯文档草稿",
        };
      }
      await responder.replyText(`本会话使用人已切换为：${request.name}\n后续工单按此人的排班处理。`);
      return { handled: true };
    }
    const matched = matchOperator(
      request.name,
      members,
      this.dutyConfig.line.pinyin_hints || {},
    );
    if (likelyOperatorMatch(matched)) {
      this.#setChatValue("operatorConfirm", message.chatId, {
        name: matched.best.name,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      await responder.replyText(`你是不是“${matched.best.name}”？\n回复“是”或“不是”。`);
      return { handled: true };
    }
    await responder.replyText(`没有匹配到网络组成员：${request.name}\n可选：${members.join("、")}`);
    return { handled: true };
  }

  async #handlePendingDuty(message, responder) {
    if (message.images?.length) return { handled: false };
    const pending = this.#getChatValue("pendingDuty", message.chatId);
    if (!pending || pending.expiresAt < Date.now()) return { handled: false };
    const text = String(message.text || "").trim();
    if (/^(取消|撤销|算了|不记了)$/i.test(text)) {
      this.#setChatValue("pendingDuty", message.chatId, null);
      await responder.replyText("已取消这条工单的草稿记录。");
      return { handled: true };
    }
    let supplement = "";
    if (/^(直接记录|按计划预录|按计划记录|计划预录)$/i.test(text)) {
      supplement = "按计划时间预录，任务反馈写未开始，结束时间使用工单要求结束时间。";
    } else if (/^(按当前进展|记录当前进展|当前进展)$/i.test(text)) {
      supplement = "按当前进展记录，结束时间使用收到时间，任务反馈写处理中。";
    } else if (/^(已完成|按已完成记录|完成记录)$/i.test(text)) {
      supplement = "按已完成记录，结束时间使用收到时间与要求结束时间中较早者。";
    } else {
      await responder.replyText("请明确：按计划预录、按当前进展记录、已完成，或取消记录。");
      return { handled: true };
    }
    this.#setChatValue("pendingDuty", message.chatId, null);
    return {
      handled: false,
      task: {
        ...message,
        text: `${pending.userText}\n【补充说明】${supplement}`,
        images: pending.images,
        ocrText: pending.ocrText,
      },
    };
  }

  async #processTask(task) {
    this.currentTask = task;
    try {
      if (task.kind === "duty") {
        await this.#runDuty(task);
      } else if (task.kind === "done") {
        await this.#runDone(task);
      } else if (task.kind === "browser-fill") {
        await this.#runBrowserFillTask(task);
      } else {
        await this.#runGeneral(task);
      }
    } catch (error) {
      this.logger.error("任务执行失败", error.message);
      await task.responder.replyProgress(
        requestId("stream"),
        task.kind === "duty" || task.kind === "done"
          ? `**腾讯文档草稿未更新**\n\n${error.message}`
          : `**Codex 执行失败**\n\n${error.message}`,
        true,
      ).catch(() => {});
    } finally {
      this.currentTask = null;
    }
  }

  async #runDuty(task) {
    const { message, responder, operator } = task;
    const streamId = requestId("stream");
    const receivedAt = message.receivedAt || new Date().toISOString();
    const promptSource = `${message.text || ""}\n${message.ocrText || ""}`;
    const context = await buildDutyContext({
      client: this.docsClient,
      config: this.dutyConfig,
      prompt: promptSource,
      receivedAt,
      operator,
    });
    const warning = context.schedule.flatMap((day) => day.warnings || [])[0];
    if (warning) {
      this.#setChatValue("pendingDuty", message.chatId, {
        userText: message.text,
        images: message.images,
        ocrText: message.ocrText,
        clarification: warning,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await responder.replyProgress(streamId, `**需要确认**\n\n${warning}`, true);
      return;
    }

    const prompt = buildDutyPrompt({
      userText: message.text,
      context,
      ocrText: message.ocrText,
      images: message.images.map((image) => image.path),
      receivedAt,
    });
    const result = await this.runner.run({
      prompt,
      threadId: this.state.get("__dutyThread__", ""),
      images: message.images.map((image) => image.path),
      reasoningEffort: this.config.duty.reasoningEffort,
      fastDuty: true,
    });
    if (result.threadId) this.state.set("__dutyThread__", result.threadId);
    if (!result.ok) throw new Error(result.text);

    const parsed = extractDutyJson(result.text);
    if (!parsed) {
      this.#setChatValue("pendingDuty", message.chatId, {
        userText: message.text,
        images: message.images,
        ocrText: message.ocrText,
        clarification: "Codex 未返回可解析 JSON",
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await responder.replyProgress(streamId, "**需要确认**\n\nCodex 未返回可解析草稿，请补充信息。", true);
      return;
    }
    if (parsed.needsClarification) {
      this.#setChatValue("pendingDuty", message.chatId, {
        userText: message.text,
        images: message.images,
        ocrText: message.ocrText,
        clarification: parsed.needsClarification,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await responder.replyProgress(streamId, `**需要确认**\n\n${parsed.needsClarification}`, true);
      return;
    }

    const normalized = normalizeDutySpec({
      weeklyRows: parsed.weeklyRows,
      handoverRows: parsed.handoverRows,
    }, operator);
    validateDutySpec(normalized);
    const fillCard = normalizeFillCard(parsed.fillCard);
    const inferredCard = inferFillCardFromSpec(normalized);
    for (const [key, value] of Object.entries(inferredCard)) {
      if (!fillCard[key]) fillCard[key] = value;
    }
    const identifierErrors = validateDutyIdentifiers(fillCard);
    if (identifierErrors.length) {
      await responder.replyProgress(
        streamId,
        [
          "**单号格式需要核对**",
          ...identifierErrors,
          "机器人未填写或提交飞书。请核对后重新发送清晰工单图片。",
        ].join("\n"),
        true,
      );
      return;
    }
    const taskDir = path.join(this.config.runtime.specRoot, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(taskDir, { recursive: true });
    const specPath = path.join(taskDir, "draft-spec.json");
    fs.writeFileSync(specPath, JSON.stringify(normalized, null, 2), "utf8");
    const currentDate = inferShiftDateFromSpec(normalized, context);
    this.#setChatValue("pendingDuty", message.chatId, null);

    if (this.config.duty.workflowMode === "direct-draft") {
      const update = await this.draftRepository.update(normalized, {
        currentDate,
        previousDate: context.previousWorkedDate,
        context,
      });
      const text = [
        "**腾讯文档草稿已更新**",
        `使用人 ${operator} · 周报新增 ${normalized.weeklyRows.length} 行 · 交接班新增 ${normalized.handoverRows.length} 行`,
        `草稿保留：周报 ${update.weeklyRows} 行、交接班 ${update.handoverRows} 行（${update.keptDates.join(" / ")}）`,
        update.fileUrl,
      ].join("\n");
      await responder.replyProgress(streamId, text, true);
      return;
    }

    let pending = this.pendingTasks.create({
      chatId: message.chatId,
      userId: message.userId,
      operator,
      receivedAt,
      text: message.text,
      ocrText: message.ocrText,
      images: message.images.map((image) => ({
        path: image.path,
        text: image.text || "",
      })),
      fillCard,
      draftSpec: normalized,
      currentDate,
      previousDate: context.previousWorkedDate,
    });
    let browserStatus = "";
    let browserResult = null;
    if (this.browserFiller?.enabled && this.config.feishuBrowser?.autoFill !== false) {
      browserResult = await this.browserFiller.fill(pending);
      pending = this.#reassignTaskIdFromBrowser(pending, message.chatId, browserResult);
      this.pendingTasks.setBrowserFill(pending.id, message.chatId, browserResult);
      browserStatus = formatBrowserFillSummary(browserResult, {
        autoSubmit: this.config.feishuBrowser?.autoSubmit,
      });
    }
    if (browserResult?.submitted) {
      await responder.replyProgress(
        streamId,
        [
          browserStatus,
          `本地短号：${pending.id}`,
          `腾讯草稿请发送：\`/done ${pending.id}\``,
        ].filter(Boolean).join("\n\n"),
        true,
      );
      return;
    }
    await responder.replyProgress(
      streamId,
      [
        formatFillCard(pending, {
          autoSubmit: Boolean(this.browserFiller?.enabled && this.config.feishuBrowser?.autoSubmit),
        }),
        browserStatus,
      ].filter(Boolean).join("\n\n"),
      true,
    );
  }

  async #runBrowserFillTask(task) {
    const { message, responder } = task;
    let { localTaskId } = task;
    const streamId = requestId("stream");
    let pending = this.pendingTasks.find(localTaskId, message.chatId);
    if (!pending) {
      await responder.replyProgress(
        streamId,
        `本会话没有找到工单短号 ${localTaskId}。发送 /pending 查看待办。`,
        true,
      );
      return;
    }
    if (["completed", "cancelled"].includes(pending.status)) {
      await responder.replyProgress(streamId, `工单短号 ${localTaskId} 当前状态不能填表。`, true);
      return;
    }
    if (pending.browserFill?.submitted) {
      await responder.replyProgress(
        streamId,
        `工单短号 ${localTaskId} 已在飞书提交，不会重复填写。提交腾讯草稿请发送 /done ${localTaskId}。`,
        true,
      );
      return;
    }
    if (!this.browserFiller?.enabled) {
      await responder.replyProgress(
        streamId,
        "飞书浏览器自动填表未启用，请检查本机 feishuBrowser 配置。",
        true,
      );
      return;
    }
    const result = await this.browserFiller.fill(pending);
    pending = this.#reassignTaskIdFromBrowser(pending, message.chatId, result);
    localTaskId = pending.id;
    this.pendingTasks.setBrowserFill(localTaskId, message.chatId, result);
    await responder.replyProgress(
      streamId,
      [
        formatBrowserFillSummary(result, {
          autoSubmit: this.config.feishuBrowser?.autoSubmit,
        }),
        `提交飞书后发送：\`/done ${localTaskId}\``,
      ].filter(Boolean).join("\n\n"),
      true,
    );
  }

  async #runDone(task) {
    const { message, responder, localTaskId } = task;
    const streamId = requestId("stream");
    const claim = this.pendingTasks.claim(localTaskId, message.chatId);
    if (!claim.ok) {
      const messages = {
        not_found: `本会话没有找到工单短号 ${localTaskId}。发送 /pending 查看待办。`,
        completed: `工单短号 ${localTaskId} 已生成过腾讯草稿，不会重复写入。`,
        cancelled: `工单短号 ${localTaskId} 已取消。`,
        processing: `工单短号 ${localTaskId} 正在处理，请稍候。`,
      };
      await responder.replyProgress(
        streamId,
        messages[claim.reason] || `无法处理工单短号 ${localTaskId}：${claim.reason}`,
        true,
      );
      return;
    }

    const pending = claim.task;
    try {
      const identifierErrors = validateDutyIdentifiers(pending.fillCard);
      if (identifierErrors.length) {
        throw new Error(`单号格式不正确：${identifierErrors.join("；")}`);
      }
      const spec = normalizeDutySpec(pending.draftSpec, pending.operator);
      validateDutySpec(spec);
      const update = await this.draftRepository.update(spec, {
        currentDate: pending.currentDate,
        previousDate: pending.previousDate,
        context: {
          workDate: pending.currentDate,
          shiftDate: pending.currentDate,
        },
      });
      this.pendingTasks.complete(localTaskId, message.chatId, {
        fileUrl: update.fileUrl,
        weeklyRows: update.weeklyRows,
        handoverRows: update.handoverRows,
        keptDates: update.keptDates,
      });
      const text = [
        "**腾讯文档草稿已更新**",
        `本地短号 ${localTaskId} · 使用人 ${pending.operator}`,
        `周报新增 ${spec.weeklyRows.length} 行 · 交接班新增 ${spec.handoverRows.length} 行`,
        `草稿保留：周报 ${update.weeklyRows} 行、交接班 ${update.handoverRows} 行（${update.keptDates.join(" / ")}）`,
        update.fileUrl,
      ].filter(Boolean).join("\n");
      await responder.replyProgress(streamId, text, true);
    } catch (error) {
      this.pendingTasks.fail(localTaskId, message.chatId, error.message);
      this.logger.error("确认飞书提交后更新腾讯草稿失败", error.message);
      await responder.replyProgress(
        streamId,
        `**腾讯文档草稿未更新**\n\n本地短号 ${localTaskId} 已保留，可排查后再次发送 /done ${localTaskId}。\n错误：${error.message}`,
        true,
      );
    }
  }

  async #runGeneral(task) {
    const { message, responder } = task;
    const threadId = this.#getChatValue("threads", message.chatId) || "";
    const result = await this.runner.run({
      prompt: message.text,
      threadId,
      images: message.images.map((image) => image.path),
    });
    if (result.threadId) this.#setChatValue("threads", message.chatId, result.threadId);
    await responder.replyProgress(
      requestId("stream"),
      `**Codex ${result.ok ? "已完成" : "执行失败"}**\n耗时 ${result.seconds}s\n\n${result.text}`,
      true,
    );
  }

  #warm() {
    this.runner.run({
      prompt: "值班草稿会话预热。不要调用工具，只回复 READY。",
      threadId: this.state.get("__dutyThread__", ""),
      reasoningEffort: this.config.duty.reasoningEffort,
      fastDuty: true,
    }).then((result) => {
      if (result.threadId) this.state.set("__dutyThread__", result.threadId);
      this.logger.info("值班会话预热", result.ok ? "成功" : "失败");
    });
  }

  #operatorForChat(chatId) {
    return this.#getChatValue("operator", chatId)
      || this.config.duty.defaultOperator
      || this.dutyConfig.operator_name;
  }

  #reassignTaskIdFromBrowser(task, chatId, browserResult) {
    const shortId = taskNumberToShortId(browserResult?.taskNumber);
    if (!shortId || shortId === task.id) return task;
    const updated = this.pendingTasks.reassignId(task.id, chatId, shortId);
    if (!updated) throw new Error(`无法将本地短号 ${task.id} 更新为 ${shortId}`);
    return updated;
  }

  #getChatValue(kind, chatId) {
    const mapping = this.state.get(`__${kind}ByChat__`, {});
    const value = mapping[chatId];
    if (kind === "operatorConfirm" || kind === "pendingDuty") {
      if (value?.expiresAt < Date.now()) return null;
    }
    return value;
  }

  #setChatValue(kind, chatId, value) {
    const mapping = this.state.get(`__${kind}ByChat__`, {});
    if (value == null) delete mapping[chatId];
    else mapping[chatId] = value;
    this.state.set(`__${kind}ByChat__`, mapping);
  }

  #cancelTask(chatId, id) {
    if (!id) return "请在 /cancel 后填写本地短号，例如：/cancel 42";
    const task = this.pendingTasks.find(id, chatId);
    if (!task) return `本会话没有找到工单短号 ${id}。`;
    if (task.status === "completed") return `工单短号 ${id} 已完成，不能取消。`;
    if (task.status === "cancelled") return `工单短号 ${id} 已经取消。`;
    if (task.status === "processing") return `工单短号 ${id} 正在处理，当前不能取消。`;
    this.pendingTasks.cancel(id, chatId);
    return `已取消本地工单短号 ${id}。腾讯草稿中的已有历史内容未改动。`;
  }

  #helpText() {
    return formatHelpText();
  }

}
