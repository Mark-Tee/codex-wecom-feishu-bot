import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

const run = promisify(execFile);
export function evidenceRegions(items) {
  const rows = items.filter(i => typeof i.text === "string" && Array.isArray(i.box) && i.box.length === 4
    && i.box.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
    .map(i => ({...i, x: Math.min(...i.box.map(p => p[0])), y: Math.min(...i.box.map(p => p[1])),
      right: Math.max(...i.box.map(p => p[0])), bottom: Math.max(...i.box.map(p => p[1]))}));
  const regions = [];
  for (const label of rows.filter(r => /工作|描述|事项|姓名|机房.*编号|出入.*编号/.test(r.text) && !/工作.{0,1}态|工作流|工作台/.test(r.text))) {
    const h = Math.max(12, label.bottom - label.y);
    const value = rows.filter(r => r.x >= label.right - 4 && r !== label && Math.abs(r.y - label.y) < h)
      .sort((a, b) => a.x - b.x)[0];
    if (!value || value.x - label.right > 500 || (Number.isFinite(value.score) && value.score >= 0.85)) continue;
    regions.push({x: Math.max(0, label.x - 12), y: Math.max(0, Math.min(label.y, value.y) - h),
      width: Math.min(1600, value.right - label.x + 36), height: Math.min(300, Math.max(label.bottom, value.bottom) - Math.min(label.y, value.y) + h * 3),
      priority: (/具体|描述|事项|姓名/.test(label.text) ? 3 : /编号/.test(label.text) ? 2 : 1) + Math.min(value.text.length, 20) / 100,
      label: label.text});
  }
  const selected = [];
  for (const region of regions.sort((a, b) => b.priority - a.priority)) {
    if (!selected.some(r => Math.abs(r.y - region.y) < Math.max(r.height, region.height) / 2)) selected.push(region);
    if (selected.length === 2) break;
  }
  return selected;
}

export function evidenceText(items) {
  return [...items].sort((a, b) => (a.box?.[0]?.[1] ?? 0) - (b.box?.[0]?.[1] ?? 0))
    .map(i => `[OCR置信度${Number.isFinite(i.score) ? i.score.toFixed(2) : "未知"}${i.score < 0.85 ? "，待核对" : ""}] ${i.text || ""}`)
    .join("\n").slice(0, 12000);
}

export async function prepareImageEvidence(message, config, logger) {
  const originals = (message.images || []).filter(i => !i.derivedForOcr);
  if (!originals.length || !config.ocr?.enabled || !config.ocr.executable) return message;
  const image = originals[0];
  // Only the first image gets at most two detail crops; keep one model call.
  if (!/\.(png|jpe?g)$/i.test(image.path || "")) return message;
  try {
    const stat = await fs.stat(image.path);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return message;
    const hash = crypto.createHash("sha256").update(await fs.readFile(image.path)).digest("hex");
    const dir = path.join(config.dataDir, "cache", "image-evidence");
    await fs.mkdir(dir, {recursive: true});
    const cache = path.join(dir, hash + ".json");
    let data;
    try {data = JSON.parse(await fs.readFile(cache, "utf8"));} catch {}
    if (data?.version !== 1 || data.hash !== hash) {
      const result = await run(config.ocr.executable, [`--image_path=${image.path}`, "--maxSideLen=2048", "--ensureLogger=0"],
        {cwd: path.dirname(config.ocr.executable), windowsHide: true, timeout: Math.min(config.ocr.timeoutMs || 20000, 20000), maxBuffer: 8 * 1024 * 1024});
      const json = JSON.parse(result.stdout.split(/\r?\n/).find(l => l.trim().startsWith("{")) || "{}");
      if (!Array.isArray(json.data)) return message;
      data = {version: 1, hash, items: json.data};
      await fs.writeFile(cache, JSON.stringify(data));
    }
    const regions = evidenceRegions(data.items), crops = [];
    if (regions.length && process.platform === "win32") {
      const plan = path.join(dir, hash + "-regions.json");
      const regionHash = crypto.createHash("sha256").update(JSON.stringify(regions)).digest("hex").slice(0, 12);
      const outputs = regions.map((r, i) => ({...r, output: path.join(dir, `ocr-focus-${hash}-${regionHash}-${i}.png`)}));
      await fs.writeFile(plan, JSON.stringify(outputs));
      await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        fileURLToPath(new URL("./image-evidence.ps1", import.meta.url)), "-ImagePath", image.path, "-PlanPath", plan],
      {windowsHide: true, timeout: 10000});
      for (const r of outputs) if ((await fs.stat(r.output)).size > 0) crops.push({path: r.output, text: "同一原图的局部放大", derivedForOcr: true});
    }
    logger?.info("图片局部证据已准备", `局部${crops.length}张；不增加模型调用次数`);
    const previous = originals.length > 1 ? `${message.ocrText || ""}\n` : "";
    return {...message, images: [...originals, ...crops], ocrText: previous + "【首图高分辨率OCR，仅辅助；分数不代表文字正确】\n" + evidenceText(data.items)};
  } catch (error) {
    logger?.warn("图片增强未完成，沿用原图", error.code || error.name);
    return message;
  }
}
