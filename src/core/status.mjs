// 书的可用状态（纯逻辑）：过期、合并作品缺卷数、散图图集缺页，书引用的文件夹句柄与启动 / 刷新前的句柄探测（probeAll）。
import { down, isDead, isLive, isLoose, allPages, probe } from './sources.mjs';
// 过期：全部源（文件夹）都找不到，或没有任何可用的文件来源（导入的备份、重启后的文件选择器散图）。记录保留，手动删除才清除。
export function expired(b) {
  return b.sources?.length
    ? b.sources.every((s) => down(b, s))
    : !b.pages.some((p) => p.handle && !isDead(p.handle)) && !isLive(b);
}
// 散图图集里有页没有可用的句柄（失效或尚未接回）：恢复时顺带找回。
export const looseLost = (b) => isLoose(b) && !isLive(b) && allPages(b).some((p) => !p.handle || isDead(p.handle));
// 合并作品中暂时找不到的卷数（整本过期时为 0）：只在书籍卡片上给一个小提示。
export const lostSources = (b) =>
  b.sources?.length > 1 && !expired(b) ? b.sources.filter((s) => down(b, s)).length : 0;
// 书引用的全部文件夹句柄（各源的文件夹，合并作品另有当初所选的根文件夹）。
export const handlesOf = (list) =>
  list.flatMap((b) => [...b.sources.map((s) => s.dir), ...(b.roots || [])]).filter(Boolean);
export const probeAll = (list) =>
  probe(
    handlesOf(list),
    list.filter(isLoose).flatMap((b) =>
      allPages(b)
        .map((p) => p.handle)
        .filter(Boolean),
    ),
  );
