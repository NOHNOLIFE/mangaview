import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detect,translate} from '../lang.mjs';
import {natural,shuffled,offsets,at,point,sortedPages,sortMode,folderSort,needsSort,fileOf,shownName,compareDirs,clipEnd,splitTail,kindOf,pageKind,isContent,unplayable,videoWidth,AUDIO_H,clock,seekStep,nudge,isPbf,pairPbf} from '../model.mjs';
import {grade,assign,coverName,hue,norm,mediaOverlap} from '../match.mjs';
import {KEYS,ZONES,ROWS,MOUSE,MORE,pieces,plain} from '../help.mjs';
import {snap,merge,changes,adopt,refresh,print} from '../merge.mjs';
import {pair,ranges,fits} from '../sections.mjs';
import {ORDERS,orderOf,following,sectionStart,sectionStep} from '../playlist.mjs';
import {mergeMarks} from '../backup.mjs';
import {skipped,handleGroups,fileGroups,scan,reconnect,source,readMissingTimes,mergeKeys,applyNames,settle,down,makePage,allPages,listDir,dirOf,addLoose,looseImages,looseFiles,looseNames,isLive,mediaSizes,pairFrom,pbfFile,hasPbf} from '../sources.mjs';
import {parsePbf,decodePbf,mergePbf,pbfId} from '../pbf.mjs';

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

