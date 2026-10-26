import { normalizeSerial } from "../../core/item-registration.mjs";

export const DEFAULT_TASK_FIELDS = Object.freeze({
  taskNumber: "任务列表",
  location: "任务地点",
  source: "任务来源",
  transactionNo: "事务单号",
  roomTicketNo: "机房单号",
  workContent: "工作内容",
  specificWork: "具体工作事项",
  vendor: "厂商",
  expectedEnterAt: "预计进入时间",
  assignees: "指派人员",
  companions: "陪同人",
  status: "状态",
});

export const DEFAULT_SCAN_FIELDS = Object.freeze({
  transactionNo: "事务单号",
  person: "厂商人员",
  location: "机房地点",
  enteredAt: "进入时间",
  leftAt: "离开时间",
  entryScan: "进入机房扫码",
  leaveScan: "离开机房扫码",
  duration: "耗时",
});

export const DEFAULT_CARRY_OUT_FIELDS = Object.freeze({
  linkedTaskRecordId: "关联主任务表",
  location: "带出地点",
  itemType: "物品类型",
  itemName: "物品名称",
  vendor: "厂商",
  carriedBy: "带出人",
  serialNumber: "序列号",
  date: "带出日期",
  photos: "物品照片",
  companion: "陪同人",
  remark: "备注",
});

export const DEFAULT_FAULTY_DISK_FIELDS = Object.freeze({
  linkedTaskRecordId: "关联主任务表",
  location: "带出地点",
  date: "日期",
  operationOrderNo: "运维操作单号",
  serverSerialNumber: "所属设备序列号",
  businessSystem: "所属业务系统",
  brand: "设备品牌",
  model: "设备型号",
  serialNumber: "硬盘SN",
  diskSize: "硬盘尺寸",
  diskType: "硬盘类型",
  photos: "硬盘照片",
  registrar: "登记人",
  remark: "备注",
});

function unwrap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("value" in value) return unwrap(value.value);
    if ("text" in value) return value.text;
    if ("name" in value) return value.name;
  }
  return value;
}

export function textValue(value) {
  const source = unwrap(value);
  if (source == null) return "";
  if (Array.isArray(source)) return source.map(textValue).filter(Boolean).join("、");
  if (typeof source === "object") return String(source.name || source.text || "").trim();
  return String(source).trim();
}

