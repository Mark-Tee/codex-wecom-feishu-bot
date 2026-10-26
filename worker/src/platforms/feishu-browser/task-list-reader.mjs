export function parseBitableTarget(formUrl) {
  const url = new URL(String(formUrl || ""));
  const segments = url.pathname.split("/").filter(Boolean);
  const baseIndex = segments.lastIndexOf("base");
  const appToken = baseIndex >= 0 ? segments[baseIndex + 1] || "" : "";
  const tableId = url.searchParams.get("table") || "";
  if (!appToken || !tableId) throw new Error("飞书地址缺少 app token 或 table ID");
  return { origin: url.origin, appToken, tableId };
}

export async function readTaskNumbers(session, {
  formUrl,
  viewId,
  fieldId,
  pageSize = 3000,
}, prefix) {
  const { origin, appToken, tableId } = parseBitableTarget(formUrl);
  const normalizedViewId = String(viewId || "").trim();
  const normalizedFieldId = String(fieldId || "").trim();
  if (!normalizedViewId || !normalizedFieldId) {
    throw new Error("缺少任务列表视图或字段配置");
  }
  const limit = Math.max(1, Math.min(3000, Number(pageSize || 3000)));
  const numbers = new Set();
  let offset = 0;
  let total = Infinity;
  let complete = false;
  for (let page = 0; page < 20; page += 1) {
    const result = await session.evaluate(`(async () => {
      const endpoint = new URL(
        ${JSON.stringify(`/space/api/v1/bitable/${appToken}/records`)},
        ${JSON.stringify(origin)},
      );
      endpoint.searchParams.set("tableId", ${JSON.stringify(tableId)});
      endpoint.searchParams.set("viewId", ${JSON.stringify(normalizedViewId)});
      endpoint.searchParams.set("viewLazyLoad", "true");
      endpoint.searchParams.set("offset", String(${JSON.stringify(offset)}));
      endpoint.searchParams.set("limit", String(${JSON.stringify(limit)}));
      endpoint.searchParams.set("tableID", ${JSON.stringify(tableId)});
      endpoint.searchParams.set("viewID", ${JSON.stringify(normalizedViewId)});
      endpoint.searchParams.set("removeFmlExtra", "true");
      const response = await fetch(endpoint, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0 || !payload.data?.records) {
        throw new Error(payload.msg || "读取飞书任务列表失败");
      }
      const bytes = Uint8Array.from(
        atob(payload.data.records),
        (char) => char.charCodeAt(0),
      );
      const decoded = JSON.parse(await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text());
      const recordMap = decoded.recordMap || {};
      const values = [];
      for (const record of Object.values(recordMap)) {
        const raw = record?.[${JSON.stringify(normalizedFieldId)}]?.value;
        const parts = Array.isArray(raw) ? raw : [raw];
        const value = parts.map((item) => (
          typeof item === "string" ? item : item?.text || ""
        )).join("").trim();
        if (${JSON.stringify(prefix)}.length && value.startsWith(${JSON.stringify(prefix)})) {
          values.push(value);
        }
      }
      return {
        values,
        loaded: Object.keys(recordMap).length,
        total: Number(decoded.tableRecordNum || decoded.viewRecordNum || 0),
      };
    })()`);
    for (const value of result?.values || []) numbers.add(value);
    const loaded = Number(result?.loaded || 0);
    const reportedTotal = Number(result?.total || 0);
    if (reportedTotal > 0) total = reportedTotal;
    offset += loaded;
    complete = !loaded
      || (Number.isFinite(total) ? offset >= total : loaded < limit);
    if (complete) break;
  }
  if (!complete) throw new Error("飞书任务列表记录过多，未完成读取");
  return [...numbers];
}
