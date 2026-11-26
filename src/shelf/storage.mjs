// 存储空间：低频检查浏览器存储的占用，接近配额时提示删除旧书记录；启动后申请持久存储。
import { extend } from '../core/lang.mjs';
import { $ } from './util.mjs';

extend({
  storageHigh: [
    'Browser storage is {p}% full. Delete records of books you no longer need (covers and bookmark thumbnails take most of the space).',
    '浏览器存储空间已用 {p}%，建议删除不再需要的旧书记录（主要占用来自封面和书签缩略图）。',
    'ブラウザーの保存領域が {p}% 使用されています。不要になった本の記録を削除してください（主に表紙としおりのサムネイルが容量を使います）。',
    '브라우저 저장 공간이 {p}% 찼습니다. 더 이상 필요 없는 책 기록을 삭제하세요(표지와 책갈피 썸네일이 대부분을 차지합니다).',
  ],
});
export function install(ctx, S) {
  const { fmt, notice, safe, shelf } = ctx;
  // ---- 存储空间：低频检查（启动后一次、打开书架时最多每 10 分钟一次）。占用达到配额的 85% 时提示删除旧书记录。
  let storageAt = 0,
    storageInfo = null,
    storageWarned = false;
  async function checkStorage(force = false) {
    if (!navigator.storage?.estimate) return null;
    if (!force && storageInfo && Date.now() - storageAt < 6e5) return storageInfo;
    storageAt = Date.now();
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    storageInfo = { usage, quota, p: quota ? usage / quota : 0 };
    const high = storageInfo.p >= 0.85,
      pct = Math.round(storageInfo.p * 100),
      warn = $('storageWarn');
    warn.hidden = !high;
    if (high) {
      warn.textContent = fmt('storageHigh', { p: pct });
      if (!storageWarned && !shelf.open) {
        storageWarned = true;
        notice(null, fmt('storageHigh', { p: pct }), 12000);
      }
    }
    return storageInfo;
  }
  // 启动后：检查占用；并申请持久存储，避免磁盘紧张时浏览器自动清除书目（不弹窗，由浏览器自行决定）。
  setTimeout(
    safe(async () => {
      await checkStorage(true);
      if (navigator.storage?.persisted && !(await navigator.storage.persisted()))
        await navigator.storage.persist().catch(() => {});
    }),
    8000,
  );
  S.checkStorage = checkStorage;
}
