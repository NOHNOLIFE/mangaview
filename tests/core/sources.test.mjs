import test from 'node:test';
import assert from 'node:assert/strict';
import {sortedPages,fileOf,shownName} from '../../src/core/model.mjs';
import {skipped,handleGroups,fileGroups,scan,reconnect,source,readMissingTimes,mergeKeys,applyNames,settle,down,makePage,allPages,listDir,dirOf,addLoose,looseImages,looseFiles,looseNames,isLive,mediaSizes} from '../../src/core/sources.mjs';

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
test('刷新只列目录：找不到为 gone，没有权限为 denied，不读图',async()=>{
  const dir=(entries,state='granted')=>({queryPermission:async()=>state,async *values(){yield* entries;}});
  const pic=name=>({name,kind:'file',getFile(){throw Error('unexpected read');}});
  assert.deepEqual(await listDir(dir([pic('1.jpg'),pic('a.txt')])),['1.jpg']);
  assert.equal(await listDir(dir([pic('a.txt')])),'gone');
  assert.equal(await listDir(dir([],'prompt')),'denied');
  assert.equal(await listDir({queryPermission:async()=>'granted',async *values(){throw new DOMException('','NotFoundError');}}),'gone');
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
