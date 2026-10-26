import fs from "node:fs";
import path from "node:path";

function localTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    sign,
    pad(Math.floor(absolute / 60)),
    ":",
    pad(absolute % 60),
  ].join("");
}

export function createLogger({ name = "app", logDir = path.resolve("logs"), maxBytes = 5 * 1024 * 1024 } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${name}.log`);

  function write(level, ...parts) {
    const line = `[${localTimestamp()}] [${level}] ${parts.join(" ")}`;
    console.log(line);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, `${line}\n`, "utf8");
    } catch {}
  }

  return {
    file,
    info: (...parts) => write("info", ...parts),
    warn: (...parts) => write("warn", ...parts),
    error: (...parts) => write("error", ...parts),
  };
}
