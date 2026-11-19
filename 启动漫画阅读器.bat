@echo off
setlocal
chcp 65001 >nul
title MangaView
if not exist "%~dp0index.html" (
    echo 找不到 index.html，请将本文件放在项目根目录。
    pause
    exit /b 1
)

set "runner=py -3"
py -3 -I -c "from http.server import ThreadingHTTPServer" >nul 2>&1
if errorlevel 1 (
    set "runner=python"
    python -I -c "from http.server import ThreadingHTTPServer" >nul 2>&1
    if errorlevel 1 (
        echo 未找到可用的 Python 3，请安装 Python 3 并勾选加入 PATH 后重试。
        pause
        exit /b 1
    )
)

pushd "%~dp0" || exit /b 1
%runner% -I -c "from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler; import webbrowser; server=ThreadingHTTPServer(('127.0.0.1', 4173), SimpleHTTPRequestHandler); url='http://127.0.0.1:4173/'; print('MangaView:', url, '（关闭此窗口即可停止服务）', flush=True); webbrowser.open(url); server.serve_forever()"
if errorlevel 1 (
    echo 服务已停止。若提示端口 4173 被占用，请检查是否已打开另一个启动窗口。
    pause
    popd
    exit /b 1
)
popd
