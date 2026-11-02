// Remote messages may query and use fixed business workflows, never maintain sources.
function remoteDenial(value) {
  const text=String(value||"").trim().replace(/^BOT\s+/iu,"");
  if (/\/(?:pair|invite|paircode|operators|revoke|stop|cancel|new|delete|remove|exec|run|restart|shutdown|config|shell)(?:\s|$)/iu.test(text)
    || /(?:绑定排班群|解绑排班群|停止|停机|重启|新会话|清空队列|取消任务|停止任务|授权|撤销授权|生成邀请码|配对|操作者|撤销操作者|运行脚本|执行命令)/u.test(text))
    return "无权限：群聊和私聊均不支持管理操作，请联系维护者在本机处理。";
  const mutation=/(?:修改|改成|改为|改一下|更改|变更|调整|调换|调班|换班|替班|删除|删掉|清空|覆盖|写入|编辑|更新|新增|添加|移除|替换|保存|重写|执行|运行|上传|同步|改动|改掉|排到|调到|换成|设为|设置|补上|补充|modify|delete|overwrite|edit|rewrite)/iu;
  const source=/(?:排班|班次|值班名单|源文件|原文件|原始|源数据|正式表|主表|配置|源码|脚本|权限|密钥|凭证|系统提示|本地文件|文件|[.](?:json|ya?ml|toml|ps1|py|js|ts|csv|xlsx?|md)\b)/iu;
  if ((mutation.test(text)&&source.test(text)) || /(?:调班|换班|替班)/u.test(text))
    return "无权限：不能通过机器人修改排班表、源文件或配置。请联系维护者在本机处理。";
  return "";
}
function remoteUserAuthorized(userId, allowUsers = [], operators = []) {
  return Boolean(userId) && (allowUsers.length ? allowUsers.includes(userId) : operators.includes(userId));
}
module.exports={remoteDenial,remoteUserAuthorized};
