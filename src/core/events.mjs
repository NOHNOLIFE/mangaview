// 模块间的事件：ctx.on 往 listeners 里登记，emit 派发（单个处理函数出错只记警告，不影响其他）。
export const listeners = {};
export function emit(type, ...args) {
  for (const fn of listeners[type] || [])
    try {
      fn(...args);
    } catch (e) {
      console.warn(e);
    }
}
