import path from "node:path";
import { loadConfig } from "../config.mjs";
import { EdgeFormSession } from "../platforms/feishu-browser/edge-session.mjs";

function configPathFromArgs() {
  const index = process.argv.indexOf("--config");
  return path.resolve(index >= 0 ? process.argv[index + 1] : "config.json");
}

const fieldNames = {
  taskList: "任务列表",
  source: "任务来源",
  location: "任务地点",
  transactionNo: "事务单号",
  roomTicketNo: "机房单号",
  workContent: "工作内容",
  specificWork: "具体工作事项",
  expectedEnterAt: "预计进入时间",
  assignees: "指派人员",
  companions: "陪同人",
};

const config = loadConfig(configPathFromArgs());
if (!config.feishuBrowser.formUrl) {
  throw new Error("feishuBrowser.formUrl 为空");
}

const session = await EdgeFormSession.open(config.feishuBrowser);
try {
  const fields = await session.evaluate(`(() => (
    [...document.querySelectorAll('.base_record_card_field_editor_wrapper > label[data-field-id]')]
      .map((label) => ({
        id: label.getAttribute('data-field-id') || '',
        text: String(label.textContent || '').trim(),
      }))
      .filter((item) => item.id)
  ))()`);
  if (!fields.length) {
    throw new Error("没有发现记录卡字段。请先在机器人专用 Edge 中打开任意一条飞书记录，再重新运行。");
  }
  const mapping = {};
  for (const [key, label] of Object.entries(fieldNames)) {
    const found = fields.find((field) => field.text.startsWith(label));
    if (!found) {
      throw new Error(`记录卡中找不到字段“${label}”。请确认使用的是主任务表记录卡。`);
    }
    mapping[key] = found.id;
  }
  process.stdout.write(JSON.stringify(mapping));
} finally {
  session.close();
}