export function peopleNames(value) {
  const source = unwrap(value);
  if (source == null) return [];
  if (!Array.isArray(source)) {
    return textValue(source).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [...new Set(source.flatMap((item) => {
    if (typeof item === "string") return peopleNames(item);
    return [String(item?.name || item?.text || "").trim()].filter(Boolean);
  }))];
}

export function linkedRecordIds(value) {
  const found = [];
  const visit = (item) => {
    if (item == null) return;
    if (typeof item === "string") {
      if (item.trim()) found.push(item.trim());
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === "object") {
      if (Array.isArray(item.record_ids)) item.record_ids.forEach(visit);
      if (item.record_id) visit(item.record_id);
      if (item.value != null) visit(item.value);
    }
  };
  visit(value);
  return [...new Set(found)];
}

export function attachmentTokens(value) {
  const source = unwrap(value);
  if (!Array.isArray(source)) return [];
  return [...new Set(source.flatMap((item) => {
    if (typeof item === "string") return [item];
    return [item?.file_token || item?.attachmentToken || ""].filter(Boolean);
  }))];
}

export function timestampValue(value) {
  const source = unwrap(value);
  if (source == null || source === "") return "";
  const timestamp = typeof source === "number"
    ? (source < 1_000_000_000_000 ? source * 1000 : source)
    : new Date(source).getTime();
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

function field(fields, name) {
  return fields?.[name];
}

export function inferWorkDate(value) {
  const source = String(value || "");
  const match = source.match(/20\d{6}/);
  if (!match) return "";
  return `${match[0].slice(0, 4)}-${match[0].slice(4, 6)}-${match[0].slice(6, 8)}`;
}

export function toLogicalTask(record, mapping = DEFAULT_TASK_FIELDS) {
  const fields = record?.fields || {};
  const transactionNo = textValue(field(fields, mapping.transactionNo));
  const taskNumber = textValue(field(fields, mapping.taskNumber));
  return {
    recordId: record?.record_id || record?.recordId || "",
    taskNumber,
    location: textValue(field(fields, mapping.location)),
    source: textValue(field(fields, mapping.source)),
    transactionNo,
    roomTicketNo: textValue(field(fields, mapping.roomTicketNo)),
    workContent: textValue(field(fields, mapping.workContent)),
    specificWork: textValue(field(fields, mapping.specificWork)),
    vendor: textValue(field(fields, mapping.vendor)),
    workDate: inferWorkDate(transactionNo) || inferWorkDate(taskNumber),
    expectedEnterAt: timestampValue(field(fields, mapping.expectedEnterAt)),
    assignees: peopleNames(field(fields, mapping.assignees)),
    companions: peopleNames(field(fields, mapping.companions)),
    status: textValue(field(fields, mapping.status)),
  };
}

export function toLogicalScan(record, mapping = DEFAULT_SCAN_FIELDS) {
  const fields = record?.fields || {};
  return {
    recordId: record?.record_id || record?.recordId || "",
    transactionNo: textValue(field(fields, mapping.transactionNo)),
    person: peopleNames(field(fields, mapping.person)),
    location: textValue(field(fields, mapping.location)),
    enteredAt: timestampValue(field(fields, mapping.enteredAt)),
    leftAt: timestampValue(field(fields, mapping.leftAt)),
    entryScan: textValue(field(fields, mapping.entryScan)),
    leaveScan: textValue(field(fields, mapping.leaveScan)),
    duration: textValue(field(fields, mapping.duration)),
  };
}

export function toLogicalCarryOutItem(record, mapping = DEFAULT_CARRY_OUT_FIELDS) {
  const fields = record?.fields || {};
  return {
    recordId: record?.record_id || record?.recordId || "",
    linkedTaskRecordId: linkedRecordIds(field(fields, mapping.linkedTaskRecordId))[0] || "",
    location: textValue(field(fields, mapping.location)),
    itemType: textValue(field(fields, mapping.itemType)),
    itemName: textValue(field(fields, mapping.itemName)),
    vendor: textValue(field(fields, mapping.vendor)),
    carriedBy: peopleNames(field(fields, mapping.carriedBy)).join("、"),
    serialNumber: normalizeSerial(textValue(field(fields, mapping.serialNumber))),
    date: timestampValue(field(fields, mapping.date)),
    photos: attachmentTokens(field(fields, mapping.photos)),
    companion: peopleNames(field(fields, mapping.companion)).join("、"),
    remark: textValue(field(fields, mapping.remark)),
  };
}

export function toLogicalFaultyDisk(record, mapping = DEFAULT_FAULTY_DISK_FIELDS) {
  const fields = record?.fields || {};
  return {
    recordId: record?.record_id || record?.recordId || "",
    linkedTaskRecordId: linkedRecordIds(field(fields, mapping.linkedTaskRecordId))[0] || "",
    location: textValue(field(fields, mapping.location)),
    date: timestampValue(field(fields, mapping.date)),
    operationOrderNo: textValue(field(fields, mapping.operationOrderNo)),
    serverSerialNumber: textValue(field(fields, mapping.serverSerialNumber)),
    businessSystem: textValue(field(fields, mapping.businessSystem)),
    brand: textValue(field(fields, mapping.brand)),
    model: textValue(field(fields, mapping.model)),
    itemName: "硬盘",
    serialNumber: normalizeSerial(textValue(field(fields, mapping.serialNumber))),
    diskSize: textValue(field(fields, mapping.diskSize)),
    diskType: textValue(field(fields, mapping.diskType)),
    photos: attachmentTokens(field(fields, mapping.photos)),
    registrar: peopleNames(field(fields, mapping.registrar)).join("、"),
    remark: textValue(field(fields, mapping.remark)),
  };
}

export function indexFieldMetadata(fields) {
  return new Map((fields || []).map((item) => [item.field_name, item]));
}

function splitMultiValue(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  return textValue(value)
    .split(/[,，、;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toFeishuFieldValue(metadata, value) {
  if (!metadata) throw new Error("目标字段不存在");
  const type = Number(metadata.type);
  if (type === 1 || type === 3 || type === 13 || type === 15) return textValue(value);
  if (type === 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("数字字段格式不正确");
    return number;
  }
  if (type === 4) return splitMultiValue(value);
  if (type === 5) {
    if (typeof value === "number") return value < 1_000_000_000_000 ? value * 1000 : value;
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) throw new Error("日期字段格式不正确");
    return timestamp;
  }
  if (type === 17) {
    return (Array.isArray(value) ? value : [value]).map((item) => (
      typeof item === "string" ? { file_token: item } : item
    ));
  }
  throw new Error(`暂不支持字段类型 ${type}（${metadata.field_name}）`);
}

export function buildTaskCreateFields(
  order,
  taskNumber,
  fieldMetadata,
  mapping = DEFAULT_TASK_FIELDS,
) {
  const values = {
    taskNumber,
    location: order.location,
    source: order.source,
    transactionNo: order.transactionNo,
    roomTicketNo: order.roomTicketNo,
    workContent: order.workContent,
    specificWork: order.specificWork,
    expectedEnterAt: order.expectedEnterAt,
  };
  const fields = {};
  for (const [logicalKey, value] of Object.entries(values)) {
    if (value == null || value === "") continue;
    const fieldName = mapping[logicalKey];
    fields[fieldName] = toFeishuFieldValue(fieldMetadata.get(fieldName), value);
  }
  return fields;
}
