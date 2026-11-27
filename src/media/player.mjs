// 播放器的状态：挂上 / 卸载源、读到元数据、播不了时的占位与重试、播放 / 暂停 / 定位；原生媒体元素的事件在这里处理
// （监听挂在媒体元素自己身上：元素停放或在外部容器里时照样收到），并经 S.notify(播放器, 事件名) 转给 driver.mjs。
// 读文件经 ctx.source(书, 页)（限时 limits.read），不要求这本书是当前打开的书：后台播放的当前曲目可以在别的书里。
// 同一时间只有一个媒体在播放：开始播放时暂停其他全部播放器（含停放中的当前曲目）。
// 壳的 DOM 与状态显示在 shell.mjs；播完之后做什么在 order.mjs（finished）。
import { extend } from '../core/lang.mjs';
import { shownName } from '../core/model.mjs';
import { fileStamp } from '../reader/thumbs.mjs';
import { midName, limits } from '../reader/view.mjs';
import { sectionStart } from '../core/playlist.mjs';
import { POS_EVERY } from './position.mjs';

extend({
  mvUnplayable: [
    "The browser can't play this file",
    '浏览器无法播放此文件',
    'ブラウザーはこのファイルを再生できません',
    '브라우저에서 이 파일을 재생할 수 없습니다',
  ],
  mvUnreadable: [
    "Can't read this file right now",
    '暂时无法读取此文件',
    'このファイルを読み込めません',
    '지금은 이 파일을 읽을 수 없습니다',
  ],
  mvRetry: ['Retry', '重试', '再試行', '다시 시도'],
});
// 读取元数据的上限 META 毫秒（超时按失败处理，不记录）。
const META = 20000;

