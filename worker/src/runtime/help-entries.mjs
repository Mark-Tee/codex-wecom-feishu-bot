export const HELP_ENTRIES = Object.freeze([
 {trigger:"首页 / 我的工单 / 还有哪些没处理",parameters:"",description:"私聊查看本人身份和待办。",example:"首页",limits:"群聊与私聊任务独立；唯一姓名可确认沿用，冲突用/as确认；不自动提交或开启提醒。"},
 {trigger:"补充",parameters:"内容",description:"接着回答本人待确认工单的问题。",example:"补充 进入时间为09:00",limits:"仅当前群本人待确认任务，超时须重新发工单；不会引用他人上下文。"},
 {trigger:"继续",parameters:"",description:"查看本人待补充信息或待办，按短号选择后操作。",example:"继续",limits:"按机器人、群、账号隔离并持久保存；不会自动重新提交。"},
 {trigger:"/as",parameters:"姓名",description:"设置本会话工单使用人。",example:"/as 测试甲",limits:"换为本人准确姓名，需匹配配置成员。"},
 {trigger:"/pending",parameters:"",description:"查看本会话待办。",example:"/pending",limits:"仅显示本会话最近十条任务。"},
 {trigger:"/status",parameters:"",description:"查看运行状态。",example:"/status",limits:"不会执行工单写入。"},
 {trigger:"发送工单图片",parameters:"",description:"识别并创建飞书工单，回执说明结果、写入状态和下一步。",example:"发送清晰工单截图",limits:"自动高分辨率OCR并按需附同一字段完整横向分段的局部放大图；仍模糊时只补关键文字，补充沿用原收单时间；支持事务、上下架和布线理线工单；布线理线无事务号时按机房号查重；上下架申请号填业务单号列，不需另补事务号，模糊编号和关键事项须确认；厂商可用已确认简称，不要求单位全称；短号仅为本地待办编号；回执“下一步”给出具体命令或说明无需操作；待补充时回复“补充 已确认文字”；等待写入许可表示字段已保存、尚未写表，请将回执交给维护者核验，不重复发图；需授权和有效登录；双号齐全按组合查重、缺一按已有号，重复业务单不新建；真实写入完整验收仍待完成；共享表测试保护开启时单独识别飞书字段，不依赖周报或交接表，新增带测试标记，待本机核准。"},
 {trigger:"/fill",parameters:"短号",description:"重试填写、核对并提交。",example:"/fill 12",limits:"真实写入待实单验收；仅本会话任务，已提交的不重复提交；并发或提交结果不明时先本机核验，禁止盲目重试；共享表测试保护开启时须本机单次许可，结果不明禁止重试。"},
 {trigger:"/done",parameters:"短号",description:"确认已提交后更新固定腾讯草稿。",example:"/done 12",limits:"周报按历史格式追加，预计耗时允许0.5h；交接按班次汇总，已有行先本机确认，不自动改正式表；重复内容跳过，结果不明须核验；真实写入待实单验收；动力值班无需此操作；共享表测试保护期间暂不写腾讯草稿。"},
 {trigger:"查看排班",parameters:"",description:"请发给排班机器人，实时查询今天和明天。",example:"@排班机器人 查看排班",limits:"只读；07:00推当天，17:00推次日。"},
 {trigger:"排班身份",parameters:"姓名",description:"在排班机器人设置个人视角。",example:"@排班机器人 排班身份 测试甲",limits:"无姓名查看本人绑定；姓名须准确匹配，不改变工单使用人。"},
 {trigger:"排班推送状态",parameters:"",description:"在排班机器人查看推送情况。",example:"@排班机器人 排班推送状态",limits:"绑定、解绑和其他管理操作只在本机维护。"},
 {trigger:"/help",parameters:"",description:"查看菜单；只@机器人也可查看。",example:"/help",limits:"菜单不授予权限；不允许修改排班源表、文件或配置。"},
]);
export function formatHelpText(entries=HELP_ENTRIES) {
 return entries.map(e=>[`${e.trigger}${e.parameters?" "+e.parameters:""}`,e.description,`例：${e.example}`,e.limits].join("\n")).join("\n\n");
}
