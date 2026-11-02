export const HELP_ENTRIES = Object.freeze([
 {trigger:"/as",parameters:"姓名",description:"设置本会话工单使用人。",example:"/as 测试甲",limits:"换为本人准确姓名，需匹配配置成员。"},
 {trigger:"/pending",parameters:"",description:"查看本会话待办。",example:"/pending",limits:"仅显示本会话最近十条任务。"},
 {trigger:"/status",parameters:"",description:"查看运行状态。",example:"/status",limits:"不会执行工单写入。"},
 {trigger:"发送工单图片",parameters:"",description:"识别并创建飞书工单。",example:"发送清晰工单截图",limits:"真实写入待实单验收；需授权和有效登录；共享表测试保护开启时先识别待本机核准。"},
 {trigger:"/fill",parameters:"短号",description:"重试填写、核对并提交。",example:"/fill 12",limits:"真实写入待实单验收；仅本会话任务，已提交的不重复提交；共享表测试保护开启时须本机单次许可，结果不明禁止重试。"},
 {trigger:"/done",parameters:"短号",description:"确认已提交后更新固定腾讯草稿。",example:"/done 12",limits:"真实写入待实单验收；动力值班无需此操作；共享表测试保护期间暂不写腾讯草稿。"},
 {trigger:"查看排班",parameters:"",description:"请发给排班机器人，实时查询今天和明天。",example:"@排班机器人 查看排班",limits:"只读；07:00推当天，17:00推次日。"},
 {trigger:"排班身份",parameters:"姓名",description:"在排班机器人设置个人视角。",example:"@排班机器人 排班身份 测试甲",limits:"无姓名查看本人绑定；姓名须准确匹配，不改变工单使用人。"},
 {trigger:"排班推送状态",parameters:"",description:"在排班机器人查看推送情况。",example:"@排班机器人 排班推送状态",limits:"绑定、解绑和其他管理操作只在本机维护。"},
 {trigger:"/help",parameters:"",description:"查看菜单；只@机器人也可查看。",example:"/help",limits:"菜单不授予权限；不允许修改排班源表、文件或配置。"},
]);
export function formatHelpText(entries=HELP_ENTRIES) {
 return entries.map(e=>[`${e.trigger}${e.parameters?" "+e.parameters:""}`,e.description,`例：${e.example}`,e.limits].join("\n")).join("\n\n");
}
