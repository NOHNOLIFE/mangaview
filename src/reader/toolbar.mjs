// 工具：顶部工具栏（鼠标贴近顶缘稍作停留即弹出，离开后由 app.mjs 的 pointerleave 收起；窄窗口自动换行）
// 与底部操作栏（贴近底缘弹出：上一本 / 回到书首 / 位置 / 滚到书尾 / 下一本）。
import {extend} from '../core/lang.mjs';
extend({
  tbEdgeTop:['Show tools at the top edge','鼠标移到顶缘时弹出工具栏','上端でツールを表示','위쪽 가장자리에서 도구 표시'],
  tbEdgeBottom:['Show the action bar at the bottom edge','鼠标移到底缘时弹出操作栏','下端で操作バーを表示','아래쪽 가장자리에서 작업 표시줄 표시'],
  ebScoped:['Only switches within the shelf filter results','仅在书架筛选结果内切换','本棚の絞り込み結果の中だけで切り替え','책장 필터 결과 안에서만 전환']
});
const DWELL=120,LEAVE=450; // 边缘触发区的距离四边统一，见 app.mjs 的 ctx.atEdge
export function install(ctx){
  const $=id=>document.getElementById(id), toolbar=$('toolbar'), bar=$('bar'), tab=$('tab'), main=ctx.main, end=$('endbar');
  // 书签、设置由其他模块注册 action；模块在本模块之后安装，所以延后检查，未注册时隐藏按钮。
  const sync=()=>{for(const el of bar.querySelectorAll('[data-optional]'))el.hidden=!ctx.actions[el.dataset.act];};
  ctx.dropKey('toolbarColumns'); // 旧版的单列 / 双列设置
  // 按钮只显示图标（操作栏放不下时也只显示图标）：把（已本地化的）文字写进 title 作为悬停提示，切换语言时同步。
  const tips=()=>{for(const el of [...bar.querySelectorAll('.tb'),...end.querySelectorAll('.eb')])el.title=el.querySelector('span')?.textContent??'';syncEnd();syncBooks();fitEnd();};
  queueMicrotask(sync);ctx.on('select',sync);
  // 换行后，落在行首或行尾的分隔线隐藏：前后两个可见按钮不在同一行即是。
  const edges=()=>{if(bar.hidden)return;for(const s of bar.querySelectorAll('.sep')){
    let a=s.previousElementSibling,b=s.nextElementSibling;while(a?.hidden)a=a.previousElementSibling;while(b?.hidden)b=b.nextElementSibling;
    s.classList.toggle('edge',!a||!b||a.offsetTop!==b.offsetTop);}};
  new ResizeObserver(edges).observe(bar);
  const dialog=()=>document.querySelector('dialog[open]');
  // 顶缘：窗口控件覆盖区（--top）以下的边缘触发区内。菜单按钮平时不可见，但位置仍在左上角（--top + 8px）。
  const topInset=()=>tab.getBoundingClientRect().top-8;
  // 正在显示的侧栏（常驻或浮动弹出）顶部是它们的头部行（含“打开全屏”按钮），这一段不算顶缘，避免在按钮上停留时误弹工具栏。
  const sides=[$('panel'),$('shelfmarks')];
  const overSide=x=>sides.some(el=>{if(!el||el.hidden)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right;});
  let edgeTimer=0,leaveTimer=0,auto=false;
  const cancel=()=>{clearTimeout(edgeTimer);edgeTimer=0;}, stay=()=>{clearTimeout(leaveTimer);leaveTimer=0;};
  new MutationObserver(()=>{if(bar.hidden){auto=false;stay();}else{sync();edges();}}).observe(bar,{attributes:true,attributeFilter:['hidden']});

  // ---- 底部操作栏：按钮固定为 上一本、回到书首、位置、滚到书尾、下一本。
  // 回到书首 / 滚到书尾只滚动（已在首尾时变灰），切书交给两端的上一本 / 下一本；Home / End 在首尾再按一次切书的键盘行为不变（app.mjs）。
  const [prevBtn,startBtn,endBtn,nextBtn]=['prev','toStart','toEnd','next'].map(a=>end.querySelector(`[data-act="${a}"]`));
  ctx.actions.toStart=()=>{if(!ctx.atStart())ctx.toStart();};ctx.actions.toEnd=()=>{if(!ctx.atEnd())ctx.toEnd();};
  function syncEnd(){
    if(end.hidden)return;startBtn.disabled=ctx.atStart();endBtn.disabled=ctx.atEnd();
    syncPos();
  }
  // 位置只显示“已读 / 总张数”（滚到书尾即 n / n）。按总张数的位数预留宽度：零高度的隐藏占位串（::after）撑开宽度（等宽数字），
  // 滚动中位数变化时两侧按钮不左右移动。
  const pos=$('endPos');
  function syncPos(){const p=ctx.current&&ctx.view.position(),n=p?.n??ctx.current?.pages.length??0,d=String(n).length;
    pos.textContent=p?`${ctx.atEnd()?n:p.i+1} / ${n}`:'';pos.dataset.room=n?`${'0'.repeat(d)} / ${'0'.repeat(d)}`:'';}
  // 列表里没有别的书时，上一本 / 下一本变灰。
  // 书架页设了筛选条件时，上一本 / 下一本只在筛选结果内切换：按钮带一个小圆点，提示文字说明原因。
  function syncBooks(){if(end.hidden)return;const others=!!ctx.current&&ctx.readingList(ctx.current).some(b=>b!==ctx.current);prevBtn.disabled=nextBtn.disabled=!others;
    const scoped=!!ctx.filtering?.();for(const b of [prevBtn,nextBtn]){b.classList.toggle('scoped',scoped);b.title=(b.querySelector('span')?.textContent??'')+(scoped?' · '+ctx.t('ebScoped'):'');}}
  // 宽度不够放下文字时只显示图标：先按完整宽度量一次，再决定。
  function fitEnd(){if(end.hidden)return;end.classList.remove('compact');if(end.scrollWidth>end.clientWidth+1)end.classList.add('compact');}
  let endTimer=0,endLeave=0;
  const endCancel=()=>{clearTimeout(endTimer);endTimer=0;}, endStay=()=>{clearTimeout(endLeave);endLeave=0;};
  function showEnd(open){endStay();ctx.fade(end,open);document.body.classList.toggle('endbar-open',open);if(open){syncEnd();syncBooks();fitEnd();}}
  const nearBottom=e=>{const r=main.getBoundingClientRect();return ctx.atEdge('bottom',e)&&e.clientX>=r.left&&e.clientX<=r.right;};
  main.addEventListener('scroll',()=>{if(ctx.showing(end))requestAnimationFrame(syncEnd);},{passive:true});
  new ResizeObserver(()=>{if(ctx.showing(end))fitEnd();}).observe(main); // 窗口缩放、侧栏停靠时阅读区宽度变化
  end.addEventListener('click',()=>main.focus()); // 按钮不留焦点，F / Enter / 空格继续作用于正文
  ctx.on('select',()=>{if(!ctx.current)showEnd(false);else setTimeout(()=>{syncEnd();syncBooks();});});ctx.on('books',syncBooks);
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&ctx.showing(end))showEnd(false);});

  document.addEventListener('pointermove',e=>{
    const mouse=e.pointerType==='mouse'&&!e.buttons;
    // 顶缘弹出工具栏
    const near=mouse&&ctx.atEdge('top',e,topInset())&&bar.hidden&&!dialog()&&!overSide(e.clientX)&&ctx.get('edgeTop',true);
    if(!near)cancel();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(bar.hidden&&!dialog()){ctx.showBar(true);auto=true;}},DWELL);
    // 面板在指针下方出现时浏览器未必补发 pointerenter，指针直接移走就收不到 pointerleave，这里兜底收起。
    if(auto&&!bar.hidden&&e.pointerType==='mouse'){
      if(toolbar.contains(e.target))stay();
      else if(!leaveTimer)leaveTimer=setTimeout(()=>{leaveTimer=0;if(!toolbar.matches(':hover')&&!toolbar.querySelector(':focus-visible'))ctx.showBar(false);},LEAVE);
    }
    // 底缘弹出操作栏；离开后收起
    const low=mouse&&ctx.current&&nearBottom(e)&&!ctx.showing(end)&&!dialog()&&ctx.get('edgeBottom',true);
    if(!low)endCancel();else if(!endTimer)endTimer=setTimeout(()=>{endTimer=0;if(ctx.current&&!dialog())showEnd(true);},DWELL);
    if(ctx.showing(end)&&e.pointerType==='mouse'){
      if(end.contains(e.target)||nearBottom(e))endStay();
      else if(!endLeave)endLeave=setTimeout(()=>{endLeave=0;if(!end.matches(':hover')&&!end.querySelector(':focus-visible'))showEnd(false);},LEAVE);
    }
  });
  document.addEventListener('pointerout',e=>{if(!e.relatedTarget){cancel();endCancel();}});
  tips();ctx.on('lang',tips);
  ctx.prefs?.sync('edgeTop');ctx.prefs?.sync('edgeBottom');
  ctx.settings.push(
    {id:'edgeTop',group:'toolbar',label:'tbEdgeTop',type:'toggle',get:()=>ctx.get('edgeTop',true),set:v=>ctx.put('edgeTop',!!v)},
    {id:'edgeBottom',group:'toolbar',label:'tbEdgeBottom',type:'toggle',get:()=>ctx.get('edgeBottom',true),set:v=>ctx.put('edgeBottom',!!v)});
}
