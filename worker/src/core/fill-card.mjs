import {isRackOrder, isWiringOrder} from "./duty-identifiers.mjs";
const FIELDS = [
  ["location", "任务地点"],
  ["source", "任务来源"],
  ["transactionNo", "事务单号"],
  ["roomTicketNo", "机房单号"],
  ["workContent", "工作内容"],
  ["specificWork", "具体工作事项"],
  ["expectedEnterAt", "预计进入时间"],
  ["vendor", "厂商"],
];

function text(value) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join("、");
  }
  if (value && typeof value === "object") {
    return String(value.name || value.text || value.value || "").trim();
  }
  return String(value ?? "").trim();
}

export function normalizeFillCard(value = {}) {
  const result = {};
  for (const [key] of FIELDS) {
    result[key] = text(value?.[key]);
  }
  if (isRackOrder(result)) {
    result.source = "上下架";
    if (result.transactionNo === "无") result.transactionNo = "";
  }
  if (isWiringOrder(result)) {
    result.source = "布线理线";
    if (result.transactionNo === "无") result.transactionNo = "";
  }
  return result;
}

export function inferFillCardFromSpec(spec = {}) {
  const weekly = spec.weeklyRows?.[0] || [];
  return normalizeFillCard({
    location: weekly[1],
    workContent: weekly[2],
    specificWork: weekly[3],
    expectedEnterAt: weekly[5] && weekly[12] ? `${weekly[5]} ${weekly[12]}` : "",
  });
}

export function formatFillCard(task, { autoSubmit = false } = {}) {
  const card = normalizeFillCard(task.fillCard || {});
  const lines = [
    `**飞书填报卡 · ${task.id}**`,
    autoSubmit
      ? "机器人会核对浏览器字段，核对通过后自动提交飞书。"
      : "请对照原工单核对浏览器中的字段，并手工提交飞书。",
  ];
  for (const [key, label] of FIELDS) {
    const optionalNumber = key === "transactionNo" && (isRackOrder(card) || isWiringOrder(card));
    const displayLabel = key === "transactionNo" && isRackOrder(card) ? "上下架申请单号（飞书事务单号列）" : label;
    lines.push(`${displayLabel}：${card[key] || (optionalNumber ? "未提供，按机房单号查重" : "未识别，请查看原图")}`);
  }
  lines.push(`飞书提交后发送：\`/done ${task.id}\``);
  return lines.join("\n");
}
