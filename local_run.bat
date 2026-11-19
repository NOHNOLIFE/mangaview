@echo off
rem Local server for developing MangaView. Regular users do not need this:
rem just open https://nohnolife.github.io/mangaview/ in Chrome or Edge.
setlocal
title MangaView local server
cd /d "%~dp0"
if not exist "index.html" (
    echo index.html not found. Keep local_run.bat in the MangaView project root.
    pause
    exit /b 1
)

set "PY="
py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(sys.version_info[0] < 3)" >nul 2>&1 && set "PY=python"
if not defined PY (
    echo Python 3 was not found. Install it from https://www.python.org/
    echo and tick "Add python.exe to PATH" during setup, then run this file again.
    pause
    exit /b 1
)

echo MangaView: http://127.0.0.1:4173/
echo Keep this window open while reading. Close it or press Ctrl+C to stop.
%PY% -I -c "import http.server as s, os, webbrowser; H=s.SimpleHTTPRequestHandler; H.extensions_map={**H.extensions_map, '.mjs':'text/javascript', '.js':'text/javascript', '.webmanifest':'application/manifest+json'}; srv=s.ThreadingHTTPServer(('127.0.0.1', 4173), H); os.environ.get('MV_NO_BROWSER') or webbrowser.open('http://127.0.0.1:4173/'); exec('try:\n srv.serve_forever()\nexcept KeyboardInterrupt:\n pass')"
if errorlevel 1 (
    echo.
    echo The server stopped. If port 4173 is already in use, close the other MangaView window first.
    pause
    exit /b 1
)
