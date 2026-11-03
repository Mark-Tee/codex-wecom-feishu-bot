# 本机健康探测诊断

曾观察到本机探测连续失败后守护恢复主进程。旧日志没有保留失败类型及耗时，不能追溯断言是超时、代理、机器负载或其他具体原因；没有找到系统事件不等于能排除瞬时资源压力。

本次保持既有fetch、127.0.0.1目标、5秒超时、30秒检查周期、2分钟启动宽限、连续3次失败重启和单实例规则。只增加诊断分类与恢复记录，不以放宽门槛掩盖问题。

日志包含失败次数、类型、阶段、耗时、距上次检查的时间；失败后恢复时额外记录一次。不会在每次正常检查刷状态，也不会打印响应正文、原始异常文本、凭证或BotID。

类型包括 HEALTH_TIMEOUT、HEALTH_ECONNREFUSED 等网络错误、HEALTH_HTTP_503 等HTTP状态、HEALTH_BAD_JSON、HEALTH_BAD_RESPONSE。代码说明现象，不自动证明底层根因；需结合当时服务状态判断。

已离线模拟超时、连接拒绝、HTTP/JSON/身份异常、恢复计数和延迟检查，确认失败门槛不变；当前短期真实探测采样成功，不代表已复现或修复历史根因，也不替代重启登录或长期稳定性验收。

没有新增轮询、外网请求、模型调用、依赖或托管；沿用已有日志轮转。开发与调试占用当前会话额度，不能把运行时无新增模型调用说成整个服务免费。实际服务流量及模型月度消耗仍未完整测量。

## Console-free Windows startup
Scheduled recovery and Startup shortcuts launch `launch-hidden.vbs` through Windows Script Host. It hides PowerShell before creation and waits for the guardian, preserving scheduler status, exit codes and single-instance protection. Minute recovery and local health checks remain unchanged; this adds no model calls or network polling. Windows Script Host must be enabled. Existing scheduled actions must be updated or reinstalled to use the new entry.
