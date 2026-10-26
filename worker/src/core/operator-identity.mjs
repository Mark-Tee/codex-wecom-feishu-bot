export function levenshtein(leftValue, rightValue) {
  const left = Array.from(String(leftValue || ""));
  const right = Array.from(String(rightValue || ""));
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = saved;
    }
  }
  return row[right.length];
}

export function parseOperatorRequest(text) {
  const source = String(text || "").trim();
  const slash = source.match(/^\/(?:as|user)\s+([^\s，,。:：]+)(?:\s+([\s\S]*))?$/i);
  if (slash) return { name: slash[1], remainder: slash[2] || "", explicit: true };

  const natural = source.match(
    /^(?:我是|使用人(?:是|改为)?|切换到)\s*([\p{Script=Han}A-Za-z]{2,12})(?:[，,。:：\s]+([\s\S]*))?/u,
  );
  if (!natural || ["说这个", "说的是", "想问"].includes(natural[1])) return null;
  return { name: natural[1], remainder: natural[2] || "", explicit: false };
}

export function matchOperator(input, members, pinyinHints = {}) {
  const source = String(input || "").trim();
  if (members.includes(source)) {
    return { exact: true, best: { name: source, score: 1 }, secondScore: 0 };
  }
  const text = source.toLowerCase().replace(/[\s._-]/g, "");
  const ascii = /^[a-z]+$/i.test(text);
  const scored = members.map((name) => {
    let score = 0;
    if (ascii) {
      for (const hint of pinyinHints[name] || []) {
        const distance = levenshtein(text, hint);
        score = Math.max(score, text === hint ? 1 : 1 - distance / Math.max(text.length, hint.length));
      }
    } else {
      const distance = levenshtein(text, name);
      const leftChars = [...text];
      const rightChars = [...name];
      let prefix = 0;
      while (prefix < leftChars.length && prefix < rightChars.length && leftChars[prefix] === rightChars[prefix]) {
        prefix += 1;
      }
      score = Math.min(1, 1 - distance / Math.max(leftChars.length, rightChars.length) + (prefix ? 0.15 : 0));
    }
    return { name, score };
  }).sort((a, b) => b.score - a.score);
  return { exact: false, best: scored[0] || null, secondScore: scored[1]?.score || 0 };
}

export function likelyOperatorMatch(match) {
  if (!match?.best) return false;
  const margin = match.best.score - match.secondScore;
  return match.best.score >= 0.7 || (match.best.score >= 0.48 && margin >= 0.18);
}
