import { nextTaskNumber, resolveTaskShift } from "../../core/task-workflow.mjs";
import {
  DEFAULT_TASK_FIELDS,
  buildTaskCreateFields,
  indexFieldMetadata,
  toLogicalTask,
} from "./fields.mjs";
import { matchTaskRecords } from "./repository.mjs";

class KeyedMutex {
  constructor() {
    this.tails = new Map();
  }

  async run(key, handler) {
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await handler();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function elapsed(clock, startedAt) {
  return Math.round(clock() - startedAt);
}

export class FeishuTaskCreationService {
  constructor({
    client,
    appToken,
    taskTableId,
    taskFields = DEFAULT_TASK_FIELDS,
    clock = () => performance.now(),
    taskViewId = "",
  }) {
    this.client = client;
    this.appToken = appToken;
    this.taskTableId = taskTableId;
    this.taskFields = taskFields;
    this.clock = clock;
    this.taskViewId = taskViewId;
    this.fieldMetadata = null;
    this.warmPromise = null;
    this.locks = new KeyedMutex();
  }

  async warm() {
    if (this.fieldMetadata) return { cached: true, elapsedMs: 0 };
    if (this.warmPromise) return this.warmPromise;
    this.warmPromise = (async () => {
      const startedAt = this.clock();
      await this.client.warmToken();
      const fields = await this.client.listFields({
        appToken: this.appToken,
        tableId: this.taskTableId,
      });
      this.fieldMetadata = indexFieldMetadata(fields);
      for (const required of ["任务列表", "事务单号", "机房单号"]) {
        if (!this.fieldMetadata.has(required)) {
          throw new Error(`飞书主任务表缺少字段：${required}`);
        }
      }
      return { cached: false, elapsedMs: elapsed(this.clock, startedAt) };
    })();
    try {
      return await this.warmPromise;
    } finally {
      this.warmPromise = null;
    }
  }

  async createOrReuse(recognized, { receivedAt = new Date().toISOString() } = {}) {
    const shift = resolveTaskShift(receivedAt);
    return this.locks.run(`${this.appToken}:${this.taskTableId}:${shift.prefix}`, async () => {
      const totalStartedAt = this.clock();
      const warm = await this.warm();

      const lookupStartedAt = this.clock();
      const filterConditions = [{
        field_name: this.taskFields.taskNumber,
        operator: "contains",
        value: [shift.prefix],
      }];
      if (recognized.transactionNo) {
        filterConditions.push({
          field_name: this.taskFields.transactionNo,
          operator: "is",
          value: [recognized.transactionNo],
        });
      }
      if (recognized.roomTicketNo) {
        filterConditions.push({
          field_name: this.taskFields.roomTicketNo,
          operator: "is",
          value: [recognized.roomTicketNo],
        });
      }
      const records = await this.client.listRecords({
        appToken: this.appToken,
        tableId: this.taskTableId,
        viewId: this.taskViewId || undefined,
        filter: {
          conjunction: "or",
          conditions: filterConditions,
        },
      });
      const tasks = records.map((record) => toLogicalTask(record, this.taskFields));
      const match = matchTaskRecords(recognized, tasks);
      const lookupMs = elapsed(this.clock, lookupStartedAt);
      if (match.action !== "create") {
        return {
          ...match,
          timings: {
            warmMs: warm.elapsedMs,
            lookupMs,
            createMs: 0,
            totalMs: elapsed(this.clock, totalStartedAt),
          },
        };
      }

      const taskNumber = nextTaskNumber(
        tasks.map((task) => task.taskNumber),
        shift.prefix,
      );
      const fields = buildTaskCreateFields(
        recognized,
        taskNumber,
        this.fieldMetadata,
        this.taskFields,
      );
      const createStartedAt = this.clock();
      const record = await this.client.createRecord(
        { appToken: this.appToken, tableId: this.taskTableId },
        fields,
      );
      const createMs = elapsed(this.clock, createStartedAt);
      return {
        action: "create",
        taskNumber,
        task: toLogicalTask(record, this.taskFields),
        timings: {
          warmMs: warm.elapsedMs,
          lookupMs,
          createMs,
          totalMs: elapsed(this.clock, totalStartedAt),
        },
      };
    });
  }
}
