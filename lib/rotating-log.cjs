const fs = require("node:fs");
const path = require("node:path");

function appendRotatingLog(file, data, {maxBytes = 5 * 1024 * 1024, keep = 5} = {}) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  let size = 0;
  try { size = fs.statSync(file).size; } catch (error) { if (error.code !== "ENOENT") throw error; }
  const archive = (n) => path.join(path.dirname(file), `${path.basename(file, ".log")}.${n}.log`);
  if (size > 0 && size + Buffer.byteLength(data) > maxBytes) {
    // Only this logger's numbered .log files are rotated; legacy files remain untouched.
    fs.rmSync(archive(keep), {force:true});
    for (let n = keep - 1; n >= 1; n--) {
      if (fs.existsSync(archive(n))) fs.renameSync(archive(n), archive(n + 1));
    }
    fs.renameSync(file, archive(1));
  }
  fs.appendFileSync(file, data);
}
module.exports = {appendRotatingLog};
