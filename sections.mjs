// 区段书签（docs/requirements-media.zh-CN.md 4.4）的配对规则，纯函数，不碰界面和存储。
// 位置用一维坐标表示，坐标越大越靠后：图片书签为「页序 + 页内位置」（i+f，可以跨页比较）；媒体书签以后按同一文件内的时间（毫秒）表示。
// 只有同一坐标系里的书签才互相配对（图片一组，每个媒体文件各一组），调用方先按坐标系分好组再传进来。
// items：[{id, at, end}]：at 是书签的坐标；end 是它的区段书签（终点）的坐标——没有区段书签为 undefined，
// 区段暂不生效（页序变化使终点排到起点之前、终点所在的页不存在）为 null。
const live=m=>m.end!=null&&m.end>m.at,rank=m=>live(m)?2:m.end!==undefined?1:0;
// 生效的区段：[{id,a,b}]，按起点排序。
export const ranges=items=>items.filter(m=>Number.isFinite(m.at)&&live(m)).map(m=>({id:m.id,a:m.at,b:m.end})).sort((x,y)=>x.a-y.a);
// 在坐标 x 处添加区段书签时配给谁：
// 1. x 在某个生效区段之内（含两端）：更新这个区段的终点；
// 2. 否则向前（坐标 ≤ x）找最近的一个「区段」（按它的终点算远近，暂不生效的按起点）或「不在任何区段内的普通书签」：
//    区段即延长它的终点，普通书签即以它为起点新建区段；
// 3. 前面什么都没有返回 null。
// 返回 {kind:'update'|'create', id, inside}；inside 表示属于第 1 种情况。
// 这样配出来的区段不嵌套、不交叉：x 与选中的起点之间不会有别的区段或普通书签（否则它们才是最近的）。
export function pair(items,x){
  const list=items.filter(m=>Number.isFinite(m.at)),spans=ranges(list);
  const inside=spans.find(s=>s.a<=x&&x<=s.b);
  if(inside)return {kind:'update',id:inside.id,inside:true};
  const covered=m=>spans.some(s=>s.id!==m.id&&s.a<=m.at&&m.at<=s.b);
  let best=null,reach=-Infinity;
  for(const m of list){
    const sec=m.end!==undefined;
    if(!sec&&covered(m))continue; // 区段内的普通书签不参与配对
    const r=live(m)?m.end:m.at;
    if(r>x)continue;
    if(r>reach||r===reach&&rank(m)>rank(best)){best=m;reach=r;} // 同一坐标上优先选生效的区段
  }
  return best&&{kind:best.end===undefined?'create':'update',id:best.id,inside:false};
}
// 区段 [a,b]（起点书签 id）能否加入：与其他生效区段不重叠（不嵌套、不交叉）。合并备份时用来挑出冲突的区段。
export const fits=(items,id,a,b)=>b>a&&!ranges(items).some(s=>s.id!==id&&s.a<=b&&a<=s.b);
