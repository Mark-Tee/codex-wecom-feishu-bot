import { execFileSync } from "node:child_process";

const SHEET_MCP_URL = "https://docs.qq.com/api/v6/sheet/mcp";

function fileArguments(file) {
  return {
    file_id: file.fileId || file.file_id,
    file_url: file.fileUrl || file.file_url,
  };
}

export function resolveTencentDocsToken() {
  if (process.env.TENCENT_DOCS_TOKEN?.trim()) {
    return process.env.TENCENT_DOCS_TOKEN.trim();
  }
  if (process.platform !== "win32") return "";
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('TENCENT_DOCS_TOKEN','User')"],
      { encoding: "utf8", timeout: 10000, windowsHide: true },
    ).trim();
  } catch {
    return "";
  }
}

export class TencentDocsClient {
  constructor({ token = resolveTencentDocsToken(), endpoint = SHEET_MCP_URL } = {}) {
    if (!token) throw new Error("未配置 TENCENT_DOCS_TOKEN");
    this.token = token;
    this.endpoint = endpoint;
  }

  async callTool(name, args) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`${name} 返回了非 JSON 响应，HTTP ${response.status}`);
    }
    if (!response.ok || payload.error) {
      const message = payload.error?.data?.message
        ?? payload.error?.message
        ?? `HTTP ${response.status}`;
      throw new Error(`${name} 失败：${message}`);
    }
    const result = payload.result || {};
    if (result.structuredContent !== undefined) return result.structuredContent;
    return JSON.parse(result.content?.[0]?.text || "{}");
  }

  async getSheetInfo(file) {
    return this.callTool("get_sheet_info", {
      ...fileArguments(file),
    });
  }

  async getCsv(file, sheetId, range) {
    const parsed = parseA1Range(range);
    return this.callTool("get_cell_data", {
      ...fileArguments(file),
      sheet_id: sheetId,
      start_row: parsed.startRow,
      start_col: parsed.startCol,
      end_row: parsed.endRow,
      end_col: parsed.endCol,
      return_csv: true,
    });
  }

  async getStyles(file, sheetId, range) {
    const parsed = parseA1Range(range);
    return this.callTool("get_cell_style", {
      ...fileArguments(file),
      sheet_id: sheetId,
      start_row: parsed.startRow,
      start_col: parsed.startCol,
      end_row: parsed.endRow,
      end_col: parsed.endCol,
    });
  }

  async clear(file, sheetId, rowCount, colCount) {
    return this.callTool("clear_range_cells", {
      ...fileArguments(file),
      sheet_id: sheetId,
      start_row: 0,
      start_col: 0,
      end_row: Math.max(0, rowCount - 1),
      end_col: Math.max(0, colCount - 1),
    });
  }

  async setCsv(file, sheetId, csv, startRow = 0, startCol = 0) {
    return this.callTool("set_range_value_by_csv", {
      ...fileArguments(file),
      sheet_id: sheetId,
      start_row: startRow,
      start_col: startCol,
      csv_data: csv,
    });
  }

  async setStyle(file, sheetId, range, format) {
    const parsed = parseA1Range(range);
    return this.callTool("set_cell_style", {
      ...fileArguments(file),
      sheet_id: sheetId,
      start_row: parsed.startRow,
      start_col: parsed.startCol,
      end_row: parsed.endRow,
      end_col: parsed.endCol,
      ...format,
    });
  }

  async setBorder(file, sheetId, range, border = {}) {
    const parsed = parseA1Range(range);
    return this.callTool("set_border", {
      ...fileArguments(file),
      sheet_id: sheetId,
      start_row: parsed.startRow,
      start_col: parsed.startCol,
      end_row: parsed.endRow,
      end_col: parsed.endCol,
      border_positions: [
        "BORDER_POS_TOP",
        "BORDER_POS_BOTTOM",
        "BORDER_POS_LEFT",
        "BORDER_POS_RIGHT",
        "BORDER_POS_INNER_VERTICAL",
        "BORDER_POS_INNER_HORIZONTAL",
      ],
      border_style: "BORDER_STYLE_THIN",
      border_color: "000000",
      ...border,
    });
  }
}

function columnNumber(name) {
  return [...String(name).toUpperCase()].reduce(
    (value, char) => value * 26 + char.charCodeAt(0) - 64,
    0,
  );
}

export function parseA1Range(value) {
  const match = String(value || "").match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!match) throw new Error(`无效的 A1 范围：${value}`);
  return {
    startRow: Number(match[2]) - 1,
    startCol: columnNumber(match[1]) - 1,
    endRow: Number(match[4]) - 1,
    endCol: columnNumber(match[3]) - 1,
  };
}
