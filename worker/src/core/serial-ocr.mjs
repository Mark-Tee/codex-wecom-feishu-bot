const SERIAL_LABEL = /\bSN\b|S\s*\/\s*N|SERIAL(?:\s*NUMBER)?|序列号/i;
const TOKEN_PATTERN = /[A-Z0-9]+(?:[-_.][A-Z0-9]+)*/gi;

function usableToken(token) {
  const normalized = String(token || "").replace(/\s+/g, "").toUpperCase();
  if (normalized.length < 7 || normalized.length > 32) return false;
  if (!/[A-Z]/.test(normalized) || !/\d/.test(normalized)) return false;
  if (/^20\d{6}$/.test(normalized)) return false;
  return true;
}

export function extractSerialCandidates(ocrText, { itemName = "" } = {}) {
  const candidates = new Map();
  const lines = String(ocrText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const labeled = SERIAL_LABEL.test(line);
    for (const match of line.matchAll(TOKEN_PATTERN)) {
      const token = match[0].replace(/\s+/g, "").toUpperCase();
      if (!usableToken(token)) continue;
      const score = (labeled ? 20 : 0)
        + Math.min(8, Math.max(0, token.length - 7))
        + (/[-_.]/.test(token) ? 2 : 0);
      const previous = candidates.get(token);
      if (!previous || score > previous.score) {
        candidates.set(token, {
          value: token,
          score,
          sourceLine: line,
          reason: labeled ? "序列号标签附近" : "照片中的字母数字串",
        });
      }
    }
  }
  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      itemName,
      requiresConfirmation: true,
    }))
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value));
}
