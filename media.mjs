// 视频、音频：正文里的播放器（原生 <video> / <audio> 负责播放，外面套一层自绘的壳）、当前媒体、自动播放、统一音量和媒体按键。
// - 页的类型按扩展名判断（model.mjs kindOf）；排版见 model.mjs offsets（视频按帧比例、高于视窗时封顶到一屏，音频是固定高度的横条）。
// - 正文里的媒体页由 view.mjs 的 hooks.media 交给这里：只有与视窗相交的媒体挂上源（对象 URL，浏览器按需读取，不整体读进内存），
//   离开视窗即卸载源、释放解码器；相邻页不预加载。缩略图栏、全屏缩略图里是固定样式的占位（ctx.mediaTile），不读文件。
// - 帧尺寸、时长在首次挂上源时读到，记入页记录（page.w / h / d），之后排版不再读文件；浏览器播不了的文件记下当时的
//   大小和修改时间（page.bad），文件没变就不再探测，只在用户点「重试」或文件变化后重做（变化在该页本来要读取时顺带比较）。
// - 壳上的按钮登记在 ctx.player.add：之后的「添加书签」「播放顺序」等按钮照此加入，默认是次要控件（宽度不够时收进弹出层）；
//   进度条上有一层 .mv-marks 容器，ctx.player.decorate(fn) 在每个播放器创建时（以及 ctx.player.refresh() 时）调用 fn(播放器) 画标记。
// - 当前媒体（ctx.media.current）：本窗口正在播放的；否则中线在视窗内、离视窗中心最近的；都没有为 null。
import {extend} from './lang.mjs';
import {shownName,pageKind,clock,seekStep,nudge} from './model.mjs';
import {fileStamp} from './thumbs.mjs';
import {midName,limits} from './view.mjs';
import {addIcons} from './settings.mjs';

extend({
  mvPlay:['Play','播放','再生','재생'],mvPause:['Pause','暂停','一時停止','일시 정지'],mvSeek:['Playback position','播放进度','再生位置','재생 위치'],
  mvMute:['Mute','静音','ミュート','음소거'],mvUnmute:['Unmute','取消静音','ミュート解除','음소거 해제'],mvVolume:['Volume','音量','音量','볼륨'],
  mvFull:['Fullscreen','全屏','全画面','전체 화면'],mvExitFull:['Exit fullscreen','退出全屏','全画面を終了','전체 화면 종료'],mvMore:['More controls','更多控件','その他の操作','더 보기'],
  mvUnplayable:['The browser can\'t play this file','浏览器无法播放此文件','ブラウザーはこのファイルを再生できません','브라우저에서 이 파일을 재생할 수 없습니다'],
  mvUnreadable:['Can\'t read this file right now','暂时无法读取此文件','このファイルを読み込めません','지금은 이 파일을 읽을 수 없습니다'],
  mvRetry:['Retry','重试','再試行','다시 시도'],mvVideo:['Video','视频','動画','동영상'],mvAudio:['Audio','音频','音声','오디오'],
  mvAutoplay:['Autoplay media','自动播放','メディアを自動再生','미디어 자동 재생'],
  mvAutoplayHint:['Play a video or audio when scrolling stops on it','滚动停在视频或音频上时自动开始播放','スクロールが止まったところの動画や音声を再生します','스크롤이 멈춘 곳의 동영상이나 오디오를 재생합니다']
});
const ICONS={
  play:'<path d="M7 4.5v15l12-7.5z"/>',pause:'<path d="M8.5 5v14M15.5 5v14"/>',
  volume:'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  'volume-low':'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  'volume-x':'<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  film:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7.5 3v18M16.5 3v18M3 7.5h4.5M3 12h18M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21"/>',
  music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  more:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  'fast-forward':'<path d="m13 19 9-7-9-7zM2 19l9-7-9-7z"/>',rewind:'<path d="m11 19-9-7 9-7zM22 19l-9-7 9-7z"/>'
};
// 壳的宽度预算（像素，与 media.css 一致）：放不下全部控件时，次要控件收进「更多」弹出层。
const BTN=32,VOL=72,GAP=2,PAD=12,BAR_MIN=120;
// 自动播放：滚动停稳 SETTLE 毫秒后才开始；视频的壳在播放中静止 IDLE 毫秒后淡出；读取元数据的上限 META 毫秒（超时按失败处理，不记录）。
const SETTLE=300,IDLE=2500,META=20000;

