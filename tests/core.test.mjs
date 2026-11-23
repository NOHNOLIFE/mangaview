import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detect,translate} from '../lang.mjs';
import {natural,shuffled,offsets,at,point,sortedPages,sortMode,folderSort,needsSort,fileOf,shownName,compareDirs} from '../model.mjs';
import {grade,assign,coverName,hue,norm} from '../match.mjs';
import {KEYS,ZONES,ROWS,MOUSE,MORE} from '../help.mjs';
import {fileGroups,scan,reconnect,source,readMissingTimes,mergeKeys,applyNames,settle,down,makePage,allPages,listDir,dirOf,addLoose,looseImages,looseFiles,looseNames,isLive} from '../sources.mjs';

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
  const book={sources:['Vol 1','Vol 2','Vol 10'].map(key=>({key,path:'S/'+key})),pages},dir=dirOf(book);
  assert.deepEqual(sortedPages(pages,'nameAsc',dir).map(p=>p.name),['Vol 1/1.jpg','Vol 2/2.jpg','Vol 2/10.jpg','Vol 10/1.jpg']);
  assert.deepEqual(sortedPages(pages,'nameDesc',dir).map(p=>p.name),['Vol 10/1.jpg','Vol 2/10.jpg','Vol 2/2.jpg','Vol 1/1.jpg']);
  assert.equal(fileOf(pages[0]),'1.jpg');assert.equal(fileOf({name:'a/b.jpg'}),'a/b.jpg');
  // 只选一个文件夹时它自己的图 key 为文件夹名、子文件夹 key 为相对路径：按卷的路径排，根文件夹自己的图仍在最前；
  // 两卷路径相同（同名的两个所选文件夹）时按 key 分开，不交错。
  const root={sources:[{key:'Z',path:'Z'},{key:'a',path:'Z/a'},{key:'Z (2)',path:'Z'}],pages:[makePage('a','1.jpg'),makePage('Z (2)','1.jpg'),makePage('Z','2.jpg'),makePage('Z (2)','2.jpg'),makePage('Z','1.jpg')]};
  assert.deepEqual(sortedPages(root.pages,'nameAsc',dirOf(root)).map(p=>p.name),['Z/1.jpg','Z/2.jpg','Z (2)/1.jpg','Z (2)/2.jpg','a/1.jpg']);
  // 同一修改时间的并列项也按路径比较。
  const t=root.pages.map(p=>({...p,lastModified:1}));
  assert.deepEqual(sortedPages(t,'timeAsc',dirOf(root)).map(p=>p.name),['Z/1.jpg','Z/2.jpg','Z (2)/1.jpg','Z (2)/2.jpg','a/1.jpg']);
});
test('文件名排序统一按路径：目录逐段自然比较，父目录自己的图在子目录之前，同名散图按加入先后',()=>{
  assert.ok(compareDirs('A','A/sub')<0);assert.ok(compareDirs('Vol 2','Vol 10')<0);assert.ok(compareDirs('A/z','B')<0);assert.ok(compareDirs('','A')<0);
  assert.ok(compareDirs('Vol 1/x','Vol 1 extra')<0,'逐段比较，不受分隔符字符影响');
  const pages=[{name:'B/1.jpg',path:'B',file:'1.jpg'},{name:'A/sub/1.jpg',path:'A/sub',file:'1.jpg'},{name:'10.jpg'},{name:'A/2.jpg',path:'A',file:'2.jpg'},
    {name:'2.jpg (2)',file:'2.jpg'},{name:'2.jpg'},{name:'A/10.jpg',path:'A',file:'10.jpg'}];
  const loose={sources:[],pages};
  assert.deepEqual(sortedPages(pages,'nameAsc',dirOf(loose)).map(p=>p.name),['2.jpg','2.jpg (2)','10.jpg','A/2.jpg','A/10.jpg','A/sub/1.jpg','B/1.jpg']);
  assert.deepEqual(sortedPages(pages,'nameDesc',dirOf(loose)).map(p=>p.name),['B/1.jpg','A/sub/1.jpg','A/10.jpg','A/2.jpg','10.jpg','2.jpg (2)','2.jpg']);
  // 单文件夹书：路径只有文件名，结果与按文件名自然排序相同。
  const single={sources:[{key:'',path:'x/y'}],pages:['10.jpg','2.jpg','1.jpg'].map(name=>({name}))};
  assert.deepEqual(sortedPages(single.pages,'nameAsc',dirOf(single)).map(p=>p.name),['1.jpg','2.jpg','10.jpg']);
  assert.deepEqual(['2.jpg (2)','A/2.jpg','2.jpg'].map(name=>shownName(pages.find(p=>p.name===name))),['2.jpg','A/2.jpg','2.jpg'],'界面显示原文件名（带相对目录），不带区分用的序号');
});
test('散图图集：同一个文件只留一份（句柄 isSameEntry / 无句柄时比较路径、文件名、大小和修改时间），同名的不同图片都保留且页名唯一',async()=>{
  // 假的文件句柄：id 相同即同一个文件；isSameEntry 不读内容，getFile 只给元数据。
  let reads=0;const fh=(id,name,lastModified=1)=>({kind:'file',name,id,isSameEntry:async o=>o.id===id,async getFile(){reads++;return {size:3,lastModified};}});
  const dir=(name,entries)=>({name,kind:'directory',async *values(){yield* entries;}});
  const book={sources:[],pages:[],bookmarks:[]};
  const [first]=await looseImages([fh('x','1.jpg'),dir('A',[fh('a1','1.jpg'),dir('deep',[fh('d1','1.jpg')])])]);
  await addLoose(book,first.pages);
  assert.deepEqual(book.pages.map(p=>[p.name,fileOf(p),p.path]),[['1.jpg','1.jpg',undefined],['A/1.jpg','1.jpg','A'],['A/deep/1.jpg','1.jpg','A/deep']]);
  // 再次加入：同一个文件（经由上级文件夹拖入，路径不同）不重复；同名的另一张图（不同文件）加序号保留。
  const [again]=await looseImages([dir('P',[dir('A',[fh('a1','1.jpg')])]),fh('y','1.jpg'),fh('x','1.jpg')]);
  const names=await addLoose(book,again.pages);
  assert.deepEqual(book.pages.map(p=>p.name),['1.jpg','A/1.jpg','A/deep/1.jpg','1.jpg (2)']);
  assert.equal(names.get('P/A/1.jpg'),'A/1.jpg');
  assert.equal(shownName(book.pages[3]),'1.jpg');assert.equal(fileOf(book.pages[3]),'1.jpg');
  assert.equal(new Set(book.pages.map(p=>p.name)).size,book.pages.length);assert.equal(reads,0,'都有句柄时只用 isSameEntry，不取文件');
  // 没有句柄的旧页（如备份导入）：相对目录、文件名和修改时间都相同才算同一个文件，接上新句柄；修改时间不同则两张都保留。
  const old={sources:[],pages:[{name:'A/2.jpg',path:'A',file:'2.jpg',lastModified:5},{name:'3.jpg',lastModified:5}]};
  await addLoose(old,[{name:'A/2.jpg',path:'A',file:'2.jpg',handle:fh('n2','2.jpg',5)},{name:'3.jpg',handle:fh('n3','3.jpg',6)}]);
  assert.deepEqual(old.pages.map(p=>[p.name,!!p.handle]),[['A/2.jpg',true],['3.jpg',false],['3.jpg (2)',true]]);
  // 回退模式（只有本次会话的 File）：同一组文件再次加入不重复，并接上本次会话的文件。
  const files=()=>['A/1.png','2.png'].map(p=>{const f=new File(['xy'],p.split('/').pop(),{type:'image/png',lastModified:9});if(p.includes('/'))Object.defineProperty(f,'webkitRelativePath',{value:p});return f;});
  const fb={sources:[],pages:[]};
  await addLoose(fb,looseFiles(files())[0].pages);assert.deepEqual(fb.pages.map(p=>[p.name,p.size]),[['2.png',2],['A/1.png',2]]);
  const stored=structuredClone(fb);assert.equal(isLive(stored),false);
  await addLoose(stored,looseFiles(files())[0].pages);assert.equal(stored.pages.length,2);assert.equal(isLive(stored),true);
});
test('旧散图图集的页名带相对目录：载入时补出 file / path，页名不变；定位原文件按相对目录 + 文件名匹配',async()=>{
  const book={sources:[],pages:[{name:'A/deep/1.jpg'},{name:'1.jpg'},{name:'B/1.jpg'}]};looseNames(book);
  assert.deepEqual(book.pages.map(p=>[p.name,p.path,fileOf(p)]),[['A/deep/1.jpg','A/deep','1.jpg'],['1.jpg',undefined,'1.jpg'],['B/1.jpg','B','1.jpg']]);
  const merged={sources:[{key:'v'}],pages:[makePage('v','1.jpg')]};looseNames(merged);assert.equal(merged.pages[0].file,undefined,'有源的书不处理');
  const fh=name=>({kind:'file',name});const dir=(name,entries)=>({name,kind:'directory',async *values(){yield* entries;}});
  // 选了 A 的上级 X：A/deep/1.jpg 对上 X/A/deep/1.jpg；没有目录的 1.jpg 只认 X 里直接放着的；B/1.jpg 在 X 里找不到，不乱配到别的 1.jpg。
  const top=fh('1.jpg'),deep=fh('1.jpg'),other=fh('1.jpg');
  const [g]=await looseImages([dir('X',[top,dir('A',[dir('deep',[deep])]),dir('C',[other])])]);
  assert.equal(reconnect(book,g),2);
  assert.equal(book.pages[0].handle,deep);assert.equal(book.pages[1].handle,top);assert.equal(book.pages[2].handle,undefined);
  // 选了原文件夹里的子文件夹 deep 也能对上。
  const again={sources:[],pages:[{name:'A/deep/1.jpg',path:'A/deep',file:'1.jpg'}]},d2=fh('1.jpg');
  assert.equal(reconnect(again,(await looseImages([dir('deep',[d2])]))[0]),1);assert.equal(again.pages[0].handle,d2);
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
test('键鼠操作图示：功能键都在显示的键盘局部内，文案四语齐全；Delete 是确认后删除这本书的记录（不删原图）',()=>{
  const shown=new Set();
  for(const z of ZONES)for(const r of z.rows){if(!r)continue;let x=0;for(const [id,w] of ROWS[r]){if(id&&Math.min(x+w,z.to)-Math.max(x,z.from)>=.25)shown.add(id);x+=w;}}
  for(const id of Object.keys(KEYS))assert.ok(shown.has(id),id+' 在图示范围内');
  const keys=new Set();for(const f of Object.values(KEYS))for(const k of [f.tap,f.hold,f.tip])if(k)keys.add(k);
  for(const m of [...MOUSE.buttons,...MOUSE.areas])keys.add(m.label).add(m.tip);for(const [,k] of MORE)keys.add(k);
  for(const k of keys)for(const lang of ['en','zh','ja','ko'])assert.ok(translate(k,lang),k+' '+lang);
  const want={en:/Delete the current book's record.*image files are kept/,zh:/删除当前书的记录.*不删除原图/,ja:/記録を削除.*元画像は削除しません/,ko:/기록 삭제.*원본 이미지는 유지/};
  for(const [lang,re] of Object.entries(want)){
    assert.match(translate(KEYS.Delete.tip,lang),re,lang);
    assert.doesNotMatch(translate('hkMoreShelf',lang),/Delete: remove|Delete 移除|Delete で外す|Delete 제거/,lang);
  }
});