test('媒体的恢复与识别：不做全文件哈希，按文件名 + 精确大小比较；改名或首个文件对不上时按重合度列出确认，同名不同大小不自动匹配',()=>{
  const vids=['01.mp4','02.mp4','03.mkv','04.mp3'],sizes=new Map(vids.map((n,i)=>[n,1000+i]));
  const book=(title,hash,size=i=>1000+i)=>({title,pages:vids.map((name,i)=>({name,size:size(i)})),fp:hash&&{cover:{hash}}});
  const cand=(title,hash,s=sizes)=>({title,hash,names:vids,sizes:s});
  assert.equal(mediaOverlap(book('A').pages,sizes),1);
  assert.equal(mediaOverlap(book('A').pages,new Map([...sizes,['02.mp4',5]])),.6,'同名不同大小不算重合');
  assert.equal(mediaOverlap([{name:'1.jpg',size:1}],sizes),null,'只比较媒体文件');
  assert.equal(mediaOverlap([{name:'01.mp4'}],sizes),null,'记录里还不知道大小的不比较');
  assert.equal(mediaOverlap(book('A').pages,undefined),null);
  // 名称与首个文件的指纹都一致：自动接回（不变）。
  assert.equal(grade(book('A','h'),cand('A','h')).level,2);
  // 文件夹改名、首个文件也对不上：媒体的文件名 + 大小几乎全对上时列出来由用户确认；对不上的仍不匹配。
  assert.equal(grade(book('A','h'),cand('B','x')).level,1);
  assert.equal(grade(book('A','h'),cand('B','x',new Map([['01.mp4',1]]))).level,0);
  assert.equal(grade(book('A','h'),cand('B','x',null)).level,0,'没有读到大小时照旧不匹配');
  assert.equal(grade(book('A','h',i=>i?1000+i:1),cand('B','x')).level,1,'首个文件变了、其余都对上（4 个里 3 个，0.6）也列出来确认');
  assert.equal(grade(book('A','h',i=>i>1?1000+i:i),cand('B','x')).level,0,'只对上一半不列出');
  // 名称相同、没有指纹可比：文件名全重合但有媒体大小不同，不自动接回。
  assert.equal(grade(book('A',null),cand('A',null)).level,2);
  assert.equal(grade(book('A',null,i=>i===1?7:1000+i),cand('A',null)).level,1);
  // 重合度高的排在前面。
  assert.ok(grade(book('A','h'),cand('B','x')).score>grade(book('A','h'),cand('B','x',new Map([['01.mp4',1000]]))).score);
});
test('散图图集里的媒体按相对目录 + 文件名定位，并要求大小一致；大小只读文件元数据',async()=>{
  let reads=0;const fh=(name,size)=>({kind:'file',name,async getFile(){reads++;return {name,size,lastModified:1};}});
  const dir=(name,entries)=>({name,kind:'directory',async *values(){yield* entries;}});
  const book={sources:[],pages:[{name:'A/clip.mp4',path:'A',file:'clip.mp4',size:500},{name:'A/song.mp3',path:'A',file:'song.mp3',size:70},{name:'A/1.jpg',path:'A',file:'1.jpg'},{name:'A/new.mp4',path:'A',file:'new.mp4'}]};
  const clip=fh('clip.mp4',500),song=fh('song.mp3',71),pic=fh('1.jpg',9),fresh=fh('new.mp4',3),other=fh('other.mp4',1);
  const [g]=await looseImages([dir('A',[clip,song,pic,fresh,other])]);
  assert.equal(reads,0,'列目录时不读文件');
  await mediaSizes(book,g);
  assert.equal(reads,2,'只为记录里已知大小的同名媒体读取元数据');
  assert.equal(reconnect(book,g),3);
  assert.equal(book.pages[0].handle,clip);assert.equal(book.pages[1].handle,undefined,'同名不同大小不接回');
  assert.equal(book.pages[2].handle,pic);assert.equal(book.pages[3].handle,fresh,'还不知道大小的照旧按相对目录 + 文件名');
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
test('键鼠操作图示：功能键都在显示的键盘局部内，文案四语齐全；长按 / Shift 的标记与说明一致；Delete 是删除这本书的记录（不删原文件）',()=>{
  const shown=new Set();
  for(const z of ZONES)for(const r of z.rows){if(!r)continue;let x=0;for(const [id,w] of ROWS[r]){if(id&&Math.min(x+w,z.to)-Math.max(x,z.from)>=.25)shown.add(id);x+=w;}}
  for(const id of Object.keys(KEYS))assert.ok(shown.has(id),id+' 在图示范围内');
  const keys=new Set();for(const f of Object.values(KEYS))keys.add(f.tip);
  for(const m of [...MOUSE.buttons,...MOUSE.areas]){keys.add(m.label);if(m.tip)keys.add(m.tip);}for(const [,k] of MORE)keys.add(k);
  for(const k of keys)for(const lang of ['en','zh','ja','ko'])assert.ok(translate(k,lang),k+' '+lang);
  // 有长按功能的键，说明里恰好一个“长按”强调片段；受 Shift 影响的键，说明里有 Shift 片段；其余键都没有。
  for(const [id,f] of Object.entries(KEYS))for(const lang of ['en','zh','ja','ko']){
    const p=pieces(translate(f.tip,lang));
    assert.equal(p.filter(x=>x[0]==='hold').length,f.hold?1:0,id+' '+lang+' hold');
    assert.equal(p.some(x=>x[0]==='shift'),!!f.shift,id+' '+lang+' Shift');
    assert.equal(p.map(x=>x[1]).join(''),plain(translate(f.tip,lang)),id+' '+lang+' pieces');
  }
  assert.deepEqual(pieces('上一屏，*长按*上一本'),[['','上一屏，'],['hold','长按'],['','上一本']]);
  const want={en:/Delete this book's record.*files kept/,zh:/删除本书记录.*不删原文件/,ja:/記録を削除.*元のファイルは残す/,ko:/기록 삭제.*원본 파일 유지/};
  for(const [lang,re] of Object.entries(want)){
    assert.match(translate(KEYS.Delete.tip,lang),re,lang);
    assert.doesNotMatch(translate('hkMoreShelf',lang),/Delete: remove|Delete 移除|Delete で外す|Delete 제거/,lang);
  }
});
test('长名称：作品名末尾省略，文件名拆成可省略的开头和保留的结尾（扩展名及其前 8 个字符）',()=>{
  assert.equal(clipEnd('短名'),'短名');assert.equal(clipEnd('a'.repeat(40)),'a'.repeat(40));
  assert.equal(clipEnd('a'.repeat(41)),'a'.repeat(39)+'…');assert.equal([...clipEnd('漫'.repeat(100))].length,40);
  assert.equal(clipEnd('😀'.repeat(50),10),'😀'.repeat(9)+'…','按字符截断，不拆开代理对');
  assert.deepEqual(splitTail('Very long series name - Episode 012.mp4'),['Very long series name - Epi','sode 012.mp4']);
  assert.deepEqual(splitTail('no extension here at all'),['no extension her','e at all']);
  assert.deepEqual(splitTail('short.jpg'),['short.jpg','']);assert.deepEqual(splitTail('第一卷第十二话很长很长的名字.webp',4),['第一卷第十二话很长很','长的名字.webp']);
  for(const s of ['Very long series name - Episode 012.mp4','x','第一卷.png'])assert.equal(splitTail(s).join(''),s);
});
test('多窗口保存：以存储中的最新记录为基础，只写本窗口改过的字段；书签按 id、标签按集合合并，不认识的字段原样保留',()=>{
  const stored={id:'b',name:null,place:'shelf',tags:['a','b'],bookmarks:[{id:'1',name:'p1',f:.5},{id:'2',name:'p2',f:.1}],pages:[{name:'1.jpg',w:800},{name:'2.jpg'}]};
  const base=snap(structuredClone(stored)),mine=structuredClone(stored),theirs=structuredClone(stored);
  mine.bookmarks=mine.bookmarks.filter(x=>x.id!=='2');mine.bookmarks.push({id:'3',name:'p3',f:.2});mine.tags=['a','b','m'];mine.place='library';
  theirs.bookmarks.push({id:'4',name:'p4',f:.3});theirs.bookmarks[0]={...theirs.bookmarks[0],end:{name:'p9',f:.4}};theirs.tags=['b','t'];theirs.name='Renamed';theirs.future={x:1};
  const {out,take,joined}=merge(base,mine,theirs);
  assert.deepEqual(out.bookmarks.map(x=>x.id),['1','4','3'],'Each side keeps its additions; a bookmark deleted here is not brought back');
  assert.deepEqual(out.bookmarks[0].end,{name:'p9',f:.4},'An entry changed only by the other window keeps that change');
  assert.deepEqual(out.tags,['b','t','m'],'Tags merge as a set: removals on either side stick');
  assert.equal(out.name,'Renamed');assert.deepEqual(out.future,{x:1});assert.equal(out.place,'library');assert.deepEqual(out.pages,stored.pages);
  assert.deepEqual(take.sort(),['future','name']);assert.deepEqual(joined.sort(),['bookmarks','tags']);
  // 同一个字段两边都改成不同的值：以本窗口（后写入的）为准；对方删掉的书签不会被本窗口加回。
  const m2=structuredClone(stored),t2=structuredClone(stored);m2.name='Mine';t2.name='Theirs';t2.bookmarks=t2.bookmarks.slice(1);m2.bookmarks.push({id:'5',name:'p5',f:0});
  const r2=merge(base,m2,t2);assert.equal(r2.out.name,'Mine');assert.deepEqual(r2.out.bookmarks.map(x=>x.id),['2','5']);
  // 本窗口删掉的字段：存储里没变就删掉。
  const m3=structuredClone(stored);delete m3.name;assert.equal('name' in merge(base,m3,structuredClone(stored)).out,false);
});
test('多窗口接收：只换进本窗口没有未保存改动的字段；句柄按对象区分本窗口的改动，按种类和名称比较存储里的内容',()=>{
  class Handle{constructor(name){this.kind='directory';this.name=name;}}
  const dir=new Handle('Vol'),book={id:'b',sources:[{key:'',title:'Vol',dir}],bookmarks:[],tags:[],pages:[{name:'1.jpg'},{name:'2.jpg'}]};
  const base=snap(book),rec=structuredClone({...book,sources:[]});rec.sources=[{key:'',title:'Vol',dir:new Handle('Vol')}];
  assert.deepEqual(changes(base,book,rec),[],'A handle read back from storage is a new object with the same content');
  rec.tags=['x'];rec.pages=[{name:'1.jpg',w:5},{name:'2.jpg'}];book.bookmarks.push({id:'1'});
  assert.deepEqual(changes(base,book,rec).sort(),['pages','tags'],'Fields with unsaved local changes wait for the next save');
  const page=book.pages[1];for(const k of ['pages','tags'])adopt(book,k,rec[k]);refresh(base,book,['pages','tags']);
  assert.equal(book.pages[1],page,'Unchanged entries keep their in-memory objects');assert.deepEqual(book.pages[0],{name:'1.jpg',w:5});
  assert.deepEqual(changes(base,book,rec),[]);
  // 本窗口把卷接到同名文件夹的新句柄（恢复失效的句柄）：算作改动，保存时写入，不被存储中的旧句柄盖掉。
  book.sources[0].dir=new Handle('Vol');
  const r=merge(base,book,rec);assert.equal(r.out.sources[0].dir,book.sources[0].dir);
  assert.notEqual(print({a:1,b:2}).l,print({a:2,b:1}).l);assert.equal(print({a:1,b:2}).l,print({b:2,a:1}).l);
});
test('区段书签配对：在区段内更新终点，否则配给前面最近的区段或普通书签',()=>{
  // 坐标：页序 + 页内位置。a 带区段 [1.5, 3.5]，b 在区段内（不参与配对），c 在区段之后，d 在当前位置之后。
  const items=[{id:'a',at:1.5,end:3.5},{id:'b',at:2.2},{id:'c',at:5.1},{id:'d',at:9.5}];
  assert.deepEqual(pair(items,3),{kind:'update',id:'a',inside:true},'在区段内：更新这个区段的终点（可缩短）');
  assert.deepEqual(pair(items,1.5),{kind:'update',id:'a',inside:true},'区段两端算在区段内');
  assert.deepEqual(pair(items,3.5),{kind:'update',id:'a',inside:true});
  assert.deepEqual(pair(items,4),{kind:'update',id:'a',inside:false},'最近的是区段：延长它');
  assert.deepEqual(pair(items,7),{kind:'create',id:'c',inside:false},'最近的是不在区段内的普通书签：以它为起点新建');
  assert.deepEqual(pair(items,5.1),{kind:'create',id:'c',inside:false},'坐标相同也算在前面（是否太近由界面判断）');
  assert.equal(pair(items,1),null,'前面什么都没有');
  assert.equal(pair([],3),null);
  // 区段内的普通书签不参与配对：区段之后要延长的仍是区段本身。
  assert.deepEqual(pair([{id:'a',at:1,end:5},{id:'b',at:4.9}],6),{kind:'update',id:'a',inside:false});
  // 暂不生效的区段（end 为 null）按起点算远近，配到它即更新终点；不在任何区段内的位置不受它影响。
  assert.deepEqual(pair([{id:'a',at:2,end:null},{id:'b',at:1}],3),{kind:'update',id:'a',inside:false});
  assert.deepEqual(pair([{id:'a',at:2,end:null},{id:'b',at:2.5}],3),{kind:'create',id:'b',inside:false});
  // 图片已不存在的书签（坐标 NaN）忽略。
  assert.deepEqual(pair([{id:'x',at:NaN},{id:'b',at:1}],3),{kind:'create',id:'b',inside:false});
  // 同一坐标上优先选生效的区段。
  assert.deepEqual(pair([{id:'n',at:4},{id:'a',at:1,end:4}],6),{kind:'update',id:'a',inside:false});
});
test('区段书签不嵌套、不交叉：按规则依次添加的结果始终互不重叠',()=>{
  // 随机地添加书签和区段书签，任何时候生效的区段都两两不重叠，且区段内的普通书签不会成为起点。
  let seed=7;const rand=()=>(seed=seed*16807%2147483647)/2147483647;
  for(let round=0;round<200;round++){
    const items=[];let n=0;
    for(let step=0;step<25;step++){
      const x=Math.round(rand()*2000)/100;
      if(rand()<.5){items.push({id:'m'+n++,at:x});continue;}
      const r=pair(items,x);if(!r)continue;const m=items.find(m=>m.id===r.id);if(x<=m.at)continue;m.end=x;
      const spans=ranges(items);
      for(let i=1;i<spans.length;i++)assert.ok(spans[i].a>spans[i-1].b,'区段互不重叠');
    }
  }
  assert.deepEqual(ranges([{id:'a',at:1,end:2},{id:'b',at:0,end:null},{id:'c',at:3}]),[{id:'a',a:1,b:2}],'只列出生效的区段');
  assert.equal(fits([{id:'a',at:1,end:3}],'b',4,6),true);
  assert.equal(fits([{id:'a',at:1,end:3}],'b',2,6),false,'交叉');
  assert.equal(fits([{id:'a',at:1,end:3}],'b',0,6),false,'嵌套');
  assert.equal(fits([{id:'a',at:1,end:3}],'a',1,6),true,'自己不算冲突');
  assert.equal(fits([],'a',3,3),false,'终点必须在起点之后');
});
test('合并备份：书签取并集，区段书签补缺，冲突的区段书签不并入，本机的保留',()=>{
  const pages=['0','1','2','3','4','5'].map(name=>({name}));
  const mine=[{id:'a',name:'1',f:.5,end:{name:'2',f:.5}},{id:'b',name:'3',f:.2}];
  const theirs=[{id:'a',name:'1',f:.5,end:{name:'4',f:.1}},{id:'b',name:'3',f:.2,end:{name:'4',f:.9}},{id:'c',name:'0',f:.1,end:{name:'1',f:.9}},{id:'d',name:'5',f:.1,end:{name:'5',f:.8}},{id:'e',name:'9',f:.1,end:{name:'9',f:.5}}];
  const out=mergeMarks(pages,mine.map(m=>({...m})),theirs);
  const get=id=>out.find(m=>m.id===id);
  assert.deepEqual(get('a').end,{name:'2',f:.5},'本机已有的区段书签不被覆盖');
  assert.deepEqual(get('b').end,{name:'4',f:.9},'本机没有区段书签的同一个书签补上');
  assert.equal(get('c').end,undefined,'与已有区段交叉的区段书签不并入');assert.equal(get('c').name,'0','书签本身照常并入');
  assert.deepEqual(get('d').end,{name:'5',f:.8});
  assert.deepEqual(get('e').end,{name:'9',f:.5},'位置无法换算（页不存在）时照常保留');
  assert.equal(out.length,5);
});
test('媒体按扩展名识别：视频、音频、图片三类；浏览器播不了的格式单独认出，其余文件不是内容',()=>{
  for(const n of ['a.mp4','b.M4V','c.webm','d.mkv','e.mov','f.ogv'])assert.equal(kindOf(n),'video',n);
  for(const n of ['a.mp3','b.FLAC','c.wav','d.ogg','e.oga','f.opus','g.m4a','h.aac','i.weba'])assert.equal(kindOf(n),'audio',n);
  for(const n of ['a.jpg','b.PNG','c.svg','d.webp'])assert.equal(kindOf(n),'image',n);
  for(const n of ['a.txt','b.pbf','c.avi','noext','dir.mp4/readme'])assert.equal(isContent(n),false,n);
  for(const n of ['a.avi','b.WMV','c.flv','d.rmvb','e.ts','f.mpg','g.wma','h.ape','i.ac3','j.dts','k.3gp','l.vob','m.m2ts','n.asf','o.rm','p.mpeg'])assert.equal(unplayable(n),true,n);
  for(const n of ['a.mp4','b.jpg','c.txt'])assert.equal(unplayable(n),false,n);
  // 散图的页名可能带区分序号：按文件名（fileOf）判断。
  assert.equal(pageKind({name:'clip.mp4 (2)',file:'clip.mp4'}),'video');assert.equal(pageKind({name:'v/song.flac',src:'v'}),'audio');assert.equal(pageKind({w:1,h:1}),'image');
});
test('媒体排版：视频按帧比例（未知按 16:9），高于视窗封顶到一屏并等比缩窄；音频在正文是固定高度、在缩略图栏是小块',()=>{
  const pages=[{name:'1.jpg',w:800,h:1200},{name:'2.mp4',w:1920,h:1080},{name:'3.mp4'},{name:'4.webm',w:400,h:1600},{name:'5.mp3'}];
  const s=offsets(pages,800,true,900),h=s.slice(1).map((x,i)=>Math.round(x-s[i]));
  assert.deepEqual(h,[1200,450,450,900,AUDIO_H]);
  assert.equal(Math.round(videoWidth(pages[3],800,true,900)),225,'封顶后宽度按比例缩小');assert.equal(videoWidth(pages[1],800,true,900),800);
  // 「小图不放大」：视频宽度不超过帧宽，与图片同一规则。
  const small=offsets([{name:'a.mp4',w:320,h:180}],800,false,900);assert.equal(small[1],180);assert.equal(videoWidth({name:'a.mp4',w:320,h:180},800,false,900),320);
  // 缩略图栏（nav）不封顶，音频是固定比例的小块。
  const nav=offsets(pages,100,true,Infinity,true),n=nav.slice(1).map((x,i)=>Math.round(x-nav[i]));assert.deepEqual(n,[150,56,56,400,50]);
});
test('媒体时间、快进步长与音量步进',()=>{
  assert.equal(clock(0),'0:00');assert.equal(clock(65.9),'1:05');assert.equal(clock(3600+62),'1:01:02');assert.equal(clock(NaN),'0:00');
  assert.deepEqual([0,999,1000,1999,2000,2999,3000,60000].map(seekStep),[2,2,5,5,10,10,30,30]);
  assert.equal(nudge(1,1),1);assert.equal(nudge(0,-1),0);assert.equal(nudge(.5,1),.55);let v=1;for(let i=0;i<7;i++)v=nudge(v,-1);assert.equal(v,.65);assert.equal(nudge(undefined,-1),.95);
});
test('导入只看扩展名：视频、音频与图片一样成书，只有媒体的文件夹也成书；播不了的格式计数并列出扩展名，不读文件',async()=>{
  const file=name=>({name,kind:'file',getFile(){throw Error('unexpected read');}});
  const dir=(name,entries)=>({name,kind:'directory',async *values(){yield* entries;}});
  const odd=skipped(),groups=[];
  for await(const g of scan(dir('Root',[file('1.jpg'),file('2.mp4'),file('a.avi'),file('notes.txt'),dir('Songs',[file('x.flac'),file('y.WMA'),file('z.ape')]),dir('Empty',[file('b.rmvb')])]),'',odd))groups.push(g);
  assert.deepEqual(groups.map(g=>[g.path,g.pages.map(p=>p.name)]),[['Root',['1.jpg','2.mp4']],['Root/Songs',['x.flac']]]);
  assert.equal(odd.n,4);assert.deepEqual([...odd.exts].sort(),['ape','avi','rmvb','wma']);
  // 不传计数器时照常扫描（恢复时的扫描不提示）。
  const plain=[];for await(const g of scan(dir('Root',[file('a.avi'),file('1.mp3')])))plain.push(g);assert.deepEqual(plain[0].pages.map(p=>p.name),['1.mp3']);
  const loose=skipped(),hg=[];for await(const g of handleGroups([file('a.webm'),file('b.flv'),file('c.png')],loose))hg.push(g);
  assert.deepEqual(hg[0].pages.map(p=>p.name),['a.webm','c.png']);assert.equal(loose.n,1);
  // 回退模式：.avi 的 type 是 video/*，也按扩展名判为不支持；扩展名认不出的图片（type 为 image/*）照旧收下。
  const files=[new File(['x'],'a.avi',{type:'video/x-msvideo'}),new File(['x'],'b.mp4',{type:'video/mp4'}),new File(['x'],'c.heif',{type:'image/heif'}),new File(['x'],'d.txt',{type:'text/plain'})];
  const fodd=skipped();assert.deepEqual(fileGroups(files,fodd)[0].pages.map(p=>p.name),['b.mp4','c.heif']);assert.equal(fodd.n,1);
  // 刷新只列目录：媒体文件与图片一样算内容，不支持的文件不算，也不读。
  const d=(entries)=>({queryPermission:async()=>'granted',async *values(){yield* entries;}});
  assert.deepEqual(await listDir(d([file('1.mp3'),file('2.avi'),file('3.webm')])),['1.mp3','3.webm']);
  assert.equal(await listDir(d([file('2.avi')])),'gone');
});

test('播放顺序与循环：一个媒体播完之后播哪个',()=>{
  assert.deepEqual(ORDERS,['list','shuffle','single']);assert.equal(orderOf('bogus'),'list');assert.equal(orderOf('single'),'single');
  const list=[1,3,4,7];
  // 单集：循环关停下，循环开重复当前媒体。
  assert.equal(following({order:'single',loop:false,list,cur:3}).next,null);
  assert.equal(following({order:'single',loop:true,list,cur:3}).next,3);
  // 列表：按页序播放下一个（图片、无法播放的不在 list 里）；最后一个播完停下，循环开回到第一个。
  assert.equal(following({order:'list',list,cur:3}).next,4);
  assert.equal(following({order:'list',list,cur:5}).next,7,'A media not in the list (e.g. without sections) continues with the next one in page order');
  assert.equal(following({order:'list',list,cur:7}).next,null);
  assert.equal(following({order:'list',loop:true,list,cur:7}).next,1);
  assert.equal(following({order:'list',loop:true,list:[4],cur:4}).next,4,'A single media loops onto itself');
  assert.equal(following({order:'list',list:[],cur:2}).next,null);
  // 随机：不重复，全部播过一遍后停下；循环开则重新洗牌继续，刚播完的不紧接着重复。
  let played=new Set(),cur=1,seen=[cur];const rnd=()=>0.6;
  for(;;){const r=following({order:'shuffle',list,cur,played,random:rnd});if(r.next==null)break;seen.push(r.next);played=r.played;cur=r.next;}
  assert.deepEqual([...seen].sort((a,b)=>a-b),list,'Each media once per round');assert.equal(seen.length,4);
  const again=following({order:'shuffle',loop:true,list,cur,played});
  assert.ok(again.next!=null&&again.next!==cur,'Looping starts a new round without repeating the last one');assert.deepEqual([...again.played].sort(),[cur,again.next].sort());
  assert.equal(following({order:'shuffle',loop:true,list:[4],cur:4,played:new Set([4])}).next,4);
  assert.equal(following({order:'shuffle',loop:false,list:[4],cur:4}).next,null);
});

test('只播放书签区段：从哪里开始、何时跳到下一个区段',()=>{
  const rs=[{a:5,b:9},{a:12,b:14}];
  assert.equal(sectionStart(rs,0),5,'From the first section after the current time');
  assert.equal(sectionStart(rs,6),6,'Inside a section: keep going');
  assert.equal(sectionStart(rs,10),12);
  assert.equal(sectionStart(rs,20),5,'Past the last section: back to the first');
  assert.equal(sectionStart([],3),3,'No sections: unchanged');
  assert.deepEqual(sectionStep(rs,6,null),{k:0},'Entering a section starts following it');
  assert.deepEqual(sectionStep(rs,8.5,0),{k:0});
  assert.deepEqual(sectionStep(rs,9,0),{k:1,seek:12},'At the end of a section jump to the next one');
  assert.deepEqual(sectionStep(rs,14,1),{k:null,done:true},'The last section ends the media');
  assert.deepEqual(sectionStep(rs,10,null),{k:null},'Dragged outside the sections: play on normally');
  assert.deepEqual(sectionStep(rs,12.5,null),{k:1},'Reaching a later section resumes section jumps');
});

test('合并备份：媒体的区段书签只与同一文件的区段比较冲突',()=>{
  const pages=[{name:'1.jpg'},{name:'a.webm'},{name:'b.webm'},{name:'2.jpg'}];
  const mine=[{id:'i1',name:'1.jpg',f:.2,end:{name:'2.jpg',f:.5}},{id:'a1',name:'a.webm',t:10,end:{name:'a.webm',t:20}}];
  const incoming=[{id:'a2',name:'a.webm',t:15,end:{name:'a.webm',t:30}},{id:'b1',name:'b.webm',t:15,end:{name:'b.webm',t:30}},{id:'a3',name:'a.webm',t:25,end:{name:'a.webm',t:28}}];
  const out=mergeMarks(pages,structuredClone(mine),incoming);
  assert.deepEqual(out.map(m=>[m.id,!!m.end]),[['i1',true],['a1',true],['a2',false],['b1',true],['a3',true]],'Crossing a section of the same file is dropped; other files and the image section spanning them do not matter');
});

// ---- PotPlayer 书签（.pbf，第 11 节）：测试用的 .pbf 现场构造，不读任何真实文件。
const BOM=String.fromCharCode(0xFEFF),HEX='89504e470d0a1a0a0000000d49484452'.repeat(4);
const pbfText=lines=>BOM+'[Bookmark]\r\n'+lines.join('\r\n')+'\r\n';
const utf16=text=>new Uint8Array(Buffer.from(text,'utf16le'));

test('解析 .pbf：UTF-16LE 带 BOM，[Bookmark] 小节，只取时间和名称',()=>{
  const text=pbfText(['0=1500*Opening*'+HEX,'1=62000**','2=90500*A * B*'+HEX,'3=120000*名前*ネーム*','4=']);
  const bytes=utf16(text);assert.deepEqual([...bytes.subarray(0,2)],[0xFF,0xFE],'The fixture starts with the UTF-16LE BOM');
  assert.deepEqual(parsePbf(decodePbf(bytes)),[{ms:1500,name:'Opening'},{ms:62000,name:''},{ms:90500,name:'A * B'},{ms:120000,name:'名前*ネーム'}],
    'Name is between the first and the last *, may contain *; empty image segment; trailing empty line skipped');
  assert.deepEqual(parsePbf(decodePbf(utf16(text).buffer)),parsePbf(text),'Accepts an ArrayBuffer');
  assert.deepEqual(parsePbf(decodePbf(new TextEncoder().encode(text))),parsePbf(text),'UTF-8 (with BOM) also decodes');
  assert.deepEqual(parsePbf(decodePbf(utf16(text.slice(1)))),parsePbf(text),'UTF-16LE without BOM is guessed');
});
test('解析 .pbf：坏行跳过，其他小节忽略，整个文件无法解析时为空',()=>{
  const text=BOM+'[Settings]\n0=5000*Not a bookmark*\n[Bookmark]\n0=abc*x*\n1=2000\n2=3000*only one star\n3=-4000*neg*\n4=5000*bad image*xyz!\nnoise\n5 = 6000 * Spaced * '+HEX+' \n6=7000*ok*\n[Other]\n7=8000*after*\n';
  assert.deepEqual(parsePbf(text),[{ms:6000,name:'Spaced'},{ms:7000,name:'ok'}]);
  for(const junk of ['','garbage',BOM,'[Bookmark]',null,undefined,42])assert.deepEqual(parsePbf(junk),[]);
  assert.deepEqual(parsePbf(decodePbf(new Uint8Array([0,1,2,3,255,254]))),[]);
});
test('.pbf 与同目录主文件名相同的媒体配对，也接受 X.flac.pbf；有歧义时不猜',()=>{
  assert.equal(isPbf('a.PBF'),true);assert.equal(isPbf('a.pbf.txt'),false);assert.equal(isContent('a.pbf'),false,'A .pbf is not a page');
  const pairs=pairPbf(['Song.flac','clip.mp4','Clip2.webm','pic.png','pic.mp3','dup.mp4','dup.mkv','img.jpg'],['song.pbf','clip.mp4.pbf','CLIP2.pbf','pic.pbf','dup.pbf','img.pbf','none.pbf']);
  assert.deepEqual([...pairs].sort(),[['Clip2.webm','CLIP2.pbf'],['Song.flac','song.pbf'],['clip.mp4','clip.mp4.pbf'],['pic.mp3','pic.pbf']],
    'Case-insensitive; images are not paired; one stem with two media files is skipped; a .pbf without media is ignored');
  assert.deepEqual([...pairPbf(['X.flac'],['X.pbf','X.flac.pbf'])],[['X.flac','X.flac.pbf']],'X.flac.pbf wins over X.pbf');
  assert.deepEqual([...pairPbf(['X.flac'],['X.pbf'])],[['X.flac','X.pbf']]);
  assert.equal(pairPbf(['a.mp3'],[]).size,0);
});
test('合并 .pbf：只增不删，1 秒内去重，名称更新，删过的不加回',()=>{
  const user={id:'u',name:'a.mp4',t:10.4,at:1},other={id:'o',name:'b.mp4',t:20,at:1},sec={id:'s',name:'a.mp4',t:40,at:1,end:{name:'a.mp4',t:50,at:1}};
  const marks=[user,other,sec];
  let r=mergePbf(marks,'a.mp4',[{ms:10000,name:'Intro'},{ms:20000,name:'Chorus'},{ms:20500,name:'Near'},{ms:49500,name:'At end'},{ms:30000,name:''}],[],7);
  assert.deepEqual(r.added,[{id:pbfId('a.mp4',20000),name:'a.mp4',t:20,at:7,label:'Chorus',from:'pbf'},{id:pbfId('a.mp4',30000),name:'a.mp4',t:30,at:7,from:'pbf'}],
    'Within 1 s of an existing bookmark (or a section end, or another new one) is the same; other files do not count; no empty label');
  assert.equal(user.label,'Intro','An unnamed bookmark gets the name');assert.deepEqual(r.renamed,[user]);assert.equal(other.label,undefined);
  assert.deepEqual(r.done.sort((a,b)=>a-b),[10000,20000,20500,30000,49500]);
  assert.equal(pbfId('a.mp4',20000),pbfId('a.mp4',20000),'Ids depend only on the page and the time');assert.notEqual(pbfId('a.mp4',20000),pbfId('b.mp4',20000));
  // 第二次：PotPlayer 里改了名称、删了一条、加了一条；应用内删掉了 30 秒那条。
  const chorus=r.added[0],all=[...marks,chorus];
  r=mergePbf(all,'a.mp4',[{ms:10000,name:'Intro'},{ms:20000,name:'Chorus 2'},{ms:30000,name:''},{ms:60000,name:'New * one'}],r.done,8);
  assert.equal(chorus.label,'Chorus 2','Names of imported bookmarks follow the .pbf');assert.deepEqual(r.renamed,[chorus]);
  assert.deepEqual(r.added.map(m=>[m.t,m.label]),[[60,'New * one']],'Deleted in the app: not added back; new entries added');
  assert.equal(all.length,4,'Entries removed in PotPlayer stay');
  r=mergePbf([...all,...r.added],'a.mp4',[{ms:20000,name:''},{ms:10000,name:'Renamed'}],r.done);
  assert.equal(chorus.label,undefined,'Cleared name of an imported bookmark');assert.equal(user.label,'Intro','A user bookmark keeps its name');
  assert.deepEqual(mergePbf([],'a.mp4',[],[]),{added:[],renamed:[],done:[]});
  assert.deepEqual(mergePbf([user],'a.mp4',[{ms:11400,name:'x'},{ms:12400,name:'y'}]).added.map(m=>m.t),[11.4,12.4],'Exactly 1 s apart is a different bookmark');
});
test('.pbf 的配对随扫描、刷新、散图一同得出，读取只取配对的那个文件',async()=>{
  const file=(name,body='x')=>({kind:'file',name,getFile:async()=>new File([body],name,{lastModified:5})});
  const dir=(name,entries)=>({name,kind:'directory',queryPermission:async()=>'granted',async *values(){yield* entries;},async getFileHandle(n){const h=entries.find(e=>e.name===n);if(!h)throw new DOMException('','NotFoundError');return h;}});
  const odd=skipped(),root=dir('Root',[file('a.mp4'),file('a.pbf','AAA'),file('b.flac'),file('b.flac.pbf'),file('c.png'),file('c.pbf'),file('lone.pbf')]);
  const [g]=await Array.fromAsync(scan(root,'',odd));
  assert.deepEqual(g.pages.map(p=>[p.name,p.pbf?.file??null]),[['a.mp4','a.pbf'],['b.flac','b.flac.pbf'],['c.png',null]],'.pbf files are not pages; images are not paired');
  assert.equal(odd.n,0,'A .pbf is not reported as unsupported');
  const names=await listDir(root);assert.deepEqual(names,['a.mp4','b.flac','c.png']);assert.deepEqual(names.pbf,['a.pbf','b.flac.pbf','c.pbf','lone.pbf']);
  const s={key:'',title:'Root',dir:root},book={id:'x',sources:[s],pages:g.pages,bookmarks:[]};
  book.pages[0].pbf.done=[1000];
  assert.equal(await (await pbfFile(book,book.pages[0])).text(),'AAA');assert.equal(await pbfFile(book,book.pages[2]),null);
  // 刷新：a.pbf 消失、c.mp3 出现并带着 c.pbf；配对消失时已处理过的条目保留。
  applyNames(book,s,Object.assign(['a.mp4','b.flac','c.png','c.mp3'],{}),false,['b.flac.pbf','c.pbf']);
  assert.deepEqual(book.pages.map(p=>[p.name,p.pbf??null]),[['a.mp4',{done:[1000]}],['b.flac',{file:'b.flac.pbf'}],['c.png',null],['c.mp3',{file:'c.pbf'}]]);
  assert.equal(hasPbf(book.pages[0]),false);assert.equal(hasPbf(book.pages[3]),true);
  applyNames(book,s,['a.mp4','b.flac','c.png','c.mp3']);assert.equal(book.pages[1].pbf.file,'b.flac.pbf','Without a listing of .pbf files the pairing is untouched');
  // 重新关联文件夹（app.mjs link）：按扫描结果配对。
  pairFrom(book,s,[{name:'a.mp4',pbf:{file:'a.pbf'}},{name:'b.flac'}]);
  assert.deepEqual(book.pages.map(p=>p.pbf?.file??null),['a.pbf',null,null,null]);assert.deepEqual(book.pages[0].pbf.done,[1000]);
  // 散图：只与同一批拖入（或同一目录里）的 .pbf 配对，记下句柄。
  const lp=(await Array.fromAsync(handleGroups([file('x.mp3'),file('x.pbf','X'),file('y.mp3'),root]))).find(g=>g.title===null);
  assert.deepEqual(lp.pages.map(p=>[p.name,!!p.pbf?.handle]),[['x.mp3',true],['y.mp3',false]]);
  assert.equal(await (await pbfFile({sources:[]},lp.pages[0])).text(),'X');
  const [li]=await looseImages([dir('Box',[file('m.webm'),file('m.pbf','M'),dir('Sub',[file('n.mp3'),file('m.pbf')])]),file('top.mp3'),file('top.pbf','T')]);
  assert.deepEqual(li.pages.map(p=>[p.name,!!p.pbf?.handle]).sort(),[['Box/Sub/n.mp3',false],['Box/m.webm',true],['top.mp3',true]],'A .pbf pairs only within its own folder');
  // 文件选择器回退：本次会话的 File。
  const fg=fileGroups([new File(['1'],'v.mp4',{type:'video/mp4'}),new File(['P'],'v.pbf'),new File(['2'],'w.mp4',{type:'video/mp4'})]);
  assert.deepEqual(fg.length,1);assert.deepEqual(fg[0].pages.map(p=>[p.name,hasPbf(p)]),[['v.mp4',true],['w.mp4',false]]);
  assert.equal(await (await pbfFile({sources:[]},fg[0].pages[0])).text(),'P');
  // 并入散图图集时，已有的同一个文件接上新拖入的 .pbf。
  const album={id:'L',title:null,sources:[],pages:[],bookmarks:[]},h=file('q.mp3');
  await addLoose(album,[{name:'q.mp3',handle:h}]);await addLoose(album,[{name:'q.mp3',handle:h,pbf:{handle:file('q.pbf','Q')}}]);
  assert.equal(album.pages.length,1);assert.equal(await (await pbfFile(album,album.pages[0])).text(),'Q');
});
