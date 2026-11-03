# codex-wecom-feishu-bot

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/Mark-Tee/codex-wecom-feishu-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/Mark-Tee/codex-wecom-feishu-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

自托管的企业微信排班与工单机器人，运行在 Windows 本机。排班只读在线表；工单通过独立 Edge 登录环境登记飞书，再按指令生成腾讯草稿，不要求飞书 API 权限。

> 文档对应当前修复分支，更新于2026-11-03；未合并的功能不能假定已在默认分支提供。本项目非企业微信、飞书、腾讯或 OpenAI 官方产品。当前适合受控试用，不代表已完成生产可靠性认证。

## 两个机器人

| 服务 | 职责 | 入口 |
|---|---|---|
| 排班 `roster` | 实时排班、个人视角、请假候选、群推送、动力交班模拟草稿 | `roster-bot.cjs` |
| 工单 `ticket` | 识别、字段确认、飞书登记、本人待办、腾讯草稿 | `bridge.cjs` → `worker/src/scripts/handle-wecom-message.mjs` |

每个实例使用独立 BotID/Secret、运行目录、状态、端口和登录任务。同一机器人不能同时建立两条长连接；每实例一个主进程加一个守护。短时工单子进程不是第二个常驻机器人。`combined` 是配置模板保留的历史兼容模式，不应误当已完成双机器人配置。

## 日常使用

群聊先 @ 对应机器人，私聊直接发送。只 @ 或发“菜单”打开按钮，点击后应收到具体结果；平台显示“成功”提示本身不算查询完成。

| 机器人 | 触发词 | 参数、示例与限制 |
|---|---|---|
| 排班 | `班`、`今`、`明` | 今天和明天、仅今天、仅明天；发送前读最新表 |
| 排班 | `我 姓名`、`我` | 如 `我 测试甲`；绑定或查看本人身份，不授予权限 |
| 排班 | `休`、`休下月`、`休2026-12` | 本月剩余或指定月候选；只列原本排白班且未受限日期 |
| 排班 | `休明`、`休2026-11-04` | 单日规则检查；不批准或办理请假 |
| 排班 | `推送`、`交班` | 查看群推送、本人动力交班提醒状态 |
| 工单 | 发工单图片 | 模糊字段先确认；按回执继续，不盲目重发 |
| 工单 | `人 姓名` | 如 `人 测试甲`，设置本人当前会话使用人 |
| 工单 | `单`、`继续`、`补 内容` | 查本人待办或待确认问题，如 `补 09:00` |
| 工单 | `填12`、`完12` | 重试填写；确认飞书已提交后生成固定腾讯草稿 |
| 工单 | `清10`、`清全部` | 停止本人当前会话追踪；全部需预览确认，不撤销在线操作 |
| 两者 | `菜单`、`状态` | 当前角色帮助、运行状态；旧业务口令仍兼容 |

姓名和补充参数前保留空格。短号以机器人本次回执为准，只能在原会话定位本人任务。成员之间、群聊与私聊之间分别接着处理，不混用任务；身份不一致时先确认，不凭昵称自动替换。

普通工单：发图 → 确认缺失字段 → 飞书填写/核验/按配置提交 → 收到明确结果后发送 `完12` → 固定腾讯草稿。动力值班按收到工单时的班次判断，只建飞书单，指派人员和陪同人留空，无需“完”。

`清`只停止后续追踪，保留防重状态；不删除已有飞书或腾讯记录。先确认清除、后点保留，不会撤销已执行的清除。

## 排班规则与定时消息

- 每天07:00推当天、17:00推次日，均在发送前重新读表；发送后不持续监控调班。
- 即时查询按绑定发起人的岗位、站点和部门排序；定时推送保持全员视角。
- 夜班（含动力夜班）、白班主值、异地网络1不能请假调休；其余候选不代表已获批准。
- 空白且无明确岗位按休息处理；紧邻夜班后为空表示下夜班休息，不列新请假候选。
- 白班辅值仅周一至周五非节假日白班有效，周末即使补班也无辅值。
- 已绑定的动力白班人员16:30、夜班人员次日07:30私聊收到模拟交班草稿；须交班前复核。
- 打卡地点不等于工作地点；站点冲突、颜色或源数据无法核验时不猜测、不发旧表。

## 写入与权限边界

源排班表只读；远程管理、授权、停任务、文件删除、绑定或解绑推送由本机维护处理，不提供给群成员执行。个人身份设置和“清本人待办”是有限的日常业务操作。

飞书只能操作本次新建记录，禁止复用已有记录卡；提交前核对字段及目标，提交后核对保存结果。双单号都有时按组合查重，只有一个时按该号；未知提交结果或不完整查重停止自动重试。布线、上下架的单号来源按原文校验，不虚构另一单号。

腾讯仅写配置中的固定草稿，不自动修改正式周报、交接主表。新增前核对整行占用，写前备份、写后读回；已有交接行生成本机合并预览，确认后才能更新。清理任务不回滚上述操作。

## 本机部署

需要 Windows/PowerShell、Node.js 22+、已登录 Codex CLI、企业微信长连接凭证；工单还需独立 Edge 登录及表格访问权限。腾讯功能需要当前用户的 `TENCENT_DOCS_TOKEN` 和本机源表/草稿配置。

