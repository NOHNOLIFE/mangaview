// 过期书与候选文件夹的匹配。浏览器拿不到磁盘绝对路径，文件夹又常以 001.jpg 这类通用文件名编号，
// 所以以“文件夹名 + 封面（首张图）内容摘要”为主要依据，文件名重合度只在缺少封面摘要时辅助判断。
import {natural} from './model.mjs';
export const norm=s=>(s??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
// 封面固定取文件名自然顺序的第一张，与当前排序（包括乱序）无关，保证换机后仍能对上。
export const coverName=names=>names.reduce((a,b)=>a==null||natural(b,a)<0?b:a,null);
export function overlap(a,b){const A=new Set(a);let n=0;for(const x of new Set(b))if(A.has(x))n++;return n/Math.max(1,A.size+new Set(b).size-n);}
// level 2：可自动恢复；1：需要用户确认；0：不匹配。cand：{title,names,hash?}
export function grade(book,cand){
  const same=norm(book.title)===norm(cand.title), mine=book.fp?.cover?.hash;
  const cover=mine&&cand.hash?mine===cand.hash:null;
  const files=same&&cover===null?overlap(book.pages.map(p=>p.name),cand.names):0;
  const level=same&&(cover||files>=.9)?2:cover||same?1:0;
  return {level,same,cover,files,score:level*10+(cover?4:0)+(same?2:0)+files};
}
// 一对一分配：按匹配强度从高到低，每本书、每个文件夹最多用一次。
export function assign(pairs){
  const books=new Set(),cands=new Set(),out=[];
  for(const p of [...pairs].sort((x,y)=>y.score-x.score)){
    if(!p.level||books.has(p.book)||cands.has(p.cand))continue;
    books.add(p.book);cands.add(p.cand);out.push(p);
  }
  return out;
}
// 标签配色：按名称散列出固定色相，同名标签在任何地方颜色一致。
export function hue(tag){let h=0;for(const ch of norm(tag))h=(h*31+ch.codePointAt(0))>>>0;return h%360;}
