// 帮助对话框的键位图：功能键齐全且高亮、键帽只写键名、按真实键盘的相对位置排布、各窗口尺寸下不溢出；悬停 / 聚焦 / 点按显示说明提示框（四语）。
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
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setFocusEmulationEnabled',{enabled:true}); // 重新载入后页面也视为有焦点，focus / focusin 照常派发
  const shots=process.env.MV_SHOTS;
  const size=async(width,height)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);};
  const load=async lang=>{await js('localStorage.setItem("mv2:lang",'+JSON.stringify(JSON.stringify(lang))+')');await cdp('Page.reload');await wait(()=>js('document.querySelector("#empty")?.hidden===false&&!!document.querySelector("#helpBody .hk-key")'));};
  const open=async()=>{await js('help.open||document.querySelector("#bar [data-act=help]").click()');await wait(()=>js('help.open'));await delay(350);};
  const shoot=async name=>{if(!shots)return;const {data}=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(shots,'help-'+name+'.png'),Buffer.from(data,'base64'));};
  const rect=k=>js('JSON.stringify(document.querySelector('+JSON.stringify('#helpBody [data-key="'+k+'"]')+').getBoundingClientRect())').then(JSON.parse);
  await size(800,900);
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  await load('zh');await open();

  // 实际绑定的主要键都在图示中且高亮、可聚焦、带说明；无关的键是暗淡占位（aria-hidden、不进入文本）。
  const bound=['Esc','W','A','S','D','F','C','V','B','T','Q','E','ShiftLeft','Space','Enter','ShiftRight',';',"'",'[',']','Home','End','PageUp','PageDown','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  const q=k=>'document.querySelector('+JSON.stringify('#helpBody [data-key="'+k+'"]')+')';
  for(const k of bound)assert.deepEqual(await js('(()=>{const el='+q(k)+';return el&&[el.classList.contains("on"),el.tabIndex,!!el.getAttribute("aria-label"),el.getBoundingClientRect().width>0]})()'),[true,0,true,true],k+' is shown highlighted');
  assert.deepEqual(await js('[...document.querySelectorAll("#helpBody .hk-key.on")].map(e=>e.dataset.key).sort()'),[...bound].sort(),'Only bound keys are highlighted');
  for(const k of ['R','G','Tab','CapsLock','ControlLeft','Backspace','P'])assert.deepEqual(await js('(()=>{const el='+q(k)+';return el&&[el.classList.contains("on"),el.getAttribute("aria-hidden"),el.textContent,el.tabIndex]})()'),[false,'true','',-1],k+' is a placeholder');
  // 键帽上只有键名：一个片段、无功能文字；长按 / Shift 只是 CSS 角标。
  const names={Esc:'Esc',ShiftLeft:'Shift',ShiftRight:'Shift',Space:'空格',Enter:'Enter',Home:'Home',End:'End',PageUp:'PgUp',PageDown:'PgDn',Delete:'Del',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'};
  for(const k of bound)assert.deepEqual(await js('(()=>{const el='+q(k)+';return [el.children.length,el.textContent]})()'),[1,names[k]??k],k+' shows only its key name');
  assert.deepEqual(await js('[...document.querySelectorAll("#helpBody .hk-key.has-hold")].map(e=>e.dataset.key).sort()'),['A','ArrowLeft','ArrowRight','D','Enter','F'],'Hold keys are marked');
  assert.deepEqual(await js('[...document.querySelectorAll("#helpBody .hk-key.has-shift")].map(e=>e.dataset.key).sort()'),['ArrowDown','ArrowUp','Enter','F','S','W'],'Shift combos are marked');
  assert.equal(await js('document.querySelectorAll("#helpBody .hk-key.mod").length'),2);
  assert.equal(await js('[...document.querySelectorAll("#helpBody [data-tip]")].filter(e=>e.tabIndex===0).length'),bound.length+4,'Every function key and reader edge is focusable');

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

  // 提示框：只有一个；文字与 aria-label 相同；在视口和对话框内，不遮住该项；最多两行。
  const tip=sel=>js('JSON.stringify((()=>{const t=help.querySelector(".hk-tip"),r=t.getBoundingClientRect(),d=help.getBoundingClientRect(),el='+(sel?'document.querySelector('+JSON.stringify(sel)+')':'document.activeElement')+',k=el.getBoundingClientRect(),lh=parseFloat(getComputedStyle(t).lineHeight);'+
    'return {n:help.querySelectorAll(".hk-tip").length,hidden:t.hidden,text:t.textContent,label:el.getAttribute("aria-label"),'+
    'in:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.left>=d.left&&r.right<=d.right&&r.top>=d.top&&r.bottom<=d.bottom,'+
    'covers:r.left<k.right-1&&r.right>k.left+1&&r.top<k.bottom-1&&r.bottom>k.top+1,lines:Math.round((t.clientHeight-parseFloat(getComputedStyle(t).paddingTop)*2)/lh),'+
    'hold:[...t.querySelectorAll(".em-hold")].map(s=>s.textContent),shift:[...t.querySelectorAll(".em-shift")].map(s=>s.textContent),'+
    'colors:[...t.querySelectorAll(".em-hold,.em-shift")].map(s=>getComputedStyle(s).color),base:getComputedStyle(t).color}})())').then(JSON.parse);
  const good=(t,msg)=>{assert.equal(t.hidden,false,msg+' shows a tip');assert.equal(t.n,1,msg+' one tip');assert.equal(t.text,t.label,msg+' tip = aria-label');assert.ok(t.in,msg+' tip inside the viewport and dialog');assert.ok(!t.covers,msg+' tip does not cover the item');assert.ok(t.lines<=2,msg+' tip at most two lines: '+t.lines);};
  const hover=async r=>{await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.left+r.width/2,y:r.top+r.height/2});await delay(60);};
  await hover(W);let t=await tip('#helpBody [data-key=W]');good(t,'W hover');assert.equal(t.text,'W 向上滚动，Shift 上一本');
  await hover(F);t=await tip('#helpBody [data-key=F]');good(t,'F hover');assert.equal(t.text,'F 跳转书签，长按添加书签；Shift 反向 / 区段书签');
  assert.deepEqual([t.hold,t.shift],[['长按'],['Shift']],'Hold and Shift are emphasised');
  assert.ok(t.colors.every(c=>c!==t.base)&&t.colors[0]!==t.colors[1],'Hold and Shift use their own accent colours: '+t.colors);
  assert.deepEqual(await js('[...document.querySelectorAll(".hk-legend .em-hold,.hk-legend .em-shift")].map(s=>getComputedStyle(s).color)'),t.colors,'Legend explains the same colours');
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});await delay(60);assert.equal((await tip('#helpBody [data-key=F]')).hidden,true,'Tip hides when the pointer leaves');
  await js('help.querySelector("[data-close]").focus()');await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await delay(80);
  assert.equal(await js('document.activeElement.dataset.key'),'Esc','Tab moves into the key map');t=await tip();good(t,'Esc focus');assert.match(t.text,/^Esc 收起/);
  await js(q('ArrowRight')+'.focus()');await delay(50);t=await tip();good(t,'→ focus');assert.equal(t.text,'→ 下一屏，长按媒体快进');
  // 触屏点按也显示提示框（点按聚焦该项）。
  await js('document.activeElement.blur()');const Bk=await rect('B');
  for(const type of ['touchStart','touchEnd'])await cdp('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:Bk.left+Bk.width/2,y:Bk.top+Bk.height/2}]});
  await delay(80);t=await tip('#helpBody [data-key=B]');good(t,'B tap');assert.equal(t.text,'B 书架');
  // 阅读区边缘有提示框；鼠标按键图例与左 / 右半屏只是文字，没有提示框。
  await js('document.querySelector("#helpBody [data-area=right]").focus()');await delay(50);t=await tip();good(t,'Right edge');assert.match(t.text,/右缘.*缩略图栏/);
  assert.deepEqual(await js('[...document.querySelectorAll("#helpBody .hk-btn")].map(e=>[e.textContent,e.hasAttribute("data-tip")])'),[['翻屏（左 / 右半屏），点媒体播放 / 暂停，拖动滚动',false],['滚动，中键自动滚动',false],['书签面板',false]]);
  await js('help.close()');await delay(50);assert.equal(await js('help.querySelector(".hk-tip").hidden'),true,'Tip hides with the dialog');

  // 各窗口尺寸：对话框在窗口内、没有横向溢出，键帽都在各自区块内；竖向最多少量滚动。键名字号不小于设定值且完整显示。
  const fits=()=>js('JSON.stringify((()=>{const b=document.getElementById("helpBody"),d=help.getBoundingClientRect(),bad=[];for(const z of b.querySelectorAll(".hk-keys")){const r=z.getBoundingClientRect();for(const k of z.children){const c=k.getBoundingClientRect();if(c.left<r.left-1||c.right>r.right+1)bad.push(k.dataset.key);}}for(const el of b.querySelectorAll(".hk-zone,.hk-more,.hk-legend,.hk-btn,.hk-area")){const c=el.getBoundingClientRect();if(c.left<d.left-1||c.right>d.right+1)bad.push(el.className);}return {x:b.scrollWidth-b.clientWidth,y:b.scrollHeight-b.clientHeight,d:[d.left,d.top,d.right,d.bottom],vw:innerWidth,vh:innerHeight,bad}})())').then(JSON.parse);
  // 单键宽的长键名（Home、PgUp 等）略小一号，下限单独算。
  const caps=()=>js('JSON.stringify([...document.querySelectorAll("#helpBody .hk-cap")].map(s=>[s.parentNode.dataset.key,parseFloat(getComputedStyle(s).fontSize),s.scrollWidth>s.clientWidth+.5,s.parentNode.classList.contains("long")]))').then(JSON.parse);
  const checkCaps=async(min,msg)=>{const c=await caps(),low=x=>x[1]<(x[3]?min-2.5:min);assert.deepEqual(c.filter(low).map(x=>x[0]+':'+x[1]),[],msg+' key names at least '+min+'px');assert.deepEqual(c.filter(x=>x[2]).map(x=>x[0]),[],msg+' key names fit');
    return Math.min(...c.filter(x=>!x[3]).map(x=>x[1]))+'/'+Math.min(...c.filter(x=>x[3]).map(x=>x[1]));};
  // 逐项聚焦：每个提示框都合格。
  const allTips=async msg=>{await delay(100);for(const sel of await js('[...document.querySelectorAll("#helpBody [data-tip]")].map(e=>e.dataset.key?"#helpBody [data-key=\\""+e.dataset.key+"\\"]":"#helpBody [data-area="+e.dataset.area+"]")')){await js('document.querySelector('+JSON.stringify(sel)+').focus()');await delay(30);const tt=await tip();good(tt,msg+' '+sel);}await js('document.activeElement.blur()');};
  const report={};
  const shotTip=async(name,k)=>{if(!shots)return;await js(q(k)+'.focus()');await delay(80);await shoot(name);await js('document.activeElement.blur()');};
  for(const [w,h] of [[500,900],[800,900],[1280,800],[360,640]]){
    await size(w,h);await open();const f=await fits();report[w+'x'+h]={scroll:f.y,font:await checkCaps(w<500?12.5:14,w+'x'+h)};await shoot('zh-'+w+'x'+h);
    assert.equal(f.x,0,w+'x'+h+' has no horizontal overflow');assert.deepEqual(f.bad,[],w+'x'+h+' keeps everything inside');
    assert.ok(f.d[0]>=0&&f.d[2]<=f.vw&&f.d[1]>=0&&f.d[3]<=f.vh,w+'x'+h+' dialog inside the window');
    if(w>=800)assert.equal(f.y,0,w+'x'+h+' needs no scrolling');if(w===500)assert.ok(f.y<=80,'500x900 scrolls a little at most: '+f.y);
    await allTips('zh '+w+'x'+h);await shotTip('zh-tip-'+w+'x'+h,'F');
    await js('help.close()');
  }
  // 四语：无横向溢出、键名完整显示、鼠标图例放得下、每个提示框合格；“长按”片段带强调样式。
  const holdWord={en:'hold',zh:'长按',ja:'長押し',ko:'길게'};
  for(const lang of ['en','zh','ja','ko']){
    await size(500,900);await load(lang);await open();let f=await fits();assert.equal(f.x,0,lang+' 500px no overflow');assert.deepEqual(f.bad,[],lang+' 500px inside');
    await checkCaps(14,lang+' 500px');
    assert.ok(await js('[...document.querySelectorAll("#helpBody .hk-btn,#helpBody .hk-area")].every(e=>e.scrollWidth<=e.clientWidth+1)'),lang+': mouse labels fit');
    await allTips(lang+' 500px');
    await js(q('A')+'.focus()');await delay(30);t=await tip();assert.deepEqual(t.hold,[holdWord[lang]],lang+': A emphasises its hold function (media rewind)');report[lang+' A']=t.text;
    await js(q('W')+'.focus()');await delay(30);t=await tip();assert.deepEqual([t.hold,t.shift],[[],['Shift']],lang+': W emphasises Shift');report[lang+' W']=t.text;
    await js(q('ShiftLeft')+'.focus()');await delay(30);report[lang+' Shift']=(await tip()).text;
    await js(q('F')+'.focus()');await delay(30);t=await tip();assert.deepEqual([t.hold,t.shift],[[holdWord[lang]],['Shift']],lang+': F emphasises hold and Shift');report[lang+' F']=t.text;
    await js('document.activeElement.blur()');await shoot(lang+'-500x900');if(lang==='en')for(const [w,h] of [[500,900],[800,900],[1280,800],[360,640]]){await js('help.close()');await size(w,h);await open();await shotTip('en-tip-'+w+'x'+h,'A');}
    await js('help.close()');
    await size(360,640);await open();f=await fits();assert.equal(f.x,0,lang+' 360px no overflow');assert.deepEqual(f.bad,[],lang+' 360px inside');
    await checkCaps(12.5,lang+' 360px');await allTips(lang+' 360px');await shoot(lang+'-360x640');await js('help.close()');
  }
  assert.deepEqual(errors,[]);console.log('PASS: key map shows every bound key highlighted (key names only, hold / Shift corner marks) with placeholders around it, real relative positions, one tip on hover / focus / tap equal to aria-label with hold and Shift emphasised, inside the viewport without covering the item, at most two lines, no overflow at 500 / 800 / 1280 / 360 wide in four languages',JSON.stringify(report));
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
