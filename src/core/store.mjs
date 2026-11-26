// books：书目记录（含只读文件句柄，不能导出）；thumbs：封面 / 书签缩略图，键为 `${bookId}:${kind}`。
// 多个窗口共用这个库：写入完成后通知 on('write')（windows.mjs 转告其他窗口）；存储结构升级时（别的窗口以更高版本打开）
// 本窗口立即让出连接并通知 on('versionchange')，不卡住新窗口；自己的升级被旧窗口挡住时通知 on('blocked')。
const listeners = { write: [], versionchange: [], blocked: [] };
let frozen = false,
  blocked = false;
export function on(type, fn) {
  listeners[type].push(fn);
  if (type === 'blocked' && blocked) fn();
}
function emit(type, ...args) {
  for (const fn of listeners[type])
    try {
      fn(...args);
    } catch (e) {
      console.warn(e);
    }
}
const db = new Promise((resolve, reject) => {
  const req = indexedDB.open('mangaview-reader-v2', 2);
  req.onupgradeneeded = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs');
  };
  req.onblocked = () => {
    blocked = true;
    emit('blocked');
  };
  req.onsuccess = () => {
    const conn = req.result;
    conn.onversionchange = () => {
      conn.close();
      frozen = true;
      emit('versionchange');
    };
    resolve(conn);
  };
  req.onerror = () => reject(req.error);
});
// 冻结后不再写入（读照常）：别的窗口正在做全局操作（还原默认设置、导入备份、清空）、即将重新载入，或连接已让出。
export function freeze() {
  frozen = true;
}
export const isFrozen = () => frozen;
const reads = new Set(['get', 'getAll', 'getAllKeys', 'count']);
// 写入通知里的键：put 为记录的键，delete 为键或范围（IDBKeyRange），clear 为 null。
const keyOf = (store, method, args) =>
  method === 'put' ? (store === 'books' ? args[0]?.id : args[1]) : method === 'delete' ? args[0] : null;
async function run(store, method, ...args) {
  const conn = await db,
    write = !reads.has(method);
  if (write && frozen) return;
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(store, write ? 'readwrite' : 'readonly');
    const req = tx.objectStore(store)[method](...args);
    tx.oncomplete = () => {
      resolve(req.result);
      if (write) emit('write', store, method, keyOf(store, method, args));
    };
    tx.onabort = () => reject(tx.error || req.error);
  });
}
export const library = (method, ...args) => run('books', method, ...args);
export const thumbs = (method, ...args) => run('thumbs', method, ...args);
// 读出最新记录、算出新记录、写回在同一个读写事务里完成，其他窗口的写入不会插在中间。
// fn(存储中的记录或 undefined) 必须同步执行，返回要写入的记录；返回 undefined 表示不写。
export async function update(id, fn) {
  const conn = await db;
  if (frozen) return;
  return new Promise((resolve, reject) => {
    const tx = conn.transaction('books', 'readwrite'),
      os = tx.objectStore('books'),
      req = os.get(id);
    let out, err;
    req.onsuccess = () => {
      try {
        out = fn(req.result);
        if (out !== undefined) os.put(out);
      } catch (e) {
        err = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      resolve(out);
      if (out !== undefined) emit('write', 'books', 'put', id);
    };
    tx.onabort = () => reject(err || tx.error || req.error);
  });
}