export function install(ctx){
  const {t,make,icon,main,get,put}=ctx;addIcons(ICONS);
  const players=new Map(); // 正文里的媒体页节点 → 播放器
  const times=new WeakMap(); // 本次会话里各媒体的播放位置（页对象 → 秒），卸载源之后回来从这里继续
  const controls=[],decorators=[];
  let playing=null,armed=false;
  // ---- 统一音量：全应用一套音量和静音，所有媒体共用；设置类偏好，跨窗口即时同步，去抖保存。
  const level=v=>Number.isFinite(+v)&&v!==null&&v!==''?Math.min(1,Math.max(0,+v)):1;
  let volume=level(get('volume',1)),muted=!!get('muted',false),saveTimer=0;
  ctx.prefs.sync('volume',v=>{volume=level(v??1);applyVolume();}).sync('muted',v=>{muted=!!v;applyVolume();}).sync('autoplay');
  function applyVolume(){for(const p of players.values()){p.el.volume=volume;p.el.muted=muted;renderVolume(p);}}
  function saveVolume(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{put('volume',volume);put('muted',muted);},300);}
  function setVolume(v,hud=false){volume=level(v);if(volume>0)muted=false;applyVolume();saveVolume();if(hud)showHud(volIcon(),Math.round(volume*100)+'%',volume);}
  function setMuted(on){muted=!!on;applyVolume();saveVolume();}
  const volIcon=()=>muted||!volume?'volume-x':volume<.5?'volume-low':'volume';
  window.addEventListener('pagehide',()=>{if(saveTimer){clearTimeout(saveTimer);put('volume',volume);put('muted',muted);}});

  // ---- 提示浮层：调音量、长按快进 / 快退时短暂显示。
  const hud=make('div','mv-hud'),hudIcon=icon('volume'),hudText=make('span','mv-hud-text'),hudBar=make('i','mv-hud-bar');let hudTimer=0;
  hud.hidden=true;hud.setAttribute('aria-hidden','true');hud.append(hudIcon,hudText,hudBar);document.body.append(hud);
  function showHud(name,text,ratio=null,ms=900){
    clearTimeout(hudTimer);hudIcon.firstChild.setAttribute('href','#i-'+name);hudText.textContent=text;
    hudBar.hidden=ratio==null;if(ratio!=null)hudBar.style.setProperty('--v',ratio);
    const host=document.fullscreenElement?.classList.contains('media')?document.fullscreenElement:document.body;if(hud.parentNode!==host)host.append(hud); // 全屏播放时提示显示在全屏的播放器里
    hud.hidden=false;if(ms)hudTimer=setTimeout(()=>{hud.hidden=true;},ms);
  }
  // 壳里的按钮：鼠标点击不夺焦点（否则之后按空格会再点一次它），键盘仍可 Tab 聚焦。
  function button(name,label,action,cls=''){const b=ctx.iconButton(name,label,action,cls);b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')e.preventDefault();});return b;}
  const setIcon=(b,name)=>b.querySelector('use').setAttribute('href','#i-'+name);
  const setLabel=(b,label)=>{if(b.title!==label){b.title=label;b.setAttribute('aria-label',label);}};

  // ---- 占位小块：缩略图栏、全屏缩略图里的视频、音频（类型图标 + 文件名，时长已知时显示时长）。这一版不截帧。
  function tile(page,kind){
    const el=make('div','mv-tile '+kind),badge=make('span','mv-badge');
    el.setAttribute('aria-label',t(kind==='video'?'mvVideo':'mvAudio')+' · '+shownName(page));
    badge.append(icon(kind==='video'?'film':'music'));if(page.d)badge.append(make('span','',clock(page.d)));
    el.append(icon(kind==='video'?'film':'music'),midName(shownName(page)),badge);return el;
  }
  ctx.mediaTile=page=>tile(page,pageKind(page));

  // ---- 播放器
  function build(node,book,page,kind){
    const el=document.createElement(kind);el.preload='metadata';el.controls=false;el.disableRemotePlayback=true;
    if(kind==='video'){el.playsInline=true;el.disablePictureInPicture=true;}
    const p={node,book,page,kind,el,state:'idle',url:null,stamp:null,timer:0,time:times.get(page)??0,wantPlay:false,userPaused:false,done:false,narrow:null,extra:new Map()};
    node.classList.add('media',kind);
    shell(p);
    if(kind==='video'){p.big=make('span','mv-big');p.big.append(icon('play'));node.replaceChildren(el,p.big,p.shell);}
    else{const card=make('div','mv-card'),head=make('div','mv-head'),name=midName(shownName(page));name.title=shownName(page);name.dataset.nodrag='';
      head.append(icon('music'),name);card.append(head,p.shell);node.replaceChildren(card,el);}
    p.fail=make('div','mv-fail');p.fail.dataset.nodrag='';p.fail.hidden=true;node.append(p.fail);
    el.volume=volume;el.muted=muted;
    events(p);node._dispose=()=>dispose(p);players.set(node,p);
    for(const fn of decorators)try{fn(p);}catch(e){console.warn(e);}
    render(p);return p;
  }
  // 播放器对外的操作（供之后的书签、播放顺序等使用）。
  const api={play:p=>start(p),pause:p=>{p.userPaused=true;p.el.pause();},seek:(p,s)=>seek(p,s),duration:p=>Number.isFinite(p.el.duration)?p.el.duration:p.page.d??null,time:p=>p.state==='ready'?p.el.currentTime:p.time};
  function shell(p){
    const s=make('div','mv-shell'),bar=make('div','mv-bar'),track=make('div','mv-track'),fill=make('i','mv-fill'),knob=make('i','mv-knob'),marks=make('div','mv-marks'),timeEl=make('span','mv-time');
    s.dataset.nodrag='';bar.tabIndex=0;bar.setAttribute('role','slider');bar.setAttribute('aria-label',t('mvSeek'));bar.setAttribute('aria-valuemin','0');
    track.append(fill);bar.append(track,marks,knob);
    const play=button('play',t('mvPlay'),()=>toggle(p),'mv-play'),mute=button('volume',t('mvMute'),()=>setMuted(!muted),'mv-mute');
    const vol=make('input','mv-vol');vol.type='range';vol.min='0';vol.max='100';vol.step='5';vol.setAttribute('aria-label',t('mvVolume'));vol.oninput=()=>setVolume(vol.value/100);
    vol.addEventListener('keydown',e=>e.stopPropagation()); // 方向键只调这个滑块，不翻屏
    const more=button('more',t('mvMore'),()=>{},'mv-more'),pop=make('div','mv-pop');pop.popover='auto';pop.dataset.nodrag='';more.hidden=true;
    more.popoverTargetElement=pop;more.setAttribute('aria-haspopup','true'); // 由浏览器开关：再点一次即收起，点别处也收起
    pop.addEventListener('toggle',e=>{more.setAttribute('aria-expanded',String(e.newState==='open'));if(e.newState==='open')placePop(p);});
    Object.assign(p,{shell:s,bar,fill,knob,marks,timeEl,play,mute,vol,more,pop});
    p.full=p.kind==='video'?button('full-enter',t('mvFull'),()=>fullscreen(p),'mv-full'):null;
    s.append(play,bar,timeEl,mute,more,pop);
    seekBar(p);layoutControls(p);
  }
  // 次要控件：音量滑块、登记的按钮、全屏（仅视频）。宽度够时排在一行，不够时收进「更多」弹出层（不换行、不溢出）。
  function secondary(p){
    const list=[{node:p.vol,w:VOL,order:10}];
    for(const c of controls)if(!c.kinds||c.kinds.includes(p.kind)){let b=p.extra.get(c);if(!b){b=button(c.icon,t(c.label),()=>c.click?.(p,api),'mv-x');b.dataset.control=c.id;p.extra.set(c,b);}
      if(c.secondary===false)continue;list.push({node:b,w:BTN,order:c.order??50});}
    if(p.full)list.push({node:p.full,w:BTN,order:90});
    return list.sort((a,b)=>a.order-b.order);
  }
  function primaryExtra(p){return controls.filter(c=>c.secondary===false&&(!c.kinds||c.kinds.includes(p.kind))).map(c=>p.extra.get(c)).filter(Boolean);}
  function layoutControls(p){
    const sec=secondary(p),W=p.shell.clientWidth,extra=primaryExtra(p);
    const fixed=PAD+BTN+p.timeEl.offsetWidth+BTN+extra.length*BTN+BAR_MIN+GAP*(4+extra.length);
    const need=fixed+sec.reduce((n,x)=>n+x.w+GAP,0),narrow=W>0&&W<need;
    p.mute.before(...extra);
    if(narrow){p.pop.append(...sec.map(x=>x.node));p.more.hidden=false;}
    else{p.more.before(...sec.map(x=>x.node));p.more.hidden=true;if(p.pop.matches(':popover-open'))p.pop.hidePopover();}
    p.narrow=narrow;p.shell.classList.toggle('narrow',narrow);renderControls(p);
  }
  const fitter=new ResizeObserver(entries=>{for(const e of entries){const p=players.get(e.target.closest('.page'));if(p)layoutControls(p);}});
  function placePop(p){const r=p.more.getBoundingClientRect();Object.assign(p.pop.style,{left:'auto',top:'auto',right:Math.max(4,innerWidth-r.right)+'px',bottom:Math.max(4,innerHeight-r.top+6)+'px'});}
  function seekBar(p){
    const {bar}=p;let scrub=false;
    const to=e=>{const r=bar.getBoundingClientRect(),d=api.duration(p);if(!d||!r.width)return;seek(p,Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))*d);};
    bar.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();scrub=true;bar.setPointerCapture(e.pointerId);to(e);});
    bar.addEventListener('pointermove',e=>{if(scrub)to(e);});
    bar.addEventListener('lostpointercapture',()=>{scrub=false;});
    bar.addEventListener('keydown',e=>{
      const d=api.duration(p),now=api.time(p);if(!d)return;
      const k=e.key,next=k==='ArrowLeft'||k==='ArrowDown'?now-5:k==='ArrowRight'||k==='ArrowUp'?now+5:k==='Home'?0:k==='End'?d:null;
      if(next==null)return;e.preventDefault();e.stopPropagation();seek(p,Math.min(d,Math.max(0,next)));
    });
  }
  function seek(p,s){
    if(!Number.isFinite(s))return;
    if(p.state==='ready')p.el.currentTime=s;else{p.time=s;times.set(p.page,s);if(p.state==='idle')load(p);}
    progress(p,s);
  }
  function events(p){
    const {el,page}=p;
    el.addEventListener('loadedmetadata',()=>{
      clearTimeout(p.timer);if(p.state!=='loading')return;p.state='ready';
      let changed=false;const d=Number.isFinite(el.duration)?Math.round(el.duration*1000)/1000:null;
      if(d!=null&&page.d!==d){page.d=d;changed=true;}
      if(page.bad){delete page.bad;changed=true;}
      if(p.kind==='video'&&el.videoWidth&&el.videoHeight&&(page.w!==el.videoWidth||page.h!==el.videoHeight))ctx.view.sized(page,el.videoWidth,el.videoHeight);
      else if(changed)ctx.view.hooks.measured();
      if(p.time>0&&(!d||p.time<d-.5))el.currentTime=p.time;
      sizeTime(p);render(p);
      if(p.wantPlay){p.wantPlay=false;start(p);}
    });
    el.addEventListener('error',()=>{if(p.state!=='loading'&&p.state!=='ready')return;const c=el.error?.code;if(c===1)return;fail(p,c===3||c===4?'decode':'read');});
    el.addEventListener('play',()=>{for(const q of players.values())if(q!==p&&!q.el.paused)q.el.pause();playing=p;p.done=false;p.userPaused=false;render(p);idle(p);});
    el.addEventListener('pause',()=>{if(playing===p)playing=null;if(p.state==='ready'){p.time=el.currentTime;times.set(page,p.time);}render(p);});
    el.addEventListener('ended',()=>{p.done=true;p.time=0;times.delete(page);render(p);});
    el.addEventListener('timeupdate',()=>progress(p));
    el.addEventListener('seeked',()=>progress(p));
    if(p.kind==='video'){
      p.node.addEventListener('pointermove',()=>idle(p));
      p.node.addEventListener('pointerleave',()=>{clearTimeout(p.idleTimer);p.node.classList.remove('idle');});
    }
    fitter.observe(p.shell);
  }
  // 视频播放中鼠标静止 IDLE 毫秒后，壳淡出、指针隐藏；移动即恢复。
  function idle(p){if(p.kind!=='video')return;p.node.classList.remove('idle');clearTimeout(p.idleTimer);p.idleTimer=setTimeout(()=>{if(!p.el.paused)p.node.classList.add('idle');},IDLE);}
  // 挂上源：先取文件信息（不读内容）比较大小和修改时间；已知播不了且文件没变的，直接显示占位，不再探测。
  async function load(p){
    if(p.state!=='idle')return;p.state='loading';p.fail.hidden=true;p.node.classList.remove('mv-failed');
    let file;
    try{let tm;file=await Promise.race([Promise.resolve().then(()=>ctx.source(p.book,p.page)),new Promise((_,no)=>{tm=setTimeout(()=>no(new DOMException('','TimeoutError')),limits.read);})]).finally(()=>clearTimeout(tm));}
    catch(e){if(p.state!=='loading')return;fail(p,'read');ctx.view.hooks.error?.(e,p.page);return;}
    if(p.state!=='loading')return; // 等待期间已离开视窗或被释放
    p.stamp=fileStamp(file);
    if(p.page.bad===p.stamp){fail(p,'known');return;}
    p.url=URL.createObjectURL(file);p.el.src=p.url;
    p.timer=setTimeout(()=>{if(p.state==='loading')fail(p,'timeout');},META);
  }
  function unload(p){
    clearTimeout(p.timer);if(p.state==='idle')return;
    if(p.state==='ready'){if(!p.el.paused)p.el.pause();p.time=p.el.currentTime;times.set(p.page,p.time);}
    p.el.removeAttribute('src');p.el.load();if(p.url){URL.revokeObjectURL(p.url);p.url=null;}
    if(p.state!=='failed')p.state='idle';p.wantPlay=false;if(playing===p)playing=null;render(p);
  }
  function dispose(p){unload(p);fitter.unobserve(p.shell);clearTimeout(p.idleTimer);if(p.pop.matches(':popover-open'))p.pop.hidePopover();if(document.fullscreenElement===p.node)document.exitFullscreen().catch(()=>{});players.delete(p.node);}
  // why：decode 浏览器播不了（记下文件的大小和修改时间，不再探测）；known 已记录过；read / timeout 暂时读不到（不记录，可重试）。
  function fail(p,why){
    unload(p);p.state='failed';p.wantPlay=false;
    if(why==='decode'&&p.stamp&&p.page.bad!==p.stamp){p.page.bad=p.stamp;ctx.view.hooks.measured();}
    const bad=why==='decode'||why==='known',retry=button('refresh',t('mvRetry'),()=>{if(p.page.bad){delete p.page.bad;ctx.view.hooks.measured();}p.state='idle';load(p);},'mv-retry');
    const name=midName(shownName(p.page));name.title=shownName(p.page);
    retry.append(make('span','',t('mvRetry')));retry.classList.remove('icon-btn');
    p.fail.replaceChildren(icon(p.kind==='video'?'film':'music'),make('strong','',t(bad?'mvUnplayable':'mvUnreadable')),name,retry);
    p.fail.hidden=false;p.node.classList.add('mv-failed');render(p);
  }
  // 时间显示按总时长的位数预留宽度：播放中数字变化不推动其他控件。
  function sizeTime(p){const d=api.duration(p),w=(clock(d||0)+' / '+clock(d||0)).length;if(p.timeEl.dataset.w!==String(w)){p.timeEl.dataset.w=w;p.timeEl.style.width=w+'ch';layoutControls(p);}}
  function progress(p,at){
    const d=api.duration(p),now=at??api.time(p),f=d?Math.min(1,Math.max(0,now/d)):0;
    p.fill.style.transform='scaleX('+f+')';p.knob.style.left=f*100+'%';
    p.timeEl.textContent=clock(now)+' / '+(d?clock(d):'-:--');
    p.bar.setAttribute('aria-valuemax',String(Math.round(d||0)));p.bar.setAttribute('aria-valuenow',String(Math.round(now)));p.bar.setAttribute('aria-valuetext',p.timeEl.textContent);
  }
  function renderVolume(p){
    const off=muted||!volume;setIcon(p.mute,volIcon());setLabel(p.mute,t(off?'mvUnmute':'mvMute'));p.mute.setAttribute('aria-pressed',String(muted));
    p.vol.value=String(Math.round(volume*100));p.vol.style.setProperty('--v',muted?0:volume);
  }
  function renderControls(p){
    for(const [c,b] of p.extra){const s=c.state?.(p,api)??{};b.disabled=!!s.disabled;if(s.pressed!=null)b.setAttribute('aria-pressed',String(!!s.pressed));if(s.icon)setIcon(b,s.icon);setLabel(b,t(s.label??c.label));}
  }
  function render(p){
    const on=!p.el.paused&&p.state==='ready';
    setIcon(p.play,on?'pause':'play');setLabel(p.play,t(on?'mvPause':'mvPlay'));
    p.node.classList.toggle('playing',on);
    if(p.full){const full=document.fullscreenElement===p.node;setIcon(p.full,full?'full-exit':'full-enter');setLabel(p.full,t(full?'mvExitFull':'mvFull'));}
    renderVolume(p);renderControls(p);progress(p);
  }
  // 开始播放：源还没挂上时先挂上，读到元数据后再播。浏览器拦截自动出声时不提示（等用户自己点）。
  function start(p){
    p.userPaused=false;p.done=false;
    if(p.state==='ready')p.el.play().catch(e=>{if(e.name!=='AbortError'&&e.name!=='NotAllowedError')console.warn(e);});
    else if(p.state!=='failed'){p.wantPlay=true;if(p.state==='idle')load(p);}
  }
  // 用户的播放 / 暂停（点击画面、壳上的按钮、空格）：手动暂停的媒体在离开视窗再回来之前不自动播放。
  function toggle(p){if(p.state==='failed')return;if(p.state==='ready'&&!p.el.paused){p.userPaused=true;p.el.pause();}else if(p.wantPlay){p.wantPlay=false;p.userPaused=true;}else start(p);}
  function fullscreen(p){if(document.fullscreenElement===p.node)document.exitFullscreen().catch(()=>{});else p.node.requestFullscreen?.().catch(()=>{});}
  document.addEventListener('fullscreenchange',()=>{for(const p of players.values())render(p);});

  // ---- 正文里的媒体页（view.mjs paint 调用）：k 为 0 是正文，1 是缩略图栏；visible 为与视窗相交。
  ctx.view.hooks.media=(node,book,page,kind,k,visible)=>{
    if(k){if(!node.firstChild)node.append(tile(page,kind));return;}
    const p=players.get(node)??build(node,book,page,kind);
    if(visible){if(p.state==='idle')load(p);}
    else if(p.state==='loading'||p.state==='ready')unload(p);
  };

  // ---- 当前媒体与自动播放
  const middle=p=>p.node.offsetTop+p.node.offsetHeight/2;
  const inView=p=>{const y=middle(p);return y>=main.scrollTop&&y<=main.scrollTop+main.clientHeight;};
  function nearest(ok=()=>true){
    let best=null,bd=Infinity;const c=main.scrollTop+main.clientHeight/2;
    for(const p of players.values()){if(p.state==='failed'||!inView(p)||!ok(p))continue;const d=Math.abs(middle(p)-c);if(d<bd){bd=d;best=p;}}
    return best;
  }
  const current=()=>playing&&players.has(playing.node)?playing:nearest();
  // 正在播放的媒体中线离开视窗即暂停（位置记在会话里）；手动暂停、播完的标记在它中线离开视窗后清除。
  function watch(){
    for(const p of players.values()){
      if(document.fullscreenElement===p.node||inView(p))continue;
      if(p.state==='ready'&&!p.el.paused)p.el.pause();
      if(p.wantPlay)p.wantPlay=false;
      p.userPaused=false;p.done=false;
    }
  }
  let settleTimer=0;
  function settled(){
    if(!get('autoplay',true)||!armed||document.hidden)return;
    if([...players.values()].some(p=>p.state==='ready'&&!p.el.paused||p.wantPlay))return;
    const p=nearest(p=>!p.userPaused&&!p.done);if(p)start(p);
  }
  main.addEventListener('scroll',()=>{watch();clearTimeout(settleTimer);settleTimer=setTimeout(settled,SETTLE);},{passive:true});
  // 启动或切书（恢复阅读位置）后，本窗口有过用户操作（按键、点击、滚轮）之前不自动播放，避免一打开就出声。
  for(const type of ['keydown','pointerdown','wheel'])window.addEventListener(type,e=>{if(e.isTrusted)armed=true;},{capture:true,passive:true});
  ctx.on('select',()=>{armed=false;});

  // 点击正文里的媒体（壳以外）：播放 / 暂停，不翻屏（app.mjs 的正文点击先问这里）。
  ctx.media={
    tap(target){const node=target?.closest?.('.page.media');const p=node&&players.get(node);if(!p)return false;toggle(p);return true;},
    current:()=>current()
  };
  // 长按 A / D / ← / →（app.mjs 的 pageHold）：当前媒体快退 / 快进，暂停中的也可以；没有当前媒体时无功能。
  let held=null;
  function tick(){
    const {p,d,t0}=held;if(p.state!=='ready'||!players.has(p.node)){ctx.pageHold.stop();return;}
    const el=p.el,end=api.duration(p),from=el.currentTime;let to=Math.max(0,from+d*seekStep(performance.now()-t0));if(end)to=Math.min(end,to);
    el.currentTime=to;held.moved+=to-from;progress(p,to);
    showHud(d>0?'fast-forward':'rewind',(held.moved<0?'−':'+')+clock(Math.abs(held.moved))+' → '+clock(to),null,0);
  }
  ctx.pageHold={
    start(d){const p=current();if(!p||p.state!=='ready')return;held={p,d,t0:performance.now(),moved:0};tick();held.timer=setInterval(()=>held&&tick(),250);},
    stop(){if(!held)return;clearInterval(held.timer);held=null;clearTimeout(hudTimer);hudTimer=setTimeout(()=>{hud.hidden=true;},700);}
  };
  // 按键：空格（含 Shift）播放 / 暂停当前媒体，不再滚动；Q / ; 音量减、E / ' 音量加（每次 5%，按住连续调）。
  ctx.keys.push({down(e){
    if(e.key===' '||e.code==='Space'){e.preventDefault();if(!e.repeat){const p=current();if(p)toggle(p);}return true;}
    if(e.altKey)return false;
    const k=e.key.toLowerCase(),d=k==='q'||k===';'||e.code==='Semicolon'?-1:k==='e'||k==='\''||e.code==='Quote'?1:0;
    if(!d)return false;e.preventDefault();setVolume(nudge(volume,d),true);return true;
  }});

  // ---- 设置：自动播放（默认开启，设置类偏好，跨窗口同步）。
  ctx.settings.push({id:'autoplay',group:'reading',label:'mvAutoplay',hint:'mvAutoplayHint',type:'toggle',get:()=>get('autoplay',true),set:v=>put('autoplay',v)});
  // ---- 播放器的扩展点：登记按钮、画进度条上的标记。
  // add({id,icon,label(文案 key),order?,secondary?=true,kinds?:['video','audio'],click(播放器,api),state?(播放器,api)→{disabled,pressed,icon,label}})
  ctx.player={
    add(c){controls.push(c);for(const p of players.values())layoutControls(p);},
    decorate(fn){decorators.push(fn);for(const p of players.values())try{fn(p);}catch(e){console.warn(e);}},
    refresh(){for(const p of players.values()){renderControls(p);for(const fn of decorators)try{fn(p);}catch(e){console.warn(e);}}},
    list:()=>[...players.values()],current:()=>current(),api
  };
  ctx.on('lang',()=>{for(const p of players.values()){p.bar.setAttribute('aria-label',t('mvSeek'));p.vol.setAttribute('aria-label',t('mvVolume'));setLabel(p.more,t('mvMore'));render(p);}});
}
