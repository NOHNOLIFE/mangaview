// 视频缩略图与封面（3.10）、类型过滤（2.3）、媒体的恢复与识别（第 5 节）。
// 独立临时配置 + OPFS 测试数据；视频、音频由 tests/media-fixtures.mjs 在测试页里现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {MEDIA_FIXTURES} from './media-fixtures.mjs';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/mediathumbs.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-mthumbs-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^(?:[\w-]+\/)*[\w.-]+$/.test(path))throw Error();
  const data=await readFile(new URL('../'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':mime[path.split('.').pop()],'Cache-Control':'no-cache'});res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port+'/';
// 自动播放由应用自己的规则（有过用户操作才自动播放）判断，这里关掉浏览器的出声拦截，结果才确定。
const chrome=spawn(binary,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--autoplay-policy=no-user-gesture-required','--window-size=800,900','about:blank'],{stdio:'ignore'});
let ws,id=0;const pending=new Map(),errors=[];
async function wait(check,what=''){let last;for(let i=0;i<160;i++){try{last=await check();if(last)return last;}catch(e){last=e;}await delay(60);}throw Error('Timed out: '+what+' '+check+'; last: '+last);}
try{
  const port=await wait(async()=>(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  const target=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const shot=async name=>{if(!process.env.MV_SHOTS)return;const {data}=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(process.env.MV_SHOTS,name+'.png'),Buffer.from(data,'base64'));};
  const key=async(key,code,vk,opts={})=>{const text=key.length===1?key:undefined;await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,text,...opts});if(!opts.hold)await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});};
  const up=(key,code,vk)=>cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});
  const click=async(x,y)=>{await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x,y});};
  const center=async sel=>js(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`);
  const tap=async sel=>{const [x,y]=await center(sel);await click(x,y);};
  await cdp('Runtime.enable');await cdp('Page.enable');
  const wide=()=>cdp('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});await wide();
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:900,deviceScaleFactor:1,mobile:false});
  // 记录在正文以外给视频挂源的次数（截帧）：验证「只为可见项生成」「持久化、不重复截帧」「失败不反复重试」。
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['en-US']});
    window.grabs=0;const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    Object.defineProperty(HTMLMediaElement.prototype,'src',{get(){return d.get.call(this);},set(v){if(!this.closest('.page'))window.grabs++;d.set.call(this,v);},configurable:true});`});
  const helpers=`window.records=()=>import('./src/core/store.mjs').then(({library})=>library('getAll'));
    window.record=t=>records().then(r=>r.find(b=>b.title===t));
    window.thumbKeys=()=>import('./src/core/store.mjs').then(({thumbs})=>thumbs('getAllKeys'));
    window.thumbRec=k=>import('./src/core/store.mjs').then(({thumbs})=>thumbs('get',k));
    window.putRec=b=>import('./src/core/store.mjs').then(({library})=>library('put',b));
    window.putThumb=(k,v)=>import('./src/core/store.mjs').then(({thumbs})=>thumbs('put',v,k));
    window.light=async blob=>{const img=new Image();img.src=URL.createObjectURL(blob);await img.decode();const c=new OffscreenCanvas(16,16),g=c.getContext('2d');g.drawImage(img,0,0,16,16);const p=g.getImageData(0,0,16,16).data;let s=0;for(let i=0;i<p.length;i+=4)s+=(p[i]+p[i+1]+p[i+2])/3;return s/256;};
    window.solid=(w,h,color)=>{const c=new OffscreenCanvas(w,h),g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,w,h);return c.convertToBlob({type:'image/webp'});};
    window.stripFrame=name=>document.querySelector('#preview .page[data-name="'+CSS.escape(name)+'"] .mv-tile>img.mv-frame');
    window.card=t=>document.querySelector('#books .book .pick[aria-label="'+CSS.escape(t)+'"]')?.closest('.book');
    window.root=()=>navigator.storage.getDirectory();
    // 开头 dark 秒全黑、之后是亮色的视频：10% 处接近纯黑，应改取 30% 处。
    window.darkWebm=async(seconds,dark,color='#ffd23c')=>{
      const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d'),stream=c.captureStream(24);
      const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      const t0=performance.now(),draw=()=>{g.fillStyle=performance.now()-t0<dark*1000?'#000':color;g.fillRect(0,0,320,180);};draw();const timer=setInterval(draw,1000/24);
      rec.start(100);await new Promise(r=>setTimeout(r,seconds*1000));const done=new Promise(r=>{rec.onstop=r;});rec.stop();await done;clearInterval(timer);for(const t of stream.getTracks())t.stop();
      return mvMedia.withDuration(new Blob(chunks,{type:'video/webm'}),seconds*1000);};`;
  const open=async()=>{await cdp('Page.navigate',{url:origin});await wait(()=>js('document.readyState==="complete"&&!!window.mvMedia===false'));await js(MEDIA_FIXTURES);await js(helpers);};
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);await js(helpers);
  // 开头约 0.5 秒全黑、之后是亮色的视频：10% 处接近纯黑，应改取 30% 处。
  const svg=(c,w=600,h=900)=>`new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${c}"/></svg>'],{type:'image/svg+xml'})`;
  await js(`(async()=>{const r=await root();
    const clips=await r.getDirectoryHandle('Clips',{create:true});
    await mvMedia.write(clips,'01 dark.webm',await darkWebm(2,.5));await mvMedia.write(clips,'02.svg',${svg('teal')});await mvMedia.write(clips,'03 bad.mp4',new Blob([new Uint8Array(4096).fill(7)]));
    const mix=await r.getDirectoryHandle('Mix',{create:true});
    await mvMedia.write(mix,'00 intro.wav',mvMedia.wav({seconds:1,freq:523}));await mvMedia.write(mix,'01 clip.webm',await mvMedia.webm({seconds:1.2}));
    for(const [n,s] of [['03 a.wav',1.1],['04 b.wav',1.2],['05 c.wav',1.3]])await mvMedia.write(mix,n,mvMedia.wav({seconds:s,freq:200}));await mvMedia.write(mix,'02.svg',${svg('purple')});
    const songs=await r.getDirectoryHandle('Songs of a very long title that keeps going on and on across several lines for the text cover so that the last part has to be cut off at the end of the sixth line',{create:true});
    await mvMedia.write(songs,'a.wav',mvMedia.wav({seconds:1}));await mvMedia.write(songs,'b.wav',mvMedia.wav({seconds:1,freq:300}));
    const pics=await r.getDirectoryHandle('Pics',{create:true});await mvMedia.write(pics,'1.svg',${svg('orange')});await mvMedia.write(pics,'2.svg',${svg('navy')});})()`);
  const add=async(name,first=false)=>{await js(`(async()=>{const d=await (await root()).getDirectoryHandle(${JSON.stringify(name)});window.showDirectoryPicker=async()=>d;document.querySelector('${first?'#empty':'#bar'} [data-act="folder"]').click();})()`);
    await wait(()=>js(`bookTitle.textContent===${JSON.stringify(name)}`),'import '+name);};
  for(const [i,n] of ['Pics','Songs of a very long title that keeps going on and on across several lines for the text cover so that the last part has to be cut off at the end of the sixth line','Mix','Clips'].entries())await add(n,i===0);
  const clipsId=(await js(`record('Clips')`)).id;

  // 3.10 只为可见项生成：缩略图栏收起时不截帧（封面的后台检查只补识别指纹，不为不可见的视频截帧）。
  await delay(2500);
  assert.equal(await js('grabs'),0,'No frame grabs while no video thumbnail is visible');
  assert.equal((await js('thumbKeys()')).filter(k=>k.includes(':vt:')).length,0);
  // 打开缩略图栏：视频页是真实画面（开头接近纯黑，改取 30% 处的亮色画面），持久化，记下文件的大小 + 修改时间和来源。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(()=>js(`stripFrame('01 dark.webm')?.naturalWidth>0`),'strip video frame');
  const vt=await js(`thumbRec(${JSON.stringify(clipsId+':vt:01 dark.webm')}).then(async r=>({src:r.src,stamp:r.stamp,w:r.w,h:r.h,light:await light(r.blob)}))`);
  assert.equal(vt.src,'auto');assert.match(vt.stamp,/^\d+:\d+$/);assert.deepEqual([vt.w,vt.h],[320,180]);
  assert.ok(vt.light>100,'A near-black frame at 10% is retried at 30%: '+vt.light);
  assert.ok(await js(`!!document.querySelector('#preview .page[data-name="01 dark.webm"] .mv-tile.framed .mv-badge')`),'The type badge stays over the frame');
  // 播不了的视频：记下文件的大小 + 修改时间（page.vfail），保持类型占位。
  await wait(async()=>/^\d+:4096$/.test((await js(`record('Clips')`)).pages.find(p=>p.name==='03 bad.mp4').vfail??''),'failure recorded');
  assert.equal(await js(`stripFrame('03 bad.mp4')`),null);
  await shot('mthumbs-strip');

  // 全屏缩略图：同一份画面；搜索框旁的类型开关只显示所选类型，可多选，标题行不移动；关闭即清空。
  await key('v','KeyV',86);await wait(()=>js(`!!document.querySelector('#overview .ov-item .mv-frame')`),'overview frame');
  const items=()=>js(`[...document.querySelectorAll('#overview .ov-item')].map(x=>+x.dataset.i).sort((a,b)=>a-b)`);
  const headBox=()=>js(`[...document.querySelectorAll('#overview .ov-head>*')].map(x=>{const r=x.getBoundingClientRect();return [r.left,r.top,r.width].map(Math.round).join()}).join('|')`);
  assert.deepEqual(await items(),[0,1,2]);await delay(500);const before=await headBox(); // 等开场动画结束
  assert.deepEqual(await js(`[...document.querySelectorAll('#overview .ov-kind')].map(b=>b.getAttribute('aria-label')+':'+b.getAttribute('aria-pressed'))`),['Images:false','Videos:false','Audio:false']);
  await tap('#overview .ov-kind[data-kind="video"]');await wait(async()=>JSON.stringify(await items())==='[0,2]','video only');
  await delay(300);assert.equal(await headBox(),before,'Header does not move');
  assert.equal(await js('document.activeElement.classList.contains("ov-scroll")'),true,'Focus goes back to the list');
  await tap('#overview .ov-kind[data-kind="image"]');await wait(async()=>JSON.stringify(await items())==='[0,1,2]','image + video');
  await tap('#overview .ov-kind[data-kind="video"]');await tap('#overview .ov-kind[data-kind="image"]');await tap('#overview .ov-kind[data-kind="audio"]');
  await wait(()=>js(`!document.querySelector('#overview .ov-none').hidden`),'no match for audio');
  await shot('mthumbs-overview-none');
  await js(`document.querySelector('#overview .ov-none button').click()`);await wait(async()=>JSON.stringify(await items())==='[0,1,2]','clear resets types');
  assert.equal(await js(`document.querySelectorAll('#overview .ov-kind[aria-pressed=true]').length`),0);
  // 加了类型开关后标题行在常见宽度下仍不溢出（说明文字的宽度上限为它们留出位置）。
  for(const w of [800,900,1100,1400]){await cdp('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:false});await delay(150);
    assert.ok(await js(`(()=>{const h=document.querySelector('#overview .ov-head');return h.scrollWidth<=h.clientWidth;})()`),'Header fits at '+w+'px');}
  await cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:900,deviceScaleFactor:1,mobile:false});await delay(150);
  await tap('#overview .ov-kind[data-kind="image"]');await key('Escape','Escape',27);await wait(()=>js(`!document.querySelector('dialog[open]')`));
  await key('v','KeyV',86);await wait(()=>js(`document.querySelector('#overview').open`));
  assert.deepEqual(await items(),[0,1,2],'Types are cleared when closing');await key('Escape','Escape',27);await wait(()=>js(`!document.querySelector('dialog[open]')`));

  // 持久化：重新打开后直接用存下的画面，只校验文件信息，不再截帧；播不了的文件没变也不再尝试。
  await open();await wait(()=>js(`bookTitle.textContent==='Clips'`));
  await wait(()=>js(`stripFrame('01 dark.webm')?.naturalWidth>0`),'frame from storage');await delay(2000);
  assert.equal(await js('grabs'),0,'No grab for a stored frame or a known failure');
  // 文件变了（大小 + 修改时间）：下次显示时重新生成。
  await js(`(async()=>{const d=await (await root()).getDirectoryHandle('Clips');await mvMedia.write(d,'01 dark.webm',await darkWebm(1.4,0,'#3c78ff'));})()`);
  await open();await wait(()=>js(`bookTitle.textContent==='Clips'`));
  await wait(async()=>(await js(`thumbRec(${JSON.stringify(clipsId+':vt:01 dark.webm')}).then(r=>r.stamp)`))!==vt.stamp,'regenerated after the file changed');
  assert.ok(await js('grabs')>=1);

  // 优先用时间最早的书签：没有书签缩略图时按书签时间截一张（来源记为该书签）；书签缩略图存在时直接用它。
  await js(`record('Clips').then(b=>{b.bookmarks=[{id:'m2',name:'01 dark.webm',t:1.1,at:2},{id:'m1',name:'01 dark.webm',t:.7,at:1},{id:'i1',name:'02.svg',f:.5,at:3}];return putRec(b);})`);
  await open();await wait(()=>js(`bookTitle.textContent==='Clips'`));
  await wait(async()=>(await js(`thumbRec(${JSON.stringify(clipsId+':vt:01 dark.webm')}).then(r=>r.src)`))==='bm:m1@0.7','frame from the earliest bookmark');
  await js(`solid(40,30,'red').then(b=>putThumb(${JSON.stringify(clipsId+':bm:m1')},{blob:b,w:40,h:30}))`);
  await open();await wait(()=>js(`bookTitle.textContent==='Clips'`));
  await wait(()=>js(`stripFrame('01 dark.webm')?.naturalWidth===40`),'bookmark thumbnail used');
  await delay(1000);assert.equal(await js('grabs'),0,'Using the bookmark thumbnail needs no grab');
  await shot('mthumbs-strip');
  // 全屏书架书签：类型开关按书签所在页的类型过滤（媒体书签即所在的视频）。
  await key('c','KeyC',67);await wait(()=>js(`document.querySelector('#shelfOverview').open&&document.querySelectorAll('#shelfOverview .ov-mark').length===3`),'shelf bookmarks');
  const marksShown=()=>js(`document.querySelectorAll('#shelfOverview .ov-mark').length`);
  await tap('#shelfOverview .ov-kind[data-kind="video"]');await wait(async()=>await marksShown()===2,'video bookmarks only');
  await tap('#shelfOverview .ov-kind[data-kind="video"]');await tap('#shelfOverview .ov-kind[data-kind="image"]');await wait(async()=>await marksShown()===1,'image bookmarks only');
  await tap('#shelfOverview .ov-kind[data-kind="image"]');await tap('#shelfOverview .ov-kind[data-kind="audio"]');
  await wait(()=>js(`!document.querySelector('#shelfOverview .ov-none').hidden&&document.querySelector('#shelfOverview .ov-none button').textContent==='Clear filters'`),'no audio bookmarks');
  await key('Escape','Escape',27);await wait(()=>js(`!document.querySelector('dialog[open]')`));

  // 3.10 封面：默认封面取文件名顺序第一个有画面的页（视频用它的缩略图，优先最早的书签画面）；识别用的指纹仍是首个文件（不论类型）。
  // 全书只有音频时用作品名生成文字封面；含视频 / 音频的书在封面上有类型角标。
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));
  const songs='Songs of a very long title that keeps going on and on across several lines for the text cover so that the last part has to be cut off at the end of the sixth line';
  await wait(()=>js(`card('Mix')?.querySelector('.cover img')?.naturalWidth>0&&card('Clips')?.querySelector('.cover img')?.naturalWidth>0`),'video covers');
  const mix=await js(`record('Mix')`),clips=await js(`record('Clips')`);
  assert.equal(mix.pages.length,6);assert.equal(mix.fp.cover.name,'00 intro.wav','Recognition fingerprint: the first file, whatever its type');assert.match(mix.fp.cover.hash,/:\d+$/);
  assert.deepEqual([mix.fp.pic,mix.fp.src,mix.fp.thumb],['01 clip.webm','auto',true],'Cover picture: the first page with a picture');
  assert.deepEqual([clips.fp.pic,clips.fp.src],['01 dark.webm','bm:m1@0.7'],'Video cover prefers the earliest bookmark');
  assert.equal(await js(`card('Clips').querySelector('.cover img').naturalWidth`),40,'The bookmark thumbnail is the cover');
  await wait(()=>js(`card(${JSON.stringify(songs)})?.querySelector('.text-cover')?.textContent===${JSON.stringify(songs)}`),'text cover');
  await shot('mthumbs-shelf');
  const tc=await js(`(()=>{const c=card(${JSON.stringify(songs)}).querySelector('.text-cover'),s=c.firstChild,r=c.getBoundingClientRect(),t=s.getBoundingClientRect();return {inside:t.left>=r.left&&t.right<=r.right&&t.top>=r.top&&t.bottom<=r.bottom,clamped:s.scrollHeight>s.clientHeight};})()`);
  assert.deepEqual(tc,{inside:true,clamped:true},'Long titles wrap and are cut inside the text cover');
  const flags=await js(`['Pics','Mix','Clips',${JSON.stringify(songs)}].map(t=>[...card(t).querySelectorAll('.kind-flag use')].map(u=>u.getAttribute('href')).join()+'|'+(card(t).querySelector('.kind-flag')?.getAttribute('aria-label')??''))`);
  assert.deepEqual(flags,['|','#i-film,#i-music|Videos · Audio','#i-film|Videos','#i-music|Audio']);
  await shot('mthumbs-shelf');

  // 2.3 书架的类型筛选：含有任一所选类型的页即匹配；持久化、计入角标与清除筛选、收起面板时显示生效条件、可存入预设、限定上一本 / 下一本。
  const shown=()=>js(`[...document.querySelectorAll('#books .book .pick')].map(p=>p.getAttribute('aria-label')).sort()`);
  await js('filterToggle.click()');await wait(()=>js('!filterPanel.hidden'));
  assert.deepEqual(await js(`[...kindFilter.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))`),['Images','Videos','Audio']);
  await js(`kindFilter.querySelector('[data-kind="audio"]').click()`);
  await wait(async()=>JSON.stringify(await shown())===JSON.stringify(['Mix',songs]),'audio filter');
  await shot('mthumbs-filter-panel');assert.equal(await js('filterBadge.textContent'),'1');assert.equal(await js('clearBtn.disabled'),false);
  await js(`kindFilter.querySelector('[data-kind="video"]').click()`);
  await wait(async()=>JSON.stringify(await shown())===JSON.stringify(['Clips','Mix',songs]),'audio + video');
  await wait(async()=>JSON.stringify(JSON.parse(await js(`localStorage.getItem('mv2:shelfFilter')`)).kinds)==='["video","audio"]','filter saved');
  await js('filterToggle.click()');await wait(()=>js('!filterSummary.hidden'));
  assert.match(await js('filterSummary.textContent'),/Videos \/ Audio/);
  await shot('mthumbs-shelf-filter');
  // 预设记下类型。
  await js('presetBtn.click()');await wait(()=>js(`presetPop.matches(':popover-open')`));await js(`presetPop.querySelector('.pp-add').click()`);
  await wait(()=>js(`!!presetPop.querySelector('.pp-name input')`));await js(`(()=>{const i=presetPop.querySelector('.pp-name input');i.value='media';i.form.requestSubmit();})()`);
  await wait(()=>js(`(JSON.parse(localStorage.getItem('mv2:shelfPresets'))||[]).some(p=>p.name==='media'&&p.f.kinds.join()==='video,audio')`),'preset with types');
  await key('Escape','Escape',27);
  // 上一本 / 下一本只在符合条件的书里切换（只看音频：Mix 与 Songs）。
  await js('filterToggle.click()');await js(`kindFilter.querySelector('[data-kind="video"]').click()`);await wait(async()=>(await shown()).length===2);
  await js(`card('Mix').querySelector('.pick').click()`);await wait(()=>js(`bookTitle.textContent==='Mix'`));
  for(let i=0;i<3;i++){await js(`document.querySelector('[data-act="next"]').click()`);await delay(150);assert.ok(['Mix',songs].includes(await js('bookTitle.textContent')),'next stays within the filter');}
  // 清除筛选：类型一并清除。
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));
  await js('clearBtn.click()');await wait(async()=>(await shown()).length===4,'cleared');
  assert.equal(await js(`kindFilter.querySelectorAll('[aria-pressed=true]').length`),0);

  // 第 5 节：含媒体的书在后台记下各媒体文件的精确大小（只读文件元数据）。
  await wait(async()=>{const r=await js('records()');return r.filter(b=>b.title!=='Pics').every(b=>b.pages.filter(p=>!p.name.endsWith('.svg')).every(p=>Number.isFinite(p.size)));},'media sizes recorded');
  assert.ok((await js(`record('Pics')`)).pages.every(p=>p.size===undefined),'Image pages are not sized');
  // 文件夹改名、首个文件也变了：按媒体的「文件名 + 大小」重合度（5 个里 4 个对上）列出来，由用户确认后接回原记录。
  await js(`(async()=>{const r=await root(),old=await r.getDirectoryHandle('Mix'),d=await r.getDirectoryHandle('Mix moved',{create:true});
    for await(const h of old.values())if(h.kind==='file'&&h.name!=='00 intro.wav')await mvMedia.write(d,h.name,await h.getFile());
    await mvMedia.write(d,'00 intro.wav',mvMedia.wav({seconds:2}));await r.removeEntry('Mix',{recursive:true});})()`);
  await js(`document.querySelector('#shelf [data-act="refresh"]').click()`);await delay(50);await wait(()=>js(`!document.querySelector('#shelf [data-act="refresh"]').disabled`));
  await wait(()=>js(`document.querySelector('[data-view="expired"] .count').textContent==='1'`),'Mix expired');
  await js(`document.querySelector('[data-view="expired"]').click()`);
  await js(`(async()=>{const r=await root();window.showDirectoryPicker=async()=>r;restoreAllBtn.click();})()`);
  await wait(()=>js('restore.open'),'review dialog');
  const rows=await js(`[...restoreList.querySelectorAll('.match')].map(r=>r.textContent)`);
  assert.equal(rows.length,1);assert.match(rows[0],/Mix moved/);assert.match(rows[0],/Media files match by name and size/);
  await js(`restoreList.querySelector('input[type=checkbox]').checked=true;restoreGo.click()`);
  await wait(async()=>(await js(`records()`)).find(b=>b.id===mix.id)?.sources?.[0]?.title==='Mix moved','restored into the old record');
  assert.equal((await js('records()')).length,4,'Restoring adds no book');

  assert.deepEqual(errors,[]);
  console.log('PASS: video frames in the strip, full-screen thumbnails and covers (10% / 30% retry, earliest bookmark first, persisted with size + time check, failures not retried, visible only), first-picture default cover, text cover for audio-only books, type badges, type filters in full-screen views and the shelf (saved, preset, clear, prev / next), media sizes for recognition, restore by media name + size');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
