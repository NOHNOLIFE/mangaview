import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detect,translate} from '../lang.mjs';
import {natural,shuffled,offsets,at,point,sortedPages,sortMode,folderSort,needsSort,fileOf} from '../model.mjs';
import {grade,assign,coverName,hue,norm} from '../match.mjs';
import {fileGroups,scan,reconnect,source,readMissingTimes,mergeKeys,applyNames,settle,down,makePage,allPages,listDir} from '../sources.mjs';

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

test('合并作品：按卷再按文件名排序，各卷不交错；页名在整本书内唯一',()=>{
  const pages=[makePage('Vol 10','1.jpg'),makePage('Vol 2','10.jpg'),makePage('Vol 2','2.jpg'),makePage('Vol 1','1.jpg')];
  const rank=new Map([['Vol 1',0],['Vol 2',1],['Vol 10',2]]),r=p=>rank.get(p.src);
  assert.deepEqual(sortedPages(pages,'nameAsc',r).map(p=>p.name),['Vol 1/1.jpg','Vol 2/2.jpg','Vol 2/10.jpg','Vol 10/1.jpg']);
  assert.deepEqual(sortedPages(pages,'nameDesc',r).map(p=>p.name),['Vol 10/1.jpg','Vol 2/10.jpg','Vol 2/2.jpg','Vol 1/1.jpg']);
  assert.equal(fileOf(pages[0]),'1.jpg');assert.equal(fileOf({name:'a/b.jpg'}),'a/b.jpg');
});
test('导入为单个作品：key 为相对所选文件夹的路径，父文件夹自己的图在前，重名自动区分',()=>{
  const g=path=>({title:path.split('/').pop(),path,pages:[]});
  const keys=list=>mergeKeys(list.map(g)).map(x=>x.key);
  assert.deepEqual(keys(['S/Vol 10','S','S/Vol 2','S/Vol 2/extra']),['S','Vol 2','Vol 2/extra','Vol 10']);
  assert.deepEqual(keys(['A','B/x']),['A','B/x']);
  assert.deepEqual(keys(['A','A']),['A','A (2)']);
});
test('按源更新页表：保留尺寸，追加新图，去掉消失的图；部分源缺失时暂存其页，找回后放回',()=>{
  const book={sources:[{key:'a',dir:{}},{key:'b',dir:{}}],pages:[{...makePage('a','1.jpg'),w:5},makePage('a','2.jpg'),makePage('b','1.jpg')]};
  assert.deepEqual(applyNames(book,book.sources[0],['1.jpg','3.jpg']),{added:1,removed:1});
  assert.deepEqual(book.pages.map(p=>p.name),['a/1.jpg','b/1.jpg','a/3.jpg']);assert.equal(book.pages[0].w,5);
  book.sources[1].missing=true;assert.equal(settle(book),true);
  assert.deepEqual(book.pages.map(p=>p.name),['a/1.jpg','a/3.jpg']);assert.deepEqual(book.parked.map(p=>p.name),['b/1.jpg']);
  assert.equal(allPages(book).length,3);
  book.sources[0].missing=true;settle(book);assert.equal(book.pages.length,3,'全部缺失时整本过期，页面原样保留');assert.equal(book.parked,undefined);
  delete book.sources[0].missing;settle(book);delete book.sources[1].missing;assert.equal(settle(book),true);assert.equal(book.pages.length,3);
  assert.equal(down({sources:[],pages:[]},{key:'',title:'x'}),true,'没有目录句柄也没有本次会话文件的源不可用');
});
test('一个文件夹只能接回一本单文件夹书，但可以同时是多本合并作品中的一卷',()=>{
  const c={title:'Vol 1',hash:'h',names:['1.jpg']},one={title:'Vol 1',pages:[{name:'1.jpg'}],fp:{cover:{hash:'h'}}};
  const slot=(book,merged)=>({book,source:{},merged,cand:c,...grade(one,c)});
  const out=assign([slot({},false),slot({},false),slot({},true),slot({},true)]);
  assert.equal(out.length,3);assert.equal(out.filter(p=>!p.merged).length,1);
  const book={},a={...slot(book,true),source:{}},b={...slot(book,true),source:{}};
  assert.equal(assign([a,b]).length,1,'同一本合并作品的两卷不能接到同一个文件夹');
});
test('刷新只列目录：找不到为 gone，没有权限为 denied，不读图',async()=>{
  const dir=(entries,state='granted')=>({queryPermission:async()=>state,async *values(){yield* entries;}});
  const pic=name=>({name,kind:'file',getFile(){throw Error('unexpected read');}});
  assert.deepEqual(await listDir(dir([pic('1.jpg'),pic('a.txt')])),['1.jpg']);
  assert.equal(await listDir(dir([pic('a.txt')])),'gone');
  assert.equal(await listDir(dir([],'prompt')),'denied');
  assert.equal(await listDir({queryPermission:async()=>'granted',async *values(){throw new DOMException('','NotFoundError');}}),'gone');
});
test('快捷键说明：Delete 是确认后删除这本书的记录（不删原图），四语一致',()=>{
  const want={en:/Delete the current book's record.*image files are kept/,zh:/删除当前书的记录.*不删除原图/,ja:/記録を削除.*元画像は削除しません/,ko:/기록 삭제.*원본 이미지는 유지/};
  for(const [lang,re] of Object.entries(want)){
    const rows=translate('shortcuts',lang);
    assert.match(rows.find(([keys])=>keys.join()==='Delete')[1],re,lang);
    assert.doesNotMatch(rows.at(-1)[1],/Delete: remove|Delete 移除|Delete で外す|Delete 제거/,lang);
  }
});
