export const isImage = name => /\.(avif|bmp|gif|ico|jfif|jpe?g|png|svg|webp|apng)$/i.test(name);
const collator = new Intl.Collator('en',{numeric:true,sensitivity:'base'});
export const natural = (a,b) => collator.compare(a,b) || (a>b?1:a<b?-1:0);
export function shuffled(list) {
  const out = [...list];
  for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
  if(out.length>1 && out.every((v,i)=>v===list[i])) [out[0],out[1]]=[out[1],out[0]];
  return out;
}
export const sortMode=book=>book.sortMode ?? (book.random?'shuffle':'nameAsc');
// 旧书只有实际顺序字段；保留已有设置。新记录用 null 明确表示跟随默认。
export const folderSort=book=>book.sortOverride===undefined ? book.sortMode??(book.random?'shuffle':null) : book.sortOverride;
export function needsSort(book,defaults){
  const override=folderSort(book), mode=override??defaults.mode;
  return sortMode(book)!==mode || (override===null && mode==='shuffle' && book.shuffleRevision!==defaults.revision);
}
export const byTime=mode=>mode==='timeAsc'||mode==='timeDesc';
// 合并作品（多个源文件夹）的页名为“源 key/文件名”，page.src 为源的 key，保证整本书内唯一；单文件夹书的页名就是文件名。
export const fileOf=p=>p.src?p.name.slice(p.src.length+1):p.name;
// rank(page)：所属源的次序。按名称排序时先按源、再按文件名，各卷不会交错。
export function sortedPages(pages,mode,rank){
  if(mode==='shuffle')return shuffled(pages);
  const direction=mode==='nameDesc'||mode==='timeDesc'?-1:1;
  const byName=(a,b)=>(rank?rank(a)-rank(b):0)||natural(fileOf(a),fileOf(b));
  return [...pages].sort((a,b)=>{
    if(byTime(mode)){
      const knownA=Number.isFinite(a.lastModified), knownB=Number.isFinite(b.lastModified);
      if(knownA!==knownB)return knownA?-1:1;
      if(knownA && a.lastModified!==b.lastModified)return direction*(a.lastModified-b.lastModified);
      return byName(a,b);
    }
    return direction*byName(a,b);
  });
}
// 只为可见项创建元素；累计高度同时用于虚拟窗口、长图内跳转和续读。
export function offsets(pages,width,fit) {
  const starts=[0];
  for(const p of pages){
    const w=p.w||800, h=p.h||1120;
    starts.push(starts.at(-1)+Math.max(1,h*(fit?width:Math.min(width,w))/w));
  }
  return starts;
}
export function at(starts,y) {
  let lo=0, hi=starts.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>>1;if(starts[mid]<=y)lo=mid;else hi=mid;}
  return {i:lo,f:Math.min(1,Math.max(0,(y-starts[lo])/(starts[lo+1]-starts[lo]||1)))};
}
export const point=(s,{i,f})=>s[i]+(s[i+1]-s[i])*f;