```powershell
git clone https://github.com/Mark-Tee/codex-wecom-feishu-bot.git
cd codex-wecom-feishu-bot
.\setup.cmd
.\doctor.cmd
```

先检出拟部署的审阅版本。向导生成 `config.json`、`worker/config.json`、`worker/duty-config.json`，字段发现可能打开空白记录卡，但不提交测试记录。向导和示例不会代替角色、权限及实际写入范围确认。

为两个独立运行目录分别设置 `service.role`、不同端口及任务名；排班配置 `roster.rulesRoot` 和 `roster.businessConfigPath`，工单配置 `dutyAgent`。授权名单 `allowUsers` 在本机配置；留空时使用已有本机操作者状态，不能理解为所有人有权处理工单。

| 配置示例 | 排班 | 工单 |
|---|---|---|
| `service.role` | `roster` | `ticket` |
| `service.healthPort` | 8799 | 8809 |
| `service.guardianPort` | 8798 | 8808 |
| `service.taskName` | `RosterBot` | `TicketBot` |

工单自动提交必须明确开启 `feishuBrowser.enabled`、`autoFill` 与 `autoSubmit`，不能从配置模板推定已启用。共享表测试先离线/零写入；真实新增必须另行明确目标、日期和记录范围。

配置核验后，在各自目录启动或安装登录自启：

```powershell
.\start.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

`start.cmd` 调用隐藏守护，不是前台日志窗口。安装脚本使用当前用户登录任务，权限不足时回退启动快捷方式；`stop.ps1` 仅停止本目录实例并暂停对应任务。不要把依赖用户浏览器登录的服务改为 SYSTEM 运行。Windows 启动项必须使用系统路径时属于机制要求，其余运行文件可放自选 D 盘目录。

## 稳定性、统计与成本

已实现单实例端口独占、异常退出退避重启、连接异常检测和日志轮转。断网重连与本机健康检查分开；未认证本身不意味着应反复杀进程。Windows重启登录和实际断网恢复仍待专项验收。

新匿名统计仅记指令类别、次数、输入方式、耗时、结果与错误类别，不记正文、图片、姓名或账号；原有业务状态和诊断日志仍可能含敏感信息。各实例 `logs/observability/report.md` 在有新事件后一分钟内更新，生成本地建议，不自动改代码或上线；事件总容量约6MiB/实例，报告窗口近30天且受容量限制。详见[统计说明](docs/observability.md)。

沿用本机资源，无新增云托管固定费；排班、菜单、守护和匿名汇总不调用模型，工单识别消耗现有 Codex/模型额度。电脑、电费、存储、维护和网络仍有成本；整月模型消耗及机场流量未实测，不把本地估价当实际账单。

## 验收状态

已有人机实测：排班推送、两角色按钮查询返回具体内容、清理确认及待办查询。限定范围内做过飞书新增/读回和腾讯草稿测试，不等于全面无人值守验收。

仍待：下一批真实工单、多成员同时使用、模糊字段识别、动力提醒自然班次送达、重启/断网恢复、长期稳定性；一分钟建单和独立测试表连续10次均未达成验收声明。既有业务仍包含根据收到时间推算完成时间的规则，不能把推算当已核实实际时间。

测试基准默认预览目标指纹，不能拿生产表替代专用测试表：

```powershell
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10
node worker/src/scripts/benchmark-feishu-e2e.mjs --help
```

实际执行须使用帮助所要求的目标指纹、`--execute`、`--record`；中断按原报告续跑，未知提交结果先核验，脚本不自动删除测试记录。

## 模块与开发

| 位置 | 责任 |
|---|---|
| `lib/wecom-long-connection.cjs` | 认证、ACK/回调分流、心跳、重连 |
| `lib/roster-service.cjs`、`lib/schedule-broadcast.cjs` | 只读查询路由、身份和定时推送 |
| `lib/interaction-cards.cjs`、`lib/task-progress.cjs` | 绑定本人/会话的按钮、串行消息进度 |
| `lib/observability.cjs` | 匿名事件白名单、轮转及本地报告 |
| `worker/src/runtime/` | 工单会话、短号状态、任务队列和机器协议 |
| `worker/src/core/` | 班次、角色、字段、站点和草稿规则 |
| `worker/src/platforms/feishu-browser/` | 浏览器填写、查重、核验、提交保护 |
| `worker/src/providers/tencent-docs/` | 在线读取、固定草稿追加、备份与读回 |

```powershell
npm run check
npm test
npm run scan:secrets
```

测试使用离线桩和合成状态；通过不代表共享表在线验收。贡献前阅读[贡献说明](CONTRIBUTING.md)与[安全说明](SECURITY.md)。不得提交本机配置、凭据、浏览器资料、图片、日志、统计、真实任务或人员名单。

更多：[架构](docs/design-notes.md) · [Worker协议](worker/README.md) · [项目状态](docs/PROJECT_STATUS.md) · [短口令](docs/short-commands.md) · [成员隔离](docs/member-context.md) · [按钮](docs/interaction-cards.md) · [清理待办](docs/clear-own-tasks.md) · [权限](docs/remote-safety.md) · [排障](docs/troubleshooting.md)。

MIT，见[LICENSE](LICENSE)。

输入防御：已加入畸形/超长输入校验、授权前媒体拦截、限流、图片内网访问保护及工单识别工具权限限制。使用范围和成本见[防御说明](docs/input-defense.md)；历史入口不据此视为已加固。
