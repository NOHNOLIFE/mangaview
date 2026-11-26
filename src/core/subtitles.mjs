// 外挂字幕（.srt .vtt .ass .ssa .lrc）的解码与解析（纯逻辑）。只取文字和时间：样式标签、特效、定位、绘图指令一律去掉；
// 输出统一的 cue 列表 [{start,end,text}]（秒，按开始时间排序），坏数据跳过、不报错。与媒体的配对只看文件名，见 model.mjs pairSubs。
import { extOf } from './model.mjs';

// ---- 解码：先看 BOM（UTF-8 / UTF-16LE / UTF-16BE），再按 UTF-8 严格解码，失败后依次尝试东亚常见的旧编码，
// 取第一个能不出替换字符解码的；都不行按 UTF-8 宽松解码。尝试顺序随界面语言调整（繁体中文地区 Big5 优先）。
const LEGACY = {
  zh: ['gb18030', 'big5', 'shift_jis', 'euc-kr'],
  ja: ['shift_jis', 'gb18030', 'big5', 'euc-kr'],
  ko: ['euc-kr', 'gb18030', 'big5', 'shift_jis'],
};
export function encodings(lang = 'en', locales = []) {
  const list = [...(LEGACY[lang] ?? LEGACY.zh)];
  if (lang === 'zh' && locales.some((l) => /^zh-(tw|hk|mo|hant)/i.test(l))) {
    list.splice(list.indexOf('big5'), 1);
    list.unshift('big5');
  }
  return ['utf-8', ...list];
}
export function decodeSubs(buf, lang, locales) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf),
    dec = (enc, from = 0, fatal = false) => new TextDecoder(enc, { fatal }).decode(a.subarray(from));
  if (a[0] === 0xef && a[1] === 0xbb && a[2] === 0xbf) return dec('utf-8', 3);
  if (a[0] === 0xff && a[1] === 0xfe) return dec('utf-16le', 2);
  if (a[0] === 0xfe && a[1] === 0xff) return dec('utf-16be', 2);
  for (const enc of encodings(lang, locales))
    try {
      return dec(enc, 0, true);
    } catch {}
  return dec('utf-8');
}

// ---- 时间："[h:]mm:ss[.,]fff"（ASS 为 h:mm:ss.cc），非法为 NaN。
export function clockOf(s) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?\s*$/.exec(s ?? '');
  if (!m) return NaN;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +('0.' + m[4]) : 0);
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };
const entities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, k) => {
    if (k[0] === '#') {
      const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : +k.slice(1);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[k.toLowerCase()] ?? all;
  });
// 每行合并连续空白、去掉首尾空白，丢掉空行。
const lines = (s) =>
  s
    .split('\n')
    .map((x) => x.replace(/[ \t\xa0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
// SRT / VTT 的文字：去掉 <i> <b> <font> <c.x> <v 名字> 等标签、注音（<rt>）、行内时间戳，以及有的 SRT 里夹带的 ASS 覆写 {\...}。
const markup = (s) =>
  lines(
    entities(
      s
        .replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\{\\[^}]*\}/g, ''),
    ),
  );

// ---- SRT / VTT：按行读，遇到「开始 --> 结束」开始一条，之后到空行为止是文字。VTT 的文件头、NOTE / STYLE / REGION 块跳过，
// 时间后面的定位设置（position: align: 等）忽略。缺了空行的 SRT：时间行前面紧挨着的纯数字行是下一条的序号，不算文字。
function parseCues(text) {
  const out = [];
  let cur = null,
    skip = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      cur = null;
      skip = false;
      continue;
    }
    if (skip) continue;
    const arrow = line.indexOf('-->');
    if (arrow >= 0) {
      const start = clockOf(line.slice(0, arrow)),
        end = clockOf(
          line
            .slice(arrow + 3)
            .trim()
            .split(/\s+/)[0],
        );
      if (cur && /^\d+$/.test(cur.lines.at(-1) ?? '')) cur.lines.pop();
      cur = Number.isFinite(start) && Number.isFinite(end) ? { start, end, lines: [] } : null;
      if (cur) out.push(cur);
      else skip = true; // 时间坏了：整条跳过
      continue;
    }
    if (cur) cur.lines.push(raw);
    else if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(line)) skip = true;
  }
  return out.map(({ start, end, lines: l }) => ({ start, end, text: markup(l.join('\n')) }));
}

