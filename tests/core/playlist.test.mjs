import test from 'node:test';
import assert from 'node:assert/strict';
import {ORDERS,orderOf,following,sectionStart,sectionStep,popoutUrl,popoutTarget,popoutSize} from '../../src/core/playlist.mjs';

test('播放顺序与循环：一个媒体播完之后播哪个',()=>{
  assert.deepEqual(ORDERS,['list','shuffle','single']);assert.equal(orderOf('bogus'),'list');assert.equal(orderOf('single'),'single');
  const list=[1,3,4,7];
  // 单集：循环关停下，循环开重复当前媒体。
  assert.equal(following({order:'single',loop:false,list,cur:3}).next,null);
  assert.equal(following({order:'single',loop:true,list,cur:3}).next,3);
  // 列表：按页序播放下一个（图片、无法播放的不在 list 里）；最后一个播完停下，循环开回到第一个。
  assert.equal(following({order:'list',list,cur:3}).next,4);
  assert.equal(following({order:'list',list,cur:5}).next,7,'A media not in the list (e.g. without sections) continues with the next one in page order');
  assert.equal(following({order:'list',list,cur:7}).next,null);
  assert.equal(following({order:'list',loop:true,list,cur:7}).next,1);
  assert.equal(following({order:'list',loop:true,list:[4],cur:4}).next,4,'A single media loops onto itself');
  assert.equal(following({order:'list',list:[],cur:2}).next,null);
  // 随机：不重复，全部播过一遍后停下；循环开则重新洗牌继续，刚播完的不紧接着重复。
  let played=new Set(),cur=1,seen=[cur];const rnd=()=>0.6;
  for(;;){const r=following({order:'shuffle',list,cur,played,random:rnd});if(r.next==null)break;seen.push(r.next);played=r.played;cur=r.next;}
  assert.deepEqual([...seen].sort((a,b)=>a-b),list,'Each media once per round');assert.equal(seen.length,4);
  const again=following({order:'shuffle',loop:true,list,cur,played});
  assert.ok(again.next!=null&&again.next!==cur,'Looping starts a new round without repeating the last one');assert.deepEqual([...again.played].sort(),[cur,again.next].sort());
  assert.equal(following({order:'shuffle',loop:true,list:[4],cur:4,played:new Set([4])}).next,4);
  assert.equal(following({order:'shuffle',loop:false,list:[4],cur:4}).next,null);
});

test('只播放书签区段：从哪里开始、何时跳到下一个区段',()=>{
  const rs=[{a:5,b:9},{a:12,b:14}];
  assert.equal(sectionStart(rs,0),5,'From the first section after the current time');
  assert.equal(sectionStart(rs,6),6,'Inside a section: keep going');
  assert.equal(sectionStart(rs,10),12);
  assert.equal(sectionStart(rs,20),5,'Past the last section: back to the first');
  assert.equal(sectionStart([],3),3,'No sections: unchanged');
  assert.deepEqual(sectionStep(rs,6,null),{k:0},'Entering a section starts following it');
  assert.deepEqual(sectionStep(rs,8.5,0),{k:0});
  assert.deepEqual(sectionStep(rs,9,0),{k:1,seek:12},'At the end of a section jump to the next one');
  assert.deepEqual(sectionStep(rs,14,1),{k:null,done:true},'The last section ends the media');
  assert.deepEqual(sectionStep(rs,10,null),{k:null},'Dragged outside the sections: play on normally');
  assert.deepEqual(sectionStep(rs,12.5,null),{k:1},'Reaching a later section resumes section jumps');
});

test('新窗口播放：地址带上书、页名和时间点，读回一致；不是新窗口播放时为空；窗口开得比屏幕小，视频按画面比例',()=>{
  const url=popoutUrl('/mangaview/',{book:'b-1',name:'A/01 clip #1 & x?.webm',t:12.34567});
  assert.ok(url.startsWith('/mangaview/?play=b-1&'));
  assert.deepEqual(popoutTarget(url.slice(url.indexOf('?'))),{book:'b-1',name:'A/01 clip #1 & x?.webm',t:12.346});
  assert.deepEqual(popoutTarget(popoutUrl('/',{book:'b',name:'a.wav',t:NaN}).slice(1)),{book:'b',name:'a.wav',t:0});
  for(const s of ['','?from=v1','?play=b','?page=a.wav&t=3'])assert.equal(popoutTarget(s),null,s);
  assert.equal(popoutTarget('?play=b&page=a.wav&t=-4').t,0);
  const screen={availWidth:1920,availHeight:1040};
  assert.deepEqual(popoutSize('video',{w:1920,h:1080},screen),{width:864,height:486});
  assert.deepEqual(popoutSize('video',{},screen),{width:864,height:486},'Unknown size: 16:9');
  assert.deepEqual(popoutSize('audio',{},screen),{width:864,height:360});
  const tall=popoutSize('video',{w:1080,h:1920},screen);assert.equal(tall.height,884);assert.equal(tall.width,497,'Tall videos narrow the window to fit the screen');
  assert.deepEqual(popoutSize('video',{w:16,h:9},{availWidth:800,availHeight:600}),{width:480,height:270},'At least 480 wide');
  assert.ok(popoutSize('video',null,{availWidth:3840,availHeight:2100}).width<=960);
});
