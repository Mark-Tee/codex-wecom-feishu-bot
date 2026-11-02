# codex-wecom-feishu-bot

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/Mark-Tee/codex-wecom-feishu-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/Mark-Tee/codex-wecom-feishu-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个自托管的企业微信智能机器人，把 **Codex、飞书多维表格和腾讯文档** 串成一条本地自动化链路：

```text
群里 @机器人 发工单
        ↓
企业微信长连接
        ↓
本地 Codex 识别和校验工单
        ↓
机器人控制的 Edge 填写并提交飞书
        ↓
用户发送 /done <短号>
        ↓
更新腾讯文档周报/交接班草稿
```

不需要公网 IP、内网穿透或飞书 API 权限。机器人在本机运行，使用已登录的 Codex CLI、企业微信智能机器人和独立 Edge 配置。

> 本项目不是企业微信、飞书、腾讯或 OpenAI 的官方项目。

## 功能

- 企业微信群里 @机器人执行任务
- 每个群聊/单聊独立记忆 Codex thread
- 每 15-25 秒推送任务进度
- 接收工单图片或文字，使用 Codex 解析字段
- 校验事务单号和机房单号格式
- 按当天白班 `WD`、夜班 `WN` 自动生成飞书任务列表号
- 使用本地浏览器自动填写、核对并提交飞书记录
- 首次配置自动发现飞书字段和“全部任务列表”视图
- 建单失败按浏览器、字段、任务号、核对、提交分阶段诊断
- 本地短号取任务列表号后三位，例如 `WN20261026006 -> 6`
- 飞书提交后发送 `/done <短号>` 更新腾讯文档草稿
- 重复命令、重复飞书记录和旧日期短号都有防重逻辑

## 需要准备

使用者只需准备以下外部信息：

1. Node.js 22+
2. 已安装并登录的 Codex CLI
3. 企业微信智能机器人的 `BotID` 和长连接 `Secret`
4. 飞书多维表格记录页 URL 和任务地点选项
5. 腾讯文档访问 Token，以及排班/周报/交接班/草稿文件 ID（只使用腾讯文档功能时需要）

Token、Secret、Cookie 和真实业务数据都不进入 Git。

## 快速开始

### 1. 克隆

```powershell
git clone https://github.com/Mark-Tee/codex-wecom-feishu-bot.git
cd codex-wecom-feishu-bot
```

### 2. 运行配置向导

```powershell
.\setup.cmd
```

向导会创建以下文件，并自动打开机器人专用 Edge：

```text
config.json
worker/config.json
worker/duty-config.json
```

这三个文件已被 `.gitignore` 忽略。

如果 Feishu 要求登录，请在两分钟内完成。向导会打开一个空白“添加记录”表单，
自动发现字段 ID 和任务列表视图 ID，然后关闭调试连接，不会提交测试记录。

### 3. 检查配置

```powershell
.\doctor.cmd
```

所有 `[fail]` 项必须处理。`[warn]` 项按实际部署情况处理。

### 4. 启动

前台启动，方便查看日志：

```powershell
.\start.cmd
```

