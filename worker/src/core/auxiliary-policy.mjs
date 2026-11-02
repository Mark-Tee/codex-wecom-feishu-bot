export function auxiliaryPolicy({ date, holiday = false, minutes = null }) {
  const key = String(date || "");
  if (!/^\d{8}$/.test(key)) throw new Error("白班辅值判断缺少有效日期");
  const day = new Date(`${key.slice(0,4)}-${key.slice(4,6)}-${key.slice(6,8)}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6 || holiday) return { allowed: false, reason: "周末及法定节假日无白班辅值" };
  if (minutes !== null && (minutes < 510 || minutes >= 1050)) return { allowed: false, reason: "夜班期间无白班辅值" };
  return { allowed: true, reason: "" };
}
