const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {normalizeRosterCommand} = require("./roster-command.cjs");

function createScheduleBroadcast({ state, save, read, send, reply, members = async () => [], ready = () => true, now = () => new Date(), log = () => {} }) {
  let busy = false;
  const retryAt = {};
  const persist = () => save(state);
  const personFor = (userId) => Object.hasOwn(state.__schedulePeople || {}, userId) ? state.__schedulePeople[userId] : "";
  const today = (date) => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai", year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  async function command(frame, prompt) {
    prompt = normalizeRosterCommand(prompt);
    if (prompt === "我的排班身份") prompt = "排班身份";
    if (/^我是\s*\S+$/.test(prompt)) prompt = "排班身份 " + prompt.replace(/^我是\s*/, "");
    if (["我的排班", "我今天什么班", "我明天什么班"].includes(prompt)) {
      const offset = prompt === "我今天什么班" ? 0 : prompt === "我明天什么班" ? 1 : null;
      return command(frame, offset === null ? "查看排班" : `查看排班 ${offset}`);
    }
    const identity = prompt.match(/^排班身份(?:\s+([^\s]+))?$/);
    const identityCommand = /^排班身份(?:\s|$)/.test(prompt);
    if (!identityCommand && !["绑定排班群", "解绑排班群", "排班推送状态", "查看排班", "查看排班 0", "查看排班 1", "是", "是的", "不是"].includes(prompt)) return false;
    const body = frame.body || {};
    const single = body.chattype === "single";
    if (!single && (body.chattype !== "group" || !body.chatid)) { await reply(frame, "未取得有效会话，请重试。"); return true; }
    if (single && ["绑定排班群", "解绑排班群", "排班推送状态"].includes(prompt)) { await reply(frame, "定时推送仅发绑定群，私聊不推送。"); return true; }
    const userId = body.from?.userid ? JSON.stringify([single ? "private:" + body.from.userid : body.chatid, body.from.userid]) : "";
    if (single && userId && !personFor(userId) && !identity?.[1]) {
      const names = [...new Set(Object.entries(state.__schedulePeople || {}).filter(([key]) => {try{return JSON.parse(key)[1] === body.from.userid;}catch{return false;}}).map(([,name])=>name))];
      if (names.length === 1 && ["是", "是的"].includes(prompt)) return command(frame, "排班身份 " + names[0]);
      await reply(frame, names.length === 1 && prompt !== "不是" ? `沿用你已确认的姓名“${names[0]}”？回复“是”确认，或发送“排班身份 姓名”更正。` : "请发送：排班身份 本人姓名。身份冲突时不自动选择。"); return true;
    }
    if (["是", "是的", "不是"].includes(prompt)) return false;
    if (identityCommand && !identity) { await reply(frame, "用法：排班身份 或 排班身份 本人准确姓名；姓名参数不能包含空格。"); return true; }
    if (identity) {
      if (!userId) { await reply(frame, "未取得发起人账号，不能绑定排班身份。"); return true; }
      const name = identity[1];
      if (!name) {
        await reply(frame, `【个人排班身份】\n${personFor(userId) || "未设置"}\n\n设置：排班身份 姓名\n例：排班身份 测试甲\n请使用排班表中的准确姓名。`);
        return true;
      }
      try {
        const configured = await members();
        if (configured.filter((value) => value === name).length !== 1) { await reply(frame, "姓名不在唯一的部门名单中，请核对后使用排班表中的准确姓名，不自动猜测或模糊匹配。"); return true; }
        state.__schedulePeople ||= Object.create(null);
        const previous = personFor(userId);
        state.__schedulePeople[userId] = name;
        try { persist(); }
        catch (error) {
          if (previous) state.__schedulePeople[userId] = previous; else delete state.__schedulePeople[userId];
          throw error;
        }
        await reply(frame, `【排班身份已设置】\n${name}\n\n发送：查看排班\n优先显示你的班次、站点和部门。\n群内定时排班仍为全员视角；动力提醒启用时，按绑定账号私聊交班模拟草稿。`);
      } catch { await reply(frame, "排班身份未能完成保存或核验，请检查部门配置后重试。"); }
      return true;
    }
    const binding = state.__scheduleGroup;
    if (prompt === "绑定排班群") {
      if (binding && binding.chatid !== body.chatid) await reply(frame, "已有其他群绑定，请先在原群发送“解绑排班群”。");
      else {
        state.__scheduleGroup = binding || {chatid:body.chatid, boundAt:now().toISOString()};
        persist();
        await reply(frame, "已绑定本群：每天北京时间07:00发送当天排班、17:00发送次日排班，均先读取最新在线表。绑定时已过的时段不补发；可发送“查看排班”即时查询。");
      }
    } else if (prompt === "解绑排班群") {
      if (binding?.chatid === body.chatid) { delete state.__scheduleGroup; persist(); await reply(frame, "已解绑本群，停止每日排班推送。"); }
      else await reply(frame, "本群未绑定排班推送。");
    } else if (prompt === "排班推送状态") {
      const status = binding?.chatid === body.chatid ? Object.values(state.__scheduleDeliveries || {}).map((item) => `${item.slot}：${({sent:"已发送",sending:"发送中",unknown:"发送结果待确认"})[item.status] || item.status}`).join("\n") || "等待下一次推送" : "本群未绑定";
      await reply(frame, `【排班推送状态】\n${status}\n\n07:00　当天排班\n17:00　次日排班\n每次发送前读取最新在线表。\n发送后有调班，请重新“查看排班”。`);
    } else {
      try {
        const viewer = userId ? personFor(userId) : "";
        log("排班查询进入实时表固定通道；个人身份", viewer ? "已设置" : "未设置");
        const text = await read(now(), {viewer, ...(/^查看排班 [01]$/.test(prompt) ? {offsets:[Number(prompt.slice(-1))]} : {})});
        await reply(frame, `${viewer ? "" : "未设置个人身份，以下为全员视角。\n设置：排班身份 姓名\n\n"}${text}`);
      }
      catch { await reply(frame, "在线排班暂时无法完整核验，未发送旧数据。请检查在线表、人员及岗位颜色后重试。"); }
    }
    return true;
  }
  async function tick() {
    const at = now();
    const binding = state.__scheduleGroup;
    const clock = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(at);
    if (busy || !ready() || !binding || clock < "07:00") return;
    const slot = clock >= "17:00"
      ? {id:"evening",time:"17:00",offset:1,label:"次日"}
      : {id:"morning",time:"07:00",offset:0,label:"当天"};
    if (at.getTime() < (retryAt[slot.id] || 0)) return;
    const bound = new Date(binding.boundAt);
    const boundClock = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(bound);
    if (today(bound) === today(at) && boundClock >= slot.time) return;
    const key = `${binding.chatid}:${today(at)}:${slot.id}`;
    state.__scheduleDeliveries ||= {};
    const previous = state.__scheduleDeliveries[slot.id];
    if (previous?.key === key && ["sending", "sent", "unknown"].includes(previous.status)) return;
    busy = true;
    try {
      const text = await read(at, {offsets:[slot.offset]});
      if (state.__scheduleGroup?.chatid !== binding.chatid || !ready()) return;
      state.__scheduleDeliveries[slot.id] = {key, slot:`${slot.time}${slot.label}`, status:"sending", at:now().toISOString()};
      persist(); // Persist intent before network send: uncertain results must not duplicate on restart.
      try {
        await send(binding.chatid, 2, text);
        state.__scheduleDeliveries[slot.id].status = "sent";
      } catch {
        state.__scheduleDeliveries[slot.id].status = "unknown";
        log("排班发送结果不确定，暂停本时段重发，可在群中查看排班和推送状态");
      }
      persist();
    } catch {
      retryAt[slot.id] = at.getTime() + 5 * 60 * 1000;
      if (state.__scheduleDeliveries[slot.id]?.key === key && ["sending", "sent", "unknown"].includes(state.__scheduleDeliveries[slot.id].status)) {
        log("排班发送状态保存异常，保留发送标记，禁止本时段自动重复");
        return;
      }
      state.__scheduleDeliveries[slot.id] = {key, slot:`${slot.time}${slot.label}`, status:"读取或核验失败，5分钟后重试", at:now().toISOString()};
      persist();
      log("排班读取或核验失败，未发送旧数据，5分钟后重试");
    } finally { busy = false; }
  }
  return {command, tick};
}