后台常驻：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
```

看到 `authenticated as <BotID>` 表示企业微信长连接成功。

### 5. 配对用户

首次启动会在本机生成 `pairing-code.txt`。在企业微信里发送：

```text
/pair 123456
```

配对后，其他未授权用户不能执行本机 Codex。

## 使用

群里发送工单图片：

```text
@机器人
```

或发送带工单字段的文字：

```text
@机器人 工单：事务单号 SJSW20261026000144，机房单号 JF20261026000072，地点 A1-304，预计进入时间 2026-10-26 19:00，故障处理
```

机器人会回复飞书任务号、本地短号和下一步命令。

飞书确认提交后发送：

```text
/done 6
```

`6` 来自飞书任务号 `WN20261026006` 的后三位。

## 命令

| 命令 | 说明 |
|---|---|
| `/help` | 显示完整指令 |
| `/pair <码>` | 配对当前企业微信用户 |
| `/invite` | 生成新的本地配对码 |
| `/new` | 清空当前会话 Codex 上下文 |
| `/status` | 查看连接、队列、进程和待办 |
| `/stop` | 停止当前任务并清空队列 |
| `/pending` | 查看未完成工单短号 |
| `/fill <短号>` | 重新执行飞书填写 |
| `/cancel <短号>` | 取消尚未完成的本地工单 |
| `/done <短号>` | 更新腾讯文档草稿 |

## 飞书填写安全规则

- 只填写机器人本次创建的记录。
- 检测到任意已有记录卡时拒绝复用，必须先关闭。
- 填写前再次读取当天最新任务号，避免多人并发冲突。
- 提交前逐字段核对地点、单号、工作内容、时间、指派人员和陪同人。
- 任一关键字段不一致时停止提交。
- 不读取或保存飞书 Cookie。
- 自动提交必须同时显式开启 `feishuBrowser.enabled` 和 `feishuBrowser.autoSubmit`。
- 失败截图只写入本机忽略目录 `data/feishu-browser-diagnostics`，不会进入 Git。

## 真实表 E2E

先只生成目标表指纹，不创建记录：

```powershell
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10
```

确认目标是专用测试表后，再显式执行 10 次：

```powershell
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10 `
  --execute --confirm-table=<上一步的 targetFingerprint> `
  --record ./data/records/feishu-e2e.json
```

报告包含成功率、P50、P95、最大耗时和失败阶段。默认验收门槛为成功率不低于
90%，P95 不超过 60 秒。脚本不会自动删除测试记录。

执行时必须指定 `--record`。每次开始和结束都会保存进度；报告已存在时拒绝覆盖。
中断后用原参数加 `--resume`，只执行尚未开始的轮次。若中断发生在建单过程中，
报告会保留 `inFlight` 和测试单号，拒绝自动重试，需先核对测试表中的实际结果。
进程被强制终止时可能留下同名 `.lock` 文件，确认旧进程已退出后再清理，禁止并发执行同一报告。
不要为绕过未知结果而直接删除报告或盲目重跑。

```powershell
node worker/src/scripts/benchmark-feishu-e2e.mjs --help
# 目标、次数和验收门槛必须与原批次相同
node worker/src/scripts/benchmark-feishu-e2e.mjs --config worker/config.e2e.json --runs=10 `
  --execute --confirm-table=<原计划指纹> --record ./data/records/feishu-e2e.json --resume
```


维护人员也可以一次性将验收摘要私发给指定企业微信用户。单聊使用用户 ID，
消息文件不得包含凭证或真实业务数据：

```powershell
node scripts/send-wecom-private.cjs --config config.json `
  --user <企业微信用户ID> --message-file <本地消息文件>
