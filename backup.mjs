import {extend} from './lang.mjs';
import {fits} from './sections.mjs';
// 应用数据导入 / 导出。备份只含书目记录、localStorage 中的 mv2: 键和缩略图；文件句柄无法序列化，导入后需重新关联文件夹。
extend({
  bakNote:['Backups include book records, tags, bookmarks, reading positions, settings and thumbnails, but not the image files or folder access. After importing on another computer or browser, reconnect each folder.','备份包含书目记录、标签、书签、阅读位置、设置和缩略图，不含图片原文件和文件夹访问权限。换电脑或换浏览器导入后，需要重新关联文件夹。','バックアップには本の記録・タグ・しおり・読書位置・設定・サムネイルが含まれますが、画像ファイル本体とフォルダーへのアクセス権は含まれません。別の PC やブラウザーで読み込んだ後は、フォルダーを再度関連付けてください。','백업에는 책 기록, 태그, 책갈피, 읽기 위치, 설정, 썸네일이 포함되며 원본 이미지 파일과 폴더 접근 권한은 포함되지 않습니다. 다른 컴퓨터나 브라우저에서 가져온 뒤에는 폴더를 다시 연결하세요.'],
  bakExport:['Export data','导出数据','データを書き出す','데이터 내보내기'],bakExportBtn:['Export','导出','書き出す','내보내기'],
  bakExportHint:['Save a JSON backup file.','保存为 JSON 备份文件。','JSON バックアップファイルとして保存します。','JSON 백업 파일로 저장합니다.'],
  bakImport:['Import data','导入数据','データを読み込む','데이터 가져오기'],bakImportBtn:['Import','导入','読み込む','가져오기'],
  bakImportHint:['Restore from a backup file by merging or replacing.','从备份文件恢复，可选择合并或替换。','バックアップから復元します。統合か置き換えを選べます。','백업 파일에서 복원합니다. 병합 또는 바꾸기를 선택할 수 있습니다.'],
  bakStorage:['Storage','存储占用','ストレージ','저장 공간'],
  bakCounts:['{books} books · {thumbs} thumbnails','{books} 本书 · {thumbs} 张缩略图','{books} 冊 · サムネイル {thumbs} 枚','책 {books}권 · 썸네일 {thumbs}개'],
  bakUsage:['{used} of {quota} ({p}%)','{used} / 上限 {quota}（{p}%）','{used} / 上限 {quota}（{p}%）','{used} / 한도 {quota} ({p}%)'],
  bakClear:['Clear all data','清除全部数据','すべてのデータを消去','모든 데이터 지우기'],bakClearBtn:['Clear','清除','消去','지우기'],
  bakClearHint:['Removes books, reading positions and thumbnails from this browser. Image files are not deleted.','清空本浏览器中的书目、阅读进度和缩略图，不会删除原图。','このブラウザーの本・読書位置・サムネイルを消去します。元画像は削除されません。','이 브라우저의 책, 읽기 위치, 썸네일을 지웁니다. 원본 이미지는 삭제되지 않습니다.'],
  bakExporting:['Exporting…','正在导出…','書き出し中…','내보내는 중…'],bakImporting:['Importing…','正在导入…','読み込み中…','가져오는 중…'],
  bakExported:['Exported {books} books and {thumbs} thumbnails','已导出 {books} 本书、{thumbs} 张缩略图','{books} 冊とサムネイル {thumbs} 枚を書き出しました','책 {books}권과 썸네일 {thumbs}개를 내보냈습니다'],
  bakInvalid:['This file is damaged or not in the expected format. Nothing was changed.','文件已损坏或格式不正确，未做任何修改。','ファイルが壊れているか形式が正しくありません。何も変更していません。','파일이 손상되었거나 형식이 올바르지 않습니다. 아무것도 변경하지 않았습니다.'],
  bakNotBackup:['This is not a MangaView backup file. Nothing was changed.','这不是 MangaView 备份文件，未做任何修改。','MangaView のバックアップファイルではありません。何も変更していません。','MangaView 백업 파일이 아닙니다. 아무것도 변경하지 않았습니다.'],
  bakNewer:['This backup comes from a newer version of MangaView. Update the app and try again.','该备份来自更新版本的 MangaView，请先更新应用再导入。','新しいバージョンの MangaView で作成されたバックアップです。アプリを更新してから読み込んでください。','더 새로운 버전의 MangaView에서 만든 백업입니다. 앱을 업데이트한 뒤 다시 시도하세요.'],
  bakAskTitle:['Import backup','导入备份','バックアップを読み込む','백업 가져오기'],
  bakSummary:['{books} books and {thumbs} thumbnails, exported {date}.','包含 {books} 本书、{thumbs} 张缩略图，导出于 {date}。','{books} 冊とサムネイル {thumbs} 枚（{date} に書き出し）。','책 {books}권, 썸네일 {thumbs}개 ({date} 내보냄).'],
  bakMerge:['Merge','合并','統合','병합'],bakReplace:['Replace','替换','置き換え','바꾸기'],bakCancel:['Cancel','取消','キャンセル','취소'],bakBack:['Back','返回','戻る','뒤로'],
  bakMergeHint:['Keep everything on this device and add what is missing. Tags and bookmarks are combined; existing reading positions are kept.','保留本机数据并补充缺少的内容；标签和书签取并集，已有的阅读位置不变。','この端末のデータを残し、足りないものを追加します。タグとしおりは統合し、既存の読書位置は保持します。','이 기기의 데이터를 유지하고 없는 항목을 추가합니다. 태그와 책갈피는 합치고 기존 읽기 위치는 유지합니다.'],
  bakReplaceHint:['Delete all books, thumbnails and settings on this device, then restore the backup.','删除本机全部书目、缩略图和设置，然后恢复备份内容。','この端末の本・サムネイル・設定をすべて削除してからバックアップを復元します。','이 기기의 모든 책, 썸네일, 설정을 삭제한 뒤 백업을 복원합니다.'],
  bakReplaceTitle:['Replace all data?','替换全部数据？','すべてのデータを置き換えますか？','모든 데이터를 바꿀까요?'],
  bakReplaceWarn:['Everything stored in this browser (books, reading positions, tags, bookmarks, thumbnails and settings) will be deleted and cannot be recovered. Image files are not affected.','本浏览器中现有的书目、阅读进度、标签、书签、缩略图和设置都将被删除且无法恢复。图片原文件不受影响。','このブラウザーに保存されている本・読書位置・タグ・しおり・サムネイル・設定はすべて削除され、元に戻せません。画像ファイルには影響しません。','이 브라우저에 저장된 책, 읽기 위치, 태그, 책갈피, 썸네일, 설정이 모두 삭제되며 복구할 수 없습니다. 이미지 파일에는 영향이 없습니다.'],
  bakReplaceNow:['Delete and replace','删除并替换','削除して置き換え','삭제하고 바꾸기'],
  bakMerged:['Import complete: {added} books added, {merged} merged.','导入完成：新增 {added} 本，合并 {merged} 本。','読み込み完了：{added} 冊追加、{merged} 冊統合。','가져오기 완료: {added}권 추가, {merged}권 병합.'],
  bakReplaced:['Import complete: {books} books restored.','导入完成：已恢复 {books} 本书。','読み込み完了：{books} 冊を復元しました。','가져오기 완료: 책 {books}권 복원.'],
  bakRelink:['Reconnect their folders to read imported books.','导入的书需重新关联文件夹后才能阅读。','読み込んだ本はフォルダーを再度関連付けると読めます。','가져온 책은 폴더를 다시 연결해야 읽을 수 있습니다.']
});
const APP='MangaView', FORMAT=2, PREFIX='mv2:', DONE='mv-backup-result', types=[{description:'MangaView backup',accept:{'application/json':['.json']}}];
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const size=n=>!Number.isFinite(n)?'?':n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
// 去掉不能序列化或只在本次会话有效的字段：目录 / 文件句柄、失效标记。
// 格式 2：书目带 sources（每个源一个文件夹）；格式 1 的单文件夹记录在载入时转为一个源（见 app.mjs normalize）。
const page=({handle,...p})=>p;
export function strip(book){const {dir,missing,roots,...rest}=book,out={...rest,pages:(book.pages||[]).map(page)};
  if(Array.isArray(book.parked))out.parked=book.parked.map(page);
  if(Array.isArray(book.sources))out.sources=book.sources.map(({dir,missing,...s})=>s);
  return out;}
