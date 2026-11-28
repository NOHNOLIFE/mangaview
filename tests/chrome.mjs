// 浏览器测试共用的启动参数（各 tests/*.browser.mjs 经 launch 启动浏览器，参数只在这里改）：
// 无头、独立的临时配置目录（profile，由各测试自己 mkdtemp）、调试端口自动分配，并且一律静音（--mute-audio）：
// 测试里的音频、视频照常"播放"（播放状态、音量、静音等属性都不受影响），只是不从扬声器出声。
// launch(浏览器路径, 配置目录, {size: '宽,高', autoplay: 是否关掉浏览器的自动播放拦截}) → 子进程。
import { spawn } from 'node:child_process';

export function launch(binary, profile, { size = '800,900', autoplay = false } = {}) {
  return spawn(
    binary,
    [
      '--headless=new',
      '--mute-audio',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--disable-background-networking',
      ...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []),
      '--window-size=' + size,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}