```

## 腾讯文档

腾讯文档 Token 使用当前 Windows 用户环境变量 `TENCENT_DOCS_TOKEN`，也可在支持的环境中使用同名环境变量。

在 `worker/duty-config.json` 中填写：

- `sources.online.schedule.file_url` / `file_id`
- `sources.online.weekly.file_url` / `file_id`
- `sources.online.handover.file_url` / `file_id`
- `draft.online_file_url` / `online_file_id`

写入前会自动在 `data/cache/idc-draft-backups` 创建本地备份，并复核写入后的格式。

## 配置结构

```text
config.json                 企业微信桥接和非敏感运行配置
worker/config.json          工单解析、飞书字段、浏览器与人员配置
worker/duty-config.json     腾讯文档表格结构、列名和安全规则
```

示例文件：

```text
config.example.json
worker/config.example.json
worker/duty-config.example.json
```

## 可选：OCR

OCR 不是必需项。没有本地 OCR 时，Codex 仍可直接读取图片。需要更快识别时，可安装 RapidOCR，并在 `worker/config.json` 中设置：

```json
{
  "ocr": {
    "enabled": true,
    "executable": "data/tools/ocr/RapidOCR-json/RapidOCR-json.exe"
  }
}
```

OCR 文字只作为辅助，不替代原始工单图片。

## 安全

- 不要提交 `config.json`、`worker/config.json`、`worker/duty-config.json`、`.env`、`state.json`、日志或浏览器配置。
- 只给可信用户配对。
- 使用独立 Edge 配置，不指向日常浏览器资料目录。
- 定期轮换企业微信 Secret，必要时撤销腾讯文档 Token。
- 公开问题中不要包含真实业务表、人员、工单或聊天记录。

详见 [SECURITY.md](SECURITY.md)。

## 开发与测试

```powershell
npm run check
npm test
npm run scan:secrets
```

测试覆盖工单解析、单号校验、WD/WN 任务号、短号迁移、飞书字段、腾讯文档合并和安全校验。
`bridge.cjs` 的长连接、用量统计、回答缓存和帮助路由已拆到 `lib/`；
旧飞书 Open API 隔离在 `worker/src/legacy/`，核心建单链路不依赖它。

## 已知限制

- 当前部署目标为 Windows，依赖 Edge 和 PowerShell。
- 企业微信每个机器人同时只能有一个长连接。
- 同一时间串行处理任务，后续任务会排队。
- 浏览器自动化依赖飞书网页结构；飞书更新页面后可能需要调整字段适配。
- 电脑关机、休眠或进程退出后，机器人无法响应。

## 许可证

MIT，详见 [LICENSE](LICENSE)。

## 项目续接

[项目交接与验证状态](docs/PROJECT_STATUS.md)：关键规则、已知限制与后续验证。

## 动力值班：只建飞书单

在 worker 配置中启用 `duty.powerDuty.enabled: true`。在线排班的月表需包含
`日期`、`动力白班值班人员`、`动力夜班值班人员`。当前使用人必须与排班姓名精确匹配。
按**收到工单时间**的北京时间班次判断：08:30–17:30白班，17:30–次日08:30夜班，凌晨使用前一天排班。
匹配后只提取飞书工单字段，不读取或生成周报、交接班；指派人员和陪同人必须留空，
会清除新建表单中的默认人员并在提交前核验。若飞书要求人员必填则停止并反馈，不擅自填入姓名。

示例：当天动力值班人员直接发工单；未提交的任务用 `/fill 12` 重试；已提交即完成，无需 `/done`。
`/done 12` 对动力任务不会写入腾讯草稿。普通值班流程保持原有规则。

桥接进程每天08:20读取在线排班，失败5分钟后重试；停机时无法刷新，恢复运行后补查。
每次工单处理前仍读取最新排班，不使用旧缓存作出决定；调班后无需手动更新本地名单。
排班读取失败、缺列、缺日期、重复日期或当班人员为空时明确停止，请核对在线表。
不会修改在线排班表。开启或关闭该配置后重启桥接以加载定时刷新。

## 部门与跨站点岗位

在业务配置 `worker/duty-config.json` 中启用 `site_rules`，按 `worker/duty-config.example.json`
填写两部门成员、辅值列、主站点别名和异地岗位列。不要把真实员工名单提交到仓库。
黄色白班用于主值判断，辅值使用所属部门的辅值列；若同日有异地岗位安排，优先按异地处理，
不把该人员选为本地主值接班人。系统的异地岗位可配置为测试值班，网络可配置为告警值班。

打卡地点不是实际工作地点证据。某些岗位可能先在本地打卡再到异地工作，这只是一种可能性，
不得自动认定某人发生了该行为。异地安排当天不补本地默认巡检、通报、值班标记或交接班。
只有工单自身明确地点为本地站点、含有效工单标识时，才单独保留这一条实际工作周报；
不能从周报默认地点反推工单地点。多条混合草稿或岗位冲突时停止核对，不猜测。
没有本地实际工作记录的异地任务仅保留飞书建单，误发 `/done` 不写入本地草稿。

本功能不替换当前配置的业务条线规则；部门名册用于归属和岗位判断，不把网络周报模板套用到其他部门。

### 本站待命

启用site_rules后，明确在岗的普通白底白班，且没有主值、辅值、动力或异地岗位安排时，
归为本站待命（home_standby）。有实际机房陪同等要求时只登记对应工单；待命本身不生成记录，
不补默认巡检、通报或交接班。明确调休、休假、休息、年假、事假、病假人员不判待命；
白色空白的夜班延续或未排班休息逻辑保持不变，不从没有岗位推定为在岗。
休假与岗位冲突、动力列缺失时要求核对。普通值班、动力值班与异地规则保持各自边界。
