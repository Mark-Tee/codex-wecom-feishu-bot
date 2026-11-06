import {buildFeishuTestPrompt} from "../core/feishu-test-prompt.mjs";
import {resolveTaskShiftForWorkOrder,parseExpectedEnterAt} from "../core/task-workflow.mjs";
import remotePolicy from "../core/remote-policy.cjs";
import inputGuard from "../core/input-guard.cjs";
import crypto from "node:crypto";
import { applySiteRecordRules } from "../core/site-assignment.mjs";
import { readPowerRoster } from "../providers/tencent-docs/power-roster.mjs";
import { buildPowerDutyPrompt } from "../core/power-duty-prompt.mjs";
import fs from "node:fs";
import path from "node:path";
import {browserOutcome} from "./observation.mjs";
import {prepareImageEvidence} from "../platforms/image-evidence.mjs";
import { buildDutyPrompt } from "../core/duty-prompt.mjs";
import {
  inferShiftDateFromSpec,
  normalizeDutySpec,
  validateDutySpec,
} from "../core/duty-spec.mjs";
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
  formatDutyFailure,
  formatPendingTasks,
  formatStatus,
} from "./output-format.mjs";
import { taskNumberToShortId } from "../core/task-workflow.mjs";
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
    if(!inputGuard.validateWorkerMessage(message)){await responder.replyText("消息格式或长度不符合要求，请发送菜单查看用法。");return;}
    message={...message,images:message.images||[]};
    if (!message.userId || !message.chatId || message.userId === "unknown") {
      await responder.replyText("无法识别发起人，未处理任务，请重新发送。"); return;
    }
    message = {...message, sessionId: JSON.stringify([message.platform || "wecom", message.chatId, message.userId])};
    const text = String(message.text || "").trim();
    if(this.config.feishuBrowser?.writeApprovalFile && /^\/done(?:\s|$)/iu.test(text)){
      await responder.replyText("当前为飞书共享表单条测试，腾讯草稿暂不写入，请先完成本机核验。");return;
    }
    const denied=remotePolicy.remoteDenial(text);
    if(denied){await responder.replyText(denied);return;}
    if (text.startsWith("/pair")) {
      const code = text.split(/\s+/)[1] || "";
      const result = this.access.pair(message.userId, code);
      await responder.replyText(result.message);
      return;
    }
    if (!this.access.isAuthorized(message.userId)) {
      await responder.replyText(
        "无权限：该账号尚未授权，请联系维护者在本机配置。",
      );
      return;
    }

    if (message.boundOperator) {
      const name=message.boundOperator,existing=this.#getChatValue("operator",message.sessionId);
      if (this.dutyConfig.line.team_members.filter(value=>value===name).length!==1 || existing&&existing!==name) {
        await responder.replyText("本机批准的姓名与成员名单或本会话绑定不一致，请维护者核对；未覆盖身份、未处理工单。");return;
      }
      if(!existing)this.#setChatValue("operator",message.sessionId,name);
    }
    if(/^\/forget(?:\s|$)/i.test(text)){
      const result=this.#forgetTasks(message.sessionId,text),confirmation=this.#getChatValue("forgetConfirm",message.sessionId);
      await responder.replyText(result,result.startsWith("将停止追踪本人当前会话")&&confirmation?{action:{kind:"forget-confirm",token:confirmation.digest}}:undefined);return;
    }
    const savedTaskCommand = text.match(/^\/(fill|done)\s+#?(\d{1,8})$/i);
    if (savedTaskCommand && (!this.config.feishuBrowser?.writeApprovalFile || savedTaskCommand[1].toLowerCase() === "done")) {
      const savedTask = this.pendingTasks.find(savedTaskCommand[2], message.sessionId);
      if (savedTask?.workflowMode === "feishu-test") {
        await responder.replyText(`旧测试待办 ${savedTask.id} 已隔离，本次未写在线表。\n下一步：不要用该短号继续正式流程；有新的真实工单时发送新图片，旧测试需要维护者在本机核验。`);
        return;
      }
    }
    this.state.set("__lastChat__", {
      chatId: message.chatId,
      chatType: message.chatType,
      userId: message.userId,
      platform: message.platform,
      at: message.receivedAt,
    });

    const privateHome = message.chatType === "single" && ["/help", "帮助", "首页", "我的工单", "还有哪些没处理"].includes(text);
    if (privateHome) {
      const operator = this.#getChatValue("operator", message.sessionId);
      const names = [...new Set(Object.entries(this.state.get("__operatorByChat__", {})).filter(([key])=>{try{const parts=JSON.parse(key);return parts[0]===(message.platform||"wecom") && parts[2]===message.userId;}catch{return false;}}).map(([,name])=>name))];
      if (!operator && names.length===1 && this.dutyConfig.line.team_members.includes(names[0])) {
        this.#setChatValue("operatorConfirm", message.sessionId, {name:names[0],expiresAt:Date.now()+300000});
        await responder.replyText(`沿用你已确认的姓名“${names[0]}”？回复“是”确认，或 /as 本人姓名更正。群聊任务不会带入。`); return;
      }
      await responder.replyText(`【我的工单】\n使用人：${operator || "未绑定，请发送 /as 本人姓名"}\n\n${formatPendingTasks(this.pendingTasks.list(message.sessionId))}\n\n继续：查看待确认问题\n补充 内容：回答问题\n/pending：待办短号\n/help：使用说明\n群聊与私聊任务独立。`); return;
    }
    if (text === "/help" || text === "帮助") {
      await responder.replyText(this.#helpText());
      return;
    }
    if (text === "/status" || text === "状态") {
      await responder.replyText(formatStatus({
        startedAt: this.startedAt,
        queueSize: this.queue.size,
        queueRunning: this.queue.running,
        operator: this.#operatorForChat(message.sessionId),
        workflowMode: this.config.duty.workflowMode,
        browserEnabled: this.browserFiller?.enabled,
        pendingCount: this.pendingTasks.activeCount(message.sessionId),
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
      this.#setChatValue("threads", message.sessionId, "");
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
      await responder.replyText(formatPendingTasks(this.pendingTasks.list(message.sessionId)));
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
      await responder.replyText(this.#cancelTask(message.sessionId, cancel[1]));
      return;
    }

    const identity = await this.#handleIdentity(message, text, responder);
    if (identity.handled) return;
    if (identity.cleanedText !== undefined) {
      message = { ...message, text: identity.cleanedText };
    }

    if (text === "继续" || text === "继续处理") {
      const waiting = this.#getChatValue("pendingDuty", message.sessionId);
      await responder.replyText(waiting ? `你有一张待补充信息的工单：\n${waiting.clarification || "请补充处理条件"}\n回复：补充 具体内容` : formatPendingTasks(this.pendingTasks.list(message.sessionId)));
      return;
    }
    if (!this.#getChatValue("operator", message.sessionId)) {
      await responder.replyText("请先确认本人身份：发送 /as 姓名，例如 /as 测试甲（换为本人）。每个群单独设置，不使用他人的默认身份。"); return;
    }
    const pendingDuty = await this.#handlePendingDuty(message, responder);
    if (pendingDuty.handled) return;
    if (pendingDuty.task) message = pendingDuty.task;

    if(this.config.duty.enabled&&!isDutyIntent(message.text,message.images)){
      await responder.replyText("这是工单机器人，只处理工单和本人待办。没有待确认的问题时无需回复是/不是；发送“菜单”查看用法。");return;
    }
    const task = {
      id: requestId("task"),
      kind: this.config.duty.enabled && isDutyIntent(message.text, message.images)
        ? "duty"
        : "general",
      message,
      responder,
      operator: this.#operatorForChat(message.sessionId),
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
    const pending = this.#getChatValue("operatorConfirm", message.sessionId);
    if (pending?.expiresAt > Date.now()) {
      if (/^(是|是的|对|对的|没错|确定|嗯)$/i.test(text)) {
        this.#setChatValue("operator", message.sessionId, pending.name);
        this.#setChatValue("operatorConfirm", message.sessionId, null);
        await responder.replyText(`已确认，本会话使用人切换为：${pending.name}\n请继续发送工单。`);
        return { handled: true };
      }
      if (/^(不是|不对|否|错了|不正确)$/i.test(text)) {
        this.#setChatValue("operatorConfirm", message.sessionId, null);
        await responder.replyText(`请重新发送正确姓名，可选：${members.join("、")}`);
        return { handled: true };
      }
      this.#setChatValue("operatorConfirm", message.sessionId, null);
    }

    const request = parseOperatorRequest(text);
    if (!request) return { handled: false };
    if (members.includes(request.name)) {
      this.#setChatValue("operator", message.sessionId, request.name);
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
      this.#setChatValue("operatorConfirm", message.sessionId, {
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
    const pending = this.#getChatValue("pendingDuty", message.sessionId);
    if (!pending || pending.expiresAt < Date.now()) return { handled: false };
    const text = String(message.text || "").trim();
    if (/^(取消|撤销|算了|不记了)$/i.test(text)) {
      this.#setChatValue("pendingDuty", message.sessionId, null);
      await responder.replyText("已取消这条工单的草稿记录。");
      return { handled: true };
    }
    let supplement = "";
    if (/^补充\s+\S/.test(text)) {
      supplement = text.replace(/^补充\s+/, "");
    } else if (/^(直接记录|按计划预录|按计划记录|计划预录)$/i.test(text)) {
      supplement = "按计划时间预录，任务反馈写未开始，结束时间使用工单要求结束时间。";
    } else if (/^(按当前进展|记录当前进展|当前进展)$/i.test(text)) {
      supplement = "按当前进展记录，结束时间使用收到时间，任务反馈写处理中。";
    } else if (/^(已完成|按已完成记录|完成记录)$/i.test(text)) {
      supplement = "按已完成记录，结束时间使用收到时间与要求结束时间中较早者。";
    } else {
      await responder.replyText("请发送“补充 内容”回答待确认问题，或选择按计划预录、按当前进展记录、已完成。");
      return { handled: true };
    }
    this.#setChatValue("pendingDuty", message.sessionId, null);
    return {
      handled: false,
      task: {
        ...message,
        receivedAt: pending.receivedAt || message.receivedAt,
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
      task.responder.observe?.("failed");
      task.responder.failure?.(error);
      this.logger.error("任务执行失败", error.message);
      await task.responder.replyProgress(
        requestId("stream"),
        ["duty", "done", "browser-fill"].includes(task.kind)
          ? formatDutyFailure(error)
          : `**Codex 执行失败**\n\n${error.message}`,
        true,
      ).catch(() => {});
    } finally {
      this.currentTask = null;
    }
  }

  async #runDuty(task) {
    const { responder, operator } = task;
    await responder.stage?.("recognizing");
    let message = task.message;
    message = await prepareImageEvidence(message, this.config, this.logger);
    const streamId = requestId("stream");
    const receivedAt = message.receivedAt || new Date().toISOString();
    const promptSource = `${message.text || ""}\n${message.ocrText || ""}`;
    const powerDuty = this.config.duty.powerDuty?.enabled
      ? await readPowerRoster({
        client: this.docsClient, config: this.dutyConfig, receivedAt, operator,
        cachePath: this.config.duty.powerDuty.cachePath,
      })
      : null;
    const powerOnly = Boolean(powerDuty?.matched);
    const feishuTest=Boolean(this.config.feishuBrowser?.writeApprovalFile);
    const context = powerOnly || feishuTest ? { powerDuty, schedule: [] } : await buildDutyContext({
      client: this.docsClient,
      config: this.dutyConfig,
      prompt: promptSource,
      receivedAt,
      operator,
    });
    const warning = context.schedule.flatMap((day) => day.warnings || [])[0];
    if (warning) {
      responder.observe?.("source_conflict");
      this.#setChatValue("pendingDuty", message.sessionId, {
        userText: message.text,
        images: message.images,
        ocrText: message.ocrText,
        receivedAt,
        clarification: warning,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await responder.replyProgress(streamId, `**需要确认 · 尚未写表**\n\n${warning}\n\n下一步：在当前聊天回复“补充 你确认的内容”；无法确认时联系维护者核对排班。`, true);
      return;
    }

    const prompt = feishuTest ? buildFeishuTestPrompt({message:{...message,receivedAt},powerDuty,browserConfig:this.config.feishuBrowser}) : powerOnly ? buildPowerDutyPrompt({ message: { ...message, receivedAt }, context: powerDuty }) : buildDutyPrompt({
      userText: message.text,
      context,
      ocrText: message.ocrText,
      images: message.images.map((image) => image.path),
      receivedAt,
    });
    const result = await this.runner.run({
      prompt,
      threadId: this.#getChatValue("dutyThreads", message.sessionId) || "",
      images: message.images.map((image) => image.path),
      reasoningEffort: this.config.duty.reasoningEffort,
      fastDuty: true,
    });
    if (result.threadId) this.#setChatValue("dutyThreads", message.sessionId, result.threadId);
    if (!result.ok) throw new Error(result.text);

    const parsed = extractDutyJson(result.text);
    if (!parsed) {
      responder.observe?.("recognition_invalid");
      this.#setChatValue("pendingDuty", message.sessionId, {
        userText: message.text,
        images: message.images,
        ocrText: message.ocrText,
        receivedAt,
        clarification: "Codex 未返回可解析 JSON",
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await responder.replyProgress(streamId, "**识别结果未能解析 · 尚未写表**\n\n下一步：把这条回复转给维护者检查识别结果，你暂时无需补充或重复发图。", true);
      return;
    }
    if (parsed.needsClarification) {
      responder.observe?.("clarification");
      this.#setChatValue("pendingDuty", message.sessionId, {
        userText: message.text,
        images: message.images,
        ocrText: message.ocrText,
        receivedAt,
        clarification: parsed.needsClarification,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      await responder.replyProgress(streamId, `**需要确认 · 尚未写表**\n\n${parsed.needsClarification}\n\n下一步：在当前聊天回复“补充 你确认的文字”，例如“补充 机架字母是 I”；只回答上面的问题即可，不必重发图片。`, true);
      return;
    }

    let normalized = powerOnly || feishuTest ? { weeklyRows: [], handoverRows: [] } : normalizeDutySpec({
      weeklyRows: parsed.weeklyRows,
      handoverRows: parsed.handoverRows,
    }, operator);
    validateDutySpec(normalized);
    const fillCard = normalizeFillCard(parsed.fillCard);
    if(feishuTest){
      if(!fillCard.source)fillCard.source=this.config.feishuBrowser.defaults?.source||"";
      if(!fillCard.specificWork.startsWith("【测试勿统计】"))fillCard.specificWork="【测试勿统计】"+fillCard.specificWork;
    }
    if(feishuTest && !parseExpectedEnterAt(fillCard.expectedEnterAt)){
      responder.observe?.("clarification");
      await responder.replyProgress(streamId,"工单原日期或时间不清楚，尚未写入飞书。下一步：重新发送日期和时间清晰的原工单图片，不用收到日期代替。",true);return;
    }
    const sitePolicy = powerOnly || feishuTest ? { assignment: null, skipHomeDraft: false } : applySiteRecordRules(normalized, {
      context, fillCard, config: this.dutyConfig,
    });
    if (!powerOnly && !feishuTest) normalized = sitePolicy.spec;
    const inferredCard = inferFillCardFromSpec(normalized);
    for (const [key, value] of Object.entries(inferredCard)) {
      if (!fillCard[key]) fillCard[key] = value;
    }
    const identifierErrors = validateDutyIdentifiers(fillCard);
    if (identifierErrors.length) {
      responder.observe?.("identifiers_invalid");
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
    if (!powerOnly && !feishuTest) {
      const taskDir = path.join(this.config.runtime.specRoot, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, "draft-spec.json"), JSON.stringify(normalized, null, 2), "utf8");
    }
    const currentDate = feishuTest ? resolveTaskShiftForWorkOrder({expectedEnterAt:fillCard.expectedEnterAt,receivedAt}).date : powerOnly ? powerDuty.date : inferShiftDateFromSpec(normalized, context);
    this.#setChatValue("pendingDuty", message.sessionId, null);

    if (!feishuTest && !powerOnly && !sitePolicy.skipHomeDraft && this.config.duty.workflowMode === "direct-draft") {
      const update = await this.draftRepository.update(normalized, {
        currentDate,
        previousDate: context.previousWorkedDate,
        context,
      });
      responder.observe?.("draft_returned");
      const text = [
        "**腾讯文档草稿已更新**",
        `使用人 ${operator} · 周报新增 ${update.weeklyRows} 行 · 交接班新增 ${update.handoverRows} 行`,
        "周报追加，交接按班次汇总；已有交接行先确认，正式表不自动修改。",
        update.fileUrl,
        "下一步：打开链接核对新增草稿；无需重复发送工单。",
      ].join("\n");
      await responder.replyProgress(streamId, text, true);
      return;
    }

    let pending = this.pendingTasks.create({
      chatId: message.sessionId,
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
      workflowMode: powerOnly ? "power-duty" : feishuTest ? "feishu-test" : sitePolicy.skipHomeDraft ? "offsite-feishu" : this.config.duty.workflowMode,
      siteAssignment: sitePolicy.assignment,
      powerDuty: powerOnly ? powerDuty : null,
      currentDate,
      previousDate: context.previousWorkedDate,
    });
    let browserStatus = "";
    let browserResult = null;
    if (this.browserFiller?.enabled && this.config.feishuBrowser?.autoFill !== false) {
      await responder.stage?.("checking");
      browserResult = await this.browserFiller.fill(pending);
      responder.observe?.(browserOutcome(browserResult,this.config.feishuBrowser));
      pending = this.#reassignTaskIdFromBrowser(pending, message.sessionId, browserResult);
      this.pendingTasks.setBrowserFill(pending.id, message.sessionId, browserResult);
      browserStatus = formatBrowserFillSummary(browserResult, {
        autoSubmit: this.config.feishuBrowser?.autoSubmit,
        taskId: pending.id,
        testOnly: feishuTest,
      });
    }
    if (sitePolicy.skipHomeDraft) {
      await this.#finishOffsiteFill(pending, browserResult, message, responder, streamId);
      return;
    }
    if (powerOnly) {
      await this.#finishPowerFill(pending, browserResult, message, responder, streamId);
      return;
    }
    if (browserResult?.submitted) {
      await responder.replyProgress(
        streamId,
        [
          browserStatus,
        ].filter(Boolean).join("\n\n"),
        true,
      );
      return;
    }
    await responder.replyProgress(
      streamId,
      [
        feishuTest ? `【共享表测试：字段已识别】\n本地短号：${pending.id}（机器人待办编号，不是飞书单号）\n原日期：${fillCard.expectedEnterAt}\n${browserStatus ? "" : "下一步：联系维护者核验并批准本次写入；你暂时无需操作。"}` : formatFillCard(pending, {
          autoSubmit: Boolean(this.browserFiller?.enabled && this.config.feishuBrowser?.autoSubmit),
          instructions: !browserStatus,
        }),
        browserStatus,
      ].filter(Boolean).join("\n\n"),
      true,
    );
  }

  async #finishOffsiteFill(pending, result, message, responder, streamId) {
    if (result?.submitted && result.verification?.ok && !result.requiresReadback) {
      this.pendingTasks.complete(pending.id, message.sessionId, { workflowMode: "offsite-feishu", taskNumber: result.taskNumber });
    }
    await responder.replyProgress(streamId, [
      `当日排班：${pending.siteAssignment.slot} · ${pending.siteAssignment.site} · ${pending.siteAssignment.assignmentType}`,
      formatBrowserFillSummary(result, { autoSubmit: this.config.feishuBrowser?.autoSubmit, skipDraft: true, taskId: pending.id }),
      `本地短号：${pending.id}。不自动生成本地站点工作记录或交接班，本地站点打卡不作为工作地点证据。`,
      !result?.configured ? "下一步：联系维护者检查飞书连接，暂时无需操作。" : "",
    ].filter(Boolean).join("\n\n"), true);
  }

  async #finishPowerFill(pending, result, message, responder, streamId) {
    if (result?.submitted && result.verification?.ok && !result.requiresReadback) {
      this.pendingTasks.complete(pending.id, message.sessionId, { taskNumber: result.taskNumber, workflowMode: "power-duty" });
    }
    const text = [
      "**动力值班：仅建飞书单**",
      `按收单时间判断：${pending.powerDuty.date} ${pending.powerDuty.kind}`,
      formatBrowserFillSummary(result, { autoSubmit: this.config.feishuBrowser?.autoSubmit, powerDuty: true, taskId: pending.id }),
      `本地短号：${pending.id}；指派人员、陪同人留空。`,
      !result?.configured ? "下一步：联系维护者检查飞书连接，暂时无需操作；本单不生成腾讯草稿。" : "",
    ].filter(Boolean).join("\n\n");
    await responder.replyProgress(streamId, text, true);
  }

  async #runBrowserFillTask(task) {
    const { message, responder, localTaskId } = task;
    const streamId = requestId("stream");
    let pending = this.pendingTasks.find(localTaskId, message.sessionId);
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
        formatBrowserFillSummary({...pending.browserFill, configured: true}, {taskId: localTaskId, powerDuty: pending.workflowMode === "power-duty", skipDraft: pending.workflowMode === "offsite-feishu", testOnly: Boolean(this.config.feishuBrowser?.writeApprovalFile)}),
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
    if (this.config.duty.powerDuty?.enabled) {
      const latest = await readPowerRoster({
        client: this.docsClient, config: this.dutyConfig,
        receivedAt: pending.receivedAt, operator: pending.operator,
        cachePath: this.config.duty.powerDuty.cachePath,
      });
      if (latest.matched !== (pending.workflowMode === "power-duty")) {
        await responder.replyProgress(streamId, "在线排班已变更，原工单模式可能不适用。请重新发送工单核对，暂不提交飞书。", true);
        return;
      }
    }
    await responder.stage?.("checking");
    const result = await this.browserFiller.fill(pending);
    responder.observe?.(browserOutcome(result,this.config.feishuBrowser));
    pending = this.#reassignTaskIdFromBrowser(pending, message.sessionId, result);
    this.pendingTasks.setBrowserFill(pending.id, message.sessionId, result);
    if (pending.workflowMode === "offsite-feishu") {
      await this.#finishOffsiteFill(pending, result, message, responder, streamId);
      return;
    }
    if (pending.workflowMode === "power-duty") {
      await this.#finishPowerFill(pending, result, message, responder, streamId);
      return;
    }
    await responder.replyProgress(
      streamId,
      [
        formatBrowserFillSummary(result, {
          autoSubmit: this.config.feishuBrowser?.autoSubmit,
          taskId: pending.id,
          testOnly: Boolean(this.config.feishuBrowser?.writeApprovalFile),
        }),
        this.config.feishuBrowser?.writeApprovalFile ? "本次只测试飞书，腾讯草稿不写。" : "",
      ].filter(Boolean).join("\n\n"),
      true,
    );
  }

  async #runDone(task) {
    const { message, responder, localTaskId } = task;
    const streamId = requestId("stream");
    const existing = this.pendingTasks.find(localTaskId, message.sessionId);
    if (existing?.workflowMode === "offsite-feishu") {
      await responder.replyProgress(streamId, "该工单当天为异地岗位且没有明确本地站点实际工单，不生成本地站点周报或交接班，无需 /done。", true);
      return;
    }
    if (existing?.workflowMode === "power-duty") {
      await responder.replyProgress(streamId, `动力值班短号 ${localTaskId} 仅负责飞书建单，不生成腾讯周报或交接班草稿，无需 /done。`, true);
      return;
    }
    const claim = this.pendingTasks.claim(localTaskId, message.sessionId);
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
      this.pendingTasks.complete(localTaskId, message.sessionId, {
        fileUrl: update.fileUrl,
        weeklyRows: update.weeklyRows,
        handoverRows: update.handoverRows,
        keptDates: update.keptDates,
      });
      responder.observe?.("draft_returned");
      const text = [
        "**腾讯文档草稿已更新**",
        `本地短号 ${localTaskId} · 使用人 ${pending.operator}`,
        `周报新增 ${update.weeklyRows} 行 · 交接班新增 ${update.handoverRows} 行`,
        "周报追加，交接按班次汇总；已有交接行先确认，正式表不自动修改。",
        update.fileUrl,
        "下一步：打开链接核对新增草稿；无需重复发送 /done。",
      ].filter(Boolean).join("\n");
      await responder.replyProgress(streamId, text, true);
    } catch (error) {
      this.pendingTasks.fail(localTaskId, message.sessionId, error.message);
      responder.observe?.("failed");
      responder.failure?.(error);
      this.logger.error("确认飞书提交后更新腾讯草稿失败", error.message);
      await responder.replyProgress(
        streamId,
        `**腾讯文档草稿未全部完成**\n\n本地短号 ${localTaskId} 已保留，可能已有部分内容写入。\n错误：${error.message}\n\n下一步：将短号 ${localTaskId} 和本条回复交给维护者核验，等待明确结果后再操作，不要立即重试 /done。`,
        true,
      );
    }
  }

  async #runGeneral(task) {
    const { message, responder } = task;
    const threadId = this.#getChatValue("threads", message.sessionId) || "";
    const result = await this.runner.run({
      prompt: message.text,
      threadId,
      images: message.images.map((image) => image.path),
    });
    if (result.threadId) this.#setChatValue("threads", message.sessionId, result.threadId);
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
      || "未绑定";
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

  #forgetTasks(chatId,text) {
    const command=text.match(/^\/forget\s+(#?\d{1,8}|all|confirm|dismiss)(?:\s+([a-f0-9]{64}))?$/i);
    if(!command)return "用法：清10；清全部后按提示确认。仅停止本人当前会话追踪，不删除在线记录。";
    const target=command[1].toLowerCase();
    const token=command[2];
    if((token&&!["confirm","dismiss"].includes(target))||(target==="dismiss"&&!token))return "确认卡无效，本次未清除。重新发送“清全部”。";
    if(target==="dismiss"){
      const confirmation=this.#getChatValue("forgetConfirm",chatId);
      if(confirmation?.digest!==token)return "确认卡已失效，本次未清除。";
      this.#setChatValue("forgetConfirm",chatId,null);return "已保留待办，本次不清除；在线记录未改动。";
    }
    const tasks=this.pendingTasks.list(chatId,{limit:Infinity}).sort((a,b)=>Number(a.id)-Number(b.id));
    if(this.currentTask?.message?.sessionId===chatId || this.queue.items.some(task=>task.message?.sessionId===chatId) || tasks.some(task=>task.status==="processing"))return "本会话有任务处理中或排队，本次未清除。结束后重发；不要重复提交。";
    if(target!=="all" && target!=="confirm"){
      const task=this.pendingTasks.find(target,chatId);
      if(!task)return "本人当前会话没有这个短号，未清除。发送“单”查看。";
      if(["completed","cancelled"].includes(task.status))return `短号${task.id}已结束，不再追踪；在线记录未改动。`;
      this.pendingTasks.cancel(task.id,chatId);
      this.#setChatValue("dutyThreads",chatId,null);
      this.#setChatValue("forgetConfirm",chatId,null);
      return `已停止追踪短号${task.id}，不再续跑；在线记录未改动。`;
    }
    const waiting=this.#getChatValue("pendingDuty",chatId);
    const digest=crypto.createHash("sha256").update(JSON.stringify({tasks,waiting:waiting || null})).digest("hex");
    if(target==="all"){
      if(!tasks.length && !waiting)return "本人当前会话没有待办或待补充任务。";
      const preview=[`将停止追踪本人当前会话${tasks.length}条待办：`,tasks.map(task=>task.id).join("、") || "无编号待办",waiting?"另有1条未编号待补充任务。":"","在线记录不删除。5分钟内回复“确认清全部”执行。"].filter(Boolean).join("\n");
      if(Buffer.byteLength(preview,"utf8")>3000)return "待办较多，无法完整展示确认范围，未清除。请使用“清 短号”逐条处理。";
      this.#setChatValue("forgetConfirm",chatId,{digest,expiresAt:Date.now()+300000});
      return preview;
    }
    const pending=this.#getChatValue("forgetConfirm",chatId);
    if(token&&pending?.digest!==token)return "确认卡对应的清单已失效，本次未清除。重新发送“清全部”。";
    this.#setChatValue("forgetConfirm",chatId,null);
    if(!pending || pending.expiresAt<Date.now())return "清除确认已失效或尚未预览，本次未清除。重新发送“清全部”。";
    if(pending.digest!==digest)return "待办或待补充内容已变化，本次未清除。重新发送“清全部”核对范围。";
    for(const task of tasks)this.pendingTasks.cancel(task.id,chatId);
    this.#setChatValue("pendingDuty",chatId,null);
    this.#setChatValue("dutyThreads",chatId,null);
    return `已停止追踪${tasks.length}条待办${waiting?"及1条待补充任务":""}，不再续跑；在线记录未改动。`;
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
