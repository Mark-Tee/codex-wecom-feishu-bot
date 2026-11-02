function restartDelay(failures) { return Math.min(300_000, 5000 * 2 ** Math.min(Math.max(failures - 1, 0), 6)); }

function createSupervisor({spawnBridge, probe, log = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let child = null, stopped = false, failures = 0, missed = 0, timer = null, startedAt = 0, checking = false;
  function launch() {
    if (stopped || child) return;
    startedAt = now(); missed = 0;
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
    try {
      const health = await probe();
      if (current !== child) return;
      if (health.pid !== current.pid) { log("健康端口不属于受管进程，停止本守护，避免争抢现有实例"); stop(); return; }
      missed = 0;
      // No restart just because the Internet is offline: connection layer handles backoff.
      if (health.connectionStale) { log("连接长时间无响应，回收受管进程后恢复"); current.kill(); }
    } catch {
      if (current !== child) return;
      missed++;
      if (missed >= 3) { log("本机健康检查连续3次失败，回收受管进程后恢复"); current.kill(); }
    } finally { checking = false; }
  }
  function stop() { stopped = true; clearTimer(timer); try { child?.kill(); } catch {} }
  return {launch, check, stop, get child() {return child;}};
}
module.exports = {createSupervisor, restartDelay};
