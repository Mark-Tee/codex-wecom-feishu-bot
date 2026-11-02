import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { orderIdentifiers, sameBusinessOrder } from "../../core/order-identity.mjs";
import { mergeDraftRows, parseCsv, toCsv } from "../../core/draft-merge.mjs";
import { inferShiftDateFromSpec, validateDutySpec } from "../../core/duty-spec.mjs";

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
    if (typeof weeklyData.csv_data !== "string" || typeof handoverData.csv_data !== "string") {
      throw new Error("草稿读取未返回完整CSV，未允许写入");
    }
    return {
      weekly: parseCsv(weeklyData.csv_data || ""),
      handover: parseCsv(handoverData.csv_data || ""),
    };
  }

  async update(spec, options = {}) {
    validateDutySpec(spec);
    // Serialize a target and keep uncertain writes from being replayed as new work.
    await fs.mkdir(this.backupDir, { recursive: true });
    const target = crypto.createHash("sha256").update(JSON.stringify(this.file)).digest("hex");
    const lockPath = path.join(this.backupDir, `${target}.writer.lock`);
    let lock;
    try { lock = await fs.open(lockPath, "wx", 0o600); }
    catch (error) { if (error.code !== "EEXIST") throw error; throw new Error("草稿已有写入或中断待核验，禁止并发重试"); }
    const receiptPath = path.join(this.backupDir, `${target}.orders.json`);
    const order = orderIdentifiers(options.order);
    const hasOrder = Boolean(order.transactionNo || order.roomTicketNo);
    try {
      let entries = [];
      if (hasOrder) {
        try { entries = JSON.parse(await fs.readFile(receiptPath, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!Array.isArray(entries)) throw new Error("草稿业务回执格式异常，请本机核验");
        const previous = entries.find(entry => sameBusinessOrder(entry.order, order));
        if (previous) {
          if (previous.status !== "completed") throw new Error("同一工单写入结果待本机核验，禁止重复提交");
          return { ...previous.result, duplicate: true };
        }
      }
      const save = async () => {
        const temp = receiptPath + "." + crypto.randomUUID() + ".tmp";
        await fs.writeFile(temp, JSON.stringify(entries, null, 2), { mode: 0o600 });
        await fs.rename(temp, receiptPath);
      };
      const entry = { order, status: "processing" };
      if (hasOrder) { entries.push(entry); await save(); }
      const result = await this.#updateDraft(spec, options);
      if (hasOrder) { entry.status = "completed"; entry.result = result; await save(); }
      return result;
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }

  async #updateDraft(spec, { currentDate = "", previousDate = "", context = {} } = {}) {
    validateDutySpec(spec);
    const sheets = await this.#sheets();
    const existing = await this.read(sheets);
    const year = String(currentDate || context.workDate || new Date().getFullYear()).slice(0, 4);
    const resolvedCurrentDate = String(currentDate || inferShiftDateFromSpec(spec, context)).replaceAll("-", "");
    const merged = mergeDraftRows({
      weeklyExisting: existing.weekly,
      handoverExisting: existing.handover,
      weeklyIncoming: spec.weeklyRows,
      handoverIncoming: spec.handoverRows,
      currentDate: resolvedCurrentDate,
      previousDate: String(previousDate || "").replaceAll("-", ""),
      year,
    });

    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.writeFile(
      path.join(this.backupDir, `${resolvedCurrentDate}-${crypto.randomUUID()}.json`),
      JSON.stringify({
        fileId: this.config.draft.online_file_id,
        currentDate: resolvedCurrentDate,
        previousDate,
        weekly: existing.weekly,
        handover: existing.handover,
      }, null, 2),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );

    await this.#replace(sheets.weekly, [merged.weeklyHeader, ...merged.weeklyRows]);
    await this.#replace(sheets.handover, [merged.handoverHeader, ...merged.handoverRows]);
    await this.#format(sheets.weekly, 17, merged.weeklyRows.length + 1, "weekly");
    await this.#format(sheets.handover, 9, merged.handoverRows.length + 1, "handover");
    const readback = await this.read(sheets);
    assertDraftContent(readback.weekly, [merged.weeklyHeader, ...merged.weeklyRows], 17, "周报");
    assertDraftContent(readback.handover, [merged.handoverHeader, ...merged.handoverRows], 9, "交接班");
    await this.#verify(sheets.weekly, 17, merged.weeklyRows.length + 1);
    await this.#verify(sheets.handover, 9, merged.handoverRows.length + 1);

    return {
      fileId: this.config.draft.online_file_id,
      fileUrl: this.config.draft.online_file_url,
      currentDate: resolvedCurrentDate,
      previousDate,
      keptDates: merged.keptDates,
      weeklyRows: merged.weeklyRows.length,
      handoverRows: merged.handoverRows.length,
    };
  }

  async #replace(sheet, rows) {
    await this.client.clear(this.file, sheet.sheet_id, sheet.row_count, sheet.col_count);
    await this.client.setCsv(this.file, sheet.sheet_id, toCsv(rows));
  }

  async #format(sheet, width, rowCount, kind) {
    if (rowCount <= 1) return;
    const range = `A2:${String.fromCharCode(64 + width)}${rowCount}`;
    await this.client.setStyle(this.file, sheet.sheet_id, range, {
      horizontal_align: "center",
      vertical_align: "center",
      font_family: "等线",
      font_size: 10,
      font_color: "FF000000",
    });
    if (kind === "weekly") {
      await this.client.setStyle(this.file, sheet.sheet_id, `D2:D${rowCount}`, { wrap_text: true });
      await this.client.setStyle(this.file, sheet.sheet_id, `M2:N${rowCount}`, { number_format_pattern: "h:mm;@" });
      await this.client.setStyle(this.file, sheet.sheet_id, `Q2:Q${rowCount}`, {
        number_format_pattern: 'h"时"mm"分";@',
      });
    } else {
      await this.client.setStyle(this.file, sheet.sheet_id, `E2:E${rowCount}`, { wrap_text: true });
    }
    await this.client.setBorder(this.file, sheet.sheet_id, range);
  }

  async #verify(sheet, width, rowCount) {
    if (rowCount <= 1) return;
    const range = `A2:${String.fromCharCode(64 + width)}${rowCount}`;
    const styles = await this.client.getStyles(this.file, sheet.sheet_id, range);
    if (!Array.isArray(styles.cells) || styles.cells.length !== (rowCount - 1) * width) {
      throw new Error(`草稿格式读回范围不完整：${sheet.sheet_name}`);
    }
    const invalid = styles.cells.filter((cell) => {
      const borders = cell.borders || {};
      return cell.horizontal_align !== "center"
        || cell.vertical_align !== "center"
        || !borders.top
        || !borders.bottom
        || !borders.left
        || !borders.right;
    });
    if (invalid.length) {
      throw new Error(`草稿写入后格式校验失败：${sheet.sheet_name} 有 ${invalid.length} 个单元格不合规`);
    }
  }
}

export function assertDraftContent(actual, expected, width, label) {
  const normalize = rows => rows.map(row => Array.from({ length: width }, (_, index) => {
    const text = String(row[index] ?? "").replaceAll("\r\n", "\n");
    if (width === 17 && (index === 12 || index === 13) && /^\d{1,2}:\d{2}$/.test(text)) return text.padStart(5, "0");
    return text;
  }));
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) {
    throw new Error(`${label}草稿写后内容核验失败，结果不明，请本机检查备份，禁止盲目重试`);
  }
}
