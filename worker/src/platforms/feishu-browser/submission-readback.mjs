import {readOrderSnapshot} from "./order-guard.mjs";
import {parseExpectedEnterAt} from "../../core/task-workflow.mjs";

export function assertSavedDate(snapshot, taskNumber, expectedEnterAt) {
  const parsed = parseExpectedEnterAt(expectedEnterAt);
  const expected = parsed && Date.parse(`${parsed.date.replaceAll("/", "-")}T${parsed.time}:00+08:00`);
  const records = snapshot.matchedRecords?.filter(row => row.taskNumber === taskNumber) || [];
  if (!snapshot.complete || records.length !== 1 || !Number.isFinite(expected)
      || records[0].expectedEnterAt == null || Number(records[0].expectedEnterAt) !== expected) {
    const error = Error(`飞书提交后日期或记录未核验通过，请本机核对任务 ${taskNumber}；禁止自动重建`);
    error.requiresLocalReview = true;
    throw error;
  }
}

export async function verifySubmission(session, config, card, taskNumber, readSnapshot = readOrderSnapshot) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const snapshot = await readSnapshot(session, config, card);
      assertSavedDate(snapshot, taskNumber, card.expectedEnterAt);
      return;
    } catch (cause) {
      // Only retry a read when pagination totals change; never retry submission or a wrong date.
      if (attempt < 2 && cause.message.includes("查重期间主表记录数变化")) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      const error = Error(`飞书已尝试提交，任务 ${taskNumber} 待本机只读核验，禁止重新建单：${cause.message}`, {cause});
      error.requiresLocalReview = true;
      throw error;
    }
  }
}
