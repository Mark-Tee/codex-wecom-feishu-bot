const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IMAGE_TTL_MS = 7 * 24 * 3600 * 1000;
const IMAGE_MAX_BYTES = 500 * 1024 * 1024;
const QR_TTL_MS = 24 * 3600 * 1000;
const ANSWER_TTL_MS = 7 * 24 * 3600 * 1000;
const ANSWER_MAX_ENTRIES = 200;

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, full, mtimeMs: stat.mtimeMs, size: stat.size };
    }).filter((file) => !file.name.endsWith(".json"));
  } catch {
    return [];
  }
}

function createAnswerCache({
  dataRoot,
  imageDir,
  qrDir,
  log = () => {},
} = {}) {
  if (!dataRoot || !imageDir || !qrDir) {
    throw new Error("answer cache 参数不完整");
  }
  const answerDir = path.join(dataRoot, "cache", "answers");
  const indexFile = path.join(answerDir, "index.json");
  fs.mkdirSync(answerDir, { recursive: true });

  let entries = {};
  try {
    entries = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch {
    entries = {};
  }

  function save() {
    try {
      fs.writeFileSync(indexFile, JSON.stringify(entries, null, 2), "utf8");
    } catch {}
  }

  function cacheKeyFor(prompt, images) {
    try {
      const hash = crypto.createHash("sha256");
      hash.update(String(prompt || ""));
      for (const image of images || []) {
        try {
          hash.update(fs.readFileSync(image));
        } catch {}
      }
      return hash.digest("hex");
    } catch {
      return "";
    }
  }

  function get(key) {
    return entries[key] || null;
  }

  function isFresh(entry, now = Date.now()) {
    return Boolean(entry?.at && now - entry.at < ANSWER_TTL_MS);
  }

  function set(key, text) {
    entries[key] = { at: Date.now(), text };
    save();
  }

  function cleanup(now = Date.now()) {
    let removed = 0;
    let freed = 0;

    const images = listFiles(imageDir).sort((left, right) => left.mtimeMs - right.mtimeMs);
    for (const file of images) {
      if (now - file.mtimeMs <= IMAGE_TTL_MS) continue;
      try {
        fs.rmSync(file.full, { force: true });
        removed += 1;
        freed += file.size;
      } catch {}
    }
    let total = listFiles(imageDir).reduce((sum, file) => sum + file.size, 0);
    for (const file of listFiles(imageDir).sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (total <= IMAGE_MAX_BYTES) break;
      try {
        fs.rmSync(file.full, { force: true });
        total -= file.size;
        removed += 1;
        freed += file.size;
      } catch {}
    }

    for (const file of listFiles(qrDir)) {
      if (now - file.mtimeMs <= QR_TTL_MS) continue;
      try {
        fs.rmSync(file.full, { force: true });
        removed += 1;
      } catch {}
    }

    let changed = false;
    for (const [key, entry] of Object.entries(entries)) {
      if (!isFresh(entry, now)) {
        delete entries[key];
        changed = true;
      }
    }
    const keys = Object.keys(entries);
    if (keys.length > ANSWER_MAX_ENTRIES) {
      keys.sort((left, right) => entries[left].at - entries[right].at);
      for (const key of keys.slice(0, keys.length - ANSWER_MAX_ENTRIES)) {
        delete entries[key];
        changed = true;
      }
    }
    if (changed) save();
    if (removed || freed || changed) {
      log("cache cleanup", `removed=${removed}`, `freed=${Math.round(freed / 1024 / 1024)}MB`);
    }
    return { removed, freed, changed };
  }

  return {
    cleanup,
    get,
    isFresh,
    key: cacheKeyFor,
    set,
  };
}

module.exports = {
  ANSWER_MAX_ENTRIES,
  ANSWER_TTL_MS,
  IMAGE_MAX_BYTES,
  IMAGE_TTL_MS,
  QR_TTL_MS,
  createAnswerCache,
};
