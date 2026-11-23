// 设置面板与数据导入 / 导出的端到端测试：独立临时配置 + OPFS 测试数据；另一个源（localhost）模拟“新的空配置”。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const binary=process.argv[2];if(!binary)throw Error('Usage: node tests/settings.browser.mjs <chrome-or-edge-executable>');
const profile=await mkdtemp(join(process.env.MV_TEST_TEMP||tmpdir(),'mv-settings-'));
const mime={mjs:'text/javascript',js:'text/javascript',html:'text/html',webmanifest:'application/manifest+json',png:'image/png',css:'text/css'};
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(path==='blank'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>blank</title>');return;} // 不运行应用的同源空白页
  if(!/^(?:icons\/)?[\w.-]+$/.test(path))throw Error();
  const data=await readFile(new URL('../'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':mime[path.split('.').pop()],'Cache-Control':'no-cache'});res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port,origin='http://127.0.0.1:'+port+'/',other='http://localhost:'+port+'/';
const chrome=spawn(binary,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--window-size=900,900','about:blank'],{stdio:'ignore'});
let ws,id=0,js;const pending=new Map(),errors=[],logs=[];
async function wait(check){let last;for(let i=0;i<150;i++){try{last=await check();if(last)return last;}catch(e){last=e;}await delay(75);}throw Error('Timed out: '+check+'; last: '+last);}
try{
  const devPort=await wait(async()=>(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  const target=(await (await fetch('http://127.0.0.1:'+devPort+'/json/list')).json()).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}
    if(m.method==='Runtime.consoleAPICalled')logs.push(m.params.args.map(x=>x.value??x.description).join(' '));
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const shot=async name=>{if(process.env.MV_SHOTS)await writeFile(join(process.env.MV_SHOTS,name+'.png'),Buffer.from((await cdp('Page.captureScreenshot')).data,'base64'));};
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'languages',{value:['en-US']});`});
  const go=async(url,ready='!!document.getElementById("settings")')=>{await cdp('Page.navigate',{url});await wait(()=>js(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&${ready}`));};
  const store=`import('./store.mjs')`;
  // 设置面板由工具栏的 data-act="settings" 按钮打开；这里临时放一个同样的按钮。
  const openSettings=async()=>{await js(`(()=>{const b=document.createElement('button');b.dataset.act='settings';document.body.append(b);b.click();b.remove();})()`);return wait(()=>js('settings.open'));};
  const headings=()=>js(`[settings.querySelector('h2').textContent,...[...settings.querySelectorAll('h3')].map(h=>h.textContent)]`);
  const sw=key=>js(`settings.querySelector('[data-id="${key}"] [role=switch]').getAttribute('aria-checked')`);

  // 1. 造两本书：lib/Alpha、lib/Beta。
  await go(origin,'document.querySelector("#empty")?.hidden===false');
  await js(`(async()=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('lib',{create:true});
    for(const [name,n] of [['Alpha',3],['Beta',2]]){const d=await root.getDirectoryHandle(name,{create:true});
      for(let i=0;i<n;i++){const w=await (await d.getFileHandle(i+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="100%" height="100%" fill="teal"/></svg>');await w.close();}}
    window.showDirectoryPicker=async()=>root;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(()=>js(`${store}.then(async m=>(await m.library('getAll')).length===2)`));
  // 在不运行应用的同源页面里补标签、书签、缩略图和阅读位置，避免应用把内存中的旧记录写回。
  await go(origin+'blank','true');
  const [a,b]=await js(`(async()=>{const {library,thumbs}=await ${store};const all=await library('getAll');
    const a=all.find(x=>x.title==='Alpha'),b=all.find(x=>x.title==='Beta');
    a.tags=['action','color'];a.bookmarks=[{id:'m1',name:'1.svg',f:.5}];await library('put',a);b.tags=['drama'];await library('put',b);
    const c=new OffscreenCanvas(4,6);c.getContext('2d').fillRect(0,0,4,6);await thumbs('put',{blob:await c.convertToBlob({type:'image/png'}),w:4,h:6},a.id+':bm:m1');
    localStorage.setItem('mv2:last',JSON.stringify(a.id));localStorage.setItem('mv2:pos:'+b.id,JSON.stringify({name:'1.svg',f:.25}));localStorage.setItem('mv2:edgeRight','false');
    return [a.id,b.id];})()`);
  await go(origin);

  // 2. 设置面板：分节、语言切换、开关持久化。
  assert.equal(await openSettings(),true);
  assert.deepEqual(await headings(),['Settings','General','Reading','Toolbar','Data']);
  assert.match(await js(`settings.querySelector('[data-id=bakNote]').textContent`),/not the image files or folder access/);
  assert.equal(await sw('edgeRight'),'false');assert.equal(await sw('autoCheck'),'true');
  // 开关几何：滑块在轨道内垂直居中（偏差 ≤ 0.5px），关时左边距 = 开时右边距 = 上下边距；放大页面、改字号后同样成立。
  const knobs=()=>js(`[...settings.querySelectorAll('.set-switch')].map(s=>{const r=s.getBoundingClientRect(),k=s.querySelector('.knob').getBoundingClientRect();
    return {on:s.getAttribute('aria-checked')==='true',dy:Math.abs(k.top+k.height/2-(r.top+r.height/2)),side:s.getAttribute('aria-checked')==='true'?r.right-k.right:k.left-r.left,top:k.top-r.top,h:r.height,w:r.width};})`);
  const checkKnobs=async label=>{await wait(()=>js(`[...settings.querySelectorAll('.set-switch .knob')].every(k=>!k.getAnimations().length)`));const all=await knobs();
    assert.ok(all.some(k=>k.on)&&all.some(k=>!k.on),'Both states present');
    for(const k of all){assert.ok(k.dy<=.5,label+': knob is vertically centred '+JSON.stringify(k));assert.ok(Math.abs(k.side-k.top)<=.5,label+': side margin equals top margin '+JSON.stringify(k));assert.ok(k.h<k.w,label+': track is a pill '+JSON.stringify(k));}
    const sides=all.map(k=>k.side);assert.ok(Math.max(...sides)-Math.min(...sides)<=.5,label+': on / off margins are symmetric '+sides);};
  await checkKnobs('default');
  await js(`settings.style.fontSize='22px';settings.style.lineHeight='2.2'`);await checkKnobs('large font');await js(`settings.style.fontSize='';settings.style.lineHeight=''`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1.5,mobile:false});await checkKnobs('scale 1.5');await cdp('Emulation.clearDeviceMetricsOverride');
  await wait(()=>js(`/\\d+ books · \\d+ thumbnails/.test(settings.querySelector('[data-id=bakStorage]').textContent)&&/ of /.test(settings.querySelector('.bak-usage').textContent)`));
  await shot('settings-en');
  await js(`(()=>{const s=settings.querySelector('[data-id=lang] select');s.value='zh';s.dispatchEvent(new Event('change'));})()`);
  await wait(async()=>JSON.stringify(await headings())===JSON.stringify(['设置','常规','阅读','工具栏','数据']));
  assert.equal(await js('document.documentElement.lang'),'zh');assert.equal(await js(`localStorage.getItem('mv2:lang')`),'"zh"');
  assert.match(await js(`settings.querySelector('[data-id=bakNote]').textContent`),/不含图片原文件和文件夹访问权限/);
  await js(`settings.querySelector('[data-id=autoCheck] [role=switch]').click()`);
  await wait(async()=>await sw('autoCheck')==='false');assert.equal(await js(`localStorage.getItem('mv2:autoCheck')`),'false');
  await go(origin);await openSettings();
  assert.equal(await sw('autoCheck'),'false');assert.equal(await js(`settings.querySelector('[data-id=lang] select').value`),'zh');
  assert.deepEqual(await headings(),['设置','常规','阅读','工具栏','数据']);
  await shot('settings-zh');

  // 3. 导出：拦截 showSaveFilePicker，检查 JSON 结构且不含句柄。
  await js(`window.showSaveFilePicker=async o=>{window.savedName=o.suggestedName;return {createWritable:async()=>({write:async b=>{window.saved=b;},close:async()=>{window.savedDone=true;}})};};
    settings.querySelector('[data-id=bakExport] button').click()`);
  const text=await wait(()=>js('window.savedDone&&window.saved.text()'));const data=JSON.parse(text);
  assert.match(await js('savedName'),/^mangaview-backup-\d{8}\.json$/);
  assert.equal(data.app,'MangaView');assert.equal(data.format,2);assert.ok(!isNaN(Date.parse(data.exported)));
  assert.deepEqual(Object.keys(data),['app','format','exported','storage','books','thumbs']);
  assert.ok(Object.keys(data.storage).every(k=>k.startsWith('mv2:')));
  assert.equal(data.storage['mv2:pos:'+b],JSON.stringify({name:'1.svg',f:.25}));assert.equal(data.storage['mv2:autoCheck'],'false');
  assert.deepEqual(data.books.map(x=>x.title).sort(),['Alpha','Beta']);
  const keys=new Set();(function walk(v){if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){keys.add(k);walk(x);}})(data.books);
  for(const k of ['dir','handle','missing'])assert.ok(!keys.has(k),'导出不应包含 '+k);
  const alpha=data.books.find(x=>x.id===a);
  assert.deepEqual(alpha.tags,['action','color']);assert.deepEqual(alpha.bookmarks,[{id:'m1',name:'1.svg',f:.5}]);assert.deepEqual(alpha.pages.map(p=>p.name),['0.svg','1.svg','2.svg']);
  // 书架会在后台为书生成封面缩略图，这里只检查测试自己写入的书签缩略图。
  const mark=data.thumbs.find(x=>x.key===a+':bm:m1');assert.ok(mark);assert.equal(mark.type,'image/png');
  assert.deepEqual([mark.w,mark.h],[4,6]);assert.equal(Buffer.from(mark.data,'base64').subarray(1,4).toString(),'PNG');
  await wait(()=>js(`notice.textContent.includes('已导出 2 本书')`));

  // 4. 另一个源 = 新的空配置：预置一本同 id 的本机书和一本只在本机的书，然后合并导入。
  await go(other+'blank','true');
  const g=await js(`(async()=>{const {library}=await ${store};const g=crypto.randomUUID();
    await library('put',{id:${JSON.stringify(a)},title:'Alpha',pages:[{name:'0.svg'}],sortOverride:null,place:'library',tags:['local','action'],bookmarks:[{id:'m0',name:'0.svg',f:0},{id:'m1',name:'1.svg',f:.9}],added:1});
    await library('put',{id:g,title:'Gamma',pages:[{name:'x.svg'}],sortOverride:null,place:'shelf',tags:[],bookmarks:[],added:2});
    localStorage.setItem('mv2:last',JSON.stringify(g));localStorage.setItem('mv2:pos:'+${JSON.stringify(a)},JSON.stringify({name:'0.svg',f:.9}));
    localStorage.setItem('mv2:custom','1');localStorage.setItem('mv2:autoCheck','true');return g;})()`);
  await go(other);
  const importFile=async(content,button)=>{
    await js(`window.confirm=()=>{throw Error('confirm() should not be used');};window.before=1;
      window.showOpenFilePicker=async()=>[{getFile:async()=>new File([${JSON.stringify(content)}],'backup.json',{type:'application/json'})}];`);
    await openSettings();await js(`settings.querySelector('[data-id=bakImport] button').click()`);
  };
  await importFile(text);
  await wait(()=>js(`document.querySelector('dialog.bak-ask')?.open`));
  assert.match(await js(`document.querySelector('.bak-ask .bak-summary').textContent`),/2 books and \d+ thumbnails/);
  assert.match(await js(`document.querySelector('.bak-ask .bak-note').textContent`),/reconnect each folder/);
  await shot('import-ask');
  await js(`document.querySelector('.bak-ask .bak-actions .primary').click()`);
  await wait(()=>js('!window.before&&!!document.getElementById("settings")&&document.readyState==="complete"'));
  const state=()=>js(`(async()=>{const {library,thumbs}=await ${store};const books=(await library('getAll')).sort((x,y)=>x.title.localeCompare(y.title));
    const ls={};for(const k of Object.keys(localStorage))if(k.startsWith('mv2:'))ls[k]=localStorage.getItem(k);
    return {books:books.map(x=>({id:x.id,title:x.title,tags:x.tags,marks:x.bookmarks.map(m=>m.id),place:x.place,pages:x.pages.length,dir:!!x.dir})),thumbs:await thumbs('getAllKeys'),ls};})()`);
  let s=await state();
  assert.deepEqual(s.books.map(x=>x.title),['Alpha','Beta','Gamma']);
  const [A,B]=s.books;
  assert.deepEqual([...A.tags].sort(),['action','color','local']);assert.deepEqual(A.marks,['m0','m1']);assert.equal(A.place,'library');assert.equal(A.pages,1);
  assert.equal(B.id,b);assert.deepEqual(B.tags,['drama']);assert.equal(B.pages,2);assert.equal(B.dir,false);assert.equal(B.place,'shelf');
  assert.deepEqual(s.thumbs.filter(k=>k.includes(':bm:')),[a+':bm:m1']);
  assert.equal(s.ls['mv2:pos:'+a],JSON.stringify({name:'0.svg',f:.9}),'本机已有的阅读位置不被覆盖');
  assert.equal(s.ls['mv2:pos:'+b],JSON.stringify({name:'1.svg',f:.25}),'本机没有的阅读位置从备份写入');
  assert.equal(s.ls['mv2:last'],JSON.stringify(g),'mv2:last 不被导入覆盖');
  assert.equal(s.ls['mv2:autoCheck'],'false');assert.equal(s.ls['mv2:lang'],'"zh"');assert.equal(s.ls['mv2:custom'],'1');
  await wait(()=>js(`notice.textContent.includes('导入完成：新增 1 本，合并 1 本')`));

  // 5. 损坏或不是备份的文件：给出提示，数据不变。
  const snapshot=async()=>{const x=await state();delete x.ls['mv2:pos:'+g];delete x.ls['mv2:last'];return x;};
  const before=await snapshot();
  for(const [content,message] of [[text.slice(0,text.length/2),'文件已损坏或格式不正确'],['{"app":"Other","format":1}','这不是 MangaView 备份文件'],
    [JSON.stringify({...data,format:3}),'更新版本'],[JSON.stringify({...data,thumbs:[{key:'x:cover',data:'%%%'}]}),'文件已损坏或格式不正确'],[JSON.stringify({...data,books:[{title:'no id'}]}),'文件已损坏或格式不正确']]){
    await js('notice.textContent=""');await importFile(content);
    await wait(()=>js(`notice.textContent.includes(${JSON.stringify(message)})`));
    assert.equal(await js(`!!document.querySelector('dialog.bak-ask')`),false);assert.equal(await js('window.before'),1,'不应重新载入');
    assert.deepEqual(await snapshot(),before);await js('settings.close()');
  }

  // 6. 替换：需要二次确认；完成后只剩备份内容。
  await importFile(text);
  await wait(()=>js(`document.querySelector('dialog.bak-ask')?.open`));
  await js(`document.querySelector('.bak-ask .bak-actions .danger').click()`);
  await wait(()=>js(`!!document.querySelector('.bak-ask .bak-warn')`));
  assert.equal(await js(`document.querySelector('.bak-ask h2').textContent`),'替换全部数据？');
  await shot('import-replace');
  await js(`document.querySelector('.bak-ask .bak-actions button').click()`); // 返回
  await wait(()=>js(`!!document.querySelector('.bak-ask .bak-choice')`));
  assert.deepEqual(await state(),s,'返回不应修改数据');
  await js(`document.querySelector('.bak-ask .bak-actions .danger').click()`);await wait(()=>js(`!!document.querySelector('.bak-ask .bak-warn')`));
  await js(`document.querySelector('.bak-ask .bak-actions .danger').click()`);
  await wait(()=>js('!window.before&&!!document.getElementById("settings")&&document.readyState==="complete"'));
  s=await state();
  assert.deepEqual(s.books.map(x=>[x.id,x.title]).sort(),[[a,'Alpha'],[b,'Beta']].sort());
  assert.deepEqual(s.books.find(x=>x.id===a).tags,['action','color']);assert.deepEqual(s.books.find(x=>x.id===a).marks,['m1']);assert.equal(s.books.find(x=>x.id===a).place,'shelf');
  assert.deepEqual(s.thumbs.filter(k=>k.includes(':bm:')),[a+':bm:m1']);
  assert.equal(s.ls['mv2:custom'],undefined,'替换会清除旧键');assert.equal(s.ls['mv2:pos:'+g],undefined);
  for(const [k,v] of Object.entries(data.storage))if(k!=='mv2:last'&&k!=='mv2:pos:'+a)assert.equal(s.ls[k],v,k);
  await wait(()=>js(`notice.textContent.includes('导入完成：已恢复 2 本书')`));

  // 7. 还原默认设置：需确认；只清除设置和布局（偏好键），书籍、书签、标签、缩略图、阅读位置和未知键都保留；重新载入后提示。
  await js(`localStorage.setItem('mv2:fit','false');localStorage.setItem('mv2:shelfmarks','true');localStorage.setItem('mv2:width','300');localStorage.setItem('mv2:edgeTop','false');localStorage.setItem('mv2:custom','1')`);
  await go(other);await wait(()=>js(`document.body.classList.contains('shelfmarks')`));
  await openSettings();const resetBtn=`settings.querySelector('.set-foot button')`;
  assert.equal(await js(`${resetBtn}.textContent`),'还原默认设置');assert.match(await js(`settings.querySelector('.set-foot small').textContent`),/书籍、书签、标签和阅读进度不受影响/);
  await shot('settings-reset');
  const kept=await state();
  await js(`window.confirm=()=>false;${resetBtn}.click()`);await delay(300);assert.deepEqual(await state(),kept,'Cancel changes nothing');
  await js(`window.before=1;window.confirm=m=>(window.asked=m,true);${resetBtn}.click()`);
  await wait(()=>js('!window.before&&!!document.getElementById("settings")&&document.readyState==="complete"'));
  s=await state();
  assert.deepEqual(s.books,kept.books);assert.deepEqual(s.thumbs,kept.thumbs);
  const prefKeys=['lang','autoCheck','edgeRight','fit','shelfmarks','width','edgeTop'].map(k=>'mv2:'+k);
  for(const k of prefKeys)assert.equal(s.ls[k],undefined,k+' is reset');
  for(const [k,v] of Object.entries(kept.ls))if(!prefKeys.includes(k))assert.equal(s.ls[k],v,k+' is kept');
  assert.equal(await js('document.documentElement.lang'),'en');assert.equal(await js(`document.body.classList.contains('shelfmarks')`),false);
  await wait(()=>js(`notice.textContent==='Settings restored to defaults'`));
  await openSettings();assert.equal(await sw('autoCheck'),'true');assert.equal(await sw('edgeRight'),'true');assert.equal(await sw('edgeTop'),'true');
  assert.equal(await js(`settings.querySelector('[data-id=lang] select').value`),'');
  assert.deepEqual(errors,[]);console.log('PASS: settings panel, language switch, toggle persistence, export, merge import, replace import, invalid files, restore defaults');
}catch(e){console.error('page errors:',errors,'console:',logs,'notice:',await js('notice.textContent+" | "+location.href').catch(e=>e.message));throw e;}finally{
  if(ws?.readyState===1){ws.send(JSON.stringify({id:++id,method:'Browser.close'}));ws.close();}
  server.close();for(let i=0;i<30&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null)chrome.kill();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
