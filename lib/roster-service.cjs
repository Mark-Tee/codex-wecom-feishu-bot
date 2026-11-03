const {normalizeRosterCommand,isMenuPrompt} = require("./roster-command.cjs");
const {remoteDenial}=require("./remote-policy.cjs");
const HELP_ENTRIES = [
  "【排班机器人】", "",
  "查看排班　今天＋明天", "我今天什么班 / 我明天什么班", "排班身份 姓名　绑定本人", "例：排班身份 测试甲；也可发“我是测试甲”", "排班身份　查看绑定（群聊、私聊独立）", "",
  "请假候选 / 调休候选 [本月/下月/YYYY-MM]", "默认本月剩余；指定月份查整月", "例：调休候选 2026-11", "也可问：我哪几天可以用来请假调休", "请假检查 / 调休检查 [今天/明天/YYYY-MM-DD]", "默认今天；例：请假检查 明天", "仅查本人；候选不代表已批准", "夜班、白班主值、异地网络1受限", "空白且无岗位按休息，不列新候选", "",
  "排班推送状态　查看推送", "动力交班状态　查看本人提醒", "/status　连接状态；只@我或/help看菜单", "",
  "07:00推当天；17:00推次日", "动力交班模拟草稿仅私聊当班绑定人员", "白班16:30；夜班次日07:30，交班前复核", "查询需授权；只读查询，不改源表",
];
const ROSTER_HELP = HELP_ENTRIES.join("\n");
function createRosterService({state,save,controller,reply,health=()=>({}),handoff=null,allowUsers=[],makeCode,now=Date.now}) {
  return async function handle(frame) {
    if (frame?.cmd !== "aibot_msg_callback") return;
    const body=frame.body||{}, userId=body.from?.userid;
    if(!body.msgid||!userId)return;
    state.__seenIds ||= [];
    if(state.__seenIds.includes(body.msgid))return;
    const text=normalizeRosterCommand(String(body.text?.content||"").replace(/^(\s*@[^\s@]+\s*)+/u,"").trim());
    const denied=remoteDenial(text);
    if(denied){await reply(frame,denied);return;}
    if(body.msgtype==="text" && isMenuPrompt(text) && body.chattype!=="single") {
      state.__seenIds.push(body.msgid);state.__seenIds=state.__seenIds.slice(-300);save(state);
      await reply(frame,ROSTER_HELP);return;
    }
    const operators=Array.isArray(state.__operators)?state.__operators:[];
    const authorized=allowUsers.length?allowUsers.includes(userId):operators.includes(userId);
    if(!authorized){await reply(frame,"无权限：该账号尚未授权，请联系维护者在本机配置。");return;}
    state.__seenIds.push(body.msgid);state.__seenIds=state.__seenIds.slice(-300);save(state);
    if(text==="动力交班状态"){await reply(frame,handoff ? handoff.status(userId) : "动力交班私聊尚未启用，请联系维护者检查配置。");return;}
    if(text==="/status"||text==="状态") {const value=health();await reply(frame,`排班机器人：${value.authenticated?"已连接":"重连中"}；只读模式，不调用模型。`);return;}
    if(body.msgtype!=="text"){await reply(frame,"这是排班机器人，不识别工单图片。请@工单机器人处理工单。\n\n"+ROSTER_HELP);return;}
    if(text==="/help"||text==="帮助"||!text){
      if(body.chattype==="single") { await controller.command(frame,"查看排班"); }
      await reply(frame,ROSTER_HELP);return;
    }
    if(await controller.command(frame,text))return;
    await reply(frame,ROSTER_HELP);
  };
}
module.exports={createRosterService,ROSTER_HELP,HELP_ENTRIES};
