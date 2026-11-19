// 左侧纵向工具面板：鼠标贴近左缘稍作停留即弹出（机制同右缘缩略图栏），离开后由 app.mjs 的 pointerleave 收起。
import {extend} from './lang.mjs';
extend({
  tbEdgeLeft:['Show tools at the left edge','鼠标移到左缘时弹出工具栏','左端でツールを表示','왼쪽 가장자리에서 도구 표시'],
  tbColumns:['Tool panel layout','工具栏布局','ツールパネルのレイアウト','도구 패널 레이아웃'],
  tbCols1:['One column','单列','1 列','1열'],tbCols2:['Two columns','双列','2 列','2열']
});
export function install(ctx){
  const $=id=>document.getElementById(id), toolbar=$('toolbar'), bar=$('bar');
  const columns=()=>Number(ctx.get('toolbarColumns',2))===1?1:2, layout=()=>{bar.dataset.cols=columns();};
  // 书签、设置由其他模块注册 action；模块在本模块之后安装，所以延后检查，未注册时隐藏按钮。
  const sync=()=>{for(const el of bar.querySelectorAll('[data-optional]'))el.hidden=!ctx.actions[el.dataset.act];};
  layout();queueMicrotask(sync);ctx.on('select',sync);
  let edgeTimer=0,leaveTimer=0,auto=false;
  const cancel=()=>{clearTimeout(edgeTimer);edgeTimer=0;}, stay=()=>{clearTimeout(leaveTimer);leaveTimer=0;};
  new MutationObserver(()=>{if(bar.hidden){auto=false;stay();}else sync();}).observe(bar,{attributes:true,attributeFilter:['hidden']});
  const dialog=()=>document.querySelector('dialog[open]');
  document.addEventListener('pointermove',e=>{
    const near=e.pointerType==='mouse'&&!e.buttons&&e.clientX<=24&&bar.hidden&&!dialog()&&ctx.get('edgeLeft',true);
    if(!near)cancel();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(bar.hidden&&!dialog()){ctx.showBar(true);auto=true;}},120);
    // 面板在指针下方出现时浏览器未必补发 pointerenter，指针直接移走就收不到 pointerleave，这里兜底收起。
    if(!auto||bar.hidden||e.pointerType!=='mouse')return;
    if(toolbar.contains(e.target))stay();
    else if(!leaveTimer)leaveTimer=setTimeout(()=>{leaveTimer=0;if(!toolbar.matches(':hover')&&!toolbar.querySelector(':focus-visible'))ctx.showBar(false);},450);
  });
  document.addEventListener('pointerout',e=>{if(!e.relatedTarget)cancel();});
  ctx.settings.push(
    {id:'edgeLeft',group:'toolbar',label:'tbEdgeLeft',type:'toggle',get:()=>ctx.get('edgeLeft',true),set:v=>ctx.put('edgeLeft',!!v)},
    {id:'toolbarColumns',group:'toolbar',label:'tbColumns',type:'choice',options:[{value:1,label:'tbCols1'},{value:2,label:'tbCols2'}],get:columns,set:v=>{ctx.put('toolbarColumns',Number(v)===1?1:2);layout();}});
}
