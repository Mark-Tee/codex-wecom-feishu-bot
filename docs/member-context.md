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
The calendar/time input CSS build hash changed in the hosted UI. Match the stable `__calendar-picker-input` and `__time-picker-input` class fragments inside the already-scoped field rather than a full generated class. Regression covers old and current hashes. The controlled end-to-end exercise required manual date selection and readback; it is not unattended automatic acceptance. Tencent writes in that exercise used an isolated append-only harness with full-row blank checks, before/after cell and style verification. The legacy default draft replacement route has not been converted to append-only and must not be used against shared sheets.

### Draft append and saved-date verification

Draft updates append after the last occupied row across all columns, including zero, false and formula cells. Existing rows and styles are not rewritten. Exact incoming business content is skipped on retry; handover work is appended as a separate row rather than merged into an existing shift row. A pending write audit blocks uncertain retries until reviewed locally. Local locking does not provide an atomic reservation against other online editors.

Record submissions now read back the business identifiers, task number and saved entry timestamp. A missing or different timestamp stops the workflow and requires local review; it never recreates or edits the submitted record automatically. Menus retain the real-write acceptance caveat. Offline regression passed; a new unattended online acceptance run is still required.

Saved-date readback retries changed pagination totals at most three times, with a 500 ms wait between reads. It never retries submission, and missing/wrong saved dates still require local review. A controlled shared-table test confirmed one correctly dated Feishu record and one appended row per fixed draft, with prior content/styles unchanged. Initial readback stopped on changed pagination totals and the run was resumed after read-only verification; a fresh uninterrupted run remains untested. Test business records and evidence stay local and private.
