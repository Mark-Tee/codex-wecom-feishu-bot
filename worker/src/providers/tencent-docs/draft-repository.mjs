import fs from "node:fs/promises";
import path from "node:path";
import { parseCsv, toCsv } from "../../core/draft-merge.mjs";
import { inferShiftDateFromSpec, validateDutySpec, groupHandoverRows, handoverKey, mergeHandoverRow } from "../../core/duty-spec.mjs";

export class TencentDraftRepository {
  constructor({
    client,
    config,
    backupDir = path.join(process.cwd(), "data", "cache", "idc-draft-backups"),
  }) {
    this.client = client;
    this.config = config;
    this.backupDir = backupDir;
    this.file = {
      fileId: config.draft.online_file_id,
      fileUrl: config.draft.online_file_url,
    };
    this.weeklyName = config.draft.weekly_sheet_name || "周报草稿";
    this.handoverName = config.draft.handover_sheet_name || "交接班草稿";
  }

  async #sheets() {
    const info = await this.client.getSheetInfo(this.file);
    const weekly = info.sheets.find((sheet) => sheet.sheet_name === this.weeklyName);
    const handover = info.sheets.find((sheet) => sheet.sheet_name === this.handoverName);
    if (!weekly || !handover) throw new Error("固定草稿缺少周报草稿或交接班草稿工作表");
    return { weekly, handover };
  }

  async read({ weekly, handover }) {
    const [weeklyData, handoverData] = await Promise.all([
      this.client.getCsv(this.file, weekly.sheet_id, `A1:Q${weekly.row_count}`),
      this.client.getCsv(this.file, handover.sheet_id, `A1:I${handover.row_count}`),
    ]);
    return {
      weekly: parseCsv(weeklyData.csv_data || ""),
      handover: parseCsv(handoverData.csv_data || ""),
    };
  }

  async update(spec, options = {}) {
    await fs.mkdir(this.backupDir, { recursive: true });
    const lockPath = path.join(this.backupDir, "draft-writer.tmp");
    let lock;
    try { lock = await fs.open(lockPath, "wx"); }
    catch { throw Error("已有草稿写入或未核验的中断，请本机维护"); }
    try { return await this.#update(spec, options); }
    finally { await lock.close(); await fs.unlink(lockPath); }
  }

  async #update(spec, { currentDate = "", previousDate = "", context = {} } = {}) {
    validateDutySpec(spec);
    if ((await fs.readdir(this.backupDir)).some(name => name.endsWith(".pending.json"))) {
      throw Error("草稿有待核验写入，禁止自动重试，请本机维护");
    }
    const sheets = await this.#sheets();
    const handoverIncoming = await this.#prepareHandover(sheets.handover, groupHandoverRows(spec.handoverRows || []));
    const resolvedCurrentDate = String(currentDate || inferShiftDateFromSpec(spec, context)).replaceAll("-", "");
    const weeklyRows = await this.#append(sheets.weekly, spec.weeklyRows || [], 17, true);
    const handoverRows = await this.#append(sheets.handover, handoverIncoming, 9, false);
    return {
      fileId: this.config.draft.online_file_id,
      fileUrl: this.config.draft.online_file_url,
      currentDate: resolvedCurrentDate,
      previousDate,
      keptDates: [],
      weeklyRows,
      handoverRows,
    };
  }

  async #cells(sheet) {
    if (!Number.isSafeInteger(sheet.row_count) || !Number.isSafeInteger(sheet.col_count) || sheet.col_count < 1 || sheet.row_count < 1) throw Error("草稿尺寸无效");
    const cells = [], step = Math.max(1, Math.floor(20000 / sheet.col_count));
    for (let row = 0; row < sheet.row_count; row += step) {
      const data = await this.client.callTool("get_cell_data", {
        file_id: this.file.fileId, file_url: this.file.fileUrl, sheet_id: sheet.sheet_id,
        start_row: row, start_col: 0, end_row: Math.min(row + step, sheet.row_count) - 1,
        end_col: sheet.col_count - 1, return_csv: false, include_formula: true,
      });
      if (!Array.isArray(data.cells)) throw Error("草稿读取不完整");
      cells.push(...data.cells.filter(c => c.formula || c.string_value || c.number_value || c.bool_value || /NUMBER|BOOL|FORMULA/.test(c.value_type || "")));
    }
    return cells;
  }

  async #prepareHandover(sheet, incoming) {
    if (!incoming.length) return incoming;
    const cells = await this.#cells(sheet), rows = new Map();
    for (const c of cells) {
      if (!rows.has(c.row)) rows.set(c.row, Array(9).fill(""));
      if (c.col < 9) rows.get(c.row)[c.col] = String(c.string_value || (c.value_type === "NUMBER" ? c.number_value : ""));
    }
    const result = [], proposals = [];
    for (const row of incoming) {
      const matches = [...rows.entries()].filter(([index, r]) => index > 0 && handoverKey(r) === handoverKey(row));
      if (matches.length > 1) throw Error("同班次交接草稿有多行，需本机核验，未写入");
      if (!matches.length) { result.push(row); continue; }
      const [index, existing] = matches[0];
      const merged = mergeHandoverRow(existing, row);
      if (JSON.stringify(existing) === JSON.stringify(merged)) { result.push(existing); continue; }
      proposals.push({sheetId: sheet.sheet_id, sheetName: sheet.sheet_name, row: index + 1, existing, incoming: row, proposed: merged});
    }
    if (proposals.length) {
      await fs.writeFile(path.join(this.backupDir, `handover-review-${Date.now()}.json`), JSON.stringify({file: this.file, proposals}, null, 2), {flag: "wx"});
      throw Error(`交接草稿同班次已有记录，合并预览已保存，需本机确认后更新；本次未写腾讯表。待确认：${proposals.map(p => `${p.existing.slice(0, 4).join(" / ")}，第${p.row}行`).join("；")}`);
    }
    return result;
  }

  async #append(sheet, incoming, width, weekly) {
    const text = c => String(c.string_value || (c.value_type === "NUMBER" ? c.number_value : c.value_type === "BOOL" ? c.bool_value : ""));
    const key = r => JSON.stringify(weekly ? r.slice(1) : r);
    if (sheet.col_count < width) throw Error("草稿列数不足");
    let added = 0;
    for (const input of incoming) {
      const before = await this.#cells(sheet), rows = new Map();
      for (const c of before) {
        if (!rows.has(c.row)) rows.set(c.row, Array(width).fill(""));
        if (c.col < width) rows.get(c.row)[c.col] = text(c);
      }
      if (!rows.has(0)) throw Error("草稿缺少表头");
      const row = input.map(v => String(v ?? ""));
      if ([...rows.entries()].some(([i, r]) => i > 0 && key(r) === key(row))) continue;
      if (!weekly && [...rows.entries()].some(([i, r]) => i > 0 && handoverKey(r) === handoverKey(row))) {
        throw Error("同班次交接草稿已变化，需重新确认合并，未追加重复班次");
      }
      if (weekly) row[0] = String(Math.max(0, ...[...rows.entries()].filter(([i]) => i > 0).map(([, r]) => Number(r[0]) || 0)) + 1);
      const target = Math.max(...rows.keys()) + 1;
      if (target >= sheet.row_count) throw Error("没有整行空白区域，请维护者扩容");
      const intent = path.join(this.backupDir, `${sheet.sheet_id}-${Date.now()}-${target}.pending.json`);
      const pending = (await fs.readdir(this.backupDir)).filter(n => n.startsWith(`${sheet.sheet_id}-`) && n.endsWith(".pending.json"));
      if (pending.length) throw Error("草稿有待核验写入，禁止自动重试，请本机维护");
      await fs.writeFile(intent, JSON.stringify({sheet, before, target, row}), {flag: "wx"});
      if (JSON.stringify(await this.#cells(sheet)) !== JSON.stringify(before)) throw Error("写前草稿变化，停止写入");
      await this.client.setCsv(this.file, sheet.sheet_id, toCsv([row]), target, 0);
      await this.#formatNewRow(sheet, target, weekly);
      const after = await this.#cells(sheet), saved = Array(width).fill("");
      if (JSON.stringify(after.filter(c => c.row !== target)) !== JSON.stringify(before)) throw Error("原记录变化，请本机核验");
      for (const c of after.filter(c => c.row === target)) {
        if (c.col >= width || c.formula) throw Error("新增行存在非预期内容");
        saved[c.col] = text(c);
      }
      if (JSON.stringify(saved) !== JSON.stringify(row)) throw Error("新增行读回不一致，请本机核验");
      await fs.rename(intent, intent.replace(".pending.json", ".verified.json"));
      added++;
    }
    return added;
  }

  async #formatNewRow(sheet, target, weekly) {
    const row = target + 1, range = `A${row}:${weekly ? "Q" : "I"}${row}`;
    await this.client.setStyle(this.file, sheet.sheet_id, range, {
      horizontal_align: "center", vertical_align: "center",
      ...(!weekly ? {font_family: "宋体", font_size: 11} : {}),
    });
    for (const cols of weekly ? ["D:D"] : ["E:F", "H:H"]) {
      const [start, end] = cols.split(":");
      await this.client.setStyle(this.file, sheet.sheet_id, `${start}${row}:${end}${row}`, {horizontal_align: "left", wrap_text: true});
    }
    if (weekly) {
      await this.client.setStyle(this.file, sheet.sheet_id, `M${row}:N${row}`, {number_format_pattern: "h:mm;@"});
      await this.client.setStyle(this.file, sheet.sheet_id, `Q${row}:Q${row}`, {number_format_pattern: 'h"时"mm"分";@'});
    }
  }
}