export function install(ctx, S) {
  const { t, make, icon } = ctx,
    { times, failedPages, fitter } = S;
  const progress = (...a) => S.progress(...a),
    render = (...a) => S.render(...a),
    sizeTime = (...a) => S.sizeTime(...a),
    decorate = (...a) => S.decorate(...a),
    button = (...a) => S.button(...a),
    remember = (...a) => S.remember(...a),
    finished = (...a) => S.finished(...a),
    sectionTick = (...a) => S.sectionTick(...a),
    rangesOf = (...a) => S.rangesOf(...a);
  function seek(p, s) {
    if (!Number.isFinite(s)) return;
    if (p.state === 'ready') p.el.currentTime = s;
    else {
      p.time = s;
      times.set(p.page, s);
      if (p.state === 'idle') load(p);
    }
    progress(p, s);
  }
  function events(p) {
    const { el, page } = p;
    el.addEventListener('loadedmetadata', () => {
      clearTimeout(p.timer);
      if (p.state !== 'loading') return;
      p.state = 'ready';
      let changed = false;
      const d = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) / 1000 : null;
      if (d != null && page.d !== d) {
        page.d = d;
        changed = true;
      }
      if (page.bad) {
        delete page.bad;
        changed = true;
      }
      if (
        p.kind === 'video' &&
        el.videoWidth &&
        el.videoHeight &&
        (page.w !== el.videoWidth || page.h !== el.videoHeight)
      )
        ctx.view.sized(page, el.videoWidth, el.videoHeight);
      else if (changed) ctx.view.hooks.measured();
      if (p.time > 0 && (!d || p.time < d - 0.5)) el.currentTime = p.time;
      sizeTime(p);
      render(p);
      decorate(p); // 进度条上的书签标记要用到时长
      S.notify?.(p, 'meta');
      if (p.wantPlay) {
        p.wantPlay = false;
        start(p);
      }
    });
    el.addEventListener('error', () => {
      if (p.state !== 'loading' && p.state !== 'ready') return;
      const c = el.error?.code;
      if (c === 1) return;
      fail(p, c === 3 || c === 4 ? 'decode' : 'read');
    });
    el.addEventListener('play', () => {
      if (el.paused) return; // 事件送到前已被后开始的媒体暂停（start 里同步暂停其他媒体），不要反过来暂停它
      for (const q of S.all()) if (q !== p && !q.el.paused) q.el.pause();
      S.playing = p;
      p.done = false;
      p.userPaused = false;
      p.hop = false;
      p.by ??= 'user'; // 不经本应用开始的（如系统媒体键）按后台播放对待
      render(p);
      clearInterval(p.posEvery);
      p.posEvery = setInterval(() => {
        if (p.state === 'ready' && !el.paused) remember(p, el.currentTime);
      }, POS_EVERY);
      S.notify?.(p, 'play');
    });
    el.addEventListener('pause', () => {
      clearInterval(p.posEvery);
      if (S.playing === p) S.playing = null;
      if (p.state === 'ready' && !p.done) {
        p.time = el.currentTime;
        times.set(page, p.time);
        remember(p, p.time);
      }
      render(p);
      S.notify?.(p, 'pause');
    });
    el.addEventListener('ended', () => {
      clearInterval(p.posEvery);
      p.done = true;
      p.time = 0;
      times.delete(page);
      remember(p, 0);
      render(p);
      S.notify?.(p, 'ended');
      finished(p);
    });
    el.addEventListener('timeupdate', () => {
      progress(p);
      if (S.only) sectionTick(p);
      S.notify?.(p, 'time');
    });
    for (const type of ['durationchange', 'emptied']) el.addEventListener(type, () => S.notify?.(p, type));
    el.addEventListener('seeking', () => {
      if (p.selfSeek) p.selfSeek = false;
      else p.sec = null;
    }); // 手动定位到区段之外不强行跳回
    el.addEventListener('seeked', () => {
      progress(p);
      S.notify?.(p, 'time');
    });
    if (p.shell) fitter.observe(p.shell);
  }
  // 挂上源：先取文件信息（不读内容）比较大小和修改时间；已知播不了且文件没变的，直接显示占位，不再探测。
  async function load(p) {
    if (p.state !== 'idle') return;
    p.state = 'loading';
    p.fail.hidden = true;
    p.node.classList.remove('mv-failed');
    let file;
    try {
      let tm;
      file = await Promise.race([
        Promise.resolve().then(() => ctx.source(p.book, p.page)),
        new Promise((_, no) => {
          tm = setTimeout(() => no(new DOMException('', 'TimeoutError')), limits.read);
        }),
      ]).finally(() => clearTimeout(tm));
    } catch (e) {
      if (p.state !== 'loading') return;
      fail(p, 'read');
      ctx.view.hooks.error?.(e, p.page);
      return;
    }
    if (p.state !== 'loading') return; // 等待期间已离开视窗或被释放
    p.stamp = fileStamp(file);
    if (p.page.bad === p.stamp) {
      fail(p, 'known');
      return;
    }
    p.url = URL.createObjectURL(file);
    p.el.src = p.url;
    p.timer = setTimeout(() => {
      if (p.state === 'loading') fail(p, 'timeout');
    }, META);
  }
  function unload(p) {
    clearTimeout(p.timer);
    if (p.state === 'idle') return;
    clearInterval(p.posEvery);
    if (p.state === 'ready') {
      if (!p.el.paused) p.el.pause();
      if (!p.done) {
        p.time = p.el.currentTime;
        times.set(p.page, p.time);
        remember(p, p.time);
      }
    }
    p.el.removeAttribute('src');
    p.el.load();
    if (p.url) {
      URL.revokeObjectURL(p.url);
      p.url = null;
    }
    if (p.state !== 'failed') p.state = 'idle';
    p.wantPlay = false;
    if (S.playing === p) S.playing = null;
    render(p);
  }
  function dispose(p) {
    unload(p);
    if (p.shell) {
      fitter.unobserve(p.shell);
      if (p.pop.matches(':popover-open')) p.pop.hidePopover();
    }
    if (S.full === p) S.leaveFull();
    if (S.players.get(p.node) === p) S.players.delete(p.node);
    S.unpark(p); // 停放处、外部容器里的媒体元素一并移除（track.mjs）
    S.release(p); // 当前曲目被释放即取消（track.mjs）
  }
  // why：decode 浏览器播不了（记下文件的大小和修改时间，不再探测）；known 已记录过；read / timeout 暂时读不到（不记录，可重试）。
  function fail(p, why) {
    unload(p);
    p.state = 'failed';
    p.wantPlay = false;
    failedPages.add(p.page);
    if (why === 'decode' && p.stamp && p.page.bad !== p.stamp) {
      p.page.bad = p.stamp;
      ctx.view.hooks.measured();
    }
    const bad = why === 'decode' || why === 'known',
      retry = button(
        'refresh',
        t('mvRetry'),
        () => {
          if (p.page.bad) {
            delete p.page.bad;
            ctx.view.hooks.measured();
          }
          p.state = 'idle';
          load(p);
        },
        'mv-retry',
      );
    const name = midName(shownName(p.page));
    name.title = shownName(p.page);
    retry.append(make('span', '', t('mvRetry')));
    retry.classList.remove('icon-btn');
    p.fail.replaceChildren(
      icon(p.kind === 'video' ? 'film' : 'music'),
      make('strong', '', t(bad ? 'mvUnplayable' : 'mvUnreadable')),
      name,
      retry,
    );
    p.fail.hidden = false;
    p.node.classList.add('mv-failed');
    render(p);
    S.changed?.(); // 运行状态（driver.mjs）：等着播放的媒体打不开
    if (p.hop) {
      p.hop = false;
      finished(p);
    } // 自动切到的媒体播不了：跳过它，接着找下一个
    if (S.track === p && p.by !== 'scroll') S.release(p); // 后台播放的文件打不开：取消当前曲目（自动滚动的由它自己跳过）
  }
  // 开始播放：源还没挂上时先挂上，读到元数据后再播。浏览器拦截自动出声时不提示（等用户自己点）。
  // 开启「只播放书签区段」且这个媒体有区段时，从当前时间之后的第一个区段起点开始（playlist.mjs sectionStart）。
  // 同一时间只播一个：别的媒体等着挂上源再播的请求（wantPlay）一并取消，快速连续切换时先请求的那个不会在源挂上后又抢回来。
  function start(p) {
    p.userPaused = false;
    p.done = false;
    for (const q of S.all()) if (q !== p) q.wantPlay = false;
    if (p.state === 'ready') {
      const rs = S.only ? rangesOf(p) : [];
      if (rs.length) {
        const now = p.el.currentTime,
          s = sectionStart(rs, now);
        if (Math.abs(s - now) > 0.01) selfSeek(p, s);
      }
    }
    if (p.state === 'ready') {
      // 同一时间只播一个：调用时就暂停其他媒体。只靠 play 事件的话，连续快速开始两个时先到的事件会把后开始的那个暂停。
      for (const q of S.all()) if (q !== p && q.state === 'ready' && !q.el.paused) q.el.pause();
      p.el.play().catch((e) => {
        if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.warn(e);
      });
    } else if (p.state !== 'failed') {
      p.wantPlay = true;
      if (p.state === 'idle') load(p);
    }
  }
  // 用户的播放 / 暂停（点击画面、壳上的按钮、空格）：手动暂停的媒体在离开视窗再回来之前不自动播放。
  function toggle(p) {
    if (p.state === 'failed') return;
    if (p.state === 'ready' && !p.el.paused) {
      p.userPaused = true;
      p.el.pause();
    } else if (p.wantPlay) {
      p.wantPlay = false;
      p.userPaused = true;
    } else start(p);
  }
  function selfSeek(p, s) {
    p.selfSeek = true;
    p.el.currentTime = s;
    p.time = s;
    progress(p, s);
  }
  Object.assign(S, { seek, events, load, unload, dispose, start, toggle, selfSeek });
}
