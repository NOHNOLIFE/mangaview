// 工具：顶部横向工具栏（鼠标贴近顶缘稍作停留即弹出，离开后由 app.mjs 的 pointerleave 收起）与底部首尾栏（贴近底缘弹出：回到书首 / 滚到书尾，已在首尾时变为上 / 下一本）。
import {extend} from './lang.mjs';
extend({
  tbEdgeTop:['Show tools at the top edge','鼠标移到顶缘时弹出工具栏','上端でツールを表示','위쪽 가장자리에서 도구 표시'],
  tbEdgeBottom:['Show start / end buttons at the bottom edge','鼠标移到底缘时弹出首尾栏','下端で先頭／末尾ボタンを表示','아래쪽 가장자리에서 처음 / 끝 버튼 표시']
});
const EDGE=24,DWELL=120,LEAVE=450;
export function install(ctx){
  const $=id=>document.getElementById(id), toolbar=$('toolbar'), bar=$('bar'), tab=$('tab'), main=ctx.main, end=$('endbar');
  // 书签、设置由其他模块注册 action；模块在本模块之后安装，所以延后检查，未注册时隐藏按钮。
  const sync=()=>{for(const el of bar.querySelectorAll('[data-optional]'))el.hidden=!ctx.actions[el.dataset.act];};
  ctx.dropKey('toolbarColumns'); // 旧版的单列 / 双列设置
  // 按钮只显示图标：把（已本地化的）文字写进 title 作为悬停提示，切换语言时同步。
  const tips=()=>{for(const el of bar.querySelectorAll('.tb'))el.title=el.querySelector('span')?.textContent??'';syncEnd();};
  queueMicrotask(sync);ctx.on('select',sync);
  const dialog=()=>document.querySelector('dialog[open]');
  // 顶缘：窗口控件覆盖区（--top）以下 EDGE 像素内。
  const topInset=()=>tab.getBoundingClientRect().top-8;
  let edgeTimer=0,leaveTimer=0,auto=false;
  const cancel=()=>{clearTimeout(edgeTimer);edgeTimer=0;}, stay=()=>{clearTimeout(leaveTimer);leaveTimer=0;};
  new MutationObserver(()=>{if(bar.hidden){auto=false;stay();}else sync();}).observe(bar,{attributes:true,attributeFilter:['hidden']});

  // ---- 底部首尾栏
  const ends=[...end.querySelectorAll('.eb')];
  ctx.actions.toStart=()=>ctx.toStart();ctx.actions.toEnd=()=>ctx.toEnd();
  function syncEnd(){
    if(end.hidden)return;const s=ctx.atStart(),e=ctx.atEnd();
    for(const [btn,swap,icon,key] of [[ends[0],s,s?'skip-back':'to-top',s?'prev':'toTop'],[ends[1],e,e?'skip-forward':'to-end',e?'next':'toEnd']]){
      btn.querySelector('use').setAttribute('href','#i-'+icon);btn.querySelector('span').textContent=ctx.t(key);btn.classList.toggle('swap',swap);}
    $('endPos').textContent=$('bookMeta').textContent;
  }
  let endTimer=0,endLeave=0;
  const endCancel=()=>{clearTimeout(endTimer);endTimer=0;}, endStay=()=>{clearTimeout(endLeave);endLeave=0;};
  function showEnd(open){endStay();ctx.fade(end,open);document.body.classList.toggle('endbar-open',open);if(open)syncEnd();}
  const nearBottom=e=>{const r=main.getBoundingClientRect();return e.clientY>=innerHeight-EDGE&&e.clientX>=r.left&&e.clientX<=r.right;};
  main.addEventListener('scroll',()=>{if(ctx.showing(end))requestAnimationFrame(syncEnd);},{passive:true});
  end.addEventListener('click',()=>main.focus()); // 按钮不留焦点，G / Enter / 空格继续作用于正文
  ctx.on('select',()=>{if(!ctx.current)showEnd(false);else setTimeout(syncEnd);});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&ctx.showing(end))showEnd(false);});

  document.addEventListener('pointermove',e=>{
    const mouse=e.pointerType==='mouse'&&!e.buttons;
    // 顶缘弹出工具栏
    const near=mouse&&e.clientY-topInset()<=EDGE&&bar.hidden&&!dialog()&&ctx.get('edgeTop',true);
    if(!near)cancel();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(bar.hidden&&!dialog()){ctx.showBar(true);auto=true;}},DWELL);
    // 面板在指针下方出现时浏览器未必补发 pointerenter，指针直接移走就收不到 pointerleave，这里兜底收起。
    if(auto&&!bar.hidden&&e.pointerType==='mouse'){
      if(toolbar.contains(e.target))stay();
      else if(!leaveTimer)leaveTimer=setTimeout(()=>{leaveTimer=0;if(!toolbar.matches(':hover')&&!toolbar.querySelector(':focus-visible'))ctx.showBar(false);},LEAVE);
    }
    // 底缘弹出首尾栏；离开后收起
    const low=mouse&&ctx.current&&nearBottom(e)&&!ctx.showing(end)&&!dialog()&&ctx.get('edgeBottom',true);
    if(!low)endCancel();else if(!endTimer)endTimer=setTimeout(()=>{endTimer=0;if(ctx.current&&!dialog())showEnd(true);},DWELL);
    if(ctx.showing(end)&&e.pointerType==='mouse'){
      if(end.contains(e.target)||nearBottom(e))endStay();
      else if(!endLeave)endLeave=setTimeout(()=>{endLeave=0;if(!end.matches(':hover')&&!end.querySelector(':focus-visible'))showEnd(false);},LEAVE);
    }
  });
  document.addEventListener('pointerout',e=>{if(!e.relatedTarget){cancel();endCancel();}});
  tips();ctx.on('lang',tips);
  ctx.settings.push(
    {id:'edgeTop',group:'toolbar',label:'tbEdgeTop',type:'toggle',get:()=>ctx.get('edgeTop',true),set:v=>ctx.put('edgeTop',!!v)},
    {id:'edgeBottom',group:'toolbar',label:'tbEdgeBottom',type:'toggle',get:()=>ctx.get('edgeBottom',true),set:v=>ctx.put('edgeBottom',!!v)});
}
