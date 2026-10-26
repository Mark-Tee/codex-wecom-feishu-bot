import { calculateScanWorkload, chooseAssignee, compareTaskIdentity } from "../../core/task-workflow.mjs";
import {
  DEFAULT_SCAN_FIELDS,
  DEFAULT_TASK_FIELDS,
  toLogicalScan,
  toLogicalTask,
} from "./fields.mjs";

function normalizedId(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function candidateScore(recognized, task) {
  return compareTaskIdentity(recognized, task).mismatches.length;
}

export function matchTaskRecords(recognized, tasks) {
  const candidates = tasks.filter((task) => {
    const transactionMatches = normalizedId(recognized.transactionNo)
      && normalizedId(recognized.transactionNo) === normalizedId(task.transactionNo);
    const roomMatches = normalizedId(recognized.roomTicketNo)
      && normalizedId(recognized.roomTicketNo) === normalizedId(task.roomTicketNo);
    return transactionMatches || roomMatches;
  });
  const exact = candidates.filter((task) => compareTaskIdentity(recognized, task).exact);
  if (exact.length === 1) return { action: "reuse", task: exact[0], candidates: exact };
  if (exact.length > 1) {
    throw new Error(`飞书中存在 ${exact.length} 条完全相同的主任务，请人工确认`);
  }
  if (candidates.length) {
    const ordered = [...candidates].sort(
      (a, b) => candidateScore(recognized, a) - candidateScore(recognized, b),
    );
    return {
      action: "confirm",
      candidates: ordered.map((task) => ({
        task,
        ...compareTaskIdentity(recognized, task),
      })),
    };
  }
  return { action: "create", candidates: [] };
}

export class FeishuTaskRepository {
  constructor({
    client,
    appToken,
    taskTableId,
    roomScanTableId,
    nonRoomScanTableId,
    taskFields = DEFAULT_TASK_FIELDS,
    scanFields = DEFAULT_SCAN_FIELDS,
    allowMultipleAssignees = true,
  }) {
    this.client = client;
    this.appToken = appToken;
    this.taskTableId = taskTableId;
    this.roomScanTableId = roomScanTableId;
    this.nonRoomScanTableId = nonRoomScanTableId;
    this.taskFields = taskFields;
    this.scanFields = scanFields;
    this.allowMultipleAssignees = allowMultipleAssignees;
  }

  async listTasks() {
    return this.client.listRecords({
      appToken: this.appToken,
      tableId: this.taskTableId,
    });
  }

  async findTask(recognized) {
    const tasks = (await this.listTasks()).map((record) => toLogicalTask(record, this.taskFields));
    return matchTaskRecords(recognized, tasks);
  }

  async collectCompletion(taskNumber) {
    const tasks = (await this.listTasks()).map((record) => toLogicalTask(record, this.taskFields));
    const matchingTasks = tasks.filter((task) => task.taskNumber === taskNumber);
    if (matchingTasks.length !== 1) {
      throw new Error(`任务号 ${taskNumber} 在飞书中匹配到 ${matchingTasks.length} 条`);
    }
    const task = matchingTasks[0];
    const tableIds = [this.roomScanTableId, this.nonRoomScanTableId].filter(Boolean);
    const records = (await Promise.all(tableIds.map((tableId) => this.client.listRecords({
      appToken: this.appToken,
      tableId,
    })))).flat()
      .map((record) => toLogicalScan(record, this.scanFields))
      .filter((record) => normalizedId(record.transactionNo) === normalizedId(task.transactionNo))
      .flatMap((record) => record.person.map((person) => ({ ...record, person })));
    const incomplete = records.filter((record) => !record.enteredAt || !record.leftAt);
    if (incomplete.length) {
      const people = [...new Set(incomplete.map((record) => record.person))].join("、");
      throw new Error(`以下人员缺少进入或离开扫码，不能闭环：${people}`);
    }
    const workload = calculateScanWorkload(records);
    return {
      task,
      scans: records,
      workload,
      assignees: chooseAssignee(records, {
        allowMultiple: this.allowMultipleAssignees,
      }),
      companions: [...new Set(records.map((record) => record.person))],
    };
  }
}
