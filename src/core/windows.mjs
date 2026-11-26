import { extend } from './lang.mjs';
import { on as onStore, freeze, isFrozen } from './store.mjs';
import { forget } from '../reader/thumbs.mjs';
// 多个窗口（包括同一本书）同时打开时的协调。各窗口各自持有内存中的书目，通过 BroadcastChannel 互相通知：
// - 书目、缩略图的写入（store.mjs 的写入通知）合并成批转告其他窗口；收到的窗口按书重读，只更新受影响的项（app.mjs 的 pull）。
// - 偏好经 localStorage 的 storage 事件同步（app.mjs，设置类 / 布局类的登记见那里的 prefs）。
// - 后台磁盘任务（启动时检查全部文件夹、生成封面等）用 Web Locks 保证同时只有一个窗口执行：ctx.disk。
// - 全局操作（还原默认设置、导入备份、清空）：ctx.hold() 先让其他窗口停止写入，完成后 ctx.reloadOthers() 让它们重新载入。
// - 存储结构升级：本窗口让出连接（store.mjs）并提示重新载入。
extend({
  removedElsewhere: [
    'This book was removed in another window',
    '这本书已在另一个窗口中被删除',
    'この本は別のウィンドウで削除されました',
    '이 책은 다른 창에서 삭제되었습니다',
  ],
  reloadedReset: [
    'Settings were restored to defaults in another window; reloaded',
    '另一个窗口还原了默认设置，已重新载入',
    '別のウィンドウで既定の設定に戻したため、再読み込みしました',
    '다른 창에서 기본 설정으로 복원하여 다시 불러왔습니다',
  ],
  reloadedImport: [
    'Data was imported in another window; reloaded',
    '另一个窗口导入了数据，已重新载入',
    '別のウィンドウでデータを読み込んだため、再読み込みしました',
    '다른 창에서 데이터를 가져와 다시 불러왔습니다',
  ],
  reloadedClear: [
    'All data was cleared in another window; reloaded',
    '另一个窗口清除了全部数据，已重新载入',
    '別のウィンドウですべてのデータを消去したため、再読み込みしました',
    '다른 창에서 모든 데이터를 지워 다시 불러왔습니다',
  ],
  dbUpgraded: [
    'MangaView was updated in another window. Reload to keep saving your progress.',
    'MangaView 已在另一个窗口中更新，请重新载入以继续保存进度。',
    '別のウィンドウで MangaView が更新されました。進行状況を保存し続けるには再読み込みしてください。',
    '다른 창에서 MangaView가 업데이트되었습니다. 진행 상황을 계속 저장하려면 다시 불러오세요.',
  ],
  dbReload: ['Reload', '重新载入', '再読み込み', '다시 불러오기'],
  dbBlocked: [
    'Close other MangaView windows to finish updating',
    '请关闭其他 MangaView 窗口以完成更新',
    '更新を完了するには他の MangaView ウィンドウを閉じてください',
    '업데이트를 마치려면 다른 MangaView 창을 닫으세요',
  ],
});
const CHANNEL = 'mangaview',
  LOCK = 'mangaview-disk',
  RELOADED = 'mv-reloaded',
  BATCH = 50,
  HOLD = 150,
  FAILSAFE = 30000;
