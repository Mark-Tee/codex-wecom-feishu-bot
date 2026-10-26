export function formatPendingTasks(tasks) {
  if (!tasks.length) return "本会话没有未完成的本地工单。";
  const labels = {
    ready: "待飞书提交",
    failed: "上次写入失败",
    processing: "处理中",
  };
  return [
    "**本会话未完成工单**",
    ...tasks.map((task) => (
      `${task.id} · ${labels[task.status] || task.status} · ${task.operator || "未设置使用人"}${
        task.browserFill?.ok ? " · 浏览器已填" : ""
      }`
    )),
    "确认飞书已提交后发送：/done <短号>",
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

export function formatBrowserFillSummary(result, { autoSubmit = false } = {}) {
  if (!result?.configured) return "";
  const filled = (result.filled || []).join("、");
  const skipped = (result.skipped || []).join("；");
  if (result.submitted) {
    return [
      "**飞书已自动核对并提交**",
      result.taskNumber ? `任务列表：${result.taskNumber}` : "",
      `已填：${filled || "无"}`,
      "腾讯草稿尚未生成，请发送 /done <短号>。",
    ].filter(Boolean).join("\n");
  }
  if (result.ok) {
    return [
      "**飞书浏览器已填写并通过核对**",
      result.taskNumber ? `任务列表：${result.taskNumber}` : "",
      `已填：${filled || "无"}`,
      autoSubmit
        ? "未检测到提交成功，请检查浏览器。"
        : "请核对后手工点击提交。",
    ].filter(Boolean).join("\n");
  }
  return [
    filled ? "**飞书浏览器已部分填写**" : "**飞书浏览器未完成填写**",
    result.taskNumber ? `任务列表：${result.taskNumber}` : "",
    filled ? `已填：${filled}` : "",
    skipped ? `未填：${skipped}` : result.message || "",
    "请核对后补填并手工提交，也可修正后发送 /fill 重试。",
  ].filter(Boolean).join("\n");
}
