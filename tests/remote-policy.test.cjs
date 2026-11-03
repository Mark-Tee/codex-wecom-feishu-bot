const test=require("node:test"),assert=require("node:assert/strict");
const {remoteDenial}=require("../lib/remote-policy.cjs");
const {ROSTER_HELP}=require("../lib/roster-service.cjs");
const {TICKET_HELP,ticketRoute}=require("../lib/ticket-policy.cjs");
test("remote management and source edits are denied before business routing",()=>{
 for(const input of ["/stop","/invite","/pair 123456","/cancel 12","/new","删除文件","帮我绑定排班群","修改排班表","把配置文件更新一下","明天给测试甲换班","BOT /revoke owner"]){assert.match(remoteDenial(input),/无权限/);assert.equal(ticketRoute(input),"denied");}
 for(const input of ["查看排班","排班身份 测试甲","排班推送状态","/status","/help","/as 测试甲","/pending","/fill 12","/done 12","请处理工单"]){assert.equal(remoteDenial(input),"");}
});
test("mobile menus have short lines, no management commands, and honest write status",()=>{
 for(const menu of [ROSTER_HELP,TICKET_HELP]){assert.doesNotMatch(menu,/\/(?:invite|pair|revoke|operators|stop|cancel|new)\b|绑定排班群|解绑排班群|删除 </);assert.ok(menu.split("\n").every(line=>[...line].length<=32));}
 assert.match(TICKET_HELP,/真实写入待实单验收/);
 for(const menu of [ROSTER_HELP,TICKET_HELP]){assert.ok(menu.length<700);assert.ok(menu.split("\n").length<=28);}
 for(const cmd of ["/as 测试甲","/pending","/fill 12","/done 12"])assert.equal(ticketRoute(cmd),"worker");
 for(const cmd of ["/help","/status"])assert.equal(ticketRoute(cmd),"local");
});
