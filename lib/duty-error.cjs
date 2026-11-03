function dutyErrorReply(error, reference) {
 const missing = /ERR_MODULE_NOT_FOUND|Cannot find module/.test(String(error?.message || ""));
 return ["【工单处理未完成】",missing ? "原因：本机工单组件加载失败，请联系维护者。" : "原因：处理发生异常，请联系维护者核验结果。","请勿重复提交；完整详情已保存在本机日志。",`问题编号：${reference}`].join("\n");
}
module.exports={dutyErrorReply};
