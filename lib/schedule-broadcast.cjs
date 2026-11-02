const path = require("node:path");
const { pathToFileURL } = require("node:url");

function createScheduleBroadcast({ state, save, read, send, reply, ready = () => true, now = () => new Date(), log = () => {} }) {
  let busy = false;
  const retryAt = {};
  const persist = () => save(state);
  const today = (date) => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai", year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  async function command(frame, prompt) {
    if (!["绑定排班群", "解绑排班群", "排班推送状态", "查看排班"].includes(prompt)) return false;
    const body = frame.body || {};
    if (body.chattype !== "group" || !body.chatid) { await reply(frame, "请在目标群内@机器人发送此指令；不会使用单聊作为排班群。"); return true; }
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
      const status = binding?.chatid === body.chatid ? Object.values(state.__scheduleDeliveries || {}).map((item) => `${item.slot}：${item.status}`).join("；") || "等待07:00/17:00" : "本群未绑定";
      await reply(frame, `排班推送：${status}；每天07:00发当天、17:00发次日，发送前读表，不自动追踪后续变更。`);
    } else {
      try { await reply(frame, await read(now())); }
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
  const controller = createScheduleBroadcast({...options, read: async (at, selection = {}) => {
    const {loadConfig, loadDutyConfig} = await fromWorker("src/config.mjs");
    const {TencentDocsClient} = await fromWorker("src/providers/tencent-docs/client.mjs");
    const {readScheduleBroadcast, formatScheduleBroadcast} = await fromWorker("src/providers/tencent-docs/schedule-broadcast.mjs");
    return formatScheduleBroadcast(await readScheduleBroadcast({client:new TencentDocsClient(),config:loadDutyConfig(loadConfig(configPath)),at,...selection}));
  }});
  const timer = setInterval(() => controller.tick().catch(() => options.log?.("排班定时器失败，请检查状态文件")), 30_000);
  timer.unref();
  return controller;
}
module.exports = {createScheduleBroadcast, startScheduleBroadcast};
