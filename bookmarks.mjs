import {extend} from './lang.mjs';
import {at,point} from './model.mjs';
import {forget} from './thumbs.mjs';
// 书签：book.bookmarks=[{id,name,f,at}]，按图片文件名定位，重新排序后仍有效。缩略图存在 thumbs store 的 `${book.id}:bm:${id}`。
extend({
  bmAdd:['Add bookmark','添加书签','しおりを追加','책갈피 추가'],bmHold:['Hold','长按','長押し','길게'],
  bmEmpty:['No bookmarks yet','还没有书签','しおりはまだありません','아직 책갈피가 없습니다'],
  bmNone:['No bookmarks yet — hold G or Enter to add one','还没有书签，长按 G 或 Enter 添加','しおりはまだありません。G か Enter を長押しで追加','아직 책갈피가 없습니다. G 또는 Enter를 길게 눌러 추가하세요'],
  bmAllGone:['The bookmarked images no longer exist','书签所在的图片都已不存在','しおりの画像が見つかりません','책갈피한 이미지가 더 이상 없습니다'],
  bmAdded:['Bookmark added','已添加书签','しおりを追加しました','책갈피를 추가했습니다'],
  bmExists:['There is already a bookmark here','这里已有书签','ここにはすでにしおりがあります','여기에 이미 책갈피가 있습니다'],
  bmKeep:['Keep holding to add a bookmark','继续按住添加书签','押し続けるとしおりを追加','계속 누르면 책갈피 추가'],
  bmN:['Bookmark {n} / {m}','书签 {n} / {m}','しおり {n} / {m}','책갈피 {n} / {m}'],
  bmWrap:['Back to the first bookmark','已回到第一个书签','最初のしおりに戻りました','첫 번째 책갈피로 돌아왔습니다'],
  bmPage:['Image {n}','第 {n} 张','{n} 枚目','{n}번째'],bmGone:['Image missing','图片已不存在','画像なし','이미지 없음'],
  bmDelete:['Delete bookmark','删除书签','しおりを削除','책갈피 삭제']
});
const SHOW=150,ADD=550,HOVER=60;
export function install(ctx){
  const {main,view,t,fmt,notice,make,icon}=ctx;
  const sprite=document.querySelector('svg.sprite'),mark='M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z';
  if(sprite&&!document.getElementById('i-bookmark'))sprite.insertAdjacentHTML('beforeend',`<symbol id="i-bookmark" viewBox="0 0 24 24"><path d="${mark}"/></symbol><symbol id="i-bookmark-plus" viewBox="0 0 24 24"><path d="${mark}"/><path d="M12 7v6M9 10h6"/></symbol>`);
  const key=(book,bm)=>book.id+':bm:'+bm.id;
  function starts(){const s=view.panes[0].starts,b=ctx.current;return b?.pages.length&&s.length===b.pages.length+1?s:null;}
  // 屏幕中心所在的图与图内位置（view.anchor() 在书首返回 null，这里不能用）。
  function here(){const s=starts();if(!s)return null;const {i,f}=at(s,main.scrollTop+main.clientHeight/2);return {i,f,name:ctx.current.pages[i].name,h:s[i+1]-s[i]};}
  // 按当前页序排列；文件名已不存在的排在最后，i 为 -1。
  function list(book){const pos=new Map(book.pages.map((p,i)=>[p.name,i]));
    return (book.bookmarks||[]).map(bm=>({bm,i:pos.get(bm.name)??-1})).sort((a,b)=>(a.i<0)-(b.i<0)||a.i-b.i||a.bm.f-b.bm.f||a.bm.at-b.bm.at);}
  let last=null; // 最近一次跳到的书签：滚动位置被夹住（书首 / 书尾）时仍能接着跳下一个。
  function go(x){view.jump({i:x.i,f:x.bm.f});last={id:x.bm.id,top:main.scrollTop};}
  function next(){
    const book=ctx.current;if(!book)return;
    if(!book.bookmarks?.length){notice(null,t('bmNone'));return;}
    const valid=list(book).filter(x=>x.i>=0),s=starts();if(!valid.length){notice('bmAllGone');return;}if(!s)return;
    let k=last&&Math.abs(main.scrollTop-last.top)<2?valid.findIndex(x=>x.bm.id===last.id):-1;
    if(k>=0)k++;else{const y=main.scrollTop+main.clientHeight/2;k=valid.findIndex(x=>point(s,{i:x.i,f:x.bm.f})>y+2);}
    const wrap=k<0||k>=valid.length;if(wrap)k=0;
    go(valid[k]);notice(null,wrap?t('bmWrap'):fmt('bmN',{n:k+1,m:valid.length}));
  }
  // 缩略图：截取屏幕中心所在那张图、以中心为准、与视口等比例的区域，换算到原图像素。
  async function snap(book,bm,page,p,vw,vh){
    let crop=null;
    if(page.w&&page.h){const s=page.h/p.h,k=Math.min(1,page.w/(vw*s),page.h/(vh*s)),w=vw*s*k,h=vh*s*k;
      crop={x:Math.round((page.w-w)/2),y:Math.round(Math.min(page.h-h,Math.max(0,p.f*page.h-h/2))),w:Math.round(w),h:Math.round(h)};}
    const thumb=await ctx.makeThumb(await ctx.source(book,page),{width:240,crop});
    if(!book.bookmarks.includes(bm))return;await ctx.saveThumb(key(book,bm),thumb);if(book===ctx.current&&!panel.hidden)render();
  }
  async function add(){
    const book=ctx.current,p=here();if(!book||!p)return false;
    if(book.bookmarks.some(b=>b.name===p.name&&Math.abs(b.f-p.f)*p.h<main.clientHeight/2)){notice('bmExists');return false;}
    const bm={id:crypto.randomUUID(),name:p.name,f:p.f,at:Date.now()},page=book.pages[p.i];
    book.bookmarks=list({pages:book.pages,bookmarks:[...book.bookmarks,bm]}).map(x=>x.bm);await ctx.persist(book);
    notice('bmAdded');if(!panel.hidden)render();
    snap(book,bm,page,p,main.clientWidth,main.clientHeight).catch(e=>console.warn(e)); // 读图失败只缺缩略图，书签照常可用
    return true;
  }
  async function drop(book,bm){
    book.bookmarks=book.bookmarks.filter(b=>b!==bm);if(last?.id===bm.id)last=null;await ctx.persist(book);
    forget(key(book,bm));await ctx.thumbs('delete',key(book,bm));if(!panel.hidden)render();
  }

  // 面板：右键呼出，“添加书签”按钮正好在鼠标下；悬停缩略图即跳转，离开面板关闭，Esc 回到原位。
  const panel=make('div','bm-panel'),addBtn=make('button','bm-add'),head=make('div','bm-head'),grid=make('div','bm-grid');
  panel.hidden=true;panel.setAttribute('role','dialog');addBtn.type='button';panel.append(addBtn,head,grid);document.body.append(panel);
  let saved=null,origin=null,armed=false,hovered=null,hoverTimer=0,pointer=null;
  function render(){
    const book=ctx.current;if(!book)return;
    panel.setAttribute('aria-label',t('bookmarks'));
    const keys=make('span','bm-keys',t('bmHold'));keys.append(make('kbd','','G'),'/',make('kbd','','Enter'));
    addBtn.replaceChildren(icon('bookmark-plus'),make('span','label',t('bmAdd')),keys);
    const items=list(book);head.replaceChildren(make('span','',t('bookmarks')),make('span','count',items.length||''));
    if(!items.length){grid.replaceChildren(make('p','bm-empty',t('bmEmpty')));return;}
    grid.replaceChildren(...items.map(x=>{
      const item=make('div','bm-item'+(x.i<0?' gone':'')),thumb=make('span','bm-thumb'),img=make('img');
      item.dataset.id=x.bm.id;item.title=x.bm.name;img.alt='';img.draggable=false;thumb.append(img);
      const none=()=>{img.remove();thumb.classList.add('empty');};ctx.getThumb(key(book,x.bm)).then(th=>{if(th)img.src=th.url;else none();},none);
      item.append(thumb,make('span','bm-page',x.i<0?t('bmGone'):fmt('bmPage',{n:x.i+1})),ctx.iconButton('close',t('bmDelete'),()=>drop(book,x.bm),'bm-del'));
      return item;
    }));
  }
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function open(x,y){
    if(!ctx.current)return;
    const p=here();saved=p&&{name:p.name,f:p.f};origin=x==null?pointer:{x,y};armed=false;hovered=null;
    panel.style.setProperty('--bm-ar',String(main.clientWidth/Math.max(1,main.clientHeight)));
    panel.style.setProperty('--bm-cols',main.clientWidth>main.clientHeight*1.2?2:3);
    render();panel.style.left=panel.style.top='0px';panel.hidden=false;
    // 用布局尺寸而非 getBoundingClientRect：弹出动画的缩放会让后者偏几像素。
    const w=panel.offsetWidth,h=panel.offsetHeight;let left,top;
    if(x==null){const m=main.getBoundingClientRect();left=m.left+(m.width-w)/2;top=m.top+Math.max(0,(m.height-h)/2.6);}
    else{left=x-panel.clientLeft-addBtn.offsetLeft-addBtn.offsetWidth/2;top=y-panel.clientTop-addBtn.offsetTop-addBtn.offsetHeight/2;}
    panel.style.left=clamp(left,8,innerWidth-w-8)+'px';panel.style.top=clamp(top,8,innerHeight-h-8)+'px';
  }
  function close(restore){
    if(panel.hidden)return;clearTimeout(hoverTimer);panel.hidden=true;hovered=null;
    if(restore&&saved&&ctx.current){const i=ctx.current.pages.findIndex(p=>p.name===saved.name);if(i>=0)view.jump({i,f:saved.f});}
    saved=null;if(document.activeElement&&panel.contains(document.activeElement))main.focus();
  }
  function jumpTo(id){const book=ctx.current,x=book&&list(book).find(x=>x.bm.id===id);if(x&&x.i>=0)go(x);}
  main.addEventListener('contextmenu',e=>{if(!ctx.current)return;e.preventDefault();open(e.clientX,e.clientY);});
  panel.addEventListener('contextmenu',e=>e.preventDefault());
  // 弹出后鼠标真正移动过才响应悬停和离开：面板出现在鼠标下时不误跳，浏览器补发的离开事件也不会立刻关掉面板。
  document.addEventListener('pointermove',e=>{pointer={x:e.clientX,y:e.clientY};},{passive:true});
  const moved=e=>!origin||Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>3;
  panel.addEventListener('pointermove',e=>{
    if(!armed&&moved(e))armed=true;if(!armed)return;
    const item=e.target.closest('.bm-item');if(item===hovered)return;hovered=item;clearTimeout(hoverTimer);
    grid.querySelector('.bm-item.active')?.classList.remove('active');
    if(item&&!item.classList.contains('gone')){item.classList.add('active');hoverTimer=setTimeout(()=>jumpTo(item.dataset.id),HOVER);}
  });
  panel.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&(armed||moved(e)))close(false);});
  panel.addEventListener('click',e=>{
    if(e.target.closest('.bm-del'))return;
    if(e.target.closest('.bm-add')){ctx.safe(add)();main.focus();return;}
    const item=e.target.closest('.bm-item');if(!item||item.classList.contains('gone'))return;
    clearTimeout(hoverTimer);jumpTo(item.dataset.id);close(false);main.focus();
  });
  document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target))close(false);},true);
  window.addEventListener('keydown',e=>{if(!panel.hidden&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);}},true);
  ctx.actions.bookmarks=()=>{if(!panel.hidden)close(false);else open(null,null);};

  // G / Enter：短按跳到下一个书签；长按 150ms 后显示进度环，满 550ms 添加书签。
  const hold=make('div','bm-hold'),dial=make('span','bm-dial'),text=make('span','bm-text'),glyph=icon('bookmark');
  dial.innerHTML='<svg class="bm-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="17"/><circle class="fill" cx="20" cy="20" r="17" pathLength="100"/></svg>';
  dial.append(glyph);hold.append(dial,text);hold.hidden=true;hold.setAttribute('aria-hidden','true');document.body.append(hold);
  let press=null,doneTimer=0;
  function showHold(state){clearTimeout(doneTimer);hold.classList.toggle('done',state==='done');glyph.firstChild.setAttribute('href','#i-'+(state==='done'?'check':'bookmark'));
    text.textContent=t(state==='done'?'bmAdded':'bmKeep');hold.hidden=false;if(state==='done')doneTimer=setTimeout(()=>{hold.hidden=true;},900);}
  function cancel(){if(!press)return;clearTimeout(press.show);clearTimeout(press.add);if(!press.done)hold.hidden=true;press=null;}
  ctx.keys.push({
    down(e){
      if(e.key!=='Enter'&&e.key.toLowerCase()!=='g')return false;
      e.preventDefault();if(e.repeat||press)return true;
      const p=press={code:e.code,done:false};
      p.show=setTimeout(()=>showHold('fill'),SHOW);
      p.add=setTimeout(()=>{p.done=true;ctx.safe(async()=>{if(await add())showHold('done');else hold.hidden=true;})();},ADD);
      return true;
    },
    up(e){if(!press||e.code!==press.code)return;const p=press;cancel();if(!p.done)next();},
    blur(){cancel();}
  });
  ctx.on('select',()=>{cancel();close(false);last=null;});
  ctx.on('lang',()=>{if(!panel.hidden)render();});
}