function startScheduleBroadcast({workerRoot, configPath, ...options}) {
  const fromWorker = (file) => import(pathToFileURL(path.join(workerRoot,file)).href);
  const controller = createScheduleBroadcast({...options, members: async () => {
    const {loadConfig, loadDutyConfig} = await fromWorker("src/config.mjs");
    const config = loadDutyConfig(loadConfig(configPath));
    return (config.site_rules?.departments || []).flatMap((group) => group.members || []);
  }, read: async (at, selection = {}) => {
    const {loadConfig, loadDutyConfig} = await fromWorker("src/config.mjs");
    const {TencentDocsClient} = await fromWorker("src/providers/tencent-docs/client.mjs");
    const {readScheduleBroadcast, formatScheduleBroadcast} = await fromWorker("src/providers/tencent-docs/schedule-broadcast.mjs");
    return formatScheduleBroadcast(await readScheduleBroadcast({client:new TencentDocsClient(),config:loadDutyConfig(loadConfig(configPath)),at,...selection}), {viewer:selection.viewer || ""});
  }});
  const timer = setInterval(() => controller.tick().catch(() => options.log?.("排班定时器失败，请检查状态文件")), 30_000);
  timer.unref();
  return controller;
}
module.exports = {createScheduleBroadcast, startScheduleBroadcast};
