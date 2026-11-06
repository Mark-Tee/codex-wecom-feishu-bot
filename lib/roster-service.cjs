const {normalizeRosterCommand,isMenuPrompt} = require("./roster-command.cjs");
const {remoteDenial}=require("./remote-policy.cjs");
const HELP_ENTRIES = [
  "【排班机器人】", "",
  "班　今天＋明天；今　今天；明　明天", "我 姓名　申请使用／绑定本人", "我　查看绑定（群聊、私聊独立）", "",
  "休　请假候选，默认本月剩余", "休下月 / 休2026-12　查指定月", "休明 / 休2026-11-04　单日检查", "仅查本人；候选不代表已批准", "夜班含动力夜班、白班主值、异地网络1受限", "空白且无岗位按休息，不列新候选", "",
  "推送　排班推送状态", "交班　动力交班状态（本人提醒）", "状态　连接状态；只@我或发“菜单”看帮助", "旧口令兼容；异常/超长拒绝，20次/分钟", "",
  "只@我显示按钮；点“指令说明”看完整口令", "按钮限本人当前会话；失效会提示重发“菜单”", "07:00推当天；17:00推次日", "动力交班模拟草稿仅私聊当班绑定人员", "白班16:30；夜班次日07:30，交班前复核", "新成员本机确认，申请1小时；只读查询", "申请另存姓名、账号和会话，仅本机核验", "统计不采正文、图片、姓名、账号",
];
const ROSTER_HELP = HELP_ENTRIES.join("\n");
function createRosterService({state,save,controller,reply,health=()=>({}),handoff=null,allowUsers=[],makeCode,now=Date.now,observe=()=>{},observeStart=()=>{}}) {
  return async function handle(frame) {
    if (frame?.cmd !== "aibot_msg_callback") return;
    const body=frame.body||{}, userId=body.from?.userid;
    if(!body.msgid||!userId)return;
    state.__seenIds ||= [];
    if(state.__seenIds.includes(body.msgid))return;
    observeStart(frame);
    const text=normalizeRosterCommand(String(body.text?.content||"").replace(/^(\s*@[^\s@]+\s*)+/u,"").trim());
    const denied=remoteDenial(text);
    if(denied){observe(frame,"denied");await reply(frame,denied);return;}
    if(body.msgtype==="text" && isMenuPrompt(text) && body.chattype!=="single") {
      state.__seenIds.push(body.msgid);state.__seenIds=state.__seenIds.slice(-300);save(state);
      await reply(frame,ROSTER_HELP);return;
    }
    const operators=Array.isArray(state.__operators)?state.__operators:[];
    const authorized=allowUsers.length?allowUsers.includes(userId):operators.includes(userId);
    if(!authorized){observe(frame,"denied");await reply(frame,"无权限：该账号尚未授权，请联系维护者在本机配置。");return;}
    state.__seenIds.push(body.msgid);state.__seenIds=state.__seenIds.slice(-300);save(state);
    if(text==="动力交班状态"){await reply(frame,handoff ? handoff.status(userId) : "动力交班私聊尚未启用，请联系维护者检查配置。");return;}
    if(text==="/status"||text==="状态") {const value=health();await reply(frame,`排班机器人：${value.authenticated?"已连接":"重连中"}；只读模式，不调用模型。`);return;}
    if(body.msgtype!=="text"){await reply(frame,"这是排班机器人，不识别工单图片。请@工单机器人处理工单。\n\n"+ROSTER_HELP);return;}
    if(text==="/help"||text==="帮助"||!text){
      await reply(frame,ROSTER_HELP);return;
    }
    if(await controller.command(frame,text))return;
    await reply(frame,ROSTER_HELP);
  };
}
module.exports={createRosterService,ROSTER_HELP,HELP_ENTRIES};
