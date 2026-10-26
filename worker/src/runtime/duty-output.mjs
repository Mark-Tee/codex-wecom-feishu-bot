export function extractDutyJson(text) {
  const source = String(text || "");
  const candidates = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(start, index + 1));
            if (
              parsed.needsClarification
              || (Array.isArray(parsed.weeklyRows) && Array.isArray(parsed.handoverRows))
            ) {
              candidates.push(parsed);
            }
          } catch {}
          break;
        }
      }
    }
  }
  return candidates.at(-1) || null;
}
