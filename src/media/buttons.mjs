// 壳上的列表级按钮：只播放书签区段、播放顺序、循环、新窗口播放（ctx.player.add）。只有登记，状态与操作在 sections.mjs、order.mjs、popout.mjs。
import { ORDER_ICON, ORDER_LABEL } from './order.mjs';

export function install(ctx, S) {
  const popout = (...a) => S.popout(...a);
  // 播放顺序（列表 / 随机 / 单集，一个按钮轮换，图标随状态变化）、循环（开关）、只播放书签区段（开关）。
  ctx.player.add({
    id: 'sections',
    icon: 'sections',
    label: 'mvSections',
    order: 30,
    click() {
      S.toggleSections();
    },
    state: () => ({ pressed: S.only }),
  });
  ctx.player.add({
    id: 'order',
    icon: ORDER_ICON[S.order],
    label: ORDER_LABEL[S.order],
    order: 40,
    click() {
      S.cycleOrder();
    },
    state: () => ({ icon: ORDER_ICON[S.order], label: ORDER_LABEL[S.order] }),
  });
  ctx.player.add({
    id: 'loop',
    icon: 'repeat',
    label: 'mvLoop',
    order: 41,
    click() {
      S.toggleLoop();
    },
    state: () => ({ pressed: S.loop }),
  });
  ctx.player.add({
    id: 'popout',
    icon: 'popout',
    label: 'mvPopout',
    order: 85,
    click: (p) => popout(p),
    state: (p) => ({ disabled: p.state === 'failed' }),
  });
}
