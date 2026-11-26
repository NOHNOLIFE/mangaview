import {extend} from './lang.mjs';
import {forget,grabFrame} from './thumbs.mjs';
import {pageKind} from './model.mjs';
// 自定义封面：书架卡片的「设置封面」列出这本书的全部书签缩略图，点选其一即设为封面；「重置封面」恢复默认封面。对所有书可用。
// 自定义封面是一份独立的压缩小图，存在 thumbs 的 `${book.id}:custom`，记录为 book.customCover={bm,r,at}（r：高宽比，瀑布流按它排版；at：设置时间，卡片据此判断要不要换图）。
// 之后删除该书签、刷新、恢复、重新导入都不改变它；随书目和缩略图进入备份。它不参与识别：恢复用的指纹（book.fp）只来自默认封面。
extend({
  coverSet:['Set cover','设置封面','表紙を設定','표지 설정'],
  coverHint:['Pick a bookmark to use as the cover','点选一个书签作为封面','表紙にするしおりを選んでください','표지로 사용할 책갈피를 선택하세요'],
  coverNone:['This book has no bookmarks yet. Add a bookmark first, then pick it here.','这本书还没有书签，请先添加书签再来选择。','この本にはまだしおりがありません。先にしおりを追加してから選んでください。','이 책에는 아직 책갈피가 없습니다. 먼저 책갈피를 추가한 뒤 여기서 선택하세요.'],
  coverReset:['Reset cover','重置封面','表紙をリセット','표지 초기화'],
  coverDone:['Cover set','已设置封面','表紙を設定しました','표지를 설정했습니다'],
  coverResetDone:['Cover reset to the default','已恢复默认封面','既定の表紙に戻しました','기본 표지로 되돌렸습니다']
});
// 封面按卡片的默认比例（高:宽 = 1.42，shelf.mjs）从书签所在的图上截取：整宽，以书签的页内位置为中心；图比这更矮就取整张。尺寸未知时取整张。
const RATIO=1.42;
export function cropFor(page,f){
  if(!page?.w||!page?.h)return null;const h=Math.min(page.h,Math.round(page.w*RATIO));
  return {x:0,y:Math.round(Math.min(page.h-h,Math.max(0,f*page.h-h/2))),w:page.w,h};
}
export const customKey=book=>book.id+':custom';
export function install(ctx){
  const {t,make,notice}=ctx;
  const sprite=document.querySelector('svg.sprite');
  if(sprite&&!document.getElementById('i-cover'))sprite.insertAdjacentHTML('beforeend','<symbol id="i-cover" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="14.5" cy="8.5" r="1.6"/><path d="m4 17 4.5-4.5 4 4 2-2L20 19"/></symbol>');
  const dialog=make('dialog','cover-pick'),title=make('h2'),name=make('span','cp-name'),hint=make('p','cp-hint'),grid=make('div','cp-grid'),foot=make('div','cp-foot'),resetBtn=make('button','');
  title.id='coverTitle';dialog.setAttribute('aria-labelledby','coverTitle');resetBtn.type='button';
  const head=make('header'),heading=make('div','cp-title');heading.append(title,name);
  const shut=ctx.iconButton('close','',()=>dialog.close());head.append(heading,shut);foot.append(resetBtn);
  dialog.append(head,hint,grid,foot);document.body.append(dialog);
  let book=null;
  function open(b){
    if(!b||dialog.open)return;book=b;
    title.textContent=t('coverSet');name.textContent=ctx.title(b);name.title=ctx.title(b);shut.title=t('close');shut.setAttribute('aria-label',t('close'));
    resetBtn.textContent=t('coverReset');resetBtn.disabled=!b.customCover;
    // 音频书签没有画面，不列出；视频书签用书签时间点的画面。
    const items=(ctx.marks?.list(b)??[]).filter(x=>!(ctx.marks.isMedia(x.bm)&&x.i>=0&&pageKind(b.pages[x.i])==='audio'));
    hint.textContent=t(items.length?'coverHint':'coverNone');hint.classList.toggle('empty',!items.length);
    dialog.style.setProperty('--bm-ar',ctx.shelfmarks?.ratio()??'.75');
    grid.replaceChildren(...items.map(x=>{
      const btn=make('button','cp-item'+(b.customCover?.bm===x.bm.id?' current':'')),img=make('img');btn.type='button';img.alt='';img.draggable=false;
      btn.setAttribute('aria-label',ctx.marks.where(b,x));btn.append(img);
      if(ctx.marks.isMedia(x.bm))ctx.marks.paint(btn,img,b,x);
      else ctx.getThumb(ctx.marks.thumbKey(b,x.bm)).then(th=>{if(th)img.src=th.url;else btn.classList.add('empty');},()=>btn.classList.add('empty'));
      btn.onclick=()=>{dialog.close();ctx.safe(choose)(b,x);};return btn;
    }));
    dialog.showModal();(grid.querySelector('.current')||grid.firstChild||shut).focus();
  }
  // 源文件可读时按封面尺寸从书签位置重新截取，读不到（过期、句柄失效、图片已不存在）时用现有的书签缩略图。
  async function choose(b,x){
    let th=null;const page=x.i>=0?b.pages[x.i]:null;
    if(page&&!ctx.expired(b))try{const file=await ctx.source(b,page);th=ctx.marks.isMedia(x.bm)?await grabFrame(file,x.bm.t,{width:320}):await ctx.makeThumb(file,{width:320,crop:cropFor(page,x.bm.f)});}catch{}
    if(!th){const rec=await ctx.thumbs('get',ctx.marks.thumbKey(b,x.bm));if(rec?.blob)th={blob:rec.blob,w:rec.w,h:rec.h};}
    if(!th){notice('failed');return;}
    if(!ctx.books.has(b.id))return; // 期间这本书已被删除
    await ctx.saveThumb(customKey(b),th);b.customCover={bm:x.bm.id,r:th.h/th.w,at:Date.now()};await ctx.persist(b);
    ctx.refreshCard?.(b);notice('coverDone');
  }
  async function reset(b){
    if(!b.customCover)return;delete b.customCover;await ctx.persist(b);
    forget(customKey(b));await ctx.thumbs('delete',customKey(b));ctx.refreshCard?.(b);notice('coverResetDone');
  }
  resetBtn.onclick=()=>{const b=book;dialog.close();if(b)ctx.safe(reset)(b);};
  dialog.addEventListener('close',()=>{if(dialog.open)return; /* close 事件异步派发：期间已重新打开就不清理 */book=null;grid.replaceChildren();});
  ctx.pickCover=open;
}
