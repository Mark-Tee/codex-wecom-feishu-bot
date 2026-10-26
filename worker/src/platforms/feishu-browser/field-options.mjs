export function normalizeOption(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s,，、;；:：。.!！?？/\\()[\]{}_-]+/g, "");
}

export function matchOption(value, options = []) {
  const wanted = normalizeOption(value);
  if (!wanted) return "";
  const exact = options.find((option) => normalizeOption(option) === wanted);
  if (exact) return exact;
  const partial = options.find((option) => {
    const normalized = normalizeOption(option);
    return normalized.includes(wanted) || wanted.includes(normalized);
  });
  return partial || "";
}

export function chooseWorkContent(fillCard = {}, options = []) {
  const direct = matchOption(fillCard.workContent, options);
  if (direct) return direct;
  const source = `${fillCard.workContent || ""} ${fillCard.specificWork || ""}`;
  const rules = [
    [/(宕机|物理重启|重启物理)/, /(宕机|重启)/],
    [/(硬件带外|带外不通|测试设备|硬件测试)/, /(带外|测试设备)/],
    [/(无故障|进入机房|陪同|现场确认)/, /(无故障|进入机房)/],
    [/(网线|光纤|插拔)/, /(网线|光纤|插拔)/],
    [/(上下架)/, /(上下架)/],
    [/(故障|维修|整改|隐患|更换|处理)/, /(故障维修|隐患整改)/],
  ];
  for (const [sourcePattern, optionPattern] of rules) {
    if (!sourcePattern.test(source)) continue;
    const option = options.find((candidate) => optionPattern.test(candidate));
    if (option) return option;
  }
  return matchOption(fillCard.specificWork, options);
}

export function resolvePersonFields(task = {}) {
  const operator = String(task.operator || "").trim();
  return {
    assignees: operator,
    companions: operator,
  };
}
