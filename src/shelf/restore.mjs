// 恢复：找不到文件夹的书和卷的恢复流程（全部恢复、单本恢复）与确认对话框。只接回已有记录，不新增书；配对规则见 pairing.mjs。
import { isLoose, allPages, keyOf } from '../core/sources.mjs';
import { norm, grade, assign } from '../core/match.mjs';
import { extend } from '../core/lang.mjs';
import { install as pairing } from './pairing.mjs';
import { $ } from './util.mjs';

extend({
  sameMedia: [
    'Media files match by name and size',
    '媒体文件的名称和大小大多相符',
    'メディアファイルの名前とサイズがほぼ一致',
    '미디어 파일 이름과 크기가 대부분 일치',
  ],
});
export function install(ctx, S) {
  const { books, t, fmt, notice, make, safe } = ctx;
  const draw = (...a) => S.draw(...a);
  // ---- 恢复：以源（文件夹）为单位。待恢复的“槽”是过期书的每个源，以及其他书中暂时找不到的卷；
  // 单文件夹书按整本书的名称和封面摘要匹配，合并作品按每一卷的名称和封面摘要匹配。用户选的文件夹作为源，可同时恢复所有引用它的书。
  // 先按文件夹名找，再比对封面摘要；改过名的文件夹用“页数相近 + 封面文件大小相同”筛出后再算摘要。
  const { candidates, coverFile, candHash, candSizes, sized, slotsOf, allSlots, pairs, apply } = pairing(ctx);
  async function pickRoot() {
    if (!window.showDirectoryPicker) {
      notice('needFsa');
      return null;
    }
    return showDirectoryPicker({ mode: 'read', id: 'mv-restore' });
  } // id：选择框开在上次恢复时选的位置
  function summary(done, pending, left) {
    const parts = [];
    if (done) parts.push(fmt('restoredN', { n: done }));
    if (pending) parts.push(fmt('pendingN', { n: pending }));
    if (left) parts.push(fmt('unmatchedN', { n: left }));
    notice(null, parts.join(' · ') || t('noMatch'));
  }
  const stillExpired = (slots) =>
    [...new Set(slots.map((x) => x.book))].filter((b) => books.has(b.id) && ctx.expired(b)).length;
  async function restoreBatch() {
    const dir = await pickRoot();
    if (!dir) return;
    const slots = allSlots();
    notice(null, fmt('scanningN', { n: 0 }), 120000);
    const cands = await candidates(dir, (n) => {
      if (n % 25 === 0) notice(null, fmt('scanningN', { n }), 120000);
    });
    const matched = assign(await pairs(slots, cands)),
      sure = matched.filter((p) => p.level === 2),
      maybe = matched.filter((p) => p.level === 1);
    const done = (await apply(sure)) + (await looseBack(dir));
    draw();
    ctx.emit('books');
    if (!maybe.length) return summary(done, 0, stillExpired(slots));
    openRestore({
      title: t('reviewTitle'),
      hint: t('reviewHint'),
      go: t('restoreSelected'),
      rows: maybe,
      checks: true,
      async onGo(chosen) {
        const more = await apply(chosen);
        draw();
        summary(done + more, 0, stillExpired(slots));
      },
    });
    summary(done, new Set(maybe.map((p) => p.book)).size, 0);
  }
  // 恢复只接回已有的记录，不新增书：所选文件夹里对不上任何记录的文件夹一律忽略。散图图集按相对目录 + 文件名逐页找回。
  async function looseBack(dir) {
    const lb = [...books.values()].find(ctx.looseLost);
    return lb && (await ctx.relocate(lb, dir, true)) ? 1 : 0;
  }
  async function restoreOne(b) {
    const dir = await pickRoot();
    if (!dir) return;
    if (isLoose(b)) {
      const n = (await ctx.relocate(b, dir, true)) ? 1 : 0,
        more = await apply(assign(await pairs(allSlots(), await candidates(dir))).filter((p) => p.level === 2));
      draw();
      ctx.emit('books');
      if (n + more) summary(n + more, 0, 0);
      else notice('noMatch');
      return;
    }
    const cands = await candidates(dir);
    if (!cands.length) return notice('noImages');
    let mine = slotsOf(b);
    if (!mine.length) mine = slotsOf(b, null, true);
    const others = allSlots().filter((x) => x.book !== b);
    if (!mine.length) return notice('noMatch');
    // 同一个文件夹也可能是其他过期书或缺失的卷：完全匹配的一并接回。
    const extra = async () => {
      await apply(assign(await pairs(others, cands)).filter((p) => p.level === 2));
      await looseBack(dir);
      ctx.emit('books');
    };
    if (!mine[0].merged) {
      const x = mine[0],
        ps = [];
      for (const c of cands) {
        if (b.fp?.cover?.hash) await candHash(c);
        if (sized(b)) await candSizes(c);
        ps.push({ book: b, source: x.source, merged: false, cand: c, ...grade(b, c) });
      }
      ps.sort((p, q) => q.score - p.score);
      // 都不匹配时，以所选文件夹本身（或唯一的子文件夹）作为强制恢复的对象。
      const best = ps[0].level ? ps[0] : (ps.find((p) => p.cand.dir === dir) ?? (ps.length === 1 ? ps[0] : null));
      if (!best) return notice('noMatch');
      const done = async () => {
        await ctx.relink(b, best.cand, x.source);
        await extra();
        draw();
        summary(1, 0, 0);
      };
      if (best.level === 2) return done();
      return openRestore({
        title: t('restoreTitle'),
        hint: t('forceHint'),
        go: t(best.level ? 'restore' : 'forceRestore'),
        rows: [best],
        onGo: done,
      });
    }
    // 合并作品：逐卷匹配；完全匹配的直接接回，可能匹配的勾选确认。一卷都对不上时：整本过期才可以按所选文件夹重建（相对路径相同的卷保留书签和进度）；
    // 只缺一卷时可以把所选文件夹强制接到这一卷，其他卷不动；缺多卷时不猜，提示没有匹配。
    const matched = assign(await pairs(mine, cands)),
      sure = matched.filter((p) => p.level === 2),
      maybe = matched.filter((p) => p.level === 1);
    if (!matched.length) {
      if (ctx.expired(b)) {
        const row = {
          book: b,
          cand: { title: dir.name, dir, names: cands.flatMap((c) => c.names), path: dir.name, cover: cands[0] },
          same: norm(dir.name) === norm(b.title),
          cover: null,
        };
        return openRestore({
          title: t('restoreTitle'),
          hint: t('forceMergedHint'),
          go: t('forceRestore'),
          rows: [row],
          async onGo() {
            await ctx.rebuild(b, ctx.mergeKeys(cands));
            await extra();
            draw();
            summary(1, 0, 0);
          },
        });
      }
      const lost = b.sources.filter((s) => ctx.isDown(b, s)),
        cand = cands.find((c) => c.dir === dir) ?? (cands.length === 1 ? cands[0] : null);
      if (lost.length !== 1 || !cand) return notice('noMatch');
      const x = mine.find((x) => x.source === lost[0]),
        row = { book: b, source: x.source, merged: true, cand, ...grade(x.t, cand) };
      return openRestore({
        title: t('restoreTitle'),
        hint: t('forceVolumeHint'),
        go: t('forceVolume'),
        rows: [row],
        async onGo() {
          await ctx.relinkAll(b, [{ cand, source: x.source }]);
          await extra();
          draw();
          summary(1, 0, 0);
        },
      });
    }
    await apply(sure);
    await extra();
    draw();
    if (!maybe.length) return summary(1, 0, 0);
    openRestore({
      title: t('reviewTitle'),
      hint: t('reviewHint'),
      go: t('restoreSelected'),
      rows: maybe,
      checks: true,
      async onGo(chosen) {
        await apply(chosen);
        draw();
        summary(1, 0, 0);
      },
    });
  }
  let urls = [];
  function side(label, name, meta, load) {
    const s = make('span', 'side'),
      mini = make('span', 'mini'),
      txt = make('span', 'txt');
    load()
      .then((u) => {
        if (u) {
          const img = new Image();
          img.alt = '';
          img.src = u;
          mini.append(img);
        }
      })
      .catch(() => {});
    txt.append(make('small', '', label), make('strong', '', name), make('span', '', meta));
    s.append(mini, txt);
    return s;
  }
  function openRestore({ title, hint, go, rows, checks = false, onGo }) {
    const dlg = $('restore');
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    $('restoreTitle').textContent = title;
    $('restoreHint').textContent = hint;
    $('restoreGo').textContent = go;
    $('restoreList').replaceChildren(
      ...rows.map((p) => {
        const row = make(checks ? 'label' : 'div', 'match');
        if (checks) {
          const box = make('input');
          box.type = 'checkbox';
          box.checked = !!p.cover;
          p.box = box;
          row.append(box);
        }
        const pages = (n) => n + ' ' + t('pages');
        // 合并作品的某一卷：显示“书名 · 卷名”和这一卷的页数、路径。
        const vol = p.merged && p.source,
          n = vol ? allPages(p.book).filter((x) => keyOf(x) === vol.key).length : p.book.pages.length;
        row.append(
          side(
            t('oldRecord'),
            ctx.title(p.book) + (vol ? ' · ' + vol.title : ''),
            [pages(n), vol ? vol.path : p.book.path].filter(Boolean).join(' · '),
            async () => (await ctx.getThumb(p.book.id + ':cover'))?.url,
          ),
          make('span', 'arrow', '→'),
          side(
            t('newFolder'),
            p.cand.title,
            [pages(p.cand.names.length), p.cand.path].filter(Boolean).join(' · '),
            async () => {
              const th = await ctx.makeThumb(await coverFile(p.cand.cover ?? p.cand), { width: 120 });
              const u = URL.createObjectURL(th.blob);
              urls.push(u);
              return u;
            },
          ),
        );
        const why = make('span', 'why');
        why.append(make('span', p.same ? '' : 'bad', t(p.same ? 'sameName' : 'diffName')));
        if (p.cover != null) why.append(make('span', p.cover ? '' : 'bad', t(p.cover ? 'sameCover' : 'diffCover')));
        if (p.media >= 0.6) why.append(make('span', '', t('sameMedia'))); // 含媒体的书：按「文件名 + 大小」重合度列出的
        row.append(why);
        return row;
      }),
    );
    $('restoreGo').onclick = safe(async () => {
      const chosen = checks ? rows.filter((p) => p.box.checked) : rows;
      dlg.close();
      if (chosen.length) await onGo(chosen);
    });
    dlg.showModal();
  }
  ctx.restoreOne = restoreOne;
  ctx.restoreBatch = restoreBatch;
  $('restoreAllBtn').onclick = safe(() => restoreBatch());
  S.restoreOne = restoreOne;
  S.restoreBatch = restoreBatch;
}
