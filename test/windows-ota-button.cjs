
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {setTimeout: delay} = require('node:timers/promises');
(async()=>{
  for(let i=0;i<80;i++){
    let page;
    try {
      const [port] = fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/);
      const tabs = await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)})).json();
      page=tabs.find(p=>p.type==='page'&&p.url.startsWith('file:'));
    }catch{}
    if(!page){await delay(75);continue}
    const ws=new WebSocket(page.webSocketDebuggerUrl);
    try {
      await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
      const answer=new Promise((res,rej)=>{
        const timeout=setTimeout(()=>rej(Error('업데이트 확인 버튼 응답 시간 초과')),12000);
        ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id!==1)return;clearTimeout(timeout);if(m.error||m.result.exceptionDetails)rej(Error(JSON.stringify(m.error??m.result.exceptionDetails)));else res(m.result.result.value);});
      });
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,awaitPromise:true,expression:"(async()=>{for(let i=0;i<80;i++){const b=document.querySelector('.update-check');if(b){const v=document.getElementById('version').textContent;b.click();return v}await new Promise(r=>setTimeout(r,25));}throw Error('버튼을 찾을 수 없습니다');})()"}}));
      assert.equal(await answer,'3.11.2');
      console.log('3.11.2 실제 화면에서 업데이트 확인 누름');
      return;
    } finally {ws.close()}
  }
  throw Error('윈도우 앱 화면을 찾을 수 없습니다.');
})().catch(e=>{console.error(e);process.exitCode=1});
