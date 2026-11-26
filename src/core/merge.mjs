// 多窗口写入合并（纯逻辑，core/books.mjs 的保存 persist 与接收其他窗口改动 pull 共用，tests/core/merge.test.mjs 覆盖）。
// 每本书只记“本窗口所知的存储版本”各字段的指纹（base），不保留整本副本。保存时在同一个读写事务里读出存储中的最新记录：
// 本窗口没改过的字段沿用存储中的值；两边都改过的字段，带 id 的条目数组（如书签）按条目合并，基本类型数组（如标签）按集合合并，其余以本窗口为准。
// 字段名一律不写死：新增的字段自动参与合并，不认识的字段原样保留。页面列表等由磁盘推导的数据冲突时以后写的为准，刷新时会重新得出。
// 指纹分两种：s 区分句柄等对象本身（本窗口换成同名文件夹的新句柄也算改动），l 只看内容（存储读出的句柄总是新对象，按种类和名称比较）。
const ids = new WeakMap();
let seq = 0,
  a = 0,
  b = 0,
  sid = 0;
const plain = (v) => {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};
function mix(c) {
  a = Math.imul(a ^ c, 2654435761);
  b = Math.imul(b ^ c, 1597334677);
}
function str(s) {
  mix(s.length);
  for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
}
function walk(v) {
  switch (typeof v) {
    case 'string':
      mix(1);
      str(v);
      return;
    case 'number':
      mix(2);
      if (Number.isInteger(v) && Math.abs(v) < 2 ** 31) mix(v | 0);
      else str(String(v));
      return;
    case 'boolean':
      mix(v ? 3 : 4);
      return;
    case 'bigint':
      mix(6);
      str(String(v));
      return;
    case 'undefined':
    case 'function':
    case 'symbol':
      mix(5);
      return;
  }
  if (v === null) {
    mix(7);
    return;
  }
  if (Array.isArray(v)) {
    mix(8);
    mix(v.length);
    for (let i = 0; i < v.length; i++) walk(v[i]);
    return;
  }
  if (plain(v)) {
    // 键值对的指纹相加：与键的先后顺序无关
    mix(9);
    const pa = a,
      pb = b;
    let sa = 0,
      sb = 0;
    for (const k in v) {
      const x = v[k];
      if (x === undefined) continue;
      a = pa;
      b = pb;
      str(k);
      walk(x);
      sa = (sa + a) | 0;
      sb = (sb + b) | 0;
    }
    a = pa;
    b = pb;
    mix(sa);
    mix(sb);
    return;
  }
  // 句柄、Blob、日期等：内容按可同步读到的属性，对象本身另记在 sid
  mix(10);
  if (v instanceof Date) str(String(v.getTime()));
  else {
    str(v.constructor?.name ?? '');
    for (const k of ['kind', 'name', 'size', 'type'])
      if (typeof v[k] === 'string' || typeof v[k] === 'number') str(String(v[k]));
  }
  let i = ids.get(v);
  if (i == null) ids.set(v, (i = ++seq));
  sid = (sid + Math.imul(i, 2654435761)) | 0;
}
const pack = (x, y) => (x >>> 0) * 2097152 + (y >>> 11);
// 字段值的指纹：{l 内容, s 内容 + 对象标识}。
export function print(v) {
  a = 0x811c9dc5;
  b = 0x9e3779b9;
  sid = 0;
  walk(v);
  const l = pack(a, b);
  if (!sid) return { l, s: l };
  mix(sid);
  return { l, s: pack(a, b) };
}
const NONE = print(undefined);
const keyed = (v) =>
  Array.isArray(v) &&
  v.every((x) => x && typeof x === 'object' && plain(x) && (typeof x.id === 'string' || typeof x.id === 'number')) &&
  new Set(v.map((x) => x.id)).size === v.length;
