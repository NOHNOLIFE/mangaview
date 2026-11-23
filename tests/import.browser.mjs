// 导入为单个作品（一本书对应多个文件夹）、按源刷新与恢复、拖入覆盖层。用独立临时配置和 OPFS 测试数据。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
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
  // 造书：每卷的图片颜色不同，封面摘要因此不同。
  const shot=async name=>{if(process.env.MV_SHOTS)await writeFile(join(process.env.MV_SHOTS,name+'.png'),Buffer.from((await cdp('Page.captureScreenshot')).data,'base64'));};
  const reload=async()=>{await js('window.__old=1');await cdp('Page.reload');await wait(()=>js('!window.__old&&document.readyState==="complete"'));await js(helpers);};
  const helpers=`window.mk=async(root,name,n,color)=>{let d=await navigator.storage.getDirectory();for(const part of root.split('/'))d=await d.getDirectoryHandle(part,{create:true});d=await d.getDirectoryHandle(name,{create:true});
    for(let i=1;i<=n;i++){const w=await (await d.getFileHandle(i+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="'+(400+i)+'"><rect width="100%" height="100%" fill="'+color+'"/></svg>');await w.close();}};
    window.dirOf=async path=>{let d=await navigator.storage.getDirectory();for(const part of path.split('/'))d=await d.getDirectoryHandle(part);return d;};
    window.rm=async path=>{const parts=path.split('/'),name=parts.pop();const d=parts.length?await dirOf(parts.join('/')):await navigator.storage.getDirectory();await d.removeEntry(name,{recursive:true});};
    window.records=()=>import('./store.mjs').then(({library})=>library('getAll'));
    window.byTitle=async t=>(await records()).find(b=>b.title===t);
    window.merged=async()=>(await records()).find(b=>b.title==='s'&&b.sources?.some(s=>s.key));`;
  await js(helpers);
  await js(`(async()=>{await mk('s','Vol 1',3,'red');await mk('s','Vol 2',2,'blue');await mk('s','Vol 10',2,'green');})()`);
  const open=async()=>{if(!await js('shelf.open'))await js(`document.querySelector('#bar [data-act="shelf"]').click()`);await wait(()=>js('shelf.open'));};
  const pick=(path,act)=>js(`(async()=>{const d=await dirOf(${JSON.stringify(path)});window.showDirectoryPicker=async()=>d;document.querySelector('#shelf [data-act="${act}"]').click();})()`);
  const count=v=>js(`document.querySelector('[data-view="${v}"] .count').textContent`);
  const refresh=async()=>{await js(`document.querySelector('#shelf [data-act="refresh"]').click()`);await delay(50);await wait(()=>js(`!document.querySelector('#shelf [data-act="refresh"]').disabled`));};
  // 1. 书架页的「导入为单个作品」：所选文件夹下各卷合成一本，按卷再按文件名排序。
  await open();await pick('s','merge');
  await wait(async()=>(await js('records()')).length===1);
  let m=await js('merged()');
  assert.equal(m.title,'s');assert.deepEqual(m.sources.map(s=>s.key),['Vol 1','Vol 2','Vol 10']);
  assert.deepEqual(m.pages.map(p=>p.name),['Vol 1/1.svg','Vol 1/2.svg','Vol 1/3.svg','Vol 2/1.svg','Vol 2/2.svg','Vol 10/1.svg','Vol 10/2.svg']);
  await wait(()=>js(`notice.textContent.includes('已合成一本：s（3 个文件夹）')`));
  await wait(()=>js(`!!document.querySelector('#reader [data-name="Vol 1/1.svg"] img')`));
  // 2. 同一个文件夹也可以单独导入为一本书，两者互不影响；书架页开着时不切换正在读的书。
  await pick('s/Vol 2','folder');
  await wait(async()=>(await js('records()')).length===2);
  await wait(()=>js(`notice.textContent.includes('已添加 1 本到书架')`));
  assert.equal(await js('bookTitle.textContent'),'s');
  // 3. 同一组文件夹再次导入为单个作品时更新原书；新加的一卷按顺序插入，书签按页名保留。
  await js(`(async()=>{const {library}=await import('./store.mjs');const b=await merged();b.bookmarks=[{id:'m1',name:'Vol 2/1.svg',f:.5,at:1}];await library('put',b);})()`);
  await reload();await wait(()=>js('bookTitle.textContent==="s"'));await open();
  await js(`mk('s','Vol 3',1,'yellow')`);await pick('s','merge');
  await wait(async()=>(await js('merged()')).sources.length===4);
  m=await js('merged()');assert.equal((await js('records()')).length,2);
  assert.deepEqual(m.pages.map(p=>p.name),['Vol 1/1.svg','Vol 1/2.svg','Vol 1/3.svg','Vol 2/1.svg','Vol 2/2.svg','Vol 3/1.svg','Vol 10/1.svg','Vol 10/2.svg']);
  assert.deepEqual(m.bookmarks.map(x=>x.name),['Vol 2/1.svg']);
  // 搜索也匹配合并作品各卷的文件夹名（刚加入的一卷同样可搜到，搜索文本缓存随源变化失效）。
  await js(`query.value='vol 3';query.dispatchEvent(new Event('input',{bubbles:true}))`);
  await wait(()=>js(`[...document.querySelectorAll('#books .book .name')].map(n=>n.textContent).join()==='s'`));
  await js(`filters.reset()`);await wait(()=>js(`document.querySelectorAll('#books .book').length===2`));
  // 4. 刷新以源为单位：共用的一卷新增图片后，两本书都更新。
  await js(`(async()=>{const d=await dirOf('s/Vol 2');const w=await (await d.getFileHandle('3.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="403"/>');await w.close();})()`);
  await refresh();
  await wait(async()=>(await js(`byTitle('Vol 2')`)).pages.length===3&&(await js('merged()')).pages.some(p=>p.name==='Vol 2/3.svg'));
  // 5. 部分卷找不到：书照常可读，缺失卷的页暂不显示（记录保留），卡片上有小提示；不算过期。
  await wait(()=>js(`merged().then(b=>b.sources.every(s=>s.fp?.hash))`)); // 每卷的封面摘要在后台计算
  await js(`rm('s/Vol 10')`);await refresh();
  await wait(async()=>{const b=await js('merged()');return b.pages.length===7&&b.parked?.length===2;});
  assert.equal(await count('expired'),'');
  await wait(()=>js(`!!document.querySelector('#books .book .part')`));
  assert.match(await js(`document.querySelector('#books .book .part').title`),/有 1 个文件夹暂时找不到/);
  // 卡片上的「恢复」：选到搬走的那一卷即接回，不新建书。
  await js(`mk('moved','Vol 10',2,'green')`);
  await js(`(async()=>{const d=await dirOf('moved');window.showDirectoryPicker=async()=>d;[...document.querySelectorAll('#books .book')].find(x=>x.querySelector('.part')).querySelector('[aria-label="恢复"]').click();})()`);
  await wait(async()=>{const b=await js('merged()');return b.pages.length===9&&!b.parked;});
  assert.equal((await js('records()')).length,2);assert.equal((await js('merged()')).sources.find(s=>s.key==='Vol 10').path,'moved/Vol 10');
  // 6. 全部找不到才过期；批量恢复时同一个文件夹同时接回单文件夹书和合并作品中的那一卷。
  await js(`(async()=>{await mk('m2','Vol 1',3,'red');await mk('m2','Vol 2',3,'blue');await mk('m2','Vol 3',1,'yellow');await mk('m2','Vol 10',2,'green');await rm('s');await rm('moved');})()`);
  await refresh();await wait(async()=>(await count('expired'))==='2');
  await js(`document.querySelector('[data-view="expired"]').click()`);
  await js(`(async()=>{const d=await dirOf('m2');window.showDirectoryPicker=async()=>d;restoreAllBtn.click();})()`);
  await wait(()=>js(`document.querySelector('[data-view="expired"]').hidden`));
  m=await js('merged()');assert.equal(m.pages.length,9);assert.ok(m.sources.every(s=>s.path.startsWith('m2/')));
  assert.equal((await js(`byTitle('Vol 2')`)).path,'m2/Vol 2');
  // 7. 拖入：书架页开着时覆盖层在顶层可见；当前是「书库」时改为导入到书库；拖到下方小区域则多个文件夹合成一本。
  await js(`document.querySelector('[data-view="library"]').click()`);
  await js(`(async()=>{await mk('drop','A',2,'gray');await mk('drop','B',2,'pink');await mk('drop','C',1,'navy');
    window.queue=[];DataTransferItem.prototype.getAsFileSystemHandle=function(){return Promise.resolve(window.queue.shift()??null);};
    window.drag=(type,x,y,n=1)=>{const dt=new DataTransfer();for(let i=0;i<n;i++)dt.items.add(new File(['x'],i+'.png',{type:'image/png'}));window.dispatchEvent(new DragEvent(type,{dataTransfer:dt,clientX:x,clientY:y,bubbles:true,cancelable:true}));};})()`);
  await js(`drag('dragenter',10,10)`);
  assert.ok(await js(`dropOverlay.matches(':popover-open')&&!dropOverlay.hidden`),'覆盖层进入顶层，书架对话框之上');
  assert.equal(await js('dropText.textContent'),'松开即可添加到书库');
  const zone=await js(`(()=>{const r=dropMerge.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`);
  await js(`drag('dragover',${zone[0]},${zone[1]})`);assert.ok(await js(`dropMerge.classList.contains('over')`));await shot('drop-over-shelf');
  await js(`(async()=>{window.queue=[await dirOf('drop/A'),await dirOf('drop/B')];drag('drop',${zone[0]},${zone[1]},2);})()`);
  await wait(async()=>(await js(`byTitle('A')`))?.sources?.length===2);
  const dropped=await js(`byTitle('A')`);assert.equal(dropped.place,'library');assert.deepEqual(dropped.sources.map(s=>s.key),['A','B']);
  assert.ok(await js('dropOverlay.hidden&&!dropOverlay.matches(":popover-open")'));
  await js(`drag('dragenter',10,10)`);await js(`(async()=>{window.queue=[await dirOf('drop/C')];drag('drop',10,10);})()`);
  await wait(async()=>(await js(`byTitle('C')`))?.place==='library');
  // 拖到「添加到散图图集」：拖入内容里的所有图（含文件夹里的，递归）都作为散图加入散图图集，不按文件夹建书；页名带相对路径，各文件夹的同名文件不冲突。
  assert.equal(await js(`document.querySelector('#shelf [data-act="files"]').title`),'添加到散图图集');
  await js(`mk('drop/A','deep',1,'olive')`);await js(`drag('dragenter',10,10)`);
  const areas=()=>js(`[dropOverlay.querySelector('.box'),dropMerge,dropLoose].map(e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom};})`);
  const stacked=(a,w,h)=>a[0].b<=a[1].t&&a[1].b<=a[2].t&&a.every(r=>r.l>=0&&r.t>=0&&r.r<=w&&r.b<=h);
  let rects=await areas();assert.ok(stacked(rects,await js('innerWidth'),await js('innerHeight')),'Default, merge and loose areas stack without overlapping: '+JSON.stringify(rects));
  assert.equal(await js('dropLoose.textContent'),'添加到散图图集拖到这里，所有图片（包括文件夹里的）都作为散图添加');
  const lzone=[(rects[2].l+rects[2].r)/2,(rects[2].t+rects[2].b)/2];
  await js(`drag('dragover',${lzone[0]},${lzone[1]})`);assert.ok(await js(`dropLoose.classList.contains('over')&&!dropMerge.classList.contains('over')`));await shot('drop-over-loose');
  await js(`drag('dragover',10,10)`);assert.ok(await js(`!dropLoose.classList.contains('over')&&!dropMerge.classList.contains('over')`),'Outside the two areas: default import');
  const total=(await js('records()')).length;
  await js(`(async()=>{window.queue=[await dirOf('drop/A'),await dirOf('drop/B')];drag('drop',${lzone[0]},${lzone[1]},2);})()`);
  const loose=await wait(async()=>(await js('records()')).find(b=>!b.title&&b.pages.some(p=>p.name==='A/deep/1.svg')));
  assert.deepEqual(loose.pages.map(p=>p.name),['A/1.svg','A/2.svg','A/deep/1.svg','B/1.svg','B/2.svg']);assert.equal(loose.place,'library');
  assert.equal((await js('records()')).length,total+1,'Only the loose album is added, no folder books');
  // 小窗口：三块区域都在窗口内、互不重叠。
  await cdp('Emulation.setDeviceMetricsOverride',{width:360,height:480,deviceScaleFactor:1,mobile:false});await wait(()=>js('innerWidth===360'));
  await js(`drag('dragenter',10,10)`);await delay(250);rects=await areas();await shot('drop-small');assert.ok(stacked(rects,360,480),'Fits a small window: '+JSON.stringify(rects));
  await js(`drag('dragleave',10,10)`);await cdp('Emulation.clearDeviceMetricsOverride');
  await js('shelf.close()');await js(`drag('dragenter',10,10)`);assert.equal(await js('dropText.textContent'),'松开即可添加到书架');await js(`drag('dragleave',10,10)`);
  assert.ok(await js('dropOverlay.hidden'));
  // 8. 旧版记录（单个 dir / title / path）和损坏的记录：载入时归一化，不报错、不白屏。
  await js(`(async()=>{const {library}=await import('./store.mjs');
    await library('put',{id:'legacy',title:'Vol 1',dir:await dirOf('m2/Vol 1'),path:'old/Vol 1',pages:[{name:'1.svg',w:300,h:401},{name:'2.svg'},{name:'3.svg'}],sortOverride:null,place:'shelf',tags:['old'],bookmarks:[{id:'b',name:'2.svg',f:0,at:1}],added:1});
    await library('put',{id:'broken',title:'Broken',pages:'oops',sources:'bad',parked:5,roots:7,added:2});
    localStorage.setItem('mv2:last',JSON.stringify('legacy'));})()`);
  await reload();
  await wait(()=>js(`bookTitle.textContent==='Vol 1'&&!!document.querySelector('#reader [data-name="1.svg"] img')`));
  await open();await wait(async()=>(await count('expired'))==='1');
  // 9. 合并作品一卷都认不出时可强制恢复：按所选文件夹重建，记录本身（标签等）保留。
  await js(`(async()=>{await rm('m2');await mk('m3/Z','P',2,'olive');await mk('m3/Z','Q',1,'teal');})()`);
  await refresh();await js(`document.querySelector('[data-view="expired"]').click()`);
  await wait(()=>js(`!!document.querySelector('#books .book.expired .pick[aria-label="s"]')`));
  await js(`(async()=>{const d=await dirOf('m3/Z');window.showDirectoryPicker=async()=>d;document.querySelector('#books .book.expired .pick[aria-label="s"]').click();})()`);
  await wait(()=>js('restore.open'));assert.equal(await js('restoreGo.textContent'),'强制恢复');
  await js('restoreGo.click()');
  await wait(async()=>{const b=await js('merged()');return b.sources.map(s=>s.key).join()==='P,Q'&&b.pages.length===3;});
  assert.equal((await js('merged()')).title,'s');
  const card=name=>`document.querySelector('#books .book .pick[aria-label=${JSON.stringify(name)}]')`;
  const restoreCard=(name,path)=>js(`(async()=>{const d=await dirOf(${JSON.stringify(path)});window.showDirectoryPicker=async()=>d;${card(name)}.closest('.book').querySelector('[aria-label="恢复"]').click();})()`);
  // 10. 阅读位置落在暂时缺失的卷里：正文退回书首，但保存的位置不被覆盖；卷找回后回到原处。缺失期间主动滚到别处阅读才保存新位置。
  await js(`(async()=>{await mk('r','R1',2,'red');await mk('r','R2',2,'blue');await mk('r','R3',2,'purple');})()`);
  await js(`document.querySelector('[data-view="all"]').click()`);await pick('r','merge');
  await wait(async()=>(await js(`byTitle('r')`))?.sources?.length===3);
  await wait(()=>js(`byTitle('r').then(b=>b.sources.every(s=>s.fp?.hash))`));
  const rid=(await js(`byTitle('r')`)).id,pos=()=>js(`JSON.parse(localStorage.getItem('mv2:pos:${rid}'))`);
  await wait(()=>js(`!!${card('r')}`));await js(`${card('r')}.click()`);
  await wait(()=>js(`!shelf.open&&bookTitle.textContent==='r'&&!!document.querySelector('#reader [data-name="R1/1.svg"] img')`));
  await js('reader.scrollTop=reader.scrollHeight');await wait(async()=>(await pos())?.name?.startsWith('R3/'));
  const inR3=(await pos()).name;
  const barRefresh=async()=>{await js(`document.querySelector('#bar [data-act="refresh"]').click()`);await delay(50);await wait(()=>js(`!document.querySelector('#bar [data-act="refresh"]').disabled`));};
  await js(`rm('r/R3')`);await barRefresh();await wait(async()=>(await js(`byTitle('r')`)).parked?.length===2);
  await delay(600);assert.equal((await pos())?.name,inR3,'缺失卷里的阅读位置不被覆盖');
  // 直接打开这类书（先切到别的书再切回来）：同样不覆盖。
  await open();await wait(()=>js(`!!${card('A')}`));await js(`${card('A')}.click()`);await wait(()=>js(`!shelf.open&&bookTitle.textContent==='A'`));
  await js('reader.scrollTop=200');await delay(300);
  await open();await wait(()=>js(`!!${card('r')}`));await js(`${card('r')}.click()`);await wait(()=>js(`!shelf.open&&bookTitle.textContent==='r'`));
  await delay(600);assert.equal((await pos())?.name,inR3,'重新打开时不覆盖');
  await js(`mk('r','R3',2,'purple')`);await barRefresh();await wait(async()=>{const b=await js(`byTitle('r')`);return !b.parked&&b.pages.length===6;});
  await wait(()=>js('reader.scrollTop>0'));await delay(600);assert.equal((await pos())?.name,inR3,'卷找回后回到原位置');
  await js(`rm('r/R3')`);await barRefresh();await wait(async()=>(await js(`byTitle('r')`)).parked?.length===2);
  await js('reader.scrollTop=300');await wait(async()=>{const p=await pos();return !!p&&!p.name.startsWith('R3/');}); // 主动阅读别处：保存新位置
  // 11. 部分卷缺失时「恢复」选了对不上的文件夹：只缺一卷时可强制接到这一卷，其他卷不动；缺多卷时提示没有匹配，不重建整本书。
  await open();await js(`mk('junk','J',1,'black')`);await wait(()=>js(`!!${card('r')}?.closest('.book').querySelector('.part')`));
  await restoreCard('r','junk');await wait(()=>js('restore.open'));
  assert.equal(await js('restoreGo.textContent'),'强制接到这一卷');await js('restoreGo.click()');
  await wait(async()=>{const b=await js(`byTitle('r')`);return !b.parked&&b.sources.find(s=>s.key==='R3').path==='junk/J';});
  let rb=await js(`byTitle('r')`);assert.deepEqual(rb.sources.map(s=>s.key),['R1','R2','R3']);
  assert.deepEqual(rb.pages.map(p=>p.name).sort(),['R1/1.svg','R1/2.svg','R2/1.svg','R2/2.svg','R3/1.svg']);
  await js(`(async()=>{await rm('r/R2');await rm('junk');await mk('other2','X',1,'gray');})()`);await refresh();
  await wait(async()=>(await js(`byTitle('r')`)).parked?.length===3);
  await js('notice.textContent=""');await restoreCard('r','other2');
  await wait(()=>js(`notice.textContent==='没有找到匹配的文件夹'`));assert.equal(await js('restore.open'),false);
  rb=await js(`byTitle('r')`);assert.deepEqual(rb.sources.map(s=>s.key),['R1','R2','R3']);assert.equal(rb.pages.length+rb.parked.length,5);
  // 12. 重建时先按目录句柄配对卷，再按 key：根文件夹自己也放进图片后，它按名称得到的 key 与原有一卷相同，原卷不会被接到根文件夹的内容上。
  await js(`(async()=>{await mk('q9','q9',2,'teal');await mk('q9','r9',2,'navy');})()`);await pick('q9','merge');
  await wait(async()=>(await js(`byTitle('q9')`))?.sources?.length===2);
  assert.deepEqual((await js(`byTitle('q9')`)).sources.map(s=>s.key),['q9','r9']);
  await js(`(async()=>{const w=await (await (await dirOf('q9')).getFileHandle('1.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500"><rect width="100%" height="100%" fill="gold"/></svg>');await w.close();})()`);
  await pick('q9','merge');await wait(async()=>(await js(`byTitle('q9')`)).sources.length===3);
  const q9=await js(`byTitle('q9')`);assert.equal(q9.sources.find(s=>s.key==='q9').path,'q9/q9');assert.equal(q9.sources.find(s=>s.path==='q9').key,'q9 (2)');
  assert.equal((await js('records()')).filter(b=>b.title==='q9').length,1);
  // 13. 再次导入为单个作品时有的源没有目录句柄：回退模式（无 File System Access）按相对路径找到原书，不报错、不重复，重新载入后再导入页面可读；
  // 备份导入后尚未接回的卷同样按相对路径对上。
  const fallback=`window.fallbackMerge=async()=>{delete window.showDirectoryPicker;document.querySelector('#shelf [data-act="merge"]').click();await new Promise(r=>setTimeout(r,50));
    const files=['fb/X/1.svg','fb/X/2.svg','fb/Y/1.svg'].map(p=>{const f=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"/>'],p.split('/').pop(),{type:'image/svg+xml'});Object.defineProperty(f,'webkitRelativePath',{value:p});return f;});
    notice.textContent='';folderInput.onchange({target:{files}});};`;
  const fb=()=>js('records()').then(r=>r.filter(b=>b.title==='fb'));
  await js(fallback);await js('fallbackMerge()');await wait(async()=>(await fb()).length===1);
  await wait(()=>js(`notice.textContent.includes('已合成一本：fb')`));
  await js('fallbackMerge()');await wait(()=>js(`notice.textContent.includes('已合成一本：fb')`));assert.equal((await fb()).length,1);
  await reload();await js(fallback);await open();await wait(()=>js(`!!document.querySelector('#books .book.expired .pick[aria-label="fb"]')||document.querySelector('[data-view="expired"] .count').textContent!==''`));
  await js('fallbackMerge()');await wait(()=>js(`notice.textContent.includes('已合成一本：fb')`));assert.equal((await fb()).length,1);
  await js(`document.querySelector('[data-view="all"]').click()`);await wait(()=>js(`!!${card('fb')}`));
  assert.deepEqual((await fb())[0].sources.map(s=>s.key),['X','Y']);
  await js(`(async()=>{await mk('t','P',2,'red');await mk('t','Q',2,'blue');})()`);await pick('t','merge');
  await wait(async()=>(await js(`byTitle('t')`))?.sources?.every(s=>s.fp?.hash));
  await js(`(async()=>{const {library}=await import('./store.mjs');const b=await byTitle('t');delete b.roots;const s=b.sources.find(s=>s.key==='Q');delete s.dir;s.fp={name:'1.svg',size:1,hash:'bogus:1'};await library('put',b);})()`);
  await reload();await open();await pick('t','merge');await wait(()=>js(`notice.textContent.includes('已合成一本：t')`));
  assert.equal((await js('records()')).filter(b=>b.title==='t').length,1);
  assert.equal(await js(`byTitle('t').then(b=>b.sources.map(s=>s.key+':'+!!s.dir).join())`),'P:true,Q:true');
  // 14. 没有任何目录句柄的合并作品点「重新授权」：按卷匹配所选文件夹，不默认绑到第一卷。
  await js(`(async()=>{await mk('u','U1',2,'red');await mk('u','U2',3,'blue');})()`);await pick('u','merge');
  await wait(async()=>(await js(`byTitle('u')`))?.sources?.every(s=>s.fp?.hash));
  await js(`(async()=>{const {library}=await import('./store.mjs');const b=await byTitle('u');delete b.roots;for(const s of b.sources)delete s.dir;await library('put',b);localStorage.setItem('mv2:last',JSON.stringify(b.id));})()`);
  await reload();await wait(()=>js(`bookTitle.textContent==='u'`));
  await js(`(async()=>{const d=await dirOf('u/U2');window.showDirectoryPicker=async()=>d;document.querySelector('[data-act="allow"]').click();})()`);
  await wait(()=>js(`byTitle('u').then(b=>b.sources.map(s=>s.key+':'+!!s.dir).join()==='U1:false,U2:true')`));
  assert.equal((await js(`byTitle('u')`)).sources[1].path,'U2');
  // 15. 过期的散图书（没有源）可以恢复：接到所选文件夹，成为单文件夹书，标签和书签保留。
  await js(`(async()=>{const {library}=await import('./store.mjs');await mk('lz','L',2,'orange');
    await library('put',{id:'loose',title:null,pages:[{name:'1.svg'},{name:'2.svg'}],sortOverride:null,place:'shelf',tags:['scraps'],bookmarks:[{id:'lb',name:'2.svg',f:0,at:1}],added:3});})()`);
  await reload();await open();await js(`document.querySelector('[data-view="expired"]').click()`);
  await wait(()=>js(`!!document.querySelector('#books .book.expired .pick[aria-label="散图图集"]')`));
  await js(`(async()=>{const d=await dirOf('lz/L');window.showDirectoryPicker=async()=>d;document.querySelector('#books .book.expired .pick[aria-label="散图图集"]').click();})()`);
  await wait(()=>js('restore.open'));assert.equal(await js('restoreGo.textContent'),'强制恢复');await js('restoreGo.click()');
  await wait(async()=>(await js('records()')).find(b=>b.id==='loose')?.title==='L');
  const lz=(await js('records()')).find(b=>b.id==='loose');
  assert.deepEqual(lz.sources.map(s=>[s.key,s.title]),[['','L']]);assert.equal(lz.path,'L');assert.equal(lz.pages.length,2);
  assert.deepEqual(lz.tags,['scraps']);assert.deepEqual(lz.bookmarks.map(m=>m.id),['lb']);
  assert.equal(await js(`!!document.querySelector('#books .book.expired .pick[aria-label="L"]')`),false);
  assert.deepEqual(errors,[]);console.log('PASS: import as one book, shared folders, re-import update, per-source refresh, partial missing, per-volume restore, batch restore to several books, drop overlay over dialog, import to library, add to the loose album by drop (recursive, no overlapping areas, small window), legacy records, forced rebuild, position kept in a missing volume, partial-missing restore, handle-first rebuild, re-import without handles, merged allow, loose restore');
}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
