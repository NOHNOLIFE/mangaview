// 书架 / 书库 / 标签 / 过期书籍与恢复。用独立临时配置和 OPFS 测试数据。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-browser-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
let updated=false;
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^(?:icons\/)?[\w.-]+$/.test(path))throw Error();
  let data=await readFile(new URL('../'+path,import.meta.url));
  if(updated&&path==='sw.js')data=data.toString().replace(/(cacheName\s*=\s*prefix\s*\+\s*)'[^']+'/,"$1'browser-test-update'");
  if(updated&&path==='index.html')data=data.toString().replace('</head>','<meta name="test-build" content="new"></head>');
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
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['zh-CN']});`});
  await cdp('Page.navigate',{url:origin});await wait(()=>js('document.querySelector("#empty")?.hidden===false'));
  // 造书：每本书的图片颜色不同，封面摘要因此不同。
  await js(`window.mk=async(root,name,n,color)=>{let d=await navigator.storage.getDirectory();for(const part of root.split('/'))d=await d.getDirectoryHandle(part,{create:true});d=await d.getDirectoryHandle(name,{create:true});
    for(let i=1;i<=n;i++){const w=await (await d.getFileHandle(i+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="'+(400+i)+'"><rect width="100%" height="100%" fill="'+color+'"/></svg>');await w.close();}};
    window.dirOf=async path=>{let d=await navigator.storage.getDirectory();for(const part of path.split('/'))d=await d.getDirectoryHandle(part);return d;};
    window.records=()=>import('./store.mjs').then(({library})=>library('getAll'));
    window.byTitle=async t=>(await records()).find(b=>b.title===t);`);
  await js(`(async()=>{await mk('lib','Alpha',3,'red');await mk('lib','Beta',4,'blue');await mk('lib','Gamma',2,'green');
    const root=await dirOf('lib');window.showDirectoryPicker=async()=>root;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(async()=>(await js('records()')).length===3);
  // 封面缩略图在后台生成，只存压缩 WebP 与摘要。
  await wait(()=>js(`records().then(r=>r.every(b=>b.fp?.thumb&&b.fp.cover.hash))`));
  assert.equal(await js(`import('./store.mjs').then(async({thumbs})=>(await thumbs('getAllKeys')).filter(k=>k.endsWith(':cover')).length)`),3);
  assert.equal(await js(`import('./store.mjs').then(async({thumbs})=>(await thumbs('getAll'))[0].blob.type)`),'image/webp');
  const open=async()=>{await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));};
  const count=v=>js(`document.querySelector('[data-view="${v}"] .count').textContent`);
  const cards=()=>js(`[...document.querySelectorAll('#books .book .pick')].map(x=>x.getAttribute('aria-label')).sort()`);
  await open();await wait(async()=>(await cards()).length===3);assert.equal(await count('shelf'),'3');
  assert.ok(await js(`new Set([...document.querySelectorAll('#books .book')].map(b=>b.style.translate.split(' ')[0])).size>=2`),'Masonry columns');
  await wait(()=>js(`document.querySelectorAll('#books .cover.ready img').length===3`));
  // 标签：添加、按 #标签 搜索、标签栏筛选。
  await js(`[...document.querySelectorAll('#books .book')].find(x=>x.querySelector('.pick').getAttribute('aria-label')==='Alpha').querySelector('[aria-label="编辑标签"]').click()`);
  await wait(()=>js('tagEditor.open'));
  await js(`tagInput.value='动作, 热血';tagForm.requestSubmit()`);
  await wait(async()=>JSON.stringify((await js(`byTitle('Alpha')`)).tags)==='["动作","热血"]');
  await js('tagEditor.close()');
  await js(`query.value='#动';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>JSON.stringify(await cards())==='["Alpha"]');
  await js(`filters.reset()`);await wait(async()=>(await cards()).length===3);
  await js(`[...tagBar.querySelectorAll('button.tag')].find(x=>x.textContent.startsWith('热血')).click()`);await wait(async()=>JSON.stringify(await cards())==='["Alpha"]');
  assert.equal(await js('filterSummary.hidden'),false,'Active tag filter is shown while the filter panel is closed');
  await js(`filterSummary.querySelector('.link-btn').click()`);await wait(async()=>(await cards()).length===3);assert.equal(await js('filterSummary.hidden'),true);
  // 批量移动：把筛选结果移入书库。
  await js(`query.value='beta';query.dispatchEvent(new Event('input',{bubbles:true}))`);await wait(async()=>JSON.stringify(await cards())==='["Beta"]');
  await js(`[...bulkActions.querySelectorAll('button')].find(b=>b.textContent.startsWith('全部移入书库')).click()`);await wait(async()=>(await js(`byTitle('Beta')`)).place==='library');
  await js(`filters.reset()`);await wait(async()=>(await count('shelf'))==='2'&&(await count('library'))==='1');
  await js(`document.querySelector('[data-view="all"]').click()`);await wait(async()=>(await cards()).length===3);
  await js('shelf.close()');
  // 迁移：文件夹被移动（Gamma 还被改名），原位置删除后变为过期书，记录与标签保留。
  await js(`(async()=>{await mk('moved','Alpha',3,'red');await mk('moved','Gamma2',2,'green');await (await navigator.storage.getDirectory()).removeEntry('lib',{recursive:true});})()`);
  await js(`document.querySelector('#bar [data-act="refresh"]').click()`);await wait(()=>js(`!document.querySelector('#bar [data-act="refresh"]').disabled`));
  assert.equal((await js('records()')).length,3);
  await open();await wait(async()=>(await count('expired'))==='3');assert.equal(await count('shelf'),'');
  await js(`document.querySelector('[data-view="expired"]').click()`);await wait(async()=>(await cards()).length===3);
  await wait(()=>js(`document.querySelectorAll('#books .book.expired .cover img').length===3`)); // 过期书仍显示缓存的封面
  // 批量恢复：同名同封面自动恢复；改名但封面相同的进入确认列表。
  await js(`(async()=>{const d=await dirOf('moved');window.showDirectoryPicker=async()=>d;[...bulkActions.querySelectorAll('button')].find(b=>b.textContent==='批量恢复…').click();})()`);
  await wait(()=>js('restore.open'));
  assert.equal(await js(`restoreList.querySelectorAll('.match').length`),1);assert.equal(await js(`restoreList.querySelector('input').checked`),true);
  await js('restoreGo.click()');
  await wait(async()=>(await js(`byTitle('Gamma2')`))?.missing===undefined&&(await count('expired'))==='1');
  const alpha=await js(`byTitle('Alpha')`);assert.deepEqual(alpha.tags,['动作','热血']);assert.equal(alpha.path,'moved/Alpha');
  await js('shelf.close()');
  // 重新打开文件夹：同名同封面的过期书接回原记录，不产生重复条目，并回到书架。
  await js(`(async()=>{await mk('again','Beta',4,'blue');const d=await dirOf('again');window.showDirectoryPicker=async()=>d;document.querySelector('#bar [data-act="folder"]').click();})()`);
  await wait(async()=>{const b=await js(`byTitle('Beta')`);return b.path==='again/Beta'&&b.place==='shelf';});
  assert.equal((await js('records()')).length,3);
  // 单本恢复：内容不符时可以强制恢复。
  await js(`(async()=>{await (await navigator.storage.getDirectory()).removeEntry('again',{recursive:true});})()`);
  await js(`document.querySelector('#bar [data-act="refresh"]').click()`);await wait(()=>js(`!document.querySelector('#bar [data-act="refresh"]').disabled`));
  await open();await js(`document.querySelector('[data-view="expired"]').click()`);await wait(async()=>JSON.stringify(await cards())==='["Beta"]');
  await js(`(async()=>{await mk('other','Zeta',5,'purple');const d=await dirOf('other/Zeta');window.showDirectoryPicker=async()=>d;document.querySelector('#books .pick').click();})()`);
  await wait(()=>js('restore.open'));assert.equal(await js('restoreGo.textContent'),'强制恢复');
  await js('restoreGo.click()');
  await wait(async()=>{const r=await js('records()');return r.length===3&&r.some(b=>b.title==='Zeta'&&b.place==='shelf'&&!b.missing);});
  await wait(async()=>(await count('shelf'))==='3');assert.ok(await js(`document.querySelector('[data-view="expired"]').hidden`));
  assert.deepEqual(errors,[]);console.log('PASS: cover thumbnails, masonry, tags, tag search, bulk move, missing books, batch restore, auto relink, forced restore');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
