import {extend} from '../core/lang.mjs';
// 设置面板：打开时按 group 分节渲染 ctx.settings。条目字段见 app.mjs，另支持可选字段：
// hint(说明文案 key)；button 可加 action(按钮文字 key，缺省用 label)、icon、danger；type:'custom' 时 render(ctx)→Node 自绘整行。
extend({
  setGeneral:['General','常规','一般','일반'],setReading:['Reading','阅读','閲覧','읽기'],setToolbar:['Toolbar','工具栏','ツールバー','도구 모음'],setData:['Data','数据','データ','데이터'],
  resetPrefs:['Restore default settings','还原默认设置','既定の設定に戻す','기본 설정으로 복원'],
  resetPrefsHint:['Settings and layout (side panels, widths, default sort…) go back to their defaults. Books, bookmarks, tags and reading progress are kept.','设置项和界面布局（侧栏、宽度、默认排序等）恢复默认；书籍、书签、标签和阅读进度不受影响。','設定とレイアウト（サイドパネル、幅、既定の並べ替えなど）を既定に戻します。本・しおり・タグ・読書位置はそのままです。','설정과 레이아웃(사이드 패널, 너비, 기본 정렬 등)을 기본값으로 되돌립니다. 책, 책갈피, 태그, 읽기 위치는 유지됩니다.'],
  confirmResetPrefs:['Restore all settings and the layout to their defaults? The page will reload. Books, bookmarks, tags and reading progress are kept.','将所有设置和界面布局恢复为默认？页面会重新载入。书籍、书签、标签和阅读进度不受影响。','すべての設定とレイアウトを既定に戻しますか？ ページを再読み込みします。本・しおり・タグ・読書位置はそのままです。','모든 설정과 레이아웃을 기본값으로 되돌릴까요? 페이지를 다시 불러옵니다. 책, 책갈피, 태그, 읽기 위치는 유지됩니다.'],
  resetDone:['Settings restored to defaults','已还原默认设置','既定の設定に戻しました','기본 설정으로 복원했습니다']
});
const groups=['general','reading','toolbar','data'], titles={general:'setGeneral',reading:'setReading',toolbar:'setToolbar',data:'setData'};
const icons={download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'};
// 图标直接补进页面的 sprite，避免多个模块同时改 index.html。
export function addIcons(table){const sprite=document.querySelector('svg.sprite');for(const [name,body] of Object.entries(table))if(!document.getElementById('i-'+name))
  sprite.insertAdjacentHTML('beforeend',`<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`);}

export function install(ctx){
  const {make,icon,t}=ctx;addIcons(icons);
  const label=key=>{try{return t(key);}catch{return key;}}; // 未注册文案时直接显示 key，不让整个面板渲染失败
  const dialog=make('dialog');dialog.id='settings';dialog.setAttribute('aria-labelledby','settingsTitle');
  const head=make('header'),title=make('h2','',''),body=make('div','set-body'),close=ctx.iconButton('close','',()=>dialog.close());
  title.id='settingsTitle';close.removeAttribute('title');head.append(title,close);dialog.append(head,body);document.body.append(dialog);
  function control(s){
    if(s.type==='toggle'){
      const on=!!s.get(),el=make('button','set-switch');el.type='button';el.setAttribute('role','switch');el.setAttribute('aria-checked',String(on));
      el.append(make('span','knob'));el.onclick=ctx.safe(async()=>{await s.set(!s.get());draw();});return el;
    }
    if(s.type==='choice'){
      const value=s.get(),text=o=>o.text??label(o.label);
      if(s.options.length<=3){ // 选项少时用分段按钮，多时用下拉框
        const box=make('div','set-seg');box.setAttribute('role','group');box.style.setProperty('--n',s.options.length);
        for(const o of s.options){const b=make('button','',text(o));b.type='button';b.setAttribute('aria-pressed',String(o.value===value));
          b.onclick=ctx.safe(async()=>{if(o.value!==s.get())await s.set(o.value);draw();});box.append(b);}
        box.style.setProperty('--i',Math.max(0,s.options.findIndex(o=>o.value===value)));return box;
      }
      const sel=make('select','set-select');for(const o of s.options){const opt=make('option','',text(o));opt.value=o.value;opt.selected=o.value===value;sel.append(opt);}
      sel.onchange=ctx.safe(async()=>{const o=s.options[sel.selectedIndex];await s.set(o.value);draw();});return sel;
    }
    if(s.type==='button'){const b=make('button',s.danger?'danger':'');b.type='button';if(s.icon)b.append(icon(s.icon));b.append(make('span','',label(s.action??s.label)));
      b.onclick=ctx.safe(async()=>{b.disabled=true;try{await s.run();}finally{b.disabled=false;}if(dialog.open)draw();});return b;}
    return null;
  }
  function row(s){
    if(s.type==='custom'){const el=make('div','set-row set-custom');el.dataset.id=s.id;el.append(s.render(ctx));return el;}
    const el=make('div','set-row'),text=make('div','set-text'),name=make('span','set-label',label(s.label)),ctl=control(s);
    el.dataset.id=s.id;name.id='set-'+s.id;text.append(name);if(s.hint)text.append(make('small','',label(s.hint)));
    if(ctl)ctl.setAttribute(s.type==='button'?'aria-describedby':'aria-labelledby',name.id);
    el.append(text);if(ctl)el.append(ctl);
    return el;
  }
  function draw(){
    const focus=dialog.contains(document.activeElement)&&document.activeElement.closest('[data-id]')?.dataset.id;
    title.textContent=t('settings');close.setAttribute('aria-label',t('close'));close.title=t('close');
    const order=[...groups,...new Set(ctx.settings.map(s=>s.group).filter(g=>!groups.includes(g)))];
    body.replaceChildren(...order.flatMap(g=>{
      const items=ctx.settings.filter(s=>s.group===g);if(!items.length)return [];
      const sec=make('section','set-group'),h=make('h3','',label(titles[g]??g));h.id='set-group-'+g;sec.setAttribute('aria-labelledby',h.id);
      const list=make('div','set-list');list.append(...items.map(row));sec.append(h,list);return [sec];
    }),foot());
    const at=focus?body.querySelector(`[data-id="${CSS.escape(focus)}"]`):null;(at?.querySelector('[aria-pressed=true]')||at?.querySelector('button,select'))?.focus();
  }
  // 面板末尾：还原默认设置（见 app.mjs 的 resetPrefs），确认后重新载入。
  function foot(){
    const el=make('div','set-foot'),hint=make('small','',t('resetPrefsHint')),b=make('button');el.dataset.id='resetPrefs';hint.id='set-resetPrefs';
    b.type='button';b.setAttribute('aria-describedby',hint.id);b.append(icon('history'),make('span','',t('resetPrefs')));
    b.onclick=()=>{if(confirm(t('confirmResetPrefs')))ctx.resetPrefs();};el.append(hint,b);return el;
  }
  ctx.actions.settings=()=>{draw();if(!dialog.open)dialog.showModal();};
  ctx.on('lang',()=>{if(dialog.open)draw();});ctx.on('pref',()=>{if(dialog.open)draw();}); // 别的窗口改了设置
  return {dialog,draw};
}
