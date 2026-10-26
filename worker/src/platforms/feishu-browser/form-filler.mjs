import { EdgeFormSession, sleep } from "./edge-session.mjs";
import { validateDutyIdentifiers } from "../../core/duty-identifiers.mjs";
import {
  chooseWorkContent,
  matchOption,
  normalizeOption,
  resolvePersonFields,
} from "./field-options.mjs";
import {
  clickVisibleTextScript,
  datePickerVisibleScript,
  dateTimeInputValuesScript,
  dropdownRectScript,
  fieldElementPointScript,
  fieldContainsValueScript,
  fieldSelector,
  optionRectScript,
  openPersonSelectorScript,
  personOptionRectScript,
  pickerCellPointScript,
  pickerHeaderButtonPointScript,
  pickerHeaderTextsScript,
  visibleButtonPointScript,
  visibleElementScript,
} from "./dom-scripts.mjs";
import {
  readTaskNumbers,
} from "./task-list-reader.mjs";
import {
  nextTaskNumber,
  parseExpectedEnterAt,
  resolveTaskShiftForWorkOrder,
} from "../../core/task-workflow.mjs";

export {
  chooseWorkContent,
  matchOption,
  normalizeOption,
  resolvePersonFields,
} from "./field-options.mjs";
export { parseBitableTarget } from "./task-list-reader.mjs";

export function assertNoOpenRecordForm(alreadyOpen) {
  if (alreadyOpen) {
    throw new Error(
      "检测到已有飞书记录卡已打开，已拒绝复用；请先关闭该记录卡后重试",
    );
  }
}

