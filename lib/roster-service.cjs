const {normalizeRosterCommand,isMenuPrompt} = require("./roster-command.cjs");
const ROSTER_HELP = [
  "【排班机器人】",
  "只@我不附文字，或发送/help，均显示本菜单。",
  "菜单可查看，执行查询和操作仍需授权。",
  "查看排班：实时查看今天和明天，按个人排班、站点、部门排序。",
  "排班身份 [准确姓名]：查看或设置本人身份，例如 排班身份 测试甲（换为本人姓名）。",
  "绑定排班群 / 解绑排班群：每天07:00发当天、17:00发次日。",
  "排班推送状态：查看绑定和发送状态；/status：连接状态。",
  "/invite：已授权操作者生成10分钟邀请码；/pair 配对码：加入授权。",
  "/help：查看说明。",
  "仅只读排班，不处理工单、飞书、表格写入或普通模型问答。",
  "未绑定个人身份使用全员视角；定时始终全员视角。数据失败不猜测、不用旧缓存。",
  "手机视图一岗一行；以上是排班安排，不代表实际出勤。固定功能不消耗模型额度。",
].join("\n");
function createRosterService({state,save,controller,reply,health=()=>({}),allowUsers=[],makeCode,now=Date.now}) {
  return async function handle(frame) {
    if (frame?.cmd !== "aibot_msg_callback") return;
    const body=frame.body||{}, userId=body.from?.userid;
    if(!body.msgid||!userId)return;
    state.__seenIds ||= [];
    if(state.__seenIds.includes(body.msgid))return;
    const text=normalizeRosterCommand(String(body.text?.content||"").replace(/^(\s*@[^\s@]+\s*)+/u,"").trim());
    if(body.msgtype==="text" && isMenuPrompt(text)) {
      state.__seenIds.push(body.msgid);state.__seenIds=state.__seenIds.slice(-300);save(state);
      await reply(frame,ROSTER_HELP);return;
    }
    const operators=Array.isArray(state.__operators)?state.__operators:[];
    if(/^\/pair(?:\s|$)/i.test(text)) {
      if(allowUsers.length&&!allowUsers.includes(userId)){await reply(frame,"本机白名单未包含该账号，请联系管理员配置，邀请码不能绕过白名单。");return;}
      const code=text.split(/\s+/)[1]||"",pair=state.__pairing;
      if(pair&&pair.code===code&&pair.expiresAt>now()) {
        state.__operators=[...new Set([...operators,userId])];delete state.__pairing;save(state);
        await reply(frame,"配对成功，可以使用排班指令。");
      } else await reply(frame,"配对码错误或已过期，请向已授权操作者申请新邀请码。");
      return;
    }
    const authorized=allowUsers.length?allowUsers.includes(userId):operators.includes(userId);
    if(!authorized){await reply(frame,"请先发送 /pair 配对码 完成授权，再查询排班。");return;}
    state.__seenIds.push(body.msgid);state.__seenIds=state.__seenIds.slice(-300);save(state);
    if (/^\/(?:invite|paircode)$/.test(text)) {
      const code=makeCode();state.__pairing={code,expiresAt:now()+600_000};save(state);
      await reply(frame,`排班邀请码：${code}\n10分钟有效。新操作者发送 /pair ${code}；使用后失效。`);return;
    }
    if(text==="/status"||text==="状态") {const value=health();await reply(frame,`排班机器人：${value.authenticated?"已连接":"重连中"}；只读模式，不调用模型。`);return;}
    if(body.msgtype!=="text"){await reply(frame,"这是排班机器人，不识别工单图片。请@工单机器人处理工单。\n\n"+ROSTER_HELP);return;}
    if(text==="/help"||text==="帮助"||!text){await reply(frame,ROSTER_HELP);return;}
    if(await controller.command(frame,text))return;
    await reply(frame,ROSTER_HELP);
  };
}
module.exports={createRosterService,ROSTER_HELP};
