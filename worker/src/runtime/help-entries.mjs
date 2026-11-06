export const HELP_ENTRIES = Object.freeze([
 {trigger:"我",parameters:"本人姓名",description:"新成员申请使用；本机确认后私聊群聊均可用，沿用本人姓名。",example:"我 测试甲",limits:"申请1小时有效，两个机器人分别确认、会话任务独立；不自动授权，同名账号冲突人工核对；必要姓名、账号和会话仅存本机授权状态，不进匿名统计。"},
 {trigger:"安全限制（自动）",parameters:"",description:"非法/超长/越权请求拒绝；每人20次/分钟，单图16MiB，每条最多4张PNG/JPEG。",example:"发送菜单查看合法业务指令",limits:"频繁请求稍后重试；不执行系统命令或任意URL，识别工具权限核验失败即停止；清理不回滚在线结果。"},
 {trigger:"匿名使用统计（自动）",parameters:"",description:"两机器人仅本机汇总指令类别、次数、耗时、结果与错误类别。",example:"正常查询即可，无需额外指令",limits:"不记录正文、图片、姓名、账号；不做个人画像；建议由本机维护复核，不自动修改或上线。"},
 {trigger:"清",parameters:"短号 / 全部",description:"停止本人当前会话追踪；预览可点确认清除或保留待办。",example:"清10；清全部后回复确认清全部",limits:"按钮绑定本次清单；长清单用文字确认；处理中暂不能清；不删在线记录，保留防重状态。"},
 {trigger:"首页 / 我的工单 / 还有哪些没处理",parameters:"",description:"私聊查看本人身份和待办。",example:"首页",limits:"仅本人；群聊、私聊任务独立。"},
 {trigger:"补充",parameters:"内容",description:"短口令：补 内容，回答待确认问题。",example:"补 进入时间为09:00",limits:"仅回答当前待确认问题；不清楚时不要猜。"},
 {trigger:"继续",parameters:"",description:"查看本人待补充信息或待办，按短号选择后操作。",example:"继续",limits:"仅查本人，不会自动重新提交。"},
 {trigger:"/as",parameters:"姓名",description:"短口令：人 姓名，设置本会话使用人。",example:"人 测试甲",limits:"换为本人准确姓名，需匹配配置成员。"},
 {trigger:"/pending",parameters:"",description:"短口令：单，查看本会话待办。",example:"单",limits:"仅显示本会话最近十条任务。"},
 {trigger:"/status",parameters:"",description:"短口令：状态，查看运行情况。",example:"状态",limits:"不会执行工单写入。"},
 {trigger:"发送工单图片",parameters:"",description:"同一消息更新识别、核对及最终登记结果。",example:"发送清晰工单截图",limits:"最终以核验回执为准；模糊字段先确认，重复不新建；真实写入待实单验收。"},
 {trigger:"/fill",parameters:"短号",description:"短口令：填12，重试短号12的填报。",example:"填12",limits:"仅本会话；结果不明先核验，勿盲目重试。"},
 {trigger:"/done",parameters:"短号",description:"短口令：完12，提交后更新固定腾讯草稿。",example:"完12",limits:"仅腾讯草稿；动力值班无需/done；已有行须确认，正式表不自动改。"},
 {trigger:"查看排班",parameters:"",description:"排班机器人短口令：班；今；明。",example:"@排班机器人 班",limits:"只读；07:00推当天，17:00推次日。"},
 {trigger:"排班身份",parameters:"姓名",description:"排班机器人短口令：我 姓名；我查绑定。",example:"@排班机器人 我 测试甲",limits:"批准姓名在私聊和群聊通用，任务仍按会话独立；姓名更正需本机核对，不改变工单使用人。"},
 {trigger:"排班推送状态",parameters:"",description:"排班机器人短口令：推送。",example:"@排班机器人 推送",limits:"绑定、解绑和其他管理操作只在本机维护。"},
 {trigger:"/help",parameters:"",description:"短口令：菜单；只@也显示按钮，指令说明看文字。",example:"菜单",limits:"按钮限本人当前会话；失效或确认异常会提示重发菜单，清理须重新预览；业务需授权，禁止修改源表或执行管理操作。"},
]);
export function formatHelpText(entries=HELP_ENTRIES) {
 return entries.map(e=>[`${e.trigger}${e.parameters?" "+e.parameters:""}　${e.description}`,`例：${e.example}；${e.limits}`].join("\n")).join("\n\n");
}
