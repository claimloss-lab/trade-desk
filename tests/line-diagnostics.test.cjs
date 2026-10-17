const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const api=fs.readFileSync(path.join(__dirname,'../functions/api/line-message.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const onRequestFactory=new Function('fetch',api.replace(/^export\s+async\s+function\s+onRequest/m,'async function onRequest')+'\nreturn onRequest;');
const userId='U'+'a'.repeat(32);
function req(token='fixture-token',to=userId){
  return new Request('https://trade-desk.pages.dev/api/line-message',{
    method:'POST',headers:{'Content-Type':'application/json','X-Line-Token':token,'X-Line-Userid':to},
    body:JSON.stringify({message:'test only'})
  });
}
test('LINE API rejects expired channel tokens with safe diagnostic code, no raw upstream leaks',async()=>{
 const onRequest=onRequestFactory(async()=>new Response(JSON.stringify({message:'Invalid token: secret ABC',details:[{property:'to',message:'recipient'}]}),{status:401}));
 const response=await onRequest({request:req(),env:{}});
 assert.equal(response.status,502);
 const data=await response.json();
 assert.deepEqual(data,{error:'LINE push request failed',code:'INVALID_CHANNEL_TOKEN',lineStatus:401});
 assert.equal(JSON.stringify(data).includes('secret'),false);
 assert.equal(JSON.stringify(data).includes(userId),false);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('LINE returns actionable status for malformed request and quota problems',async()=>{
 for(const [status,code] of [[400,'INVALID_REQUEST'],[403,'PERMISSION_DENIED'],[404,'RECIPIENT_NOT_FOUND'],[429,'RATE_LIMITED'],[503,'LINE_SERVICE_UNAVAILABLE']]){
  const onRequest=onRequestFactory(async()=>new Response('error',{status}));
  const data=await(await onRequest({request:req(),env:{}})).json();
  assert.equal(data.code,code);
  assert.equal(data.lineStatus,status);
 }
});
test('LINE success means accepted, not guaranteed delivery',async()=>{
 const onRequest=onRequestFactory(async()=>new Response('{}',{status:200}));
 const response=await onRequest({request:req(),env:{}});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,status:'accepted'});
});
function browserHarness(to,response){
 const element={value:'',textContent:'',style:{}};
 const nodes={
   'line-token':{value:'fixture-only-token'},
   'line-userid':{value:to},
   'line-test-result':element,
 };
 const calls=[];
 const code=html.slice(html.indexOf('async function testLineConnection(){'),html.indexOf('// Core LINE send function'));
 assert.match(code,/testLineConnection/);
 const context={
  document:{getElementById:id=>nodes[id]},
  AbortSignal,
  fetch:async(url,options)=>{calls.push({url,options});return response;},
 };
 vm.runInNewContext(code,context);
 return {run:()=>context.testLineConnection(),element,calls};
}
test('browser diagnostic shows correct error and does not expose token or full recipient id',async()=>{
 const fixture=browserHarness(userId,new Response(JSON.stringify({error:'LINE push request failed',code:'INVALID_CHANNEL_TOKEN',lineStatus:401}),{status:502}));
 await fixture.run();
 assert.equal(fixture.calls.length,1);
 assert.match(fixture.element.textContent,/Token.*หมดอายุ.*401/);
 assert.doesNotMatch(fixture.element.textContent,/fixture-only-token/);
 assert.doesNotMatch(fixture.element.textContent,new RegExp(userId));
});
test('browser rejects OA Basic ID without calling send API',async()=>{
 const fixture=browserHarness('@my-line-oa',new Response('{}',{status:200}));
 await fixture.run();
 assert.equal(fixture.calls.length,0);
 assert.match(fixture.element.textContent,/Webhook/);
});
test('browser makes clear accepted request is not proof of actual delivery',async()=>{
 const fixture=browserHarness(userId,new Response(JSON.stringify({ok:true,status:'accepted'}),{status:200}));
 await fixture.run();
 assert.match(fixture.element.textContent,/รับคำขอ/);
 assert.match(fixture.element.textContent,/เช็กใน LINE/);
});