const noHandles=(k,v)=>(typeof FileSystemHandle!=='undefined'&&v instanceof FileSystemHandle)||v instanceof Blob?undefined:v;
const mv2Keys=()=>Object.keys(localStorage).filter(k=>k.startsWith(PREFIX));
function base64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.slice(r.result.indexOf(',')+1));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
function bytes(text){const bin=atob(text),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}

// 缩略图可能上千张：逐条转成 JSON 片段，每 64 条合成一个 Blob，不在内存里拼一个巨大字符串。
export async function build(ctx){
  ctx.flush();
  const storage={};for(const k of mv2Keys())storage[k]=localStorage.getItem(k);
  const books=[...ctx.books.values()].map(strip);
  const head=JSON.stringify({app:APP,format:FORMAT,exported:new Date().toISOString(),storage,books},noHandles);
  const chunks=[],parts=[head.slice(0,-1)+',"thumbs":['];let n=0;
  for(const key of await ctx.thumbs('getAllKeys')){
    const rec=await ctx.thumbs('get',key);if(!(rec?.blob instanceof Blob))continue;
    parts.push((n++?',':'')+JSON.stringify({key,w:rec.w,h:rec.h,type:rec.blob.type,data:await base64(rec.blob)}));
    if(parts.length>=64){chunks.push(new Blob(parts));parts.length=0;}
  }
  parts.push(']}');chunks.push(new Blob(parts));
  return {blob:new Blob(chunks,{type:'application/json'}),books:books.length,thumbs:n};
}
async function exportData(ctx){
  const d=new Date(),name=`mangaview-backup-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  // 先弹保存框：生成文件可能较慢，之后再调用会失去用户手势。
  const handle=window.showSaveFilePicker?await showSaveFilePicker({suggestedName:name,types}):null;
  ctx.notice('bakExporting',undefined,120000);
  const out=await build(ctx);
  if(handle){const w=await handle.createWritable();await w.write(out.blob);await w.close();}
  else{const a=ctx.make('a');a.href=URL.createObjectURL(out.blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);}
  ctx.notice(null,ctx.fmt('bakExported',{books:out.books,thumbs:out.thumbs}));
}

class BackupError extends Error{constructor(key){super(key);this.key=key;}}
// 完整校验并解码后才返回；任何一处不对都抛出 BackupError，此时尚未写入任何数据。
export async function parse(file){
  let data;try{data=JSON.parse(await file.text());}catch{throw new BackupError('bakInvalid');}
  if(!isObj(data)||data.app!==APP)throw new BackupError('bakNotBackup');
  if(data.format!==FORMAT&&data.format!==1)throw new BackupError(Number(data.format)>FORMAT?'bakNewer':'bakInvalid');
  const list=data.thumbs??[];
  if(!isObj(data.storage)||!Array.isArray(data.books)||!Array.isArray(list))throw new BackupError('bakInvalid');
  const ids=new Set();
  for(const b of data.books){
    const bad=list=>list!=null&&(!Array.isArray(list)||list.some(p=>!isObj(p)||typeof p.name!=='string'));
    if(!isObj(b)||typeof b.id!=='string'||!b.id||ids.has(b.id)||!Array.isArray(b.pages)||bad(b.pages)||bad(b.parked)
      ||b.sources!=null&&(!Array.isArray(b.sources)||b.sources.some(s=>!isObj(s)||typeof s.key!=='string')))throw new BackupError('bakInvalid');
    ids.add(b.id);
  }
  const storage=Object.entries(data.storage).filter(([k,v])=>k.startsWith(PREFIX)&&typeof v==='string');
  const thumbs=list.map(x=>{
    if(!isObj(x)||typeof x.key!=='string'||typeof x.data!=='string')throw new BackupError('bakInvalid');
    try{return {key:x.key,value:{blob:new Blob([bytes(x.data)],{type:typeof x.type==='string'&&x.type||'image/webp'}),w:x.w,h:x.h}};}catch{throw new BackupError('bakInvalid');}
  });
  return {exported:data.exported,storage,thumbs,books:data.books.map(b=>{const book=strip(b);book.place??='shelf';book.tags=Array.isArray(book.tags)?book.tags:[];book.bookmarks=Array.isArray(book.bookmarks)?book.bookmarks:[];return book;})};
}

// 书签按 id 取并集。区段书签（bookmarks.mjs 的 end）：本机的同一个书签没有区段书签而备份里有时补上；
// 并入后会与已有区段嵌套或交叉的区段书签不并入（书签本身照常并入），本机的区段一律保留。位置按本机记录的页序换算（sections.mjs）。
export function mergeMarks(pages,marks,incoming){
  const pos=new Map((Array.isArray(pages)?pages:[]).map((p,i)=>[p?.name,i])),key=m=>m?.id??JSON.stringify(m);
  const at=m=>{const i=pos.get(m?.name);return i==null||!Number.isFinite(m?.f)?NaN:i+m.f;};
  const out=[...marks],byId=new Map(out.map(m=>[key(m),m]));
  const item=m=>({id:m?.id,at:at(m),end:isObj(m?.end)?(at(m.end)>at(m)?at(m.end):null):undefined});
  // 两头都在、终点在起点之后时才检查冲突；暂不生效的区段不占范围，照常并入。
  const ok=(start,end)=>{const a=at(start),b=at(end);return !(Number.isFinite(a)&&Number.isFinite(b)&&b>a)||fits(out.map(item),start.id,a,b);};
  for(const m of incoming){
    const mine=byId.get(key(m));
    if(mine){if(isObj(mine)&&!mine.end&&isObj(m?.end)&&ok(mine,m.end))mine.end=m.end;continue;}
    let add=m;if(isObj(m)&&isObj(m.end)&&!ok(m,m.end)){const {end,...rest}=m;add=rest;}
    out.push(add);byId.set(key(add),add);
  }
  return out;
}
// 合并：同 id 以本机记录为准，只并入标签和书签（含区段书签，见 mergeMarks）、补上自定义封面；阅读位置只补缺；设置覆盖（mv2:last 除外）；缩略图只补缺。
export async function merge(ctx,data){
  ctx.flush();
  const saved=new Map((await ctx.library('getAll')).map(b=>[b.id,b]));let added=0,merged=0;
  for(const b of data.books){
    const mine=ctx.books.get(b.id)??saved.get(b.id);
    if(!mine){await ctx.library('put',b);added++;continue;}
    const tags=Array.isArray(mine.tags)?mine.tags:[],marks=Array.isArray(mine.bookmarks)?mine.bookmarks:[];
    mine.tags=[...new Set([...tags,...b.tags])];
    mine.bookmarks=mergeMarks(mine.pages,marks,b.bookmarks);
    if(!mine.customCover&&isObj(b.customCover))mine.customCover=b.customCover; // 自定义封面的缩略图（`${id}:custom`）随下面的缩略图补缺一起并入
    await ctx.library('put',mine);merged++;
  }
  const keys=new Set(await ctx.thumbs('getAllKeys'));
  for(const x of data.thumbs)if(!keys.has(x.key))await ctx.thumbs('put',x.value,x.key);
  for(const [k,v] of data.storage){
    if(k===PREFIX+'last'||k.startsWith(PREFIX+'pos:')&&localStorage.getItem(k)!==null)continue;
    localStorage.setItem(k,v);
  }
  return {added,merged};
}
// 替换：先放下当前书，避免之后 pagehide 把本机阅读位置写回；再清空全部数据写入备份。
// 内存中的书目也先清空，后台任务晚到的保存不会把旧记录写回（见 app.mjs persist）。
export async function replace(ctx,data){
  ctx.select(null);ctx.books.clear();
  await ctx.library('clear');await ctx.thumbs('clear');for(const k of mv2Keys())localStorage.removeItem(k);
  for(const b of data.books)await ctx.library('put',b);
  for(const x of data.thumbs)await ctx.thumbs('put',x.value,x.key);
  for(const [k,v] of data.storage)localStorage.setItem(k,v);
}

// 小对话框：第一步选合并 / 替换，选替换时再确认一次。返回 'merge' | 'replace' | null。
function ask(ctx,data){
  const {make,t}=ctx,d=make('dialog','bak-ask');d.setAttribute('aria-labelledby','bakAskTitle');document.body.append(d);
  const date=new Date(data.exported),when=isNaN(date)?'?':date.toLocaleString(ctx.lang);
  const button=(key,cls,fn)=>{const b=make('button',cls,t(key));b.type='button';b.onclick=fn;return b;};
  return new Promise(resolve=>{
    let result=null;const done=v=>{result=v;d.close();};
    function step(warn){
      const head=make('header'),h=make('h2','',t(warn?'bakReplaceTitle':'bakAskTitle')),body=make('div','bak-body'),acts=make('div','bak-actions');
      h.id='bakAskTitle';head.append(h,ctx.iconButton('close',t('close'),()=>d.close()));
      if(warn){const p=make('p','bak-warn');p.append(ctx.icon('alert'),make('span','',t('bakReplaceWarn')));body.append(p);
        acts.append(button('bakBack','',()=>step(false)),button('bakReplaceNow','danger',()=>done('replace')));}
      else{
        const choice=(key,hint)=>{const el=make('div','bak-choice');el.append(make('strong','',t(key)),make('span','',t(hint)));return el;};
        const note=make('p','bak-note');note.append(ctx.icon('info'),make('span','',t('bakNote')));
        body.append(make('p','bak-summary',ctx.fmt('bakSummary',{books:data.books.length,thumbs:data.thumbs.length,date:when})),choice('bakMerge','bakMergeHint'),choice('bakReplace','bakReplaceHint'),note);
        acts.append(button('bakCancel','',()=>d.close()),button('bakReplace','danger',()=>step(true)),button('bakMerge','primary',()=>done('merge')));
      }
      d.replaceChildren(head,body,acts);(warn?acts.firstChild:acts.lastChild).focus();
    }
    d.onclose=()=>{d.remove();resolve(result);};
    step(false);d.showModal();
  });
}
function chooseFile(){
  if(window.showOpenFilePicker)return showOpenFilePicker({types}).then(([h])=>h.getFile());
  return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=()=>resolve(input.files[0]||null);input.oncancel=()=>resolve(null);input.click();});
}
async function importData(ctx){
  const file=await chooseFile();if(!file)return;
  let data;try{data=await parse(file);}catch(e){if(e instanceof BackupError){ctx.notice(e.key,undefined,8000);return;}throw e;}
  const mode=await ask(ctx,data);if(!mode)return;
  ctx.notice('bakImporting',undefined,120000);
  let result;
  if(mode==='merge'){const r=await merge(ctx,data);result=['bakMerged',r,r.added>0];}
  else{await replace(ctx,data);result=['bakReplaced',{books:data.books.length},data.books.length>0];}
  // 重新载入页面，让书架、当前书和各模块状态都从存储重新读取；结果提示在载入后按导入后的语言显示。
  sessionStorage.setItem(DONE,JSON.stringify(result));location.reload();
}

function usage(ctx){
  const {make,t}=ctx,text=make('div','set-text'),value=make('span','bak-usage','…'),out=document.createDocumentFragment();
  const counts=make('small','',ctx.fmt('bakCounts',{books:ctx.books.size,thumbs:'…'}));text.append(make('span','set-label',t('bakStorage')),counts);out.append(text,value);
  Promise.all([ctx.thumbs('count'),navigator.storage?.estimate?.()]).then(([n,est])=>{
    counts.textContent=ctx.fmt('bakCounts',{books:ctx.books.size,thumbs:n});
    value.textContent=est?ctx.fmt('bakUsage',{used:size(est.usage),quota:size(est.quota),p:est.quota?Math.round(est.usage/est.quota*100):0}):'';
  }).catch(()=>{value.textContent='';});
  return out;
}
export function install(ctx){
  const done=sessionStorage.getItem(DONE);sessionStorage.removeItem(DONE);
  if(done)try{const [key,vars,relink]=JSON.parse(done);setTimeout(()=>ctx.notice(null,ctx.fmt(key,vars)+(relink?' '+ctx.t('bakRelink'):''),8000),300);}catch{}
  ctx.settings.push(
    {id:'bakNote',group:'data',type:'custom',render(){const p=ctx.make('p','bak-note');p.append(ctx.icon('info'),ctx.make('span','',ctx.t('bakNote')));return p;}},
    {id:'bakExport',group:'data',type:'button',label:'bakExport',hint:'bakExportHint',action:'bakExportBtn',icon:'download',run:()=>exportData(ctx)},
    {id:'bakImport',group:'data',type:'button',label:'bakImport',hint:'bakImportHint',action:'bakImportBtn',icon:'upload',run:()=>importData(ctx)},
    {id:'bakStorage',group:'data',type:'custom',render:()=>usage(ctx)},
    {id:'bakClear',group:'data',type:'button',label:'bakClear',hint:'bakClearHint',action:'bakClearBtn',icon:'trash',danger:true,run:()=>ctx.actions.clear()});
}
