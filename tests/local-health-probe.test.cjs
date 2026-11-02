const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{EventEmitter}=require('node:events');
const {probeLocalHealth}=require('../lib/local-health-probe.cjs');
const {createSupervisor}=require('../lib/bot-supervisor.cjs');
const valid={service:'codex-wecom-bridge',pid:42,authenticated:false,connectionStale:false};
test('probe preserves health contract and only requests loopback',async()=>{
 let time=1000;const result=await probeLocalHealth({port:8799,now:()=>{const current=time;time+=123;return current;},fetchImpl:async(url,options)=>{assert.equal(url,'http://127.0.0.1:8799/health');assert.ok(options.signal instanceof AbortSignal);return {ok:true,json:async()=>valid};}});
 assert.equal(result.pid,42);assert.equal(result.authenticated,false);assert.equal(result.probeElapsedMs,123);
});
test('probe classifies timeout, network, HTTP, JSON and identity errors without raw payload',async()=>{
 const timeout=Object.assign(Error('ExamplePrivateRuntimeMessage'),{name:'TimeoutError'});
 const network=Object.assign(Error('ExamplePrivateRuntimeMessage'),{cause:{code:'ECONNREFUSED'}});
 const cases=[
  [async()=>{throw timeout},'HEALTH_TIMEOUT','request'],
  [async()=>{throw network},'HEALTH_ECONNREFUSED','request'],
  [async()=>({ok:false,status:503}),'HEALTH_HTTP_503','request'],
  [async()=>({ok:true,json:async()=>{throw SyntaxError('ExamplePrivateRuntimeMessage')}}),'HEALTH_BAD_JSON','json'],
  [async()=>({ok:true,json:async()=>({service:'another',pid:42})}),'HEALTH_BAD_RESPONSE','identity'],
 ];
 for(const [fetchImpl,code,phase] of cases)await assert.rejects(()=>probeLocalHealth({port:8799,fetchImpl}),error=>{assert.equal(error.code,code);assert.equal(error.phase,phase);assert.ok(error.elapsedMs>=0);assert.doesNotMatch(error.message,/ExamplePrivate/);return true;});
});
test('invalid port never sends a request',async()=>{
 let calls=0;for(const port of [0,65536,NaN,'8799'])await assert.rejects(()=>probeLocalHealth({port,fetchImpl:async()=>{calls++;}}),{code:'HEALTH_CONFIG_ERROR'});assert.equal(calls,0);
});
test('real loopback deadline still aborts a delayed local response',async()=>{
 const server=http.createServer((req,res)=>{setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(valid));}},200);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(()=>probeLocalHealth({port:server.address().port,timeoutMs:20}),{code:'HEALTH_TIMEOUT'});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('supervisor logs failure diagnostics and recovery, not the raw error',async()=>{
 let clock=0,attempt=0,kills=0;const log=[],child=new EventEmitter();child.pid=42;child.kill=()=>kills++;
 const supervisor=createSupervisor({now:()=>clock,spawnBridge:()=>child,log:line=>log.push(line),probe:async()=>{attempt++;if(attempt<=2)throw Object.assign(Error('ExamplePrivateRuntimeMessage'),{code:'HEALTH_TIMEOUT',phase:'request',elapsedMs:5123});return {...valid,probeElapsedMs:3};}});
 supervisor.launch();clock=120000;await supervisor.check();clock+=30000;await supervisor.check();clock+=30000;await supervisor.check();
 assert.equal(kills,0);assert.ok(log.some(line=>line.includes('1/3')&&line.includes('HEALTH_TIMEOUT')&&line.includes('5123ms')));assert.ok(log.some(line=>line.includes('已恢复')&&line.includes('2次')));assert.doesNotMatch(log.join('\n'),/ExamplePrivateRuntimeMessage/);supervisor.stop();
});
test('supervisor records delayed check interval without changing its restart threshold',async()=>{
 let clock=0,kills=0;const log=[],child=new EventEmitter();child.pid=42;child.kill=()=>kills++;
 const supervisor=createSupervisor({now:()=>clock,spawnBridge:()=>child,log:line=>log.push(line),probe:async()=>{throw Error('no raw detail');}});
 supervisor.launch();clock=120000;await supervisor.check();clock=300000;await supervisor.check();assert.equal(kills,0);assert.ok(log.some(line=>line.includes('距上次检查=180000ms')));clock+=30000;await supervisor.check();assert.equal(kills,1);supervisor.stop();
});
