export const MAX_REPLY_BYTES = 20_000;

export function truncateReply(text, maxBytes = MAX_REPLY_BYTES) {
  const buffer = Buffer.from(String(text || ""), "utf8");
  if (buffer.length <= maxBytes) return buffer.toString("utf8");
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n\n…内容过长，已截断`;
}