const flat = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');
function field(v) {
  const f = print(v);
  if (Array.isArray(v) && v.length) {
    if (flat(v)) f.v = [...v];
    else if (keyed(v)) f.e = new Map(v.map((x) => [x.id, print(x)]));
  }
  return f;
}
// 一条记录的 base：字段名 → 指纹（条目数组另记各条目的指纹，基本类型数组另记取值）。
export function snap(rec) {
  const m = new Map();
  for (const k of Object.keys(rec)) if (k !== 'id' && rec[k] !== undefined) m.set(k, field(rec[k]));
  return m;
}
export function refresh(base, rec, keys) {
  for (const k of keys) {
    if (rec[k] === undefined) base.delete(k);
    else base.set(k, field(rec[k]));
  }
}
const keysOf = (base, ...recs) =>
  new Set([...base.keys(), ...recs.flatMap((r) => Object.keys(r))].filter((k) => k !== 'id'));
// 集合合并：保留对方的，去掉本窗口删掉的，加上本窗口新增的。
function union(base, mine, theirs) {
  const was = new Set(base),
    m = new Set(mine),
    t = new Set(theirs);
  return [...theirs.filter((x) => !was.has(x) || m.has(x)), ...mine.filter((x) => !was.has(x) && !t.has(x))];
}
// 条目合并（按 id）：顺序沿用存储中的，本窗口新增的接在后面；任一边删除的不再加回；两边都改了同一条时以本窗口为准。
function entries(base, mine, theirs) {
  const mm = new Map(mine.map((x) => [x.id, x])),
    out = [],
    seen = new Set();
  for (const x of theirs) {
    const m = mm.get(x.id),
      was = base.get(x.id);
    if (!m) {
      if (!was) out.push(x);
      continue;
    }
    seen.add(x.id);
    out.push(!was || print(m).s !== was.s || print(x).l === print(m).l ? m : x);
  }
  for (const m of mine) if (!seen.has(m.id) && !base.has(m.id)) out.push(m);
  return out;
}
// 保存：mine 是内存中的书，theirs 是存储中的最新记录。返回要写入的记录 out，
// take：本窗口没改、存储中已变的字段（内存随之跟进）；joined：两边合并出的新值（内存也换成它）。
export function merge(base, mine, theirs) {
  const out = { ...theirs },
    take = [],
    joined = [];
  for (const k of keysOf(base, mine, theirs)) {
    const was = base.get(k) ?? NONE,
      m = print(mine[k]),
      t = print(theirs[k]);
    if (m.s === was.s) {
      if (t.l !== was.l) take.push(k);
      continue;
    }
    let v = mine[k];
    if (t.l !== was.l && t.l !== m.l) {
      if (flat(v) && flat(theirs[k])) v = union(was.v ?? [], v, theirs[k]);
      else if (keyed(v) && keyed(theirs[k])) v = entries(was.e ?? new Map(), v, theirs[k]);
      if (v !== mine[k]) joined.push(k);
    }
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return { out, take, joined };
}
// 接收其他窗口的改动：返回存储中已变、而本窗口没有未保存改动的字段（有未保存改动的留到保存时合并）。
export function changes(base, mine, theirs) {
  const out = [];
  for (const k of keysOf(base, mine, theirs)) {
    const was = base.get(k) ?? NONE;
    if (print(mine[k]).s === was.s && print(theirs[k]).l !== was.l) out.push(k);
  }
  return out;
}
// 把存储中的字段值换进内存中的书：数组里内容相同的条目沿用本窗口的对象（页面对象带着缩略图缓存的标识和本次会话的句柄状态）。
export function adopt(target, k, value) {
  const old = target[k];
  if (value === undefined) {
    delete target[k];
    return;
  }
  if (Array.isArray(old) && Array.isArray(value)) {
    const pool = new Map();
    for (const x of old)
      if (x && typeof x === 'object') {
        const l = print(x).l;
        if (!pool.has(l)) pool.set(l, []);
        pool.get(l).push(x);
      }
    target[k] = value.map((x) => {
      if (!x || typeof x !== 'object') return x;
      const list = pool.get(print(x).l);
      return list?.length ? list.shift() : x;
    });
  } else target[k] = value;
}
