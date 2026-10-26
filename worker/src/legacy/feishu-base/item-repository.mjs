import { evaluateReplacementItems } from "../../core/item-registration.mjs";
import {
  DEFAULT_CARRY_OUT_FIELDS,
  DEFAULT_FAULTY_DISK_FIELDS,
  toLogicalCarryOutItem,
  toLogicalFaultyDisk,
} from "./fields.mjs";

export class FeishuItemRepository {
  constructor({
    client,
    appToken,
    carryOutTableId,
    faultyDiskTableId,
    carryOutFields = DEFAULT_CARRY_OUT_FIELDS,
    faultyDiskFields = DEFAULT_FAULTY_DISK_FIELDS,
  }) {
    this.client = client;
    this.appToken = appToken;
    this.carryOutTableId = carryOutTableId;
    this.faultyDiskTableId = faultyDiskTableId;
    this.carryOutFields = carryOutFields;
    this.faultyDiskFields = faultyDiskFields;
  }

  async inspectTask({ task, items, photoSender, operationOrderNo = "" }) {
    const [carryOutRecords, faultyDiskRecords] = await Promise.all([
      this.client.listRecords({
        appToken: this.appToken,
        tableId: this.carryOutTableId,
      }),
      this.client.listRecords({
        appToken: this.appToken,
        tableId: this.faultyDiskTableId,
      }),
    ]);
    const existingCarryOut = carryOutRecords
      .map((record) => toLogicalCarryOutItem(record, this.carryOutFields))
      .filter((record) => record.linkedTaskRecordId === task.recordId);
    const existingFaultyDisks = faultyDiskRecords
      .map((record) => toLogicalFaultyDisk(record, this.faultyDiskFields))
      .filter((record) => record.linkedTaskRecordId === task.recordId);
    return evaluateReplacementItems({
      task,
      items,
      photoSender,
      existingCarryOut,
      existingFaultyDisks,
      operationOrderNo,
    });
  }
}
