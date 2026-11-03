export const HELP_ENTRIES = Object.freeze([
 {trigger:"清",parameters:"短号 / 全部",description:"停止本人当前会话追踪。",example:"清10；清全部后回复确认清全部",limits:"只清本地待办；全部须预览确认，处理中暂不能清；不删在线记录，保留防重状态；已完成无需清除。"},
 {trigger:"首页 / 我的工单 / 还有哪些没处理",parameters:"",description:"私聊查看本人身份和待办。",example:"首页",limits:"仅本人；群聊、私聊任务独立。"},
 {trigger:"补充",parameters:"内容",description:"短口令：补 内容，回答待确认问题。",example:"补 进入时间为09:00",limits:"仅回答当前待确认问题；不清楚时不要猜。"},
 {trigger:"继续",parameters:"",description:"查看本人待补充信息或待办，按短号选择后操作。",example:"继续",limits:"仅查本人，不会自动重新提交。"},
 {trigger:"/as",parameters:"姓名",description:"短口令：人 姓名，设置本会话使用人。",example:"人 测试甲",limits:"换为本人准确姓名，需匹配配置成员。"},
 {trigger:"/pending",parameters:"",description:"短口令：单，查看本会话待办。",example:"单",limits:"仅显示本会话最近十条任务。"},
 {trigger:"/status",parameters:"",description:"短口令：状态，查看运行情况。",example:"状态",limits:"不会执行工单写入。"},
 {trigger:"发送工单图片",parameters:"",description:"识别并创建飞书工单，回执说明结果、写入状态和下一步。",example:"发送清晰工单截图",limits:"模糊字段先确认；重复不新建；真实写入待实单验收。"},
 {trigger:"/fill",parameters:"短号",description:"短口令：填12，重试短号12的填报。",example:"填12",limits:"仅本会话；结果不明先核验，勿盲目重试。"},
 {trigger:"/done",parameters:"短号",description:"短口令：完12，提交后更新固定腾讯草稿。",example:"完12",limits:"仅腾讯草稿；动力值班无需/done；已有行须确认，正式表不自动改。"},
 {trigger:"查看排班",parameters:"",description:"排班机器人短口令：班；今；明。",example:"@排班机器人 班",limits:"只读；07:00推当天，17:00推次日。"},
 {trigger:"排班身份",parameters:"姓名",description:"排班机器人短口令：我 姓名；我查绑定。",example:"@排班机器人 我 测试甲",limits:"无姓名查看本人绑定；姓名须准确匹配，不改变工单使用人。"},
 {trigger:"排班推送状态",parameters:"",description:"排班机器人短口令：推送。",example:"@排班机器人 推送",limits:"绑定、解绑和其他管理操作只在本机维护。"},
 {trigger:"/help",parameters:"",description:"短口令：菜单；只@机器人也可查看。",example:"菜单",limits:"业务操作需授权；禁止修改源表或执行管理操作。"},
]);
export function formatHelpText(entries=HELP_ENTRIES) {
 return entries.map(e=>[`${e.trigger}${e.parameters?" "+e.parameters:""}　${e.description}`,`例：${e.example}；${e.limits}`].join("\n")).join("\n\n");
}
