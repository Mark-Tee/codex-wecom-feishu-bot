export const ITEM_REGISTRY = Object.freeze({
  carryOut: "itemCarryOut",
  faultyDisk: "faultyDisk",
});

const HARD_DISK_PATTERN = /硬盘|磁盘|HDD|SSD/i;
const FULL_EQUIPMENT_PATTERN = /整机|服务器整机|交换机整机|存储整机/i;

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeSerial(value) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

export function routeReplacementItem(item) {
  const itemName = text(item?.itemName || item?.name);
  if (item?.fullEquipment || FULL_EQUIPMENT_PATTERN.test(itemName)) {
    return {
      action: "skip",
      reason: "整机设备走线下出门条流程，首期不自动登记",
    };
  }
  return {
    action: "register",
    registry: HARD_DISK_PATTERN.test(itemName)
      ? ITEM_REGISTRY.faultyDisk
      : ITEM_REGISTRY.carryOut,
  };
}

function itemIdentity(record) {
  return [
    text(record.linkedTaskRecordId),
    text(record.itemName).toLowerCase(),
    normalizeSerial(record.serialNumber),
  ].join("|");
}

function existingIdentity(record) {
  return itemIdentity({
    linkedTaskRecordId: record.linkedTaskRecordId,
    itemName: record.itemName || (record.registry === ITEM_REGISTRY.faultyDisk ? "硬盘" : ""),
    serialNumber: record.serialNumber,
  });
}

function uniquePhotos(item) {
  const values = Array.isArray(item?.photos) ? item.photos : [item?.photo];
  return [...new Set(values.map(text).filter(Boolean))];
}

function missingFields(record, labels) {
  return Object.entries(labels)
    .filter(([key]) => {
      const value = record[key];
      return Array.isArray(value) ? value.length === 0 : !text(value);
    })
    .map(([, label]) => label);
}

function confirmationText(record) {
  if (record.registry === ITEM_REGISTRY.faultyDisk) {
    return [
      `关联主任务：${record.linkedTaskNumber || record.linkedTaskRecordId}`,
      `硬盘SN：${record.serialNumber}`,
      `所属设备序列号：${record.serverSerialNumber}`,
      `设备品牌/型号：${record.brand || "未识别"} / ${record.model || "未识别"}`,
      `硬盘尺寸/类型：${record.diskSize || "未识别"} / ${record.diskType || "未识别"}`,
      `登记人：${record.registrar}`,
    ].join("\n");
  }
  return [
    `关联主任务：${record.linkedTaskNumber || record.linkedTaskRecordId}`,
    `物品名称：${record.itemName}`,
    `序列号：${record.serialNumber}`,
    `厂商：${record.vendor}`,
    `带出人：${record.carriedBy}`,
    `陪同人：${record.companion}`,
    `带出地点：${record.location}`,
  ].join("\n");
}

export function evaluateItemRegistration({
  task,
  item,
  photoSender,
  existingCarryOut = [],
  existingFaultyDisks = [],
  operationOrderNo = "",
}) {
  const route = routeReplacementItem(item);
  if (route.action === "skip") return { status: "skipped", ...route };

  const photos = uniquePhotos(item);
  const taskFields = {
    linkedTaskRecordId: task.recordId,
    linkedTaskNumber: task.taskNumber,
    location: task.location,
    vendor: task.vendor,
    date: item.date || task.workDate,
  };
  const record = route.registry === ITEM_REGISTRY.faultyDisk
    ? {
        registry: route.registry,
        ...taskFields,
        operationOrderNo,
        serverSerialNumber: item.serverSerialNumber,
        businessSystem: item.businessSystem || task.businessSystem,
        brand: item.brand || task.brand,
        model: item.model || task.model,
        itemName: "硬盘",
        serialNumber: normalizeSerial(item.serialNumber || item.diskSerialNumber),
        diskSize: item.diskSize,
        diskType: item.diskType,
        photos,
        registrar: photoSender,
        remark: item.remark || "",
      }
    : {
        registry: route.registry,
        ...taskFields,
        itemType: "其他物品",
        itemName: text(item.itemName || item.name),
        vendor: text(task.vendor || item.vendor),
        carriedBy: text(item.carriedBy || item.vendorPerson),
        serialNumber: normalizeSerial(item.serialNumber),
        photos,
        companion: text(photoSender),
        remark: item.remark || "",
      };

  const existing = route.registry === ITEM_REGISTRY.faultyDisk
    ? existingFaultyDisks
    : existingCarryOut;
  const identity = itemIdentity(record);
  const duplicate = existing.find((entry) => existingIdentity(entry) === identity);
  if (duplicate) {
    return {
      status: "registered",
      registry: route.registry,
      identity,
      existingRecordId: duplicate.recordId,
      record,
    };
  }

  const required = route.registry === ITEM_REGISTRY.faultyDisk
    ? {
        linkedTaskRecordId: "关联主任务表",
        location: "带出地点",
        date: "日期",
        operationOrderNo: "运维操作单号",
        serverSerialNumber: "所属设备序列号",
        businessSystem: "所属业务系统",
        brand: "设备品牌",
        serialNumber: "硬盘SN",
        diskSize: "硬盘尺寸",
        diskType: "硬盘类型",
        photos: "硬盘照片",
        registrar: "登记人",
      }
    : {
        linkedTaskRecordId: "关联主任务表",
        location: "带出地点",
        itemName: "物品名称",
        vendor: "厂商",
        carriedBy: "带出人",
        serialNumber: "序列号",
        photos: "物品照片",
        companion: "陪同人",
      };
  const missing = missingFields(record, required);
  if (missing.length) {
    return {
      status: "needs_input",
      registry: route.registry,
      identity,
      missingFields: missing,
      record,
    };
  }
  return {
    status: "ready",
    registry: route.registry,
    identity,
    requiresConfirmation: true,
    confirmationText: confirmationText(record),
    record,
  };
}

export function evaluateReplacementItems({
  task,
  items,
  photoSender,
  existingCarryOut = [],
  existingFaultyDisks = [],
  operationOrderNo = "",
}) {
  return (items || []).map((item) => evaluateItemRegistration({
    task,
    item,
    photoSender,
    existingCarryOut,
    existingFaultyDisks,
    operationOrderNo,
  }));
}