const why = { reset: 'reloadedReset', merge: 'reloadedImport', replace: 'reloadedImport', clear: 'reloadedClear' };
export function install(ctx) {
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const post = (message) => {
    try {
      channel?.postMessage(message);
    } catch (e) {
      console.warn(e);
    }
  };
  try {
    const done = sessionStorage.getItem(RELOADED);
    if (done) {
      sessionStorage.removeItem(RELOADED);
      setTimeout(() => ctx.notice(why[done] ?? 'reloadedImport', undefined, 6000), 300);
    }
  } catch {}

  // ---- 写入通知：约 50ms 合并一批。缩略图按键（删除一本书时按前缀）通知；清空由全局操作处理，不逐条通知。
  let batch = null;
  onStore('write', (store, method, key) => {
    if (method === 'clear') return;
    batch ??= { books: new Set(), thumbs: new Set() };
    if (store === 'books') {
      if (typeof key === 'string') batch.books.add(key);
    } else if (typeof key === 'string') batch.thumbs.add(key);
    else if (typeof key?.lower === 'string') batch.thumbs.add(key.lower);
    if (batch.timer) return;
    batch.timer = setTimeout(() => {
      const b = batch;
      batch = null;
      post({ type: 'write', books: [...b.books], thumbs: [...b.thumbs] });
    }, BATCH);
  });
  // 收到其他窗口的写入：先换掉缩略图缓存（键或前缀），再重读书目（封面随书目记录的变化重新显示）。
  function received({ books = [], thumbs = [] }) {
    if (isFrozen()) return;
    if (thumbs.length) {
      for (const k of thumbs) forget(k);
      ctx.emit('thumbs', thumbs);
    }
    if (books.length) ctx.safe(ctx.pull)(books);
  }

  // ---- 全局操作
  let failsafe = 0;
  function reload(reason) {
    try {
      sessionStorage.setItem(RELOADED, reason || 'merge');
    } catch {}
    location.reload();
  }
  ctx.hold = async () => {
    post({ type: 'freeze' });
    await new Promise((r) => setTimeout(r, HOLD));
  };
  ctx.reloadOthers = (reason) => post({ type: 'reload', reason });

  // ---- 后台磁盘任务：持有锁的窗口执行，其他窗口不读盘。只有可见的窗口排队等锁；持有者转到后台而有可见的窗口在等时，把锁交给它。
  // 持有者关闭后锁自动交给排在最前的窗口；若启动时的全量检查还没有任何窗口完成过，接手的窗口补做（checked 由 hello / checked 消息在窗口间传递）；
  // 新窗口播放打开的窗口（ctx.popout）不补做。
  const locks = navigator.locks,
    disk = { owner: !locks, checked: false };
  let release = null,
    pending = null,
    waiters = [],
    ready;
  const wake = () => {
    const list = waiters;
    waiters = [];
    for (const fn of list) fn();
  };
  function gained() {
    disk.owner = true;
    wake();
    ctx.emit('disk', true);
    if (ctx.started && !disk.checked && !ctx.popout && ctx.get('autoCheck', true))
      ctx
        .refreshAll(false)
        .then(() => {
          if (disk.owner && !disk.checked) return ctx.refreshAll(false);
        })
        .catch((e) => console.warn(e));
  }
  const hold = () =>
    new Promise((r) => {
      release = r;
    });
  function wait() {
    // 排队等锁；窗口转到后台时撤回
    if (!locks || disk.owner || pending) return;
    const ctrl = new AbortController();
    pending = ctrl;
    locks
      .request(LOCK, { signal: ctrl.signal }, () => {
        pending = null;
        gained();
        return hold();
      })
      .catch(() => {
        if (pending === ctrl) pending = null;
      });
  }
  // 先试一次立即可得的锁：启动时马上知道本窗口是否负责后台任务。
  function claim() {
    return new Promise((done) => {
      if (!locks || disk.owner || pending || document.hidden) {
        done();
        return;
      }
      locks
        .request(LOCK, { ifAvailable: true }, (lock) => {
          done();
          if (!lock) {
            wait();
            return;
          }
          gained();
          return hold();
        })
        .catch(() => done());
    });
  }
  function handoff() {
    if (!disk.owner || !locks) return;
    disk.owner = false;
    const r = release;
    release = null;
    r?.();
    wake();
    ctx.emit('disk', false);
  }
  async function yieldIfWanted() {
    const q = await locks?.query().catch(() => null);
    if (document.hidden && disk.owner && q?.pending?.some((l) => l.name === LOCK)) handoff();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (pending) {
        pending.abort();
        pending = null;
      }
      if (disk.owner) yieldIfWanted();
    } else if (!disk.owner) {
      claim().then(() => {
        if (!disk.owner) post({ type: 'want' });
      });
    }
    wake();
  });
  ready = claim();
  ctx.disk = {
    get owner() {
      return disk.owner;
    },
    // 轮到本窗口做后台读盘：持有锁且窗口可见时返回（后台任务每一项开始前等它）。
    turn: () =>
      new Promise((r) => {
        const go = () => {
          if (disk.owner && !document.hidden) r();
          else waiters.push(go);
        };
        go();
      }),
    // 启动时的全量检查是否由本窗口来做。
    check: async () => {
      await ready;
      return disk.owner && !disk.checked;
    },
    done() {
      disk.checked = true;
      post({ type: 'checked' });
    },
  };

  if (channel)
    channel.onmessage = ({ data: m }) => {
      if (!m || typeof m !== 'object') return;
      switch (m.type) {
        case 'write':
          received(m);
          break;
        case 'freeze':
          freeze();
          clearTimeout(failsafe);
          failsafe = setTimeout(() => reload(), FAILSAFE);
          break; // 发起的窗口中途出错也不会一直冻结
        case 'reload':
          reload(m.reason);
          break;
        case 'hello':
          if (disk.checked) post({ type: 'checked' });
          break;
        case 'checked':
          disk.checked = true;
          break;
        case 'want':
          if (disk.owner && document.hidden) handoff();
          break;
      }
    };
  post({ type: 'hello' });

  // ---- 存储结构升级：连接已让出（store.mjs），之后不能再保存，常驻提示重新载入；本窗口的升级被旧窗口挡住时提示关闭它们。
  onStore('versionchange', () => {
    const bar = ctx.make('div', '', null),
      text = ctx.make('span', '', ctx.t('dbUpgraded')),
      btn = ctx.make('button', 'primary', ctx.t('dbReload'));
    bar.id = 'dbUpgraded';
    bar.setAttribute('role', 'alert');
    bar.popover = 'manual';
    btn.type = 'button';
    btn.onclick = () => location.reload();
    bar.append(ctx.icon('alert'), text, btn);
    document.body.append(bar);
    try {
      bar.showPopover();
    } catch {}
  });
  onStore('blocked', () => ctx.notice('dbBlocked', undefined, 15000));
}
