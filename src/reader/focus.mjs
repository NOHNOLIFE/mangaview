// 专注模式（默认开启）：常驻的书架书签列表和停靠的缩略图栏，在没有悬停、没有键盘焦点时隐藏内容（仍占位，不收起），
// 底色与阅读区相同的中性深色，减少干扰；鼠标移上去即淡入显示。样式全在 focus.css，这里只负责开关。
import { extend } from '../core/lang.mjs';
extend({
  focusMode: [
    'Focus mode: side panels show their content only on hover',
    '专注模式：侧栏只在悬停时显示内容',
    '集中モード：サイドパネルはホバー時だけ内容を表示',
    '집중 모드: 사이드 패널은 마우스를 올렸을 때만 내용 표시',
  ],
});
export function install(ctx) {
  const on = () => ctx.get('focusMode', true) !== false;
  const apply = () => document.body.classList.toggle('focus-mode', on());
  apply();
  ctx.prefs.sync('focusMode', apply); // 设置类：别的窗口切换后即时跟随
  ctx.settings.push({
    id: 'focusMode',
    group: 'reading',
    label: 'focusMode',
    type: 'toggle',
    get: on,
    set: (v) => {
      ctx.put('focusMode', !!v);
      apply();
    },
  });
}
