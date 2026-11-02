function watchConnection(socket, {now = Date.now, timeoutMs = 90_000, pollMs = 15_000, onTimeout = () => {}} = {}) {
  let lastReceivedAt = now();
  let stopped = false;
  const receive = () => { lastReceivedAt = now(); };
  socket.addEventListener("message", receive);
  const check = () => {
    if (stopped || now() - lastReceivedAt < timeoutMs) return false;
    stop();
    onTimeout();
    try { if (typeof socket.terminate === "function") socket.terminate(); else socket.close(); } catch {}
    return true;
  };
  const timer = setInterval(check, pollMs);
  timer.unref?.();
  function stop() { stopped = true; clearInterval(timer); socket.removeEventListener?.("message", receive); }
  return {check, stop, snapshot: () => ({lastReceivedAt, stale: now() - lastReceivedAt >= timeoutMs})};
}
module.exports = {watchConnection};
