// 读图队列：某些文件的读取挂起（浏览器偶发）时不能卡住整个队列。框架同 tests/browser.mjs。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/queue.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-queue-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^(?:[\w-]+\/)*[\w.-]+$/.test(path))throw Error();
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
  // 模拟浏览器的文件读取卡死：window.hang 为真时，名字以 h 开头的文件 getFile 永不返回；
  // window.bad 里的句柄（模拟整体失效的已保存句柄）的一切操作都永不返回，同一文件夹新取得的句柄正常。
  // 另外，sessionStorage.badNames 里列出名字的句柄，凡是从存档里读出来的（不是本次会话新取得的）都算失效：模拟浏览器更新后旧句柄整体作废。
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`{const never=()=>new Promise(()=>{}),fresh=new WeakSet(),tag=h=>(fresh.add(h),h),F=FileSystemFileHandle.prototype,D=FileSystemDirectoryHandle.prototype,H=FileSystemHandle.prototype;
    const bad=h=>window.bad?.has(h)||!fresh.has(h)&&h.name!==''&&(sessionStorage.badNames||'').split(',').includes(h.name);
    const g=F.getFile;F.getFile=function(){return window.hang&&this.name.startsWith('h')||bad(this)?never():g.call(this);};
    for(const k of ['getFileHandle','getDirectoryHandle']){const f=D[k];D[k]=function(...a){return bad(this)?never():f.apply(this,a).then(tag);};}
    for(const k of ['isSameEntry','queryPermission','requestPermission']){const f=H[k];H[k]=function(...a){return bad(this)?never():f.apply(this,a);};}
    for(const k of ['values','entries','keys']){const f=D[k];D[k]=function(){if(bad(this))return {next:never,[Symbol.asyncIterator](){return this;}};const it=f.call(this);
      return {next:()=>it.next().then(r=>{if(!r.done){const v=r.value;if(Array.isArray(v))tag(v[1]);else if(v instanceof FileSystemHandle)tag(v);}return r;}),[Symbol.asyncIterator](){return this;}};};}}`});
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  const add=(name,prefix,button)=>js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('${name}',{create:true});
    for(let i=0;i<12;i++){const out=await (await dir.getFileHandle('${prefix}'+i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>');await out.close();}
    window.lastDir=dir;window.showDirectoryPicker=async()=>dir;document.querySelector('${button}').click();})()`);
  const shown=prefix=>js(`document.querySelector('#reader [data-name="${prefix}0.svg"] img')?.naturalWidth===600`);
  const go=async prefix=>{for(let i=0;i<5&&!await js(`!!document.querySelector('#reader [data-name="${prefix}0.svg"]')`);i++){await js('document.querySelector(\'[data-act="next"]\').click()');await delay(150);}};
  await add('Fine','a','#empty [data-act="folder"]');await wait(()=>shown('a'));
  // 一本书的图读不出来（读取挂起），切到别的书后，别的书照常显示：被丢弃的任务不占读图名额。
  await js('window.hang=true');await add('Stuck','h','#bar [data-act="folder"]');
  await wait(()=>js(`!!document.querySelector('#reader [data-name="h0.svg"]')`));await delay(400);
  assert.equal(await shown('h'),false);
  await go('a');await wait(()=>shown('a'));
  // 读取超时按失败处理：显示「无法显示」和「暂时无法读取」提示，让出名额；离开再回来会重新读取。
  await js("import('./src/reader/view.mjs').then(m=>{m.limits.read=300;})");
  await go('h');await wait(()=>js(`document.querySelector('#reader [data-name="h0.svg"]')?.classList.contains('failed')`));
  await wait(()=>js('!access.hidden'));
  await go('a');await wait(()=>shown('a'));
  await js('window.hang=false');await go('h');await wait(()=>shown('h'));
  // 已保存的文件夹句柄整体卡死：读图限时失败并提示；刷新时限时，记为找不到（过期）；重新拖入同一个文件夹（新句柄）接回原记录，书签保留、不产生重复条目。
  const rec=title=>js(`new Promise(r=>{const q=indexedDB.open('mangaview-reader-v2');q.onsuccess=()=>{const g=q.result.transaction('books').objectStore('books').getAll();g.onsuccess=()=>r(g.result.filter(b=>b.title==='${title}').map(b=>({id:b.id,marks:(b.bookmarks||[]).length,missing:!!b.sources?.[0]?.missing})));};})`);
  await js("Promise.all([import('./src/core/sources.mjs'),import('./src/reader/view.mjs')]).then(([s,v])=>{s.limits.first=500;s.limits.next=300;v.limits.read=5000;})");
  await add('Kept','k','#bar [data-act="folder"]');await wait(()=>shown('k'));
  await js('reader.focus()');await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'f',code:'KeyF',windowsVirtualKeyCode:70});await delay(800);await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'f',code:'KeyF',windowsVirtualKeyCode:70});
  await wait(async()=>(await rec('Kept'))[0]?.marks===1);const kept=(await rec('Kept'))[0];
  await js('window.bad=new WeakSet([window.lastDir])');
  await go('a');await go('k');
  await wait(()=>js(`document.querySelector('#reader [data-name="k0.svg"]')?.classList.contains('failed')`));await wait(()=>js('!access.hidden'));
  const t0=Date.now();await js(`document.querySelector('[data-act="refresh"]').click()`);
  await wait(()=>js(`notice.textContent.startsWith('1 本找不到文件夹')`));await wait(()=>js(`!document.querySelector('[data-act="refresh"]').disabled`));
  assert.ok(Date.now()-t0<8000,'Refresh does not hang on a stuck folder');
  await js(`window.showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('Kept');document.querySelector('#bar [data-act="folder"]').click()`);
  await wait(async()=>{const r=await rec('Kept');return r.length===1&&!r[0].missing;});
  assert.deepEqual(await rec('Kept'),[{id:kept.id,marks:1,missing:false}],'Re-adding the folder reconnects the original record');
  await go('k');await wait(()=>shown('k'));
  // 启动和刷新前并行探测：卡住的句柄不必各等一遍较长的首次时限。
  const probed=await js(`(async()=>{const s=await import('./src/core/sources.mjs');s.limits.first=20000;s.limits.probe=300;const hs=[];const root=await navigator.storage.getDirectory();for(const n of ['Fine','Stuck'])hs.push(await root.getDirectoryHandle(n));window.bad=new WeakSet(hs);const t=performance.now();await s.probe(hs);return {ms:performance.now()-t,stuck:hs.every(s.isStuck)};})()`);
  assert.ok(probed.stuck&&probed.ms<2000,'Stuck handles are found in parallel: '+JSON.stringify(probed));
  // 浏览器更新后旧句柄整体作废：启动时几秒内判定（不逐个等硬盘超时），提示条说明是浏览器更新所致并直接给出恢复入口；
  // 选一次上级文件夹，单文件夹书和散图图集一起接回原记录，书签保留；文件夹里没有对应记录的内容不会被加成新书。
  await js(`(async()=>{const root=await navigator.storage.getDirectory();
    for(const [d,p] of [['Loose','l'],['Extra','x']]){const dir=await root.getDirectoryHandle(d,{create:true});for(let i=0;i<2;i++){const out=await (await dir.getFileHandle(p+i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="navy"/></svg>');await out.close();}}
    const loose=await root.getDirectoryHandle('Loose');window.showOpenFilePicker=async()=>[await loose.getFileHandle('l0.svg'),await loose.getFileHandle('l1.svg')];document.querySelector('#bar [data-act="files"]').click();})()`);
  const all=()=>js(`new Promise(r=>{const q=indexedDB.open('mangaview-reader-v2');q.onsuccess=()=>{const g=q.result.transaction('books').objectStore('books').getAll();g.onsuccess=()=>r(g.result.map(b=>b.id+':'+(b.title??'')+':'+b.pages.length+':'+(b.bookmarks||[]).length).sort());};})`);
  await wait(async()=>(await all()).some(x=>x.includes('::2:')));const before=await all();
  await js(`localStorage.setItem('mv2:ua','"1"');sessionStorage.badNames='Fine,Stuck,Kept,l0.svg,l1.svg'`);
  const t1=Date.now();await cdp('Page.navigate',{url:origin});
  await wait(()=>js('!access.hidden&&access.classList.contains("stale")'));
  assert.ok(Date.now()-t1<9000,'Dead handles are detected quickly at startup');
  assert.match(await js('access.querySelector("span").textContent'),/1 → \d+.*4 个/,'The hint blames the browser update and counts the dead sources');
  await js(`window.showDirectoryPicker=async()=>navigator.storage.getDirectory();document.querySelector('#access [data-act="allow"]').click()`);
  await wait(()=>js('access.hidden'));
  assert.equal(await js('notice.textContent'),'已恢复 4 本');
  assert.deepEqual(await all(),before,'Restoring reconnects the existing records and adds no new books');
  assert.equal(await js(`JSON.parse(localStorage.getItem('mv2:ua'))===navigator.userAgent.split('Chrome/')[1].split('.')[0]`),true);
  await go('k');await wait(()=>shown('k'));
  // 只为当前这一本「定位原文件」时，所选文件夹里其他失效的书和散图也一并接回，不用逐本操作。
  await cdp('Page.navigate',{url:origin});await wait(()=>js('!access.hidden&&access.classList.contains("stale")'));
  await js(`window.showDirectoryPicker=async()=>navigator.storage.getDirectory();document.querySelector('#access [data-act="locate"]').click()`);
  await wait(()=>js('access.hidden'));assert.deepEqual(await all(),before);
  await go('a');await wait(()=>shown('a'));await go('k');await wait(()=>shown('k'));
  assert.deepEqual(errors,[]);console.log('PASS: a stalled read never blocks the image queue: switching books frees the slots, a read that times out shows as failed with the unavailable hint, and the page is read again when revisited; a stuck saved folder handle times out everywhere (reading, refresh, matching), counts as not found, and re-adding the same folder reconnects the original record with its bookmarks; handles voided by a browser update are detected at startup within seconds, the hint names the update, and one restore reconnects folders and loose images without adding books');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
