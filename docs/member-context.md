# 每人独立会话

按机器人、群、账号隔离身份、模型会话、待确认信息及工单待办；跨群不继承。业务授权仍由本机白名单控制，绑定姓名不会授予权限。

排班首次发送 `我是测试甲` 或 `排班身份 测试甲`（换为本人准确姓名）；`我的排班身份` 查看，`我的排班`、`我今天什么班`、`我明天什么班` 查询。即时查询本人优先，定时仍为全员视角。群昵称在现有协议中无可靠字段，暂不自动识别。

工单首次发送 `/as 测试甲`。`继续` 查看本人待确认问题或待办；`补充 进入时间为09:00` 接着回答问题；多张已识别工单按 `/pending` 中的短号操作。继续不会自动重提。待确认信息沿用15分钟有效期，过期需重新发工单；身份、线程及已保存待办持续保存。排队中的执行进程若被终止，不保证自动重放。

旧群级模型历史不自动归属，保留原文件；旧待办只有明确账号匹配时才可续办。不会依据同名或昵称转移工单。共享表写入继续受查重、单实例和本机许可控制。

离线验证：公开整合版198项、私有工单149项通过，覆盖成员交替、跨群、服务重建、旧任务归属、越权短号。未做多人群实测或共享表新写入。未新增依赖、模型识别昵称、云资源或轮询；身份和续办提示不调用模型，实际工单继续使用原模型额度，实际月度费用和代理流量未量测。

## 私聊体验
排班私聊支持姓名绑定和本人实时查询，/help显示排班及菜单；工单私聊首页、我的工单、还有哪些没处理显示本人身份和待办，/help进入首页。唯一的同账号已有姓名须确认后沿用；多个姓名不自动选择。群聊任务不带入私聊；两个机器人不共享身份文件，分别确认。个人定时提醒关闭，定时群推送不变。身份不会授予权限。新增提示和首页不调用模型，不新增固定费用；实际工单仍使用已有模型、网络和本机资源，实际月度消耗未量测。200项离线回归通过，尚待真实私聊收发验收；测试未写共享表。

## 识别与写入阶段
识别完成且在浏览器打开前被单次许可拦截时，独立标记 awaitingWriteApproval，回复“识别已完成·等待写入许可”；待办显示待本机核准，禁止引导/done。已打开页面或结果不明时仍走原核验提示，不声称零写入。新增消息本地生成，无新增模型调用或在线资源费用。

## Worker deployment acceptance
A source test pass does not verify the deployed worker directory. After deploying worker files, run the actual configured worker entry with a synthetic `/help` message from an isolated temporary working directory. Verify the returned JSON contains help text, not merely exit code zero. This exercises static imports without model calls, browser actions, or online table writes; keep its state outside the production working directory. Include the field-discovery module and its dependencies when deploying the browser filler. Remote failures return a concise cause and reference; detailed diagnostics remain in local logs.

## Date input compatibility
The calendar/time input CSS build hash changed in the hosted UI. Match the stable `__calendar-picker-input` and `__time-picker-input` class fragments inside the already-scoped field rather than a full generated class. Regression covers old and current hashes. The controlled end-to-end exercise required manual date selection and readback; it is not unattended automatic acceptance. Tencent writes in that exercise used an isolated append-only harness with full-row blank checks, before/after cell and style verification. The default draft replacement route was subsequently converted to the guarded append path described below.

### Draft append and saved-date verification

Draft updates append after the last occupied row across all columns, including zero, false and formula cells. Existing rows and styles are not rewritten. Exact incoming business content is skipped on retry. Handover rows are grouped by date, line, shift and outgoing person before writing; an existing shift row requires a locally reviewed merge proposal instead of another appended row. A pending write audit blocks uncertain retries until reviewed locally. Local locking does not provide an atomic reservation against other online editors.

Record submissions now read back the business identifiers, task number and saved entry timestamp. A missing or different timestamp stops the workflow and requires local review; it never recreates or edits the submitted record automatically. Menus retain the real-write acceptance caveat. Offline regression passed; a new unattended online acceptance run is still required.

Saved-date readback retries changed pagination totals at most three times, with a 500 ms wait between reads. It never retries submission, and missing/wrong saved dates still require local review. A controlled shared-table test confirmed one correctly dated Feishu record and one appended row per fixed draft, with prior content/styles unchanged. Initial readback stopped on changed pagination totals and the run was resumed after read-only verification; a fresh uninterrupted run remains untested. Test business records and evidence stay local and private.

### Historical report format

Future weekly and handover drafts follow the existing monthly templates. Estimated duration uses decimal hours such as `0.5h` without upward rounding; actual duration stays based on real start/end times. Weekly descriptions preserve necessary room locations and use concise action/vendor wording. The outgoing person already has a dedicated handover column, so self-action entries do not repeat that name. External actors' names remain when supplied by the source. Operator actions use the frontline requester/publisher; outside-vendor accompaniment uses the duty requester/publisher, and special sources require clarification.

New handover work is grouped and numbered within completed/unfinished cells. Existing-shift changes produce a local JSON review containing the target, original and proposed row, then stop before either draft is written. Local maintenance must obtain explicit confirmation and re-read the target before applying any existing-row update; there is no group command to grant that approval. Formal source sheets are never the destination of this draft repository. Templates with missing/conflicting identity or successor/state data require clarification. Only new draft cells receive template formatting: handover body uses Songti 11 and wrapped left-aligned work columns, while weekly time and duration formats match the monthly template. No historical cells are reformatted.

Costs: no new paid infrastructure or recurring historical-sheet polling. Normal draft writes add style calls for the new row (four per weekly row and three per handover row), using the existing service account/network. Local grouping/review does not call a model. Actual traffic, API pricing and monthly usage have not been measured; existing model recognition and Codex debugging still use their current allocation. The new format has offline coverage; no new real records were created for this change.
### Rack installation/removal orders

Rack orders use the existing business-number field (`transactionNo`, labelled transaction number in the target form) for the original rack application number, with source set to rack installation/removal and the corresponding work-content option. They do not require a fabricated ordinary transaction number. The recognised rack application prefix is `SXJXQ`, followed by an actual calendar date and the original numeric suffix; do not pad a suffix to the ordinary transaction-number length. Other prefixes or illegible values require clarification, even when a historical row contains them. Explicitly absent rack numbers are blank, with the room ticket still required and used for deduplication. The historical literal `无` is treated as absence for matching, rather than as a shared business identifier. Ordinary transaction validation remains unchanged. Multiple numbers in one field are not automatically supported. Existing shared records are neither corrected nor recreated by this change. Private evidence and raw source examples remain local.

### Wiring orders

Wiring source is `布线理线`, with the verified work-content label `布线、理线相关事项`. Both normal and controlled extraction prompts use this mapping. Wiring work without a supplied transaction number uses the valid room ticket alone, while a supplied ordinary transaction number remains strictly validated. Missing optional business numbers are displayed as not supplied, not as a recognition failure. Wiring words in explicit work content take precedence over generic accompaniment keywords. The example config includes the previously omitted option. Unreadable specific-work text still requires clarification; historical descriptions are examples, not substitute facts. No historical shared records are edited by this repair.
