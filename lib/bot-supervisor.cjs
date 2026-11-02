function restartDelay(failures) { return Math.min(300_000, 5000 * 2 ** Math.min(Math.max(failures - 1, 0), 6)); }

function createSupervisor({spawnBridge, probe, log = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let child = null, stopped = false, failures = 0, missed = 0, timer = null, startedAt = 0, checking = false, lastCheckAt = null;
  function launch() {
    if (stopped || child) return;
    startedAt = now(); missed = 0; lastCheckAt = null;
    try {
      const current = spawnBridge(); child = current;
      let handled = false;
      const exited = (reason) => {
        if (handled) return; handled = true;
        if (child === current) child = null;
        if (stopped) return;
        failures = now() - startedAt >= 5 * 60_000 ? 1 : failures + 1;
        const delay = restartDelay(failures);
        log(`机器人退出（${reason}），${delay / 1000}秒后重启`);
        timer = setTimer(launch, delay);
      };
      current.once("error", () => exited("启动失败"));
      current.once("exit", (code) => exited(`退出码${code}`));
      log("机器人已启动");
    } catch { failures++; timer = setTimer(launch, restartDelay(failures)); log("启动机器人失败，已安排退避重试"); }
  }
  async function check() {
    if (checking || stopped || !child || now() - startedAt < 120_000) return;
    checking = true;
    const current = child;
    const checkedAt=now(),gap=lastCheckAt===null?0:Math.max(0,checkedAt-lastCheckAt);lastCheckAt=checkedAt;
    try {
      const health = await probe();
      if (current !== child) return;
      if (health.pid !== current.pid) { log("健康端口不属于受管进程，停止本守护，避免争抢现有实例"); stop(); return; }
      if(missed)log(`本机健康探测已恢复，此前连续失败${missed}次；本次${Number.isFinite(health.probeElapsedMs)?health.probeElapsedMs:"未知"}ms`);
      missed = 0;
      // No restart just because the Internet is offline: connection layer handles backoff.
      if (health.connectionStale) { log("连接长时间无响应，回收受管进程后恢复"); current.kill(); }
    } catch (error) {
      if (current !== child) return;
      missed++;
      const code=/^HEALTH_[A-Z0-9_]{1,40}$/.test(error?.code||"")?error.code:"HEALTH_PROBE_ERROR";
      const phase=["request","json","identity","config"].includes(error?.phase)?error.phase:"unknown";
      const elapsed=Number.isFinite(error?.elapsedMs)?Math.max(0,Math.round(error.elapsedMs)):"未知";
      log(`本机健康探测失败 ${missed}/3；类型=${code}；阶段=${phase}；耗时=${elapsed}ms；距上次检查=${gap}ms`);
      if (missed >= 3) { log("本机健康检查连续3次失败，回收受管进程后恢复"); current.kill(); }
    } finally { checking = false; }
  }
  function stop() { stopped = true; clearTimer(timer); try { child?.kill(); } catch {} }
  return {launch, check, stop, get child() {return child;}};
}
module.exports = {createSupervisor, restartDelay};
