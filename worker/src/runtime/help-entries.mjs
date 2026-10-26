export const HELP_ENTRIES = Object.freeze([
  {
    trigger: "发送工单图片",
    parameters: "",
    description: "识别工单并在飞书中创建、核对和提交任务；按白班 WD、夜班 WN 生成任务列表号，本地短号取后三位并去掉前导零，例如 WN20261026006 使用短号 6，WN20261026012 使用短号 12；当前使用人同时写入指派人员和陪同人。",
    example: "直接发送一张清晰的工单截图",
    limits: "事务单号须为 SJSW + 8位日期 + 6位序号；机房单号须为 JF + 8位日期 + 6位序号；任务列表号按当天同前缀最大序号加一；短号由任务列表号后三位生成。",
  },
  {
    trigger: "/done",
    parameters: "<短号>",
    description: "确认飞书已提交后，按本地保存的识别结果更新固定腾讯周报/交接班草稿。",
    example: "/done 12",
    limits: "短号必须与飞书任务列表号后三位一致；短号只属于发送工单的会话，同一条任务不会重复写入。",
  },
  {
    trigger: "/pending",
    parameters: "",
    description: "列出本会话尚未完成的本地工单短号。",
    example: "/pending",
    limits: "最多显示最近 10 条。",
  },
  {
    trigger: "/fill",
    parameters: "<短号>",
    description: "在本机已登录的飞书网页版中重新填写、核对并提交；指派人员和陪同人都使用当前会话使用人，已提交的短号不会重复提交。",
    example: "/fill 12",
    limits: "短号由飞书任务列表号后三位生成；首次使用需在自动打开的 Edge 中手工登录，字段核对不一致时停止提交。",
  },
  {
    trigger: "/cancel",
    parameters: "<短号>",
    description: "取消本会话中尚未完成的本地工单。",
    example: "/cancel 12",
    limits: "已完成的任务不能取消；不会删除腾讯草稿中的历史内容。",
  },
  {
    trigger: "/pair",
    parameters: "<配对码>",
    description: "首次使用时配对本机机器人。",
    example: "/pair 123456",
    limits: "配对码只在本机 pairing-code.txt 中查看。",
  },
  {
    trigger: "/as 或 我是<姓名>",
    parameters: "",
    description: "切换本会话的值班使用人。",
    example: "/as 张明 或 我是张明",
    limits: "姓名必须在配置的网络组成员中或能明确匹配。",
  },
  {
    trigger: "/status",
    parameters: "",
    description: "查看运行状态、队列、使用人和本会话本地待办数量。",
    example: "/status",
    limits: "只显示当前会话信息。",
  },
  {
    trigger: "/new",
    parameters: "",
    description: "清空普通 Codex 会话上下文，保留使用人和本地待办。",
    example: "/new",
    limits: "不会取消未完成的工单任务。",
  },
  {
    trigger: "/stop",
    parameters: "",
    description: "停止当前执行并清空排队任务。",
    example: "/stop",
    limits: "不会删除已经生成的本地待办记录。",
  },
  {
    trigger: "/operators",
    parameters: "",
    description: "查看已配对的操作者。",
    example: "/operators",
    limits: "只用于本机私有机器人。",
  },
  {
    trigger: "/invite 或 /paircode",
    parameters: "",
    description: "生成 10 分钟有效的新配对码。",
    example: "/invite",
    limits: "不要发送给未授权人员。",
  },
  {
    trigger: "/help 或 帮助",
    parameters: "",
    description: "显示完整指令说明。",
    example: "/help",
    limits: "参数写在指令后并用空格分隔。",
  },
]);

export function formatHelpText(entries = HELP_ENTRIES) {
  return entries.map((entry) => {
    const trigger = entry.parameters
      ? `${entry.trigger} ${entry.parameters}`
      : entry.trigger;
    return [
      `**${trigger}**`,
      entry.description,
      `示例：${entry.example}`,
      `注意：${entry.limits}`,
    ].join("\n");
  }).join("\n\n");
}
