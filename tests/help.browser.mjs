// 帮助对话框的键位图：功能键齐全且高亮、按真实键盘的相对位置排布、各窗口尺寸下不溢出、四语键帽文字不溢出、悬停 / 聚焦提示。
// 框架同 tests/browser.mjs。设置环境变量 MV_SHOTS=目录 时把各尺寸的截图存到该目录，供人工自查观感。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/help.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-help-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^(?:icons\/)?[\w.-]+$/.test(path))throw Error();
  let data=await readFile(new URL('../'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':mime[path.split('.').pop()],'Cache-Control':'no-cache'});res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
const chrome=spawn(binary,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--window-size=800,900','about:blank'],{stdio:'ignore'});
let ws,id=0,cdp;const pending=new Map(),errors=[];
async function wait(check){let last;for(let i=0;i<150;i++){try{last=await check();if(last)return last;}catch(e){last=e;}await delay(75);}throw Error('Timed out: '+check+'; last: '+last);}
try{
  const port=await wait(async()=>(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  const target=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
  async function attach(page){
    ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
    ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  }
  await attach(target);
  cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await cdp('Runtime.enable');await cdp('Page.enable');
  const shots=process.env.MV_SHOTS;
  const size=async(width,height)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);};
  const load=async lang=>{await js('localStorage.setItem("mv2:lang",'+JSON.stringify(JSON.stringify(lang))+')');await cdp('Page.reload');await wait(()=>js('document.querySelector("#empty")?.hidden===false&&!!document.querySelector("#helpBody .hk-key")'));};
  const open=async()=>{await js('help.open||document.querySelector("#bar [data-act=help]").click()');await wait(()=>js('help.open'));await delay(350);};
  const shoot=async name=>{if(!shots)return;const {data}=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(shots,'help-'+name+'.png'),Buffer.from(data,'base64'));};
  const rect=k=>js('JSON.stringify(document.querySelector('+JSON.stringify('#helpBody [data-key="'+k+'"]')+').getBoundingClientRect())').then(JSON.parse);
  await size(800,900);
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  await load('zh');await open();

  // 实际绑定的主要键都在图示中且高亮、可聚焦、带完整说明；无关的键是暗淡占位（aria-hidden、不进入文本）。
  const bound=['Esc','W','A','S','D','F','C','V','B','T','ShiftLeft','Space','Enter','ShiftRight','[',']','Home','End','PageUp','PageDown','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  for(const k of bound)assert.deepEqual(await js('(()=>{const el=document.querySelector('+JSON.stringify('#helpBody [data-key="'+k+'"]')+');return el&&[el.classList.contains("on"),el.tabIndex,!!el.getAttribute("aria-label"),el.getBoundingClientRect().width>0]})()'),[true,0,true,true],k+' is shown highlighted');
  assert.deepEqual(await js('[...document.querySelectorAll("#helpBody .hk-key.on")].map(e=>e.dataset.key).sort()'),[...bound].sort(),'Only bound keys are highlighted');
  for(const k of ['Q','G','Tab','CapsLock','ControlLeft','Backspace','P'])assert.deepEqual(await js('(()=>{const el=document.querySelector('+JSON.stringify('#helpBody [data-key="'+k+'"]')+');return el&&[el.classList.contains("on"),el.getAttribute("aria-hidden"),el.textContent,el.tabIndex]})()'),[false,'true','',-1],k+' is a placeholder');
  assert.ok(await js('[...document.querySelectorAll("#helpBody [data-key=F],#helpBody [data-key=Enter],#helpBody [data-key=A],#helpBody [data-key=ArrowRight]")].every(e=>e.querySelector(".hk-hold"))'),'Tap / hold keys show both labels');
  assert.ok(await js('["F","Enter","Space"].every(k=>document.querySelector("#helpBody [data-key="+k+"]").classList.contains("shift"))&&document.querySelectorAll("#helpBody .hk-key.mod").length===2'),'Shift combos are marked');
  assert.equal(await js('[...document.querySelectorAll("#helpBody [data-tip]")].filter(e=>e.tabIndex===0).length'),bound.length+3+6,'Every function key and mouse action is focusable');

  // 真实键盘的相对位置：W 在 S 正上方，A S D 同行相邻；方向键呈倒 T；导航键簇两行三列。
  const near=(a,b,msg,tol=1.5)=>assert.ok(Math.abs(a-b)<=tol,msg+': '+a+' vs '+b);
  const [W,A,S,D,F]=await Promise.all(['W','A','S','D','F'].map(rect));
  assert.ok(W.left+W.width/2>S.left&&W.left+W.width/2<S.right&&W.bottom<=S.top&&S.top-W.bottom<8,'W sits right above S');
  for(const [x,y] of [[A,S],[S,D],[D,F]]){near(x.top,y.top,'Same row');assert.ok(y.left>=x.right-.5&&y.left-x.right<6,'Adjacent keys');}
  const [U,Dn,Lt,Rt]=await Promise.all(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].map(rect));
  near(U.left,Dn.left,'↑ is centred over ↓');assert.ok(U.bottom<=Dn.top&&Dn.top-U.bottom<8,'↑ is right above ↓');
  for(const [x,y] of [[Lt,Dn],[Dn,Rt]]){near(x.top,y.top,'← ↓ → share a row');assert.ok(y.left>=x.right-.5&&y.left-x.right<6,'← ↓ → are adjacent');}
  const [Hm,Ed,Pu,Pd,Dl,En,Rs]=await Promise.all(['Home','End','PageUp','PageDown','Delete','Enter','ShiftRight'].map(rect));
  near(Hm.left,Ed.left,'Home over End');near(Pu.left,Pd.left,'PgUp over PgDn');assert.ok(Dl.right<=Ed.left+.5&&Hm.top<Ed.top,'Delete beside End, Home above');
  near(En.right,Rs.right,'Enter and right Shift end at the same column');assert.ok(En.left>Rs.left&&Rt.left>En.right,'Enter left of the arrow cluster');
  const [Esc,Tab,Sp,Ls]=await Promise.all(['Esc','Tab','Space','ShiftLeft'].map(rect));
  near(Esc.left,Tab.left,'Esc is above Tab',2);assert.ok(Ls.width>A.width*2&&Sp.width>A.width*3,'Wide keys keep their widths');

  // 悬停与键盘焦点显示同一条完整说明。
  const tip=()=>js('JSON.stringify({hidden:help.querySelector(".hk-tip").hidden,text:help.querySelector(".hk-tip").textContent,in:(()=>{const t=help.querySelector(".hk-tip").getBoundingClientRect(),d=help.getBoundingClientRect();return t.left>=d.left&&t.right<=d.right&&t.top>=d.top&&t.bottom<=d.bottom})()})').then(JSON.parse);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:W.left+W.width/2,y:W.top+W.height/2});await delay(80);
  let t=await tip();assert.equal(t.hidden,false);assert.equal(t.text,await js('document.querySelector("#helpBody [data-key=W]").getAttribute("aria-label")'));assert.ok(t.in,'Tip stays inside the dialog');
  assert.match(t.text,/W.*向上滚动/);
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});await delay(80);assert.equal((await tip()).hidden,true,'Tip hides when the pointer leaves');
  await js('help.querySelector("[data-close]").focus()');await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await delay(80);
  assert.equal(await js('document.activeElement.dataset.key'),'Esc','Tab moves into the key map');t=await tip();assert.equal(t.hidden,false);assert.match(t.text,/Esc.*收起/);
  const [Rr]=await Promise.all(['ArrowRight'].map(rect));
  await js('document.querySelector("#helpBody [data-key=ArrowRight]").focus()');await delay(50);t=await tip();assert.ok(t.in);assert.match(t.text,/单击：后一屏.*长按：切到下一本/);
  await js('help.close()');await delay(50);assert.equal((await tip()).hidden,true,'Tip hides with the dialog');

  // 各窗口尺寸：对话框在窗口内、没有横向溢出，键帽都在各自区块内；竖向最多少量滚动。
  const fits=()=>js('JSON.stringify((()=>{const b=document.getElementById("helpBody"),d=help.getBoundingClientRect(),bad=[];for(const z of b.querySelectorAll(".hk-keys")){const r=z.getBoundingClientRect();for(const k of z.children){const c=k.getBoundingClientRect();if(c.left<r.left-1||c.right>r.right+1)bad.push(k.dataset.key);}}for(const el of b.querySelectorAll(".hk-zone,.hk-more,.hk-legend,.hk-btn,.hk-area")){const c=el.getBoundingClientRect();if(c.left<d.left-1||c.right>d.right+1)bad.push(el.className);}return {x:b.scrollWidth-b.clientWidth,y:b.scrollHeight-b.clientHeight,d:[d.left,d.top,d.right,d.bottom],vw:innerWidth,vh:innerHeight,bad}})())').then(JSON.parse);
  const report={};
  for(const [w,h] of [[500,900],[800,900],[1280,800],[360,640]]){
    await size(w,h);await open();const f=await fits();report[w+'x'+h]=f.y;await shoot('zh-'+w+'x'+h);
    assert.equal(f.x,0,w+'x'+h+' has no horizontal overflow');assert.deepEqual(f.bad,[],w+'x'+h+' keeps everything inside');
    assert.ok(f.d[0]>=0&&f.d[2]<=f.vw&&f.d[1]>=0&&f.d[3]<=f.vh,w+'x'+h+' dialog inside the window');
    if(w>=800)assert.equal(f.y,0,w+'x'+h+' needs no scrolling');if(w===500)assert.ok(f.y<=80,'500x900 scrolls a little at most: '+f.y);
    await js('help.close()');
  }
  // 四语：键帽上的文字（键名、短标签）完整显示，不被省略；360 宽时允许省略，但不溢出。
  const clipped=()=>js('[...document.querySelectorAll("#helpBody .hk-key.on>span")].filter(s=>s.scrollWidth>s.clientWidth+.5).map(s=>s.parentNode.dataset.key+":"+s.textContent)');
  for(const lang of ['en','zh','ja','ko']){
    await size(500,900);await load(lang);await open();
    assert.deepEqual(await clipped(),[],lang+': key cap labels fit at 500px');
    assert.ok(await js('[...document.querySelectorAll("#helpBody .hk-btn,#helpBody .hk-area")].every(e=>e.scrollWidth<=e.clientWidth+1)'),lang+': mouse labels fit');
    await shoot(lang+'-500x900');await js('help.close()');
    await size(360,640);await open();const f=await fits();assert.equal(f.x,0,lang+' 360px no overflow');assert.deepEqual(f.bad,[],lang+' 360px inside');
    report[lang+'@360 clipped']=(await clipped()).length;await shoot(lang+'-360x640');await js('help.close()');
  }
  assert.deepEqual(errors,[]);console.log('PASS: key map shows every bound key highlighted with placeholders around it, real relative positions (W over S, A S D adjacent, inverted-T arrows, nav cluster), hover / focus tips, no overflow at 500 / 800 / 1280 / 360 wide, labels fit in four languages',JSON.stringify(report));
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
