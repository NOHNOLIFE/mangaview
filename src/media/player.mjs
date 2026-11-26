// 播放器的状态：挂上 / 卸载源、读到元数据、播不了时的占位与重试、播放 / 暂停 / 定位；原生媒体元素的事件在这里处理。
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
  mvSoundBlocked: [
    'The browser blocked playback with sound — click to play',
    '浏览器拦截了自动出声，点击即可播放',
    'ブラウザーが音声付きの自動再生をブロックしました。クリックすると再生します',
    '브라우저가 소리 있는 자동 재생을 차단했습니다. 클릭하면 재생됩니다',
  ],
});
// 视频的壳在播放中静止 IDLE 毫秒后淡出；读取元数据的上限 META 毫秒（超时按失败处理，不记录）。
const IDLE = 2500,
  META = 20000;

export function install(ctx, S) {
  const { t, make, icon } = ctx,
    { players, times, rounds, failedPages, fitter } = S;
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
      for (const q of players.values()) if (q !== p && !q.el.paused) q.el.pause();
      S.playing = p;
      p.done = false;
      p.userPaused = false;
      p.auto = false;
      p.popped = false;
      render(p);
      idle(p);
      if (p.blocked) {
        p.blocked = false;
        ctx.notice(null, '', 1);
      } // 点击后开始播放：收起「点击即可播放」的提示
      let r = rounds.get(p.book);
      if (!r) rounds.set(p.book, (r = new Set()));
      r.add(page.name);
      clearInterval(p.posEvery);
      p.posEvery = setInterval(() => {
        if (p.state === 'ready' && !el.paused) remember(p, el.currentTime);
      }, POS_EVERY);
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
    });
    el.addEventListener('ended', () => {
      clearInterval(p.posEvery);
      p.done = true;
      p.time = 0;
      times.delete(page);
      remember(p, 0);
      render(p);
      finished(p);
    });
    el.addEventListener('timeupdate', () => {
      progress(p);
      if (S.only) sectionTick(p);
    });
    el.addEventListener('seeking', () => {
      if (p.selfSeek) p.selfSeek = false;
      else p.sec = null;
    }); // 手动定位到区段之外不强行跳回
    el.addEventListener('seeked', () => progress(p));
    if (p.kind === 'video') {
      p.node.addEventListener('pointermove', () => idle(p));
      p.node.addEventListener('pointerleave', () => {
        clearTimeout(p.idleTimer);
        p.node.classList.remove('idle');
      });
    }
    fitter.observe(p.shell);
  }
  // 视频播放中鼠标静止 IDLE 毫秒后，壳淡出、指针隐藏；移动即恢复。
  function idle(p) {
    if (p.kind !== 'video') return;
    p.node.classList.remove('idle');
    clearTimeout(p.idleTimer);
    p.idleTimer = setTimeout(() => {
      if (!p.el.paused) p.node.classList.add('idle');
    }, IDLE);
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
    fitter.unobserve(p.shell);
    clearTimeout(p.idleTimer);
    if (p.pop.matches(':popover-open')) p.pop.hidePopover();
    if (document.fullscreenElement === p.node) document.exitFullscreen().catch(() => {});
    players.delete(p.node);
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
    if (p.auto) {
      p.auto = false;
      finished(p);
    } // 按播放顺序切到的媒体播不了：跳过它，接着找下一个
  }
  // 开始播放：源还没挂上时先挂上，读到元数据后再播。浏览器拦截自动出声时不提示（等用户自己点）；
  // 只有新窗口播放接手的媒体（p.popped）提示一次「点击即可播放」，停在该处等待点击。
  // 开启「只播放书签区段」且这个媒体有区段时，从当前时间之后的第一个区段起点开始（playlist.mjs sectionStart）。
  function start(p) {
    p.userPaused = false;
    p.done = false;
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
      for (const q of players.values()) if (q !== p && q.state === 'ready' && !q.el.paused) q.el.pause();
      p.el.play().catch((e) => {
        if (e.name === 'NotAllowedError' && p.popped) {
          p.popped = false;
          p.blocked = true;
          render(p);
          ctx.notice(null, t('mvSoundBlocked'), 20000);
        } else if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.warn(e);
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
