import { clickVisibleTextScript } from "./dom-scripts.mjs";
import { sleep } from "./edge-session.mjs";

export const BROWSER_FIELD_LABELS = Object.freeze({
  taskList: "任务列表",
  source: "任务来源",
  location: "任务地点",
  transactionNo: "事务单号",
  roomTicketNo: "机房单号",
  workContent: "工作内容",
  specificWork: "具体工作事项",
  expectedEnterAt: "预计进入时间",
  assignees: "指派人员",
  companions: "陪同人",
});

export const REQUIRED_BROWSER_FIELDS = Object.freeze(Object.keys(BROWSER_FIELD_LABELS));

function normalizeLabel(value) {
  return String(value || "")
    .replace(/[\s*＊:：]/g, "")
    .trim();
}

export function mergeDiscoveredFieldIds(existing = {}, fields = []) {
  const result = { ...existing };
  for (const [key, label] of Object.entries(BROWSER_FIELD_LABELS)) {
    const found = fields.find((field) => normalizeLabel(field.text).startsWith(label));
    if (found?.id) result[key] = found.id;
  }
  return result;
}

export function missingRequiredFieldIds(fieldIds = {}) {
  return REQUIRED_BROWSER_FIELDS.filter((key) => !String(fieldIds[key] || "").startsWith("fld"));
}

function fieldDiscoveryExpression(mode) {
  return `(() => {
    const normalize = (value) => String(value || '').replace(/[\\s*＊:：]/g, '').trim();
    const recordSelector = '.base_record_card_field_editor_wrapper > label[data-field-id]';
    const formSelector = '[id^="field-item-"][data-field-id], [data-field-id][id^="field-item-"]';
    const selector = ${JSON.stringify(mode)} === 'record'
      ? recordSelector
      : ${JSON.stringify(mode)} === 'form'
        ? formSelector
        : recordSelector + ', ' + formSelector;
    const seen = new Set();
    const fields = [];
    for (const label of document.querySelectorAll(selector)) {
      const id = String(label.getAttribute('data-field-id') || '').trim();
      if (!/^fld[A-Za-z0-9]+$/.test(id) || seen.has(id)) continue;
      const root = label.closest('.base_record_card_field_editor_wrapper, [id^="field-item-"]') || label;
      const text = String(root.innerText || label.innerText || '').trim();
      seen.add(id);
      fields.push({ id, text: normalize(text) });
    }
    return fields;
  })()`;
}

export async function discoverFieldIds(session, {
  fieldIds = {},
  mode = "record",
} = {}) {
  const fields = await session.evaluate(fieldDiscoveryExpression(mode));
  const discovered = mergeDiscoveredFieldIds({}, fields || []);
  const merged = mergeDiscoveredFieldIds(fieldIds, fields || []);
  return {
    fieldIds: merged,
    foundKeys: REQUIRED_BROWSER_FIELDS.filter((key) => discovered[key]?.startsWith("fld")),
    missingActual: REQUIRED_BROWSER_FIELDS.filter((key) => !discovered[key]?.startsWith("fld")),
    missing: missingRequiredFieldIds(merged),
    foundCount: Object.keys(merged).filter((key) => merged[key]?.startsWith("fld")).length,
  };
}

const TASK_VIEW_LABELS = [
  "筛选用-全部任务列表",
  "全部任务列表",
  "全部任务",
];

export async function discoverTaskListViewId(session) {
  return session.evaluate(`(() => {
    const labels = ${JSON.stringify(TASK_VIEW_LABELS)};
    const normalize = (value) => String(value || '').replace(/\\s+/g, '').trim();
    const candidates = [...document.querySelectorAll(
      '[data-view-id], [data-viewid], a[href*="view=vew"], [href*="view=vew"]'
    )];
    const viewIdOf = (element) => {
      const direct = element.getAttribute('data-view-id')
        || element.getAttribute('data-viewid')
        || '';
      if (/^vew[A-Za-z0-9]+$/.test(direct)) return direct;
      try {
        const id = new URL(element.getAttribute('href') || '', location.href)
          .searchParams.get('view') || '';
        return /^vew[A-Za-z0-9]+$/.test(id) ? id : '';
      } catch {
        return '';
      }
    };
    for (const label of labels) {
      for (const element of candidates) {
        const text = normalize(element.innerText || element.textContent || element.getAttribute('aria-label'));
        if (text !== normalize(label)) continue;
        let current = element;
        for (let depth = 0; current && depth < 4; depth += 1) {
          const id = viewIdOf(current);
          if (id) return id;
          current = current.parentElement;
        }
      }
    }
    return '';
  })()`);
}

export async function hasOpenRecordForm(session) {
  return Boolean(await session.evaluate(
    `Boolean(document.querySelector('.base_record_card_field_editor_wrapper > label[data-field-id]'))`,
  ));
}

export async function openRecordFormForDiscovery(session, {
  timeoutMs = 20_000,
  existingFieldIds = {},
} = {}) {
  if (await hasOpenRecordForm(session)) {
    return discoverFieldIds(session, {
      fieldIds: existingFieldIds,
      mode: "record",
    });
  }
  const viewDeadline = Date.now() + timeoutMs;
  let viewClicked = false;
  while (Date.now() < viewDeadline && !viewClicked) {
    viewClicked = await session.evaluate(clickVisibleTextScript("待办任务列表"));
    if (!viewClicked) await sleep(300);
  }
  if (!viewClicked) throw new Error("找不到“待办任务列表”视图");
  await sleep(700);
  let addClicked = false;
  const formDeadline = Date.now() + timeoutMs;
  while (Date.now() < formDeadline) {
    if (await hasOpenRecordForm(session)) {
      await sleep(500);
      return discoverFieldIds(session, {
        fieldIds: existingFieldIds,
        mode: "record",
      });
    }
    const clickedThisRound = await session.evaluate(clickVisibleTextScript("添加记录"));
    addClicked = clickedThisRound || addClicked;
    await sleep(clickedThisRound ? 1500 : 400);
  }
  throw new Error(addClicked ? "新记录卡未加载" : "找不到“添加记录”按钮");
}
