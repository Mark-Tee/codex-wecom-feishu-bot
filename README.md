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
- 本地短号取任务列表号后三位，例如 `WN20261026006 -> 6`
- 飞书提交后发送 `/done <短号>` 更新腾讯文档草稿
- 重复命令、重复飞书记录和旧日期短号都有防重逻辑

## 需要准备

使用者只需准备以下外部信息：

1. Node.js 22+
2. 已安装并登录的 Codex CLI
3. 企业微信智能机器人的 `BotID` 和长连接 `Secret`
4. 飞书多维表格记录页 URL、全部任务视图 ID 和字段 ID
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

向导会创建：

```text
config.json
worker/config.json
worker/duty-config.json
```

这三个文件已被 `.gitignore` 忽略。

### 3. 登录飞书专用 Edge

第一次启用浏览器填写时，机器人会打开独立 Edge 配置。请只在这个配置中登录飞书，不要使用日常浏览器配置。

打开任意一条主任务记录卡后运行：

```powershell
node worker/src/scripts/discover-feishu-fields.mjs --config worker/config.json
```

脚本会输出类似：

```json
{
  "taskList": "fldXXXX",
  "source": "fldXXXX",
  "location": "fldXXXX",
  "transactionNo": "fldXXXX",
  "roomTicketNo": "fldXXXX",
  "workContent": "fldXXXX",
  "specificWork": "fldXXXX",
  "expectedEnterAt": "fldXXXX",
  "assignees": "fldXXXX",
  "companions": "fldXXXX"
}
```

重新运行 `setup.cmd` 并粘贴这段 JSON，或在 `worker/config.json` 中手工填写。

### 4. 检查配置

```powershell
.\doctor.cmd
```

所有 `[fail]` 项必须处理。`[warn]` 项按实际部署情况处理。

### 5. 启动

前台启动，方便查看日志：

```powershell
.\start.cmd
```

后台常驻：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup.ps1
```

看到 `authenticated as <BotID>` 表示企业微信长连接成功。

### 6. 配对用户

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
```

测试覆盖工单解析、单号校验、WD/WN 任务号、短号迁移、飞书字段、腾讯文档合并和安全校验。

## 已知限制

- 当前部署目标为 Windows，依赖 Edge 和 PowerShell。
- 企业微信每个机器人同时只能有一个长连接。
- 同一时间串行处理任务，后续任务会排队。
- 浏览器自动化依赖飞书网页结构；飞书更新页面后可能需要调整字段适配。
- 电脑关机、休眠或进程退出后，机器人无法响应。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
