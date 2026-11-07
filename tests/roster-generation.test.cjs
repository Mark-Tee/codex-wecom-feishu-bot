const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calendar,validate,createRosterGeneration}=require('../lib/roster-generation.cjs');
const {assertOnlineMonthAbsent,createOnlineMonth}=require('../lib/roster-generation.cjs');
test('an existing online month can never be replaced by the publication entry',async()=>{
  assert.throws(()=>assertOnlineMonthAbsent({sheets:[{sheet_name:'202612'}]},'2026-12'),/只允许生成本地/);
  let writes=0;
  const client={getSheetInfo:async()=>({sheets:[{sheet_name:'202612'}]}),callTool:async()=>{writes++;}};
  await assert.rejects(createOnlineMonth(client,{fileUrl:'test'},'2026-12'),/不替换/);assert.equal(writes,0);
  assert.throws(()=>assertOnlineMonthAbsent({},'2026-12'),/禁止发布/);
  client.getSheetInfo=async()=>({sheets:[]});await createOnlineMonth(client,{fileUrl:'test'},'2026-12');assert.equal(writes,1);
});
const {createInteractionCards}=require('../lib/interaction-cards.cjs');
const {createRosterService,ROSTER_HELP}=require('../lib/roster-service.cjs');
test('official calendar separates makeup work from auxiliary duty',()=>{
  assert.equal(calendar('2026-12').filter(d=>d.workday).length,23);
  const makeup=calendar('2026-10').find(d=>d.date==='2026-10-10');assert.equal(makeup.workday,true);assert.equal(makeup.aux,false);
  assert.throws(()=>calendar('2027-01'),/日历/);
});
const fixture=()=>({days:[{date:'2026-12-01',workday:true,aux:true},{date:'2026-12-02',workday:true,aux:true}],groups:[{members:['a','b','c','d']}],previousNight:[],previousMain:[],maxExcess:1});
const result=()=>({days:[{date:'2026-12-01',roles:{a:'main',b:'aux',c:'night',d:'off1'},powerWhite:'a',powerNight:'c'},{date:'2026-12-02',roles:{a:'aux',b:'main',c:'rest',d:'night'},powerWhite:'b',powerNight:'d'}]});
test('independent check verifies work units and rejects night rest or power conflicts',()=>{
  assert.deepEqual(validate(fixture(),result()).totals,{a:2,b:2,c:2,d:3});
  const bad=result();bad.days[1].roles.c='off1';assert.throws(()=>validate(fixture(),bad),/休息/);
  const power=result();power.days[0].powerWhite='d';assert.throws(()=>validate(fixture(),power),/动力/);
  const previous=fixture();previous.previousNight=['a'];assert.throws(()=>validate(previous,result()),/休息/);
});
test('working-day idle rest is rejected and excess units are allowed',()=>{
  const input=fixture();input.maxExcess=0;
  assert.equal(validate(input,result()).totals.d,3);
  const bad=result();input.groups[0].members.push('e');bad.days[0].roles.e='rest';bad.days[1].roles.e='off1';
  assert.throws(()=>validate(input,bad),/不得自动安排额外休息/);
});
test('main duty cannot repeat on adjacent dates or across month boundary',()=>{
  const consecutive=result();consecutive.days[1].roles.a='main';consecutive.days[1].roles.b='aux';consecutive.days[1].powerWhite='a';
  assert.throws(()=>validate(fixture(),consecutive),/白班主值不得连续/);
  const boundary=fixture();boundary.previousMain=['a'];assert.throws(()=>validate(boundary,result()),/白班主值不得连续/);
  const missing=fixture();delete missing.previousMain;assert.throws(()=>validate(missing,result()),/缺少上月末/);
});
test('generation stays restricted to fixed owner and serializes work',async()=>{
  let calls=0,release;const replies=[];
  const service=createRosterGeneration({settings:{enabled:true,ownerUserId:'owner'},business:()=>({}),generateDraft:async()=>{calls++;await new Promise(r=>release=r);return {output:'draft.xlsx',check:{target:23,totals:{a:23}},result:{optimal:false}};}});
  const frame=user=>({body:{from:{userid:user}}}),reply=async(_,text)=>replies.push(text);
  await service.command(frame('other'),'生成排班稿',reply);assert.equal(calls,0);
  const pending=service.command(frame('owner'),'生成排班稿 2026-12',reply);
  assert.equal(service.busy,true);
  await service.command(frame('owner'),'生成排班稿 2026-12',reply);assert.equal(calls,1);release();await pending;
  assert.equal(service.busy,false);
  assert.ok(replies.some(t=>t.includes('尚未证明最优')));assert.ok(replies.some(t=>t.includes('等待')));
});
test('generation card rejects another account, another chat and duplicate events',async()=>{
  const state={},dispatched=[];
  const cards=createInteractionCards({role:'roster',state,save:()=>{},authorized:()=>true,canGenerate:user=>user==='owner',send:async()=>{},reply:async()=>{},dispatch:async frame=>dispatched.push(frame),help:ROSTER_HELP});
  await cards.menu({body:{chattype:'single',from:{userid:'owner'}},headers:{req_id:'menu'}});
  const id=Object.keys(state.__interactionCards)[0],action=state.__interactionCards[id].actions.find(a=>a.command==='生成排班稿');
  const event=(userid,chattype='single',chatid)=>({cmd:'aibot_event_callback',headers:{req_id:'event'},body:{msgid:'click',from:{userid},chattype,chatid,event:{eventtype:'template_card_event',task_id:id,event_key:action.key}}});
  await cards.handle(event('other'));await cards.handle(event('owner','group','other-chat'));assert.equal(dispatched.length,0);
  await cards.handle(event('owner'));assert.equal(dispatched.length,1);assert.equal(dispatched[0].body.text.content,'生成排班稿');
  await cards.handle(event('owner'));assert.equal(dispatched.length,1);
});
test('owner sees generation button and others keep existing menu',async()=>{
  for(const user of ['owner','other']){
    const sent=[];const cards=createInteractionCards({role:'roster',state:{},save:()=>{},authorized:()=>true,canGenerate:id=>id==='owner',send:async(...v)=>sent.push(v),reply:async()=>{},dispatch:async()=>{},help:ROSTER_HELP});
    await cards.menu({body:{chattype:'single',from:{userid:user}},headers:{req_id:'req'}});
    const buttons=sent[0][1].template_card.button_list;assert.equal(buttons.length,6);assert.equal(buttons.some(b=>b.text==='生成排班稿'),user==='owner');
  }
});
test('generation is reachable through roster service with updated help',async()=>{
  let called=false;const service=createRosterService({state:{},save:()=>{},allowUsers:['owner'],controller:{command:async()=>{throw Error('wrong handler');}},generation:{command:async(_,text)=>{called=text==='生成排班稿 2026-12';return true;}},reply:async()=>{}});
  await service({cmd:'aibot_msg_callback',body:{msgid:'1',from:{userid:'owner'},msgtype:'text',chattype:'single',text:{content:'生成排班稿 2026-12'}}});
  assert.equal(called,true);assert.match(ROSTER_HELP,/生成排班稿.*YYYY-MM/);
});
test('interrupted generation resumes only the saved owner request',async()=>{
  const state={__rosterGeneration:{status:'running',month:'2026-12',frame:{body:{from:{userid:'owner'},chattype:'single'}}}};
  let received;
  const service=createRosterGeneration({state,settings:{enabled:true,ownerUserId:'owner'},business:()=>({}),generateDraft:async args=>{received=args.month;return {output:'local.xlsx',check:{target:23,totals:{a:23}},result:{optimal:false}};}});
  await service.resume(async()=>{});assert.equal(received,'2026-12');assert.equal(state.__rosterGeneration.status,'completed');
  received=null;await service.resume(async()=>{});assert.equal(received,null);
});
