import {CdpConnection} from "./cdp.mjs";
import {parseBitableTarget} from "./task-list-reader.mjs";
import {assertSameWriteTarget} from "./write-approval.mjs";

export async function attachHandoffReader(config) {
  const response = await fetch(`http://127.0.0.1:${config.debugPort}/json/list`, {signal:AbortSignal.timeout(2500)});
  if (!response.ok) throw Error("飞书只读浏览器不可用");
  const pages = await response.json();
  const page = pages.find(item => {try {assertSameWriteTarget(item.url, config.formUrl);return item.type === "page" && item.webSocketDebuggerUrl;} catch {return false;}});
  if (!page) throw Error("没有已登录的正确飞书任务表页面，请维护者打开；不自动创建或跳转页面");
  return CdpConnection.connect(page.webSocketDebuggerUrl);
}

export async function readHandoffRecords(config, prefix, {connect = attachHandoffReader} = {}) {
  const target = parseBitableTarget(config.formUrl), ids = config.fieldIds || {};
  for (const key of ["taskList", "location", "workContent", "specificWork", "transactionNo", "roomTicketNo"]) if (!ids[key]) throw Error(`交班统计缺少字段：${key}`);
  if (!config.taskListViewId) throw Error("交班统计缺少完整表视图");
  const session = await connect(config), seen = new Set(), records = [];
  const verifiedFields = Object.fromEntries(["taskList", "location", "workContent", "specificWork", "transactionNo", "roomTicketNo"].map(key => [key, false]));
  let offset = 0, total;
  try {
    assertSameWriteTarget(await session.evaluate("location.href"), config.formUrl);
    for (let page = 0; page < 20; page++) {
      const result = await session.evaluate(`/* READ_ONLY_HANDOFF */ (async()=>{
        const url=new URL(${JSON.stringify(`/space/api/v1/bitable/${target.appToken}/records`)},${JSON.stringify(target.origin)});
        for(const [k,v] of Object.entries({tableId:${JSON.stringify(target.tableId)},tableID:${JSON.stringify(target.tableId)},viewId:${JSON.stringify(config.taskListViewId)},viewID:${JSON.stringify(config.taskListViewId)},viewLazyLoad:'true',offset:${JSON.stringify(String(offset))},limit:'3000',removeFmlExtra:'true'}))url.searchParams.set(k,v);
        const response=await fetch(url,{credentials:'include',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)}),payload=await response.json();
        if(!response.ok||payload.code!==0||!payload.data?.records)throw Error('飞书任务读取失败');
        const bytes=Uint8Array.from(atob(payload.data.records),c=>c.charCodeAt(0));
        const decoded=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
        const plain=v=>v==null?'':Array.isArray(v)?v.map(plain).join(''):typeof v==='object'?plain(v.text??v.value??''):String(v);
        const ids=${JSON.stringify(ids)},rows=Object.entries(decoded.recordMap||{}),selected=[],fieldsPresent={};
        for(const [id,row] of rows){for(const key of ['taskList','location','workContent','specificWork','transactionNo','roomTicketNo'])fieldsPresent[key] ||= Object.hasOwn(row,ids[key]);const number=plain(row[ids.taskList]?.value);if(!number.startsWith(${JSON.stringify(prefix)}))continue;
          for(const key of ['taskList','location','workContent','specificWork','transactionNo','roomTicketNo'])if(!Object.hasOwn(row,ids[key]))throw Error('飞书任务字段不完整');
          selected.push({id,number,location:row[ids.location]?.value,workContent:row[ids.workContent]?.value,description:plain(row[ids.specificWork]?.value),transactionNo:plain(row[ids.transactionNo]?.value),roomTicketNo:plain(row[ids.roomTicketNo]?.value)});}
        return {recordIds:rows.map(([id])=>id),total:decoded.tableRecordNum,selected,fieldsPresent};
      })()`);
      if (!Array.isArray(result?.recordIds) || !Array.isArray(result.selected) || !Number.isSafeInteger(Number(result.total)) || Number(result.total)<0 || result.total === null || result.total === "") throw Error("交班统计未返回完整记录总数");
      if (total === undefined) total = Number(result.total);
      if (total !== Number(result.total)) throw Error("读取期间飞书记录数变化，交班统计需重读");
      for (const id of result.recordIds) {if(seen.has(id))throw Error("交班统计分页重复");seen.add(id);}
      for (const key of Object.keys(verifiedFields)) verifiedFields[key] ||= Boolean(result.fieldsPresent?.[key]);
      records.push(...result.selected);offset += result.recordIds.length;
      if (seen.size === total) {
        if (total && !Object.values(verifiedFields).every(Boolean)) throw Error("交班统计字段映射未核实，不能当作零任务");
        return records;
      }
      if (!result.recordIds.length || seen.size > total) throw Error("交班统计分页不完整");
    }
    throw Error("交班统计记录过多，未完成读取");
  } finally {session.close();}
}
