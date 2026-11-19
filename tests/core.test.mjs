import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detect,translate} from '../lang.mjs';
import {natural,shuffled,offsets,at,point,sortedPages,sortMode,folderSort,needsSort} from '../model.mjs';
import {grade,assign,coverName,hue,norm} from '../match.mjs';
import {fileGroups,scan,reconnect,source,readMissingTimes} from '../sources.mjs';

test('语言按偏好顺序匹配地区变体，否则显示英文',()=>{
  for(const [list,want] of [[['fr-CA','zh-Hant-TW','en'],'zh'],[['ko-KR'],'ko'],[['ja-JP'],'ja'],[['en-US','zh'],'en'],[['fr','de'],'en'],[[],'en']])assert.equal(detect(list),want);
});
test('所有静态界面标签均有四种离线翻译',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const [,key] of html.matchAll(/data-(?:t|label|aria|placeholder)="([^"]+)"/g))for(const lang of ['en','zh','ja','ko'])assert.ok(translate(key,lang));
});
test('页面标题与离线缓存使用同一版本号',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const version=html.match(/<title>MangaView v([\d.]+)<\/title>/)?.[1];
  assert.ok(version);assert.equal(sw.match(/cacheName\s*=\s*prefix\s*\+\s*'([^']+)'/)?.[1],version);
});
test('混合宽度和超长图按同一张图的相对高度定位，而不是按整本比例',()=>{
  const pages=[{w:500,h:500},{w:1000,h:20000},{w:500,h:500}];
  const body=offsets(pages,850,false),nav=offsets(pages,100,true),hit=at(nav,1500);
  assert.deepEqual(hit,{i:1,f:.7});assert.equal(point(body,hit),12400);assert.deepEqual(at(body,12400),hit);
  assert.deepEqual(at(body,body.at(-1)),{i:2,f:1});
});
test('排序不会漏图、重复或修改原序列',()=>{
  const a=['10.png','1.png','2.png'].sort(natural);assert.deepEqual(a,['1.png','2.png','10.png']);
  const b=shuffled(a);assert.notDeepEqual(a,b);assert.deepEqual([...b].sort(natural),a);
  assert.deepEqual(shuffled([]),[]);
});
test('旧书保留乱序；文件名和修改时间可反向，未知时间始终在末尾',()=>{
  assert.equal(sortMode({random:true}),'shuffle');
  assert.equal(sortMode({}),'nameAsc');
  const pages=[{name:'10',lastModified:5},{name:'2',lastModified:5},{name:'1'},{name:'3',lastModified:0}];
  const names=mode=>sortedPages(pages,mode).map(p=>p.name);
  assert.deepEqual(names('nameAsc'),['1','2','3','10']);
  assert.deepEqual(names('nameDesc'),['10','3','2','1']);
  assert.deepEqual(names('timeAsc'),['3','2','10','1']);
  assert.deepEqual(names('timeDesc'),['2','10','3','1']);
});
test('默认和单书偏好独立；历史乱序不因升级或重开而重洗',()=>{
  const defaults={mode:'shuffle',revision:'one'};
  assert.equal(folderSort({}),null);
  assert.equal(folderSort({random:true}),'shuffle');
  assert.equal(folderSort({sortMode:'timeDesc'}),'timeDesc');
  assert.equal(needsSort({sortMode:'timeDesc'},defaults),false);
  assert.equal(needsSort({random:true},defaults),false);
  const inherited={sortOverride:null,sortMode:'shuffle',shuffleRevision:'one'};
  assert.equal(needsSort(inherited,defaults),false);
  assert.equal(needsSort(inherited,{...defaults,revision:'two'}),true);
  assert.equal(needsSort(inherited,{mode:'nameDesc'}),true);
  assert.equal(needsSort({...inherited,sortOverride:'shuffle'},{mode:'nameDesc'}),false);
});
test('时间元数据按需读取并复用，失败的文件不丢失，过期请求不写回',async()=>{
  let reads=0;
  const [book]=fileGroups([new File(['x'],'1.png',{lastModified:0})]);
  book.pages.push({name:'2.png',handle:{async getFile(){reads++;return {lastModified:7};}}},{name:'gone.jpg'});
  await readMissingTimes(book,()=>true);await readMissingTimes(book,()=>true);
  assert.deepEqual(book.pages.map(p=>p.lastModified),[0,7,undefined]);assert.equal(reads,1);
  let active=true;
  const page={handle:{async getFile(){active=false;return {lastModified:9};}}};
  await readMissingTimes({pages:[page]},()=>active);assert.equal(page.lastModified,undefined);
});
test('目录扫描无需读图，嵌套同名目录不会合并',async()=>{
  const pic={name:'2.jpg',kind:'file',getFile(){throw Error('unexpected read');}};
  const dir=(name,entries)=>({name,kind:'directory',async *values(){yield* entries;}});
  const books=await Array.fromAsync(scan(dir('root',[dir('a',[dir('same',[pic])]),dir('b',[dir('same',[pic])])])));
  assert.deepEqual(books.map(x=>x.title),['same','same']);assert.notEqual(books[0].dir,books[1].dir);
});
test('无句柄的散图不复制进历史；重新定位不删除未匹配图',async()=>{
  const f=new File(['x'],'comic.png',{type:'image/png'}),[group]=fileGroups([f]);
  const book=structuredClone(group);await assert.rejects(source(book,book.pages[0]),{name:'NotFoundError'});
  book.pages.unshift({name:'missing.jpg'});assert.equal(reconnect(book,group),1);
  assert.equal(await source(book,book.pages[1]),f);assert.equal(book.pages.length,2);
});
test('过期书匹配：同名同封面自动恢复，改名或换封面需确认，一个文件夹只配一本书',()=>{
  const book=(title,hash,names=['1.jpg','2.jpg'])=>({title,pages:names.map(name=>({name})),fp:hash&&{cover:{hash}}});
  const cand=(title,hash,names=['1.jpg','2.jpg'])=>({title,hash,names});
  assert.equal(grade(book('Ａlpha  Book','h1'),cand('alpha book','h1')).level,2);
  assert.equal(grade(book('A','h1'),cand('B','h1')).level,1);
  assert.equal(grade(book('A','h1'),cand('A','h2')).level,1);
  assert.equal(grade(book('A',null),cand('A',null)).level,2);
  assert.equal(grade(book('A',null,['1.jpg']),cand('A',null,['9.jpg'])).level,1);
  assert.equal(grade(book('A','h1'),cand('B','h2')).level,0);
  const b1=book('A','h1'),b2=book('A','h2'),c1=cand('A','h1');
  const out=assign([{book:b2,cand:c1,...grade(b2,c1)},{book:b1,cand:c1,...grade(b1,c1)}]);
  assert.equal(out.length,1);assert.equal(out[0].book,b1);
  assert.equal(coverName(['10.jpg','2.jpg','b.png']),'2.jpg');
  assert.equal(hue('热血'),hue(' 热血 '));assert.equal(norm('ＡＢ  c'),'ab c');
});
