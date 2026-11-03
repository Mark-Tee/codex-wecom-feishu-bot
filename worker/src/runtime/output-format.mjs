export function formatPendingTasks(tasks) {
  if (!tasks.length) return "本会话没有未完成工单。";
  const labels = {
    ready: "待飞书提交",
    failed: "上次写入失败",
    processing: "处理中",
  };
  return [
    "**本会话未完成工单**",
    "短号为本地编号。",
    ...tasks.map((task) => {
      let next = `联系维护者核对短号 ${task.id} 的飞书提交状态，暂不发送 /done。`;
      if (task.browserFill?.requiresReadback || task.browserFill?.requiresLocalReview || task.status === "failed") next = `将短号 ${task.id} 告知维护者核验，暂时无需操作。`;
      else if (task.status === "processing") next = "等待处理结果，不要重复提交。";
      else if (task.browserFill?.submitted) next = ["power-duty", "offsite-feishu", "feishu-test"].includes(task.workflowMode)
        ? "无需 /done，等待核验结果。" : `发送 /done ${task.id} 生成腾讯草稿。`;
      const status = task.browserFill?.awaitingWriteApproval ? "识别完成，待本机核准写入"
        : task.browserFill?.requiresReadback ? "飞书提交待读回核验"
        : task.browserFill?.requiresLocalReview ? "待本机核验"
        : task.browserFill?.submitted ? "飞书已提交" : labels[task.status] || task.status;
      return `${task.id} · ${status} · ${task.operator || "未设置使用人"}${
        task.browserFill?.ok ? " · 浏览器已填" : ""
      }\n下一步：${next}`;
    }),
  ].join("\n");
}

export function formatStatus({
  startedAt,
  now = Date.now(),
  queueSize,
  queueRunning,
  operator,
  workflowMode,
  browserEnabled,
  pendingCount,
}) {
  return [
    "连接：运行中",
    `运行：${Math.round((now - startedAt) / 1000)} 秒`,
    `队列：${queueSize} 个`,
    `当前：${queueRunning ? "执行中" : "空闲"}`,
    `值班使用人：${operator}`,
    `流程：${workflowMode === "direct-draft" ? "直接写草稿" : "半自动飞书"}`,
    `浏览器填表：${browserEnabled ? "已启用" : "未启用"}`,
    `本地待办：${pendingCount} 个`,
  ].join("\n");
}

export function formatBrowserFillSummary(result, { autoSubmit = false, powerDuty = false, skipDraft = false, taskId = "", testOnly = false } = {}) {
  if (!result?.configured) return "";
  const localId = taskId ? `本地短号：${taskId}（不是飞书单号）` : "";
  if(result.awaitingWriteApproval)return ["【识别已完成 · 等待写入许可】",localId,"字段已保存为本地待办；本次未打开飞书填写页面、未新增记录。","下一步：把这条回复转给维护者，等待本机核验；你暂时无需操作，不要重复发图或发送 /fill、/done。"].filter(Boolean).join("\n");
  if(result.requiresReadback)return ["【飞书页面提示已提交】",localId,result.taskNumber ? `任务列表：${result.taskNumber}` : "","尚待本机读回核对新增记录，不代表最终验收通过。","下一步：等待维护者核验结果，你暂时无需操作，不要重复建单或发送 /done。"].filter(Boolean).join("\n");
  if(result.requiresLocalReview)return [result.message?.includes("相同业务工单已在飞书存在") ? "【工单重复 · 未新增】" : "【飞书共享表保护】",localId,result.message,"下一步：联系维护者核对已有记录或处理结果；你暂时无需操作，不要手工提交或发送 /fill、/done。"].filter(Boolean).join("\n");
  const filled = (result.filled || []).join("、");
  const skipped = (result.skipped || []).join("；");
  if (result.submitted) {
    return [
      "**飞书已自动核对并提交**",
      localId,
      result.taskNumber ? `任务列表：${result.taskNumber}` : "",
      testOnly ? "下一步：等待维护者核验测试记录；本次只测试飞书，不写腾讯草稿，你无需发送 /done。" : powerDuty ? "下一步：无需操作。动力值班仅建飞书单，不生成腾讯草稿。" : skipDraft ? "下一步：无需操作。当日异地安排，不生成本地站点草稿。" : `下一步：发送 /done ${taskId || "<短号>"}，生成腾讯周报和交接草稿。`,
    ].filter(Boolean).join("\n");
  }
  if (result.ok) {
    return [
      "**飞书浏览器已填写并通过核对**",
      localId,
      result.taskNumber ? `任务列表：${result.taskNumber}` : "",
      autoSubmit
        ? "下一步：联系维护者检查浏览器，尚未确认提交成功，请勿重发工单或发送 /done。"
        : `下一步：请核对后手工点击提交。确认提交成功后${powerDuty || skipDraft || testOnly ? "无需 /done。" : `发送 /done ${taskId || "<短号>"}。`}`,
    ].filter(Boolean).join("\n");
  }
  return [
    filled ? "**飞书浏览器已部分填写**" : "**飞书浏览器未完成填写**",
    localId,
    result.taskNumber ? `任务列表：${result.taskNumber}` : "",
    result.diagnostics?.code ? `失败阶段：${result.diagnostics.code}` : "",
    filled ? `已填：${filled}` : "",
    skipped ? `未填：${skipped}` : result.message || "",
    "下一步：把这条回复转给维护者，先核验页面和已有记录。提交结果未确认，不要自行提交、重试或发送 /done。",
  ].filter(Boolean).join("\n");
}
