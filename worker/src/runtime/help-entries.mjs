export const HELP_ENTRIES = Object.freeze([
  {trigger:"机器人分工",parameters:"本机service.role配置",description:"排班角色只读并定时推送，不调用模型；工单角色处理图片、/draft、/as 姓名、/pending、/fill、/done、/cancel，排班指令请发给排班机器人。",example:"在排班机器人发送 查看排班，在工单机器人发送 /pending。",limits:"两套身份、端口、状态和启动任务独立，业务排班规则共用；工单真实写入仍须满足原有确认和验证条件。"},
  {trigger:"排班身份 / 排班身份 姓名",parameters:"可选的本人准确姓名",description:"桥接群指令，无参数查询本人绑定；带姓名按发起人账号保存个人排班身份。查看排班优先显示本人的各日期排班，再按排班站点、同站点部门排序。手机视图一岗一行、站点部门加粗分段，主值兼同班动力合并标注，不把部门空动力岗位显示成未安排。群内@后残留BOT时，已知排班指令仍走实时表固定通道，不进入普通模型问答。",example:"@机器人 排班身份 测试甲（换为本人姓名）；@机器人 查看排班",limits:"需已授权操作者，姓名精确匹配唯一部门成员。身份仅存本机，不改变工单使用人；未绑定按全员展示，调休或地点不明不默认南岗。07:00/17:00定时推送始终全员视角。本地排序不增加模型或读表调用。"},
  {trigger:"本机守护与登录启动",parameters:"无业务参数",description:"桥接项目install-autostart.ps1登记用户登录启动，start-hidden.ps1启动守护，stop.ps1停止并暂停计划任务。异常退出退避重启，本机健康每30秒检测，90秒连接无响应重连，日志轮转。",example:"项目目录 powershell -File .\\install-autostart.ps1",limits:"一个机器人加轻量本地守护，保留单实例。健康检查不调用模型、不访问代理；登录前不运行。重启系统后的登录启动尚需实际观察。"},
  {trigger: "绑定排班群 / 解绑排班群 / 排班推送状态 / 查看排班", parameters: "无",
   description: "由桥接服务在已授权操作者所在群处理。每天北京时间07:00发送当天排班、17:00发送次日排班，发送前实时读表。",
   example: "在目标群@机器人 绑定排班群；@机器人 查看排班可即时重新读取。",
   limits: "仅绑定一个群，单聊不绑定；绑定时已过的时段不补发，重启仅补当前时段且持久去重，发送结果不明不自动重发该时段。发送后不追踪变更，在线表为准；缺失冲突不发旧缓存。白班辅值仅周一至周五非节假日白班，周末补班及夜班均无辅值。"},
  {
    trigger: "跨站点排班自动判断",
    parameters: "",
    description: "按业务配置site_rules匹配部门成员、对应辅值列和异地岗位。异地安排优先于本地黄色白班和打卡地点，不自动生成本地巡检、通报或交接；工单明确属于本地实际工作时只登记该工单。在岗且无固定岗位者为本站待命，只处理实际工单，明确休假和夜班后休息不判待命。",
    example: "启用site_rules后，发送带明确地点和单号的工单；异地任务无需/done，本地实际工单仍按正常流程确认。",
    limits: "网络2/3可能先在本地打卡只是可能性，不能据此认定工作地点；缺列、重复岗位、部门冲突时停止询问。岗位姓名前的数字仅匹配时忽略，不解释其含义，也不改在线原文。成员名单仅保存在本机配置，不提交真实姓名。",
  },
  {
    trigger: "动力值班自动识别",
    parameters: "",
    description: "启用 duty.powerDuty.enabled 后，收单前实时读取在线排班；按收到工单的北京时间班次匹配当前使用人。动力值班只建飞书单，指派人员和陪同人留空，不生成周报或交接班。",
    example: "当天动力值班人员直接发送工单图片，无需手动切换",
    limits: "每天08:20刷新；机器人停机时无法定时读取，恢复后补查。白班08:30–17:30，夜班17:30–次日08:30；凌晨取前一天夜班。读表失败或排班缺失时停止，不用旧缓存猜测。动力任务无需/done。",
  },
  {
    trigger: "发送工单图片",
    parameters: "",
    description: "识别工单并在飞书中创建、核对和提交任务；按白班 WD、夜班 WN 生成任务列表号，本地短号取后三位并去掉前导零，例如 WN20261026006 使用短号 6，WN20261026012 使用短号 12；普通值班当前使用人同时写入指派人员和陪同人；动力值班两项留空。",
    example: "直接发送一张清晰的工单截图",
    limits: "事务单号须为 SJSW + 8位日期 + 6位序号；机房单号须为 JF + 8位日期 + 6位序号；任务列表号按当天同前缀最大序号加一；短号由任务列表号后三位生成。",
  },
  {
    trigger: "/done",
    parameters: "<短号>",
    description: "确认飞书已提交后，按本地保存的识别结果更新固定腾讯周报/交接班草稿。",
    example: "/done 12",
    limits: "短号必须与飞书任务列表号后三位一致；短号只属于发送工单的会话，同一条任务不会重复写入；动力值班任务禁止进入腾讯草稿流程。",
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
    description: "在本机已登录的飞书网页版中重新填写、核对并提交；普通值班两个人员字段使用当前使用人；动力值班继续留空。已提交的短号不会重复提交。",
    example: "/fill 12",
    limits: "短号由飞书任务列表号后三位生成；首次使用需在自动打开的 Edge 中手工登录。字段缺失时会尝试自动发现；失败会返回阶段码并在本机保存诊断截图，字段核对不一致时停止提交。",
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
