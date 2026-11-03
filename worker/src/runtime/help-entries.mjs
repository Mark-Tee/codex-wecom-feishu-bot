export const HELP_ENTRIES = Object.freeze([
 {trigger:"首页 / 我的工单 / 还有哪些没处理",parameters:"",description:"私聊查看本人身份和待办。",example:"首页",limits:"仅本人；群聊、私聊任务独立。"},
 {trigger:"补充",parameters:"内容",description:"接着回答本人待确认工单的问题。",example:"补充 进入时间为09:00",limits:"仅回答当前待确认问题；不清楚时不要猜。"},
 {trigger:"继续",parameters:"",description:"查看本人待补充信息或待办，按短号选择后操作。",example:"继续",limits:"仅查本人，不会自动重新提交。"},
 {trigger:"/as",parameters:"姓名",description:"设置本会话工单使用人。",example:"/as 测试甲",limits:"换为本人准确姓名，需匹配配置成员。"},
 {trigger:"/pending",parameters:"",description:"查看本会话待办。",example:"/pending",limits:"仅显示本会话最近十条任务。"},
 {trigger:"/status",parameters:"",description:"查看运行状态。",example:"/status",limits:"不会执行工单写入。"},
 {trigger:"发送工单图片",parameters:"",description:"识别并创建飞书工单，回执说明结果、写入状态和下一步。",example:"发送清晰工单截图",limits:"模糊字段先确认；重复不新建；真实写入待实单验收。"},
 {trigger:"/fill",parameters:"短号",description:"重试填写、核对并提交。",example:"/fill 12",limits:"仅本会话；结果不明先核验，勿盲目重试。"},
 {trigger:"/done",parameters:"短号",description:"确认已提交后更新固定腾讯草稿。",example:"/done 12",limits:"仅腾讯草稿；动力值班无需/done；已有行须确认，正式表不自动改。"},
 {trigger:"查看排班",parameters:"",description:"请发给排班机器人，实时查询今天和明天。",example:"@排班机器人 查看排班",limits:"只读；07:00推当天，17:00推次日。"},
 {trigger:"排班身份",parameters:"姓名",description:"在排班机器人设置个人视角。",example:"@排班机器人 排班身份 测试甲",limits:"无姓名查看本人绑定；姓名须准确匹配，不改变工单使用人。"},
 {trigger:"排班推送状态",parameters:"",description:"在排班机器人查看推送情况。",example:"@排班机器人 排班推送状态",limits:"绑定、解绑和其他管理操作只在本机维护。"},
 {trigger:"/help",parameters:"",description:"查看菜单；只@机器人也可查看。",example:"/help",limits:"业务操作需授权；禁止修改源表或执行管理操作。"},
]);
export function formatHelpText(entries=HELP_ENTRIES) {
 return entries.map(e=>[`${e.trigger}${e.parameters?" "+e.parameters:""}　${e.description}`,`例：${e.example}；${e.limits}`].join("\n")).join("\n\n");
}