// ---- ASS / SSA：[Events] 里的 Dialogue 行，字段按 Format 行（没有时用默认顺序），最后一个字段 Text 可含逗号。
// 文字去掉 {...} 覆写块；\N 为换行，\n、\h 为空格；\p1 之后到 \p0 是绘图指令，丢弃，整行都是绘图的不出现。
// 同一时间、同一文字的多层（描边、阴影常这样做）只留一条。
function assText(s) {
  let out = '',
    drawing = false;
  for (const part of s.split(/(\{[^}]*\})/)) {
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const m of part.matchAll(/\\p(\d+)/g)) drawing = +m[1] > 0;
      continue;
    }
    if (!drawing) out += part;
  }
  return lines(out.replace(/\\N/g, '\n').replace(/\\[nh]/g, ' '));
}
function parseAss(text) {
  const out = [],
    seen = new Set();
  let events = false,
    format = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      events = /^\[events\]$/i.test(line);
      continue;
    }
    if (!events) continue;
    const m = /^(format|dialogue)\s*:(.*)$/i.exec(line);
    if (!m) continue;
    if (m[1].toLowerCase() === 'format') {
      const f = m[2].split(',').map((x) => x.trim().toLowerCase());
      if (f.includes('start') && f.includes('end') && f.at(-1) === 'text') format = f;
      continue;
    }
    const v = m[2].split(','),
      n = format.length;
    if (v.length < n) continue;
    const fields = [...v.slice(0, n - 1), v.slice(n - 1).join(',')],
      at = (k) => fields[format.indexOf(k)],
      start = clockOf(at('start')),
      end = clockOf(at('end')),
      t = assText(at('text'));
    const key = start + '|' + end + '|' + t;
    if (!Number.isFinite(start) || !Number.isFinite(end) || seen.has(key)) continue;
    seen.add(key);
    out.push({ start, end, text: t });
  }
  return out;
}

// ---- LRC：行首一个或多个 [mm:ss.xx] 时间标签（一行多个标签即多次出现）；[offset:±毫秒] 整体提前（正）或推后（负）；
// 其他标签（[ar:] [ti:] 等）与行内逐字时间 <mm:ss.xx> 忽略。每行持续到下一个时间点，最后一行到媒体结束；空行只用来清屏。
function parseLrc(text) {
  const rows = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim(),
      off = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(line);
    if (off) {
      offset = +off[1] / 1000;
      continue;
    }
    const tags = /^(\[\d+:\d{1,2}(?:[.:]\d+)?\]\s*)+/.exec(line);
    if (!tags) continue;
    const words = lines(line.slice(tags[0].length).replace(/<\d+:\d{1,2}(?:[.:]\d+)?>/g, ''));
    for (const m of tags[0].matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d+))?\]/g))
      rows.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3]) : 0), text: words });
  }
  for (const r of rows) r.t = Math.max(0, r.t - offset);
  rows.sort((a, b) => a.t - b.t);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].text) continue;
    let j = i + 1;
    while (j < rows.length && rows[j].t <= rows[i].t) j++;
    out.push({ start: rows[i].t, end: j < rows.length ? rows[j].t : Infinity, text: rows[i].text });
  }
  return out;
}

const PARSERS = { srt: parseCues, vtt: parseCues, ass: parseAss, ssa: parseAss, lrc: parseLrc };
// 按扩展名选解析器；认不出的扩展名按内容判断。返回按开始时间排好序的 cue 列表。
export function parseSubs(text, name = '') {
  if (typeof text !== 'string') return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, '\n');
  let fn = PARSERS[extOf(name)];
  if (!fn)
    fn = /^\s*\[script info\]/i.test(text)
      ? parseAss
      : /-->/.test(text)
        ? parseCues
        : /^\s*\[\d+:\d/m.test(text)
          ? parseLrc
          : () => [];
  return fn(text)
    .filter((c) => Number.isFinite(c.start) && c.start >= 0 && c.end > c.start && c.text)
    .sort((a, b) => a.start - b.start);
}

// ---- 某一时刻正在显示的 cue（可能有几条重叠）：按开始时间二分，再借「到此为止最晚的结束时间」往回找，长时间重叠的也不漏。
const reachOf = new WeakMap();
export function cuesAt(cues, t) {
  if (!cues?.length || !Number.isFinite(t)) return [];
  let reach = reachOf.get(cues);
  if (!reach) {
    reach = [];
    let r = -Infinity;
    for (const c of cues) reach.push((r = Math.max(r, c.end)));
    reachOf.set(cues, reach);
  }
  let lo = 0,
    hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo - 1; i >= 0 && reach[i] > t; i--) if (cues[i].end > t) out.push(cues[i]);
  return out.reverse();
}
