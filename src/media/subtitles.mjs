// 外挂字幕的显示（6.1）：播放器面板上的字幕按钮（开关、多个字幕时的选择菜单）、读取与缓存、随播放时间更新。
// - 配对只看文件名，在导入、刷新列目录时顺带完成（sources.mjs，记在 page.subs）；解析在 core/subtitles.mjs。
// - 只在该媒体第一次要显示字幕时（字幕开着、播放器挂上源）读字幕文件，解析结果在会话内缓存（CACHE 条），
//   之后每次挂上源只取文件的大小和修改时间，变了才重读；读不到时简短提示，不影响播放。
// - 开关全局记住（偏好 'subs'，跨窗口同步）；选择按媒体记在书目记录的 book.subPick=[{id:页名,f:字幕文件名}]（按条目合并，见 merge.mjs），
//   没选过的默认取与媒体完全同名的，其次按文件名顺序第一个（model.mjs defaultSub）。
// - 显示在面板的字幕容器 .mv-subs 里（视频叠在画面底部，全屏、新窗口播放同样显示；音频在卡片的字幕区）；面板没有提供时自建一个最简的。
// 时间更新：timeupdate，视频播放中另用 requestVideoFrameCallback 逐帧；定位、变速、只播区段的跳转后立即刷新；卸载源时清空。
import { extend } from '../core/lang.mjs';
import { fileOf, defaultSub } from '../core/model.mjs';
import { subsOf, subFile } from '../core/sources.mjs';
import { decodeSubs, parseSubs, cuesAt } from '../core/subtitles.mjs';

extend({
  mvSubs: ['Subtitles', '字幕', '字幕', '자막'],
  mvSubsNone: ['No subtitles', '没有字幕', '字幕なし', '자막 없음'],
  mvSubsOff: ['Off', '关闭', 'オフ', '끄기'],
  mvSubsUnreadable: [
    "Can't read the subtitle file",
    '无法读取字幕文件',
    '字幕ファイルを読み込めません',
    '자막 파일을 읽을 수 없습니다',
  ],
});
// CACHE：会话内缓存的字幕条数；READ：读取一个字幕文件的时限（毫秒）。
const CACHE = 32,
  READ = 20000;

