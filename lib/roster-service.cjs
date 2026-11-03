const {normalizeRosterCommand,isMenuPrompt} = require("./roster-command.cjs");
const {remoteDenial}=require("./remote-policy.cjs");
const HELP_ENTRIES = [
  "【排班机器人】", "", "查看排班", "今天＋明天，发送前实时读表", "",
  "排班身份 姓名", "设置个人视角，如：排班身份 测试甲", "也可发送：我是测试甲", "群聊与私聊身份分别保存，先显示本人排班", "私聊可直接查询，无需@", "我今天什么班 / 我明天什么班", "不带姓名：查看本人绑定", "",
  "排班推送状态", "查看定时推送情况", "",
  "/status　查看连接状态", "/help　查看本菜单", "",
  "定时推送（全员视角）", "07:00　当天排班", "17:00　次日排班", "",
  "动力交班私聊（功能启用时）", "绑定身份后，动力白班16:30、夜班次日07:30收到模拟草稿", "仅私聊当班动力人员，不发群、不写表、不调用模型", "只统计生成时已登记任务，交班前复核新增任务、分类和人员", "身份有冲突不发；结果不明不重发；错过5分钟窗口不补旧稿", "动力交班状态　查看本人提醒状态（无参数）", "例：动力交班状态；实际交接完成后再使用草稿", "",
  "查询需授权；姓名须准确匹配。", "只读查询，不允许修改排班源表。", "只@我也可查看菜单。",
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
