# 踩坑记录

## 853000 invalid bot_id or secret

- 最常见：截图转录错字符（`I/l/1`、`O/0`）。用复制按钮，别手抄。
- 其次：机器人还是"设置接收消息回调地址"模式，或者长连接没保存。
- 再其次：用的是回调模式的 Secret，不是长连接专用 Secret。

## 脚本报"缺少 }"或中文乱码

Windows PowerShell 5.1 默认按 ANSI 读取无 BOM 的 UTF-8 脚本。
解决：脚本保存为 **UTF-8 with BOM**。

## codex exec 跑满 300 秒超时

`spawn` 没关 stdin，Codex 在等输入。
解决：`stdio: ["ignore", "pipe", "pipe"]`。

## 通知里的 Windows 路径显示异常

企业微信 markdown 把 `\` 当转义符。解决：显示时替换成 `/`。

## 重启后 config.toml 的 notify 被改写

新版本 Codex 会把它包成
`codex-computer-use.exe turn-ended --previous-notify "[\"powershell\",...]"`。
这是应用自己的转发链，脚本仍在其中，属于正常现象。

## 模型执行系统查询特别慢

Codex 沙箱与交互桌面不在同一窗口站，`MainWindowHandle` 取不到，
模型会去试 UIAutomation/WPF。
解决：桥接进程定时采集窗口清单写 `system-info.json`，并在
`developer_instructions` 里要求优先读文件。

## Computer Use 截图持续超时

`FrameArrived timed out` / `window capture timed out`，重置会话、换资源管理器验证都一样，
说明当前环境的 Windows.Graphics.Capture 不可用（锁屏、远程桌面、虚拟显示器等）。
这不是应用的问题。

## 主动推送发不出去

`aibot_send_msg` 要求该会话里先和机器人说过话，且只能推给最近一次会话；
`chat_type` 1 是单聊、2 是群聊。

## 长连接频繁断开

同一个机器人只允许一条长连接，新连接会踢掉旧的；
心跳 30 秒一次，断线后按指数退避重连。

## 过一会儿 @ 机器人没反应，进程不见了

用 `Start-Process` 或前台 `start.cmd` 启动的桥接，可能随启动它的终端/任务会话结束被一起清掉。
排查：`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -match bridge`。
解决：用 `install-startup.ps1`，通过 WMI 创建进程并加入登录启动。

守护进程验证方式：手动结束 `bridge.cjs` 的 node 进程，约 5 秒后应出现新的
`bridge.cjs` 进程，日志里会有一次新的 `authenticated as ...`。