export function install(ctx) {
  const { t, make, icon, get, put } = ctx;
  let on = get('subs', true) !== false;
  const cache = new Map(), // 书 id、页名、字幕文件名 → {stamp,cues}，最近用过的在末尾
    state = new WeakMap(), // 播放器 → {box,cue,file,cues,loading,token,frame,sig}
    failed = new Set(); // 本次会话已提示过读不到的字幕
  const limit = (p, ms) => {
    let tm;
    return Promise.race([
      p,
      new Promise((_, no) => {
        tm = setTimeout(() => no(new DOMException('', 'TimeoutError')), ms);
      }),
    ]).finally(() => clearTimeout(tm));
  };
  // ---- 选择：按媒体记住的，其次默认。
  function chosen(p) {
    const list = subsOf(p.page);
    if (!list.length) return null;
    const e = Array.isArray(p.book.subPick) ? p.book.subPick.find((x) => x?.id === p.page.name) : null;
    return list.includes(e?.f) ? e.f : defaultSub(fileOf(p.page), list);
  }
  function choose(p, file) {
    const book = p.book,
      names = new Set(book.pages.map((x) => x.name)),
      next = (Array.isArray(book.subPick) ? book.subPick : []).filter((x) => x?.id !== p.page.name && names.has(x?.id));
    next.push({ id: p.page.name, f: file });
    book.subPick = next;
    ctx.persist(book);
    for (const q of ctx.player.list()) if (q.book === book && q.page === p.page) show(q);
  }
  // ---- 容器：面板提供的 .mv-subs；没有时自建（视频叠在画面上，音频放在卡片的标题行）。
  function setup(p) {
    let s = state.get(p);
    if (s) return s;
    let box = p.node.querySelector('.mv-subs');
    if (!box) {
      box = make('div', 'mv-subs mv-subs-own');
      if (p.kind === 'video') p.el.after(box);
      else (p.node.querySelector('.mv-head') ?? p.node.querySelector('.mv-card') ?? p.node).append(box);
    }
    const cue = make('div', 'mv-cue');
    cue.hidden = true;
    box.append(cue);
    s = { box, cue, file: null, cues: null, loading: false, token: 0, frame: 0, sig: subsOf(p.page).join('\n') };
    state.set(p, s);
    const el = p.el,
      tick = () => draw(p);
    for (const type of ['timeupdate', 'seeking', 'seeked', 'ratechange', 'pause', 'ended'])
      el.addEventListener(type, tick);
    el.addEventListener('play', () => {
      tick();
      frames(p);
    });
    // 卸载源（离开视窗、播不了）：清空显示，下次挂上源时重新核对文件。
    el.addEventListener('emptied', () => {
      stopFrames(p);
      s.token++;
      s.loading = false;
      s.cues = null;
      s.file = null;
      draw(p);
    });
    return s;
  }
  function frames(p) {
    const s = state.get(p),
      el = p.el;
    if (!s || !el.requestVideoFrameCallback || s.frame) return;
    const step = () => {
      s.frame = 0;
      draw(p);
      if (!el.paused && !el.ended) s.frame = el.requestVideoFrameCallback(step);
    };
    s.frame = el.requestVideoFrameCallback(step);
  }
  function stopFrames(p) {
    const s = state.get(p);
    if (s?.frame) p.el.cancelVideoFrameCallback?.(s.frame);
    if (s) s.frame = 0;
  }
  function draw(p) {
    const s = state.get(p);
    if (!s) return;
    const text =
      on && s.cues && p.state === 'ready'
        ? cuesAt(s.cues, p.el.currentTime)
            .map((c) => c.text)
            .join('\n')
        : '';
    if (s.cue.textContent !== text) s.cue.textContent = text;
    s.cue.hidden = !text;
  }
  // ---- 读取：每次挂上源后核对一次文件（只取大小和修改时间），缓存里有同样的就不读内容。
  async function show(p) {
    const s = setup(p),
      file = on && p.state === 'ready' ? chosen(p) : null;
    if (!file) {
      s.cues = null;
      s.file = null;
      draw(p);
      return;
    }
    if (s.file === file && (s.cues || s.loading)) return draw(p);
    s.file = file;
    s.cues = null;
    draw(p);
    const token = ++s.token,
      key = p.book.id + '\n' + p.page.name + '\n' + file;
    s.loading = true;
    try {
      const f = await subFile(p.book, p.page, file),
        stamp = f.lastModified + ':' + f.size;
      let hit = cache.get(key);
      if (hit?.stamp !== stamp) {
        const text = decodeSubs(await limit(f.arrayBuffer(), READ), ctx.lang, navigator.languages ?? []);
        hit = { stamp, cues: parseSubs(text, file) };
      }
      cache.delete(key);
      cache.set(key, hit);
      while (cache.size > CACHE) cache.delete(cache.keys().next().value);
      if (token !== s.token) return;
      s.cues = hit.cues;
    } catch (e) {
      if (token !== s.token) return;
      const old = cache.get(key); // 暂时读不到（硬盘慢、被占用）：用上次读到的
      s.cues = old?.cues ?? [];
      if (!old && !failed.has(key)) {
        failed.add(key);
        ctx.notice(null, t('mvSubsUnreadable'));
      }
      if (!['NotFoundError', 'NotAllowedError', 'NotReadableError', 'TimeoutError', 'SecurityError'].includes(e?.name))
        console.warn(e);
    } finally {
      if (token === s.token) s.loading = false;
    }
    draw(p);
    if (!p.el.paused) frames(p);
  }
  // decorate 在播放器创建、读到元数据（挂上源）、ctx.player.refresh() 时调用。
  ctx.player.decorate((p) => {
    setup(p);
    show(p);
  });

  // ---- 开关与选择菜单（.menu-pop）：只有一个字幕时按钮直接开 / 关；有多个时弹出菜单：关闭 + 各个字幕。
  const menu = make('div', 'menu-pop mv-subs-pop');
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  menu.dataset.nodrag = '';
  document.body.append(menu);
  let owner = null,
    downOpen = null;
  const buttonOf = (p) => p?.extra?.get(control);
  menu.addEventListener('toggle', (e) => {
    buttonOf(owner)?.setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState === 'open') menu.querySelector('[aria-checked=true]')?.focus({ preventScroll: true });
    else owner = null;
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')],
      i = items.indexOf(document.activeElement),
      n = items.length;
    const j = { ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    e.stopPropagation();
    items[j].focus();
  });
  // 再点一次按钮即收起：按下时菜单已为它打开的，这次点击只收起（不再打开）。
  document.addEventListener(
    'pointerdown',
    (e) => {
      downOpen =
        menu.matches(':popover-open') && e.target.closest?.('[data-control="subs"]') === buttonOf(owner) ? owner : null;
    },
    true,
  );
  function item(label, checked, act) {
    const b = make('button', 'sp-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(checked));
    b.append(icon('check'), make('span', '', label));
    b.onclick = () => {
      const btn = buttonOf(owner);
      menu.hidePopover();
      btn?.focus({ preventScroll: true });
      act();
    };
    return b;
  }
  function openMenu(p) {
    const btn = buttonOf(p),
      cur = chosen(p);
    owner = p;
    menu.replaceChildren(
      item(t('mvSubsOff'), !on, () => setOn(false)),
      ...subsOf(p.page).map((f) =>
        item(f, on && f === cur, () => {
          if (f !== cur) choose(p, f);
          setOn(true);
        }),
      ),
    );
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, {
      left: Math.max(4, Math.min(r.left, innerWidth - 4 - Math.min(416, innerWidth - 8))) + 'px',
      top: 'auto',
      right: 'auto',
      bottom: Math.max(4, innerHeight - r.top + 6) + 'px',
    });
    try {
      menu.showPopover({ source: btn });
    } catch {
      menu.showPopover();
    }
  }
  function setOn(v) {
    v = !!v;
    if (v === on) return;
    on = v;
    put('subs', on);
    apply();
  }
  function apply() {
    for (const p of ctx.player.list()) show(p);
    ctx.player.refresh();
  }
  ctx.prefs.sync('subs', (v) => {
    on = v !== false;
    apply();
  });
  const control = {
    id: 'subs',
    icon: 'subtitles',
    label: 'mvSubs',
    order: 20,
    click(p) {
      const list = subsOf(p.page);
      if (!list.length) return;
      if (list.length === 1) return setOn(!on);
      if (owner === p && menu.matches(':popover-open')) return menu.hidePopover();
      if (downOpen === p) return;
      openMenu(p);
    },
    state(p) {
      const n = subsOf(p.page).length,
        b = buttonOf(p);
      if (b && n > 1) b.setAttribute('aria-haspopup', 'menu');
      else b?.removeAttribute('aria-haspopup');
      return { disabled: !n, pressed: !!n && on, label: n ? 'mvSubs' : 'mvSubsNone' };
    },
  };
  ctx.player.add(control);
  // 刷新、导入后页上的字幕可能有增减，别的窗口可能改了选择：只重新核对受影响的播放器。
  const again = (book, picked = false) => {
    let any = false;
    for (const p of ctx.player.list()) {
      const s = state.get(p),
        sig = subsOf(p.page).join('\n');
      if (!s || (book && p.book !== book) || (s.sig === sig && !picked)) continue;
      s.sig = sig;
      show(p);
      any = true;
    }
    if (any) ctx.player.refresh();
  };
  ctx.on('books', () => again());
  ctx.on('synced', (book, keys) => {
    if (keys.includes('subPick') || keys.includes('pages')) again(book, keys.includes('subPick'));
  });
}