export class FeishuBrowserFormFiller {
  constructor({ config = {}, logger } = {}) {
    this.config = config;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.config.enabled && this.config.formUrl && this.config.fieldIds);
  }

  #selector(fieldId) {
    return fieldSelector(fieldId, this.config.entryMode || "form");
  }

  async #waitForForm(session) {
    const selectors = Object.values(this.config.fieldIds).map((fieldId) => this.#selector(fieldId));
    const deadline = Date.now() + Number(this.config.formTimeoutMs || 20_000);
    while (Date.now() < deadline) {
      const state = await session.evaluate(`(() => ({
        url: location.href,
        ready: document.readyState,
        form: ${JSON.stringify(selectors)}.every((selector) => document.querySelector(selector)),
        login: /(扫码登录|登录飞书|请登录)/.test(document.body?.innerText || "")
      }))()`);
      if (state?.form) {
        await sleep(1000);
        return;
      }
      if (state?.login) {
        throw new Error("飞书浏览器尚未登录。请在自动打开的 Edge 中完成登录后发送 /fill <短号>。");
      }
      await sleep(300);
    }
    throw new Error("飞书表单未加载，请确认浏览器已登录且表单链接有效");
  }

  #readTaskNumbers(session, prefix) {
    return readTaskNumbers(session, {
      formUrl: this.config.formUrl,
      viewId: this.config.taskListViewId,
      fieldId: this.config.fieldIds?.taskList,
      pageSize: this.config.taskListPageSize,
    }, prefix);
  }

  async #openRecordModal(session) {
    const clickVisibleText = (text) => session.evaluate(clickVisibleTextScript(text));

    const selectors = Object.values(this.config.fieldIds).map((fieldId) => this.#selector(fieldId));
    const alreadyOpen = await session.evaluate(
      `${JSON.stringify(selectors)}.some((selector) => document.querySelector(selector))`,
    );
    assertNoOpenRecordForm(alreadyOpen);

    const deadline = Date.now() + Number(this.config.formTimeoutMs || 20_000);
    let viewClicked = false;
    while (Date.now() < deadline && !viewClicked) {
      viewClicked = await clickVisibleText("待办任务列表");
      if (!viewClicked) await sleep(300);
    }
    if (!viewClicked) throw new Error("找不到“待办任务列表”视图");
    await sleep(400);
    const modalOpen = await session.evaluate(
      `${JSON.stringify(selectors)}.some((selector) => document.querySelector(selector))`,
    );
    let addClicked = modalOpen;
    while (Date.now() < deadline && !addClicked) {
      addClicked = await clickVisibleText("添加记录");
      if (!addClicked) await sleep(300);
    }
    if (!addClicked) throw new Error("找不到“添加记录”按钮");
    await this.#waitForForm(session);
  }

  async #clickField(session, fieldId) {
    const selector = this.#selector(fieldId);
    const candidates = await session.evaluate(visibleElementScript(selector));
    if (!candidates?.length) throw new Error(`找不到可填写控件：${fieldId}`);
    const point = candidates.find((candidate) => candidate.tag !== "BUTTON") || candidates[0];
    await session.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:"center"})`);
    await sleep(150);
    const refreshed = await session.evaluate(visibleElementScript(selector));
    const target = refreshed?.[0];
    if (!target) throw new Error(`字段不可见：${fieldId}`);
    await session.click(target.x, target.y);
    await sleep(150);
  }

  async #fillText(session, fieldId, value) {
    if (!value) return false;
    await this.#clickField(session, fieldId);
    const focused = await session.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(this.#selector(fieldId))});
      return Boolean(root && document.activeElement && root.contains(document.activeElement));
    })()`);
    if (!focused) {
      const fallbackFocused = await session.evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(this.#selector(fieldId))});
        const editor = root?.querySelector('[contenteditable="true"]');
        if (!editor) return false;
        editor.focus();
        editor.click();
        return root.contains(document.activeElement);
      })()`);
      if (!fallbackFocused) throw new Error("文本控件未获得焦点");
    }
    await session.selectAll();
    await session.pressBackspace();
    await session.insertText(value);
    await sleep(150);
    return true;
  }

  async #chooseOption(session, fieldId, value) {
    if (!value) return false;
    const point = await session.evaluate(dropdownRectScript(this.#selector(fieldId)));
    if (!point) throw new Error("找不到下拉控件");
    await session.click(point.x, point.y);
    let option = null;
    for (let attempt = 0; attempt < 10 && !option; attempt += 1) {
      await sleep(200);
      option = await session.evaluate(optionRectScript(value));
    }
    if (!option) throw new Error(`选项不存在：${value}`);
    await session.click(option.x, option.y);
    await sleep(200);
    return true;
  }

  async #clearSelectedValues(session, fieldId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clicked = await session.evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(this.#selector(fieldId))});
        const element = root?.querySelector(
          '.b-user-tag-close, .ud__tag__close-icon, .b-select-value-close, [class*="close-icon"]'
        );
        if (!element) return false;
        element.click();
        return true;
      })()`);
      if (!clicked) return;
      await sleep(100);
    }
  }

  async #choosePerson(session, fieldId, value) {
    if (!value) return false;
    const selector = this.#selector(fieldId);
    if (this.config.entryMode !== "record") await session.pressEscape();
    await this.#clearSelectedValues(session, fieldId);
    const point = await session.evaluate(dropdownRectScript(selector));
    if (!point) throw new Error("找不到人员选择控件");
    let opened = await session.evaluate(openPersonSelectorScript(selector));
    if (!opened) {
      await session.click(point.x, point.y);
      await sleep(300);
      opened = await session.evaluate(openPersonSelectorScript(selector));
    }
    if (!opened) throw new Error("找不到人员搜索框");
    await session.selectAll();
    await session.insertText(value);
    let option = null;
    for (let attempt = 0; attempt < 50 && !option; attempt += 1) {
      await sleep(200);
      option = await session.evaluate(personOptionRectScript(selector, value));
    }
    if (!option) throw new Error(`人员不存在：${value}`);
    await session.click(option.x, option.y);
    let confirmed = false;
    for (let attempt = 0; attempt < 15 && !confirmed; attempt += 1) {
      await sleep(200);
      confirmed = await session.evaluate(fieldContainsValueScript(selector, value));
    }
    if (!confirmed) throw new Error(`人员选择未生效：${value}`);
    if (this.config.entryMode !== "record") await session.pressEscape();
    return true;
  }

  async #pickDate(session, selector, parsed) {
    const [year, month, day] = parsed.date.split("/").map(Number);
    const datePoint = await session.evaluate(fieldElementPointScript(
      selector,
      ".bitable-f9ce0c__calendar-picker-input",
    ));
    if (!datePoint) throw new Error("找不到日期输入框");
    await session.click(datePoint.x, datePoint.y);
    await sleep(300);

    const clickHeader = async (textPattern) => {
      const point = await session.evaluate(pickerHeaderButtonPointScript(selector, textPattern));
      if (point) await session.click(point.x, point.y);
      await sleep(250);
    };

    const header = await session.evaluate(pickerHeaderTextsScript(selector));
    const displayedYear = header.find((item) => /^\d{4}年$/.test(item));
    if (displayedYear !== `${year}年`) {
      await clickHeader("/^\\d{4}年$/");
      const yearPoint = await session.evaluate(pickerCellPointScript(selector, String(year)));
      if (!yearPoint) throw new Error("日期面板找不到目标年份");
      await session.click(yearPoint.x, yearPoint.y);
      await sleep(250);
    }

    const monthLabel = `${month}月`;
    const currentHeader = await session.evaluate(pickerHeaderTextsScript(selector));
    const currentMonth = currentHeader.find((item) => /^\d{1,2}月$/.test(item)) || "";
    if (currentMonth !== monthLabel) {
      await clickHeader("/^\\d{1,2}月$/");
      const monthPoint = await session.evaluate(pickerCellPointScript(selector, String(month)));
      if (!monthPoint) throw new Error("日期面板找不到目标月份");
      await session.click(monthPoint.x, monthPoint.y);
      await sleep(250);
    }

    const dayPoint = await session.evaluate(pickerCellPointScript(selector, String(day)));
    if (!dayPoint) throw new Error("日期面板找不到目标日期");
    await session.click(dayPoint.x, dayPoint.y);
    await sleep(250);
  }

  async #fillDateTime(session, fieldId, value) {
    const parsed = parseExpectedEnterAt(value);
    if (!parsed) return false;
    const selector = this.#selector(fieldId);
    if (this.config.entryMode !== "record") await session.pressEscape();
    await this.#pickDate(session, selector, parsed);
    const timePoint = await session.evaluate(fieldElementPointScript(
      selector,
      ".bitable-f9ce0c__time-picker-input",
    ));
    if (!timePoint) throw new Error("找不到时间输入框");
    await session.click(timePoint.x, timePoint.y);
    await session.selectAll();
    await session.pressBackspace();
    await session.insertText(parsed.time);
    await session.pressEnter();
    await sleep(300);
    const values = await session.evaluate(dateTimeInputValuesScript(selector));
    if (values?.date !== parsed.date || values?.time !== parsed.time) {
      throw new Error("日期时间写入未生效");
    }
    if (
      this.config.entryMode === "record"
      && await session.evaluate(datePickerVisibleScript(selector))
    ) {
      const datePoint = await session.evaluate(fieldElementPointScript(
        selector,
        ".bitable-f9ce0c__calendar-picker-input",
      ));
      if (!datePoint) throw new Error("找不到日期输入框");
      await session.click(datePoint.x, datePoint.y);
      await sleep(250);
      if (await session.evaluate(datePickerVisibleScript(selector))) {
        throw new Error("日期选择器未关闭");
      }
    }
    return true;
  }

  async #readFieldValues(session, ids) {
    const selectors = Object.fromEntries(
      Object.entries(ids).map(([key, fieldId]) => [key, this.#selector(fieldId)]),
    );
    return session.evaluate(`(() => {
      const read = (selector) => {
        const root = document.querySelector(selector);
        const menu = root?.querySelector('.b-select-dropdown-menu');
        const editor = root?.querySelector('[contenteditable="true"]');
        return {
          menuText: String(menu?.innerText || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim(),
          selectedText: [...(root?.querySelectorAll('.b-select-value-list .b-user-tag-text') || [])]
            .map((element) => String(element.textContent || '').trim())
            .join('、'),
          text: String(editor?.innerText || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim(),
          inputs: [...(root?.querySelectorAll('input') || [])].map((input) => input.value),
        };
      };
      return {
        taskList: read(${JSON.stringify(selectors.taskList)}),
        source: read(${JSON.stringify(selectors.source)}),
        location: read(${JSON.stringify(selectors.location)}),
        transactionNo: read(${JSON.stringify(selectors.transactionNo)}),
        roomTicketNo: read(${JSON.stringify(selectors.roomTicketNo)}),
        workContent: read(${JSON.stringify(selectors.workContent)}),
        specificWork: ${selectors.specificWork ? `read(${JSON.stringify(selectors.specificWork)})` : "null"},
        expectedEnterAt: read(${JSON.stringify(selectors.expectedEnterAt)}),
        assignees: read(${JSON.stringify(selectors.assignees)}),
        companions: read(${JSON.stringify(selectors.companions)}),
      };
    })()`);
  }

  async #verifyFields(session, ids, expected) {
    const actual = await this.#readFieldValues(session, ids);
    const mismatches = [];
    const contains = (actualValue, expectedValue, label) => {
      if (!expectedValue) return;
      if (!normalizeOption(actualValue).includes(normalizeOption(expectedValue))) mismatches.push(label);
    };
    contains(actual.taskList?.text, expected.taskList, "任务列表");
    contains(actual.source?.menuText, expected.source, "任务来源");
    contains(actual.location?.menuText, expected.location, "任务地点");
    contains(actual.transactionNo?.text, expected.transactionNo, "事务单号");
    contains(actual.roomTicketNo?.text, expected.roomTicketNo, "机房单号");
    contains(actual.workContent?.menuText, expected.workContent, "工作内容");
    contains(actual.specificWork?.text, expected.specificWork, "具体工作事项");
    contains(actual.assignees?.selectedText, expected.assignees, "指派人员");
    contains(actual.companions?.selectedText, expected.companions, "陪同人");
    if (expected.date && actual.expectedEnterAt?.inputs?.[0] !== expected.date) {
      mismatches.push("预计进入日期");
    }
    if (expected.time && actual.expectedEnterAt?.inputs?.[1] !== expected.time) {
      mismatches.push("预计进入时间");
    }
    return { ok: mismatches.length === 0, mismatches };
  }

  async #submit(session) {
    const button = await session.evaluate(visibleButtonPointScript("提交"));
    if (!button) throw new Error("核对通过，但页面没有可点击的“提交”按钮");
    await session.click(button.x, button.y);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(250);
      const success = await session.evaluate(
        `/(提交成功|填写成功|提交完成|已提交|已经保存到云端|保存成功)/.test(document.body?.innerText || "")`,
      );
      if (success) return true;
    }
    throw new Error("已点击提交，但未检测到飞书提交成功确认");
  }

  async fill(task) {
    if (!this.enabled) {
      return { ok: false, configured: false, message: "浏览器自动填表未启用" };
    }
    let session;
    const filled = [];
    const skipped = [];
    const failed = [];
    const timings = {};
    const startedAt = Date.now();
    const identifierErrors = validateDutyIdentifiers(task.fillCard || {});
    if (identifierErrors.length) {
      return {
        ok: false,
        configured: true,
        filled,
        skipped,
        failed: ["单号格式"],
        verification: { ok: false, mismatches: ["事务单号或机房单号"] },
        submitted: false,
        timings: { total: 0 },
        message: identifierErrors.join("；"),
        pageUrl: this.config.formUrl,
      };
    }
    const people = resolvePersonFields(task);
    if (!people.companions) {
      return {
        ok: false,
        configured: true,
        filled,
        skipped,
        failed: ["陪同人"],
        verification: { ok: false, mismatches: ["陪同人"] },
        submitted: false,
        timings: { total: 0 },
        message: "缺少机器人使用人，无法填写陪同人",
        pageUrl: this.config.formUrl,
      };
    }
    try {
      session = await EdgeFormSession.open(this.config);
      const ids = this.config.fieldIds;
      const options = this.config.options || {};
      const card = task.fillCard || {};
      const shift = resolveTaskShiftForWorkOrder({
        expectedEnterAt: card.expectedEnterAt,
        receivedAt: task.receivedAt,
      });
      let taskNumber = nextTaskNumber(
        await this.#readTaskNumbers(session, shift.prefix),
        shift.prefix,
      );
      if (this.config.entryMode === "record") await this.#openRecordModal(session);
      else await this.#waitForForm(session);

      const workContent = chooseWorkContent(card, options.workContent || []);
      const source = matchOption(
        card.source || this.config.defaults?.source,
        options.source || [],
      );
      const defaultSource = this.config.defaults?.source || "事务工单";
      const sourceAlreadySelected = await session.evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(this.#selector(ids.source))});
        const menu = root?.querySelector('.b-select-dropdown-menu');
        return String(menu?.innerText || '').includes(${JSON.stringify(source || defaultSource)});
      })()`);
      const actions = [
        ["任务列表", () => this.#fillText(session, ids.taskList, taskNumber)],
        ["任务来源", () => (
          source && !sourceAlreadySelected
            ? this.#chooseOption(session, ids.source, source)
            : Promise.resolve(false)
        )],
        ["任务地点", () => this.#chooseOption(
          session,
          ids.location,
          matchOption(card.location, options.location || []),
        )],
        ["事务单号", () => this.#fillText(session, ids.transactionNo, card.transactionNo)],
        ["机房单号", () => this.#fillText(session, ids.roomTicketNo, card.roomTicketNo)],
        ["工作内容", () => this.#chooseOption(session, ids.workContent, workContent)],
        ["具体工作事项", () => this.#fillText(session, ids.specificWork, card.specificWork)],
        ["预计进入时间", () => this.#fillDateTime(session, ids.expectedEnterAt, card.expectedEnterAt)],
        ["指派人员", () => this.#choosePerson(
          session,
          ids.assignees,
          people.assignees,
        )],
        ["陪同人", () => this.#choosePerson(
          session,
          ids.companions,
          people.companions,
        )],
      ];
      for (const [label, action] of actions) {
        const actionStartedAt = Date.now();
        try {
          if (await action()) filled.push(label);
          else skipped.push(`${label}（原值或人工填写）`);
        } catch (error) {
          skipped.push(`${label}（${error.message}）`);
          failed.push(label);
        } finally {
          timings[label] = Date.now() - actionStartedAt;
        }
      }

      const refreshedTaskNumber = nextTaskNumber(
        await this.#readTaskNumbers(session, shift.prefix),
        shift.prefix,
      );
      if (refreshedTaskNumber !== taskNumber) {
        await this.#fillText(session, ids.taskList, refreshedTaskNumber);
        taskNumber = refreshedTaskNumber;
        if (!filled.includes("任务列表")) filled.unshift("任务列表");
        const failedIndex = failed.indexOf("任务列表");
        if (failedIndex >= 0) failed.splice(failedIndex, 1);
      }

      const expectedEnterAt = parseExpectedEnterAt(card.expectedEnterAt);
      const expectedDate = expectedEnterAt?.date || "";
      const expectedTime = expectedEnterAt?.time || "";
      const verification = await this.#verifyFields(session, ids, {
        taskList: taskNumber,
        source,
        location: matchOption(card.location, options.location || []),
        transactionNo: card.transactionNo,
        roomTicketNo: card.roomTicketNo,
        workContent,
        specificWork: card.specificWork,
        assignees: people.assignees,
        companions: people.companions,
        date: expectedDate,
        time: expectedTime,
      });
      if (!verification.ok) {
        failed.push("字段核对");
        return {
          ok: false,
          configured: true,
          taskNumber,
          taskPrefix: shift.prefix,
          taskShiftKind: shift.kind,
          filled,
          skipped,
          failed,
          verification,
          submitted: false,
          timings: { ...timings, total: Date.now() - startedAt },
          message: `字段核对不一致：${verification.mismatches.join("、")}`,
          pageUrl: this.config.formUrl,
        };
      }

      let submitted = false;
      if (this.config.autoSubmit) {
        const submitStartedAt = Date.now();
        try {
          submitted = await this.#submit(session);
        } finally {
          timings["飞书提交"] = Date.now() - submitStartedAt;
        }
      }

      return {
        ok: failed.length === 0,
        configured: true,
        taskNumber,
        taskPrefix: shift.prefix,
        taskShiftKind: shift.kind,
        filled,
        skipped,
        failed,
        verification,
        submitted,
        submittedAt: submitted ? new Date().toISOString() : "",
        timings: { ...timings, total: Date.now() - startedAt },
        pageUrl: this.config.formUrl,
      };
    } catch (error) {
      this.logger?.warn("飞书浏览器自动填表失败", error.message);
      return {
        ok: false,
        configured: true,
        filled,
        skipped,
        failed,
        timings: { ...timings, total: Date.now() - startedAt },
        message: error.message,
        pageUrl: this.config.formUrl,
      };
    } finally {
      session?.close();
    }
  }
}
