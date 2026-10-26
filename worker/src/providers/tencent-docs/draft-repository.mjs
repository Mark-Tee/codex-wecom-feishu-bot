import fs from "node:fs/promises";
import path from "node:path";
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
    return {
      weekly: parseCsv(weeklyData.csv_data || ""),
      handover: parseCsv(handoverData.csv_data || ""),
    };
  }

  async update(spec, { currentDate = "", previousDate = "", context = {} } = {}) {
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
      path.join(this.backupDir, `${resolvedCurrentDate}-${Date.now()}.json`),
      JSON.stringify({
        fileId: this.config.draft.online_file_id,
        currentDate: resolvedCurrentDate,
        previousDate,
        weekly: existing.weekly,
        handover: existing.handover,
      }, null, 2),
      "utf8",
    );

    await this.#replace(sheets.weekly, [merged.weeklyHeader, ...merged.weeklyRows]);
    await this.#replace(sheets.handover, [merged.handoverHeader, ...merged.handoverRows]);
    await this.#format(sheets.weekly, 17, merged.weeklyRows.length + 1, "weekly");
    await this.#format(sheets.handover, 9, merged.handoverRows.length + 1, "handover");
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
    const invalid = (styles.cells || []).filter((cell) => {
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
