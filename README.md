<div align="center">

<img src="icons/192.png" width="88" alt="MangaView">

# MangaView

**A local manga & webtoon reader that runs in your browser.**<br>
Handles huge libraries, works offline, and never uploads your files.

**English** · [简体中文](README.zh-CN.md)

### [▶ Open MangaView](https://nohnolife.github.io/mangaview/)

</div>

## Showcase

<!-- Screenshots, GIFs or demo videos go here. -->

*Screenshots and a demo video are coming soon.*

## Features

- **Open anything local**: pick or drag in folders and loose images. Every folder that directly contains images becomes a book.
- **Built for long strips**: each book is one continuous vertical strip with no snapping at image borders, so tall webtoon pages read naturally.
- **Fast with big libraries**: only visible pages are created and decoded, behind a small read queue. Thousands of images on a spinning hard drive stay responsive.
- **Thumbnail navigator**: pops out at the right window edge or stays pinned beside the page. Click any point of a thumbnail to jump to that exact spot, even inside a very tall image.
- **Bookshelf**: covers, page counts, reading progress, title search and page-count filters.
- **Sorting**: by file name or modification time (either direction), or shuffle. Set a default or override it per book.
- **Picks up where you left off** in every book, and refreshes folders to pick up added or removed images.
- **Installable and offline**: install it as an app. After the first load it runs without a network connection.
- **Four languages**: English, 中文, 日本語 and 한국어, chosen automatically from your browser settings.

## Getting started

### Online

Open **https://nohnolife.github.io/mangaview/** in the latest desktop **Chrome** or **Edge**. To install it as an app, use the install icon in the address bar. Once loaded, it also works offline.

### Run locally

On Windows, install [Python 3](https://www.python.org/) and double-click `启动漫画阅读器.bat` in the repository root. It starts a local server and opens your browser. Keep the console window open while reading, and close it to stop the server.

Or run this from the repository root on any platform:

```sh
python -m http.server 4173 --bind 127.0.0.1
```

Then open http://127.0.0.1:4173/. Opening `index.html` straight from disk does not work, because installing, offline mode and file access all need a secure context.

## How to use

Open a folder or images from the welcome screen, or drop them anywhere in the window. Hover the top-left corner or press **T** to show the toolbar.

### Mouse

| Action | Result |
| --- | --- |
| Wheel / left-drag | Scroll |
| Middle click | Browser auto-scroll (where your OS and browser support it) |
| Click the top 15% | Jump to the start. At the start, go to the previous book |
| Click the bottom 15% | Jump to the end. At the end, go to the next book |
| Click the middle, left / right half | Back / forward one screen |
| Move to the right window edge | Pop out the thumbnail strip |
| Click a thumbnail | Jump to that exact point |

### Keyboard

| Keys | Result |
| --- | --- |
| `Space` / `↓` | Scroll down (hold to keep scrolling) |
| `Shift+Space` / `↑` | Scroll up |
| `F` / `→` / `Enter` | Forward one screen |
| `D` / `←` | Back one screen |
| `Home` / `End` | Start / end of the book. Press again to change books |
| `Page Up` / `Page Down` | Previous / next book |
| `Delete` | Remove the current book from the shelf |
| `Ctrl+C` | Copy the titles currently listed on the shelf |
| `T` | Show or hide the toolbar |
| `Esc` | Close the toolbar and the thumbnail strip |

The keyboard button in the toolbar shows this list inside the app.

### Thumbnail strip

Move the mouse to the right edge to pop it out over the page. It closes when the mouse leaves. The thumbnail button in the toolbar pins it instead: pinned, it sits beside the page and the page narrows so nothing is covered. Drag its left edge to resize it.

### Sorting

In **Sort**, choose **This folder / book** to set an order for the current book only, or **Default for all folders** to change the default. **Use default** removes a book's own setting. Choosing shuffle reshuffles every time you pick it, but reopening a book keeps its shuffled order. Time-based sorting reads file modification times on demand. Re-import a folder to refresh those times.

### Refreshing folders

MangaView checks your folders for added or removed images in three cases:

- each time the app opens or the page is reloaded, it checks every folder it still has access to;
- when you switch back to the window, it checks the current book;
- when you press a **Refresh** button (next to **Bookshelf** in the toolbar, and on the shelf), it checks everything. A manual refresh can also ask for access to the current book again.

A folder that can't be found is **not** removed automatically, because the browser can't tell a deleted folder from an unplugged drive. The book is marked *Folder missing* on the shelf instead. A manual refresh lists the missing folders and removes their records only after you confirm. This stops a new folder that later appears at the same path from inheriting old progress and order. New subfolders are not detected: open the parent folder again to add them.

### Your data

Images are read on your device and never uploaded or copied. The app stores only a book index, read-only file handles, sort settings and reading positions in the browser. Clearing site data erases this history.

- If the browser has revoked access when you reopen a book, use **Grant access**.
- If the files have moved, use **Locate originals**.
- Browsers without file-handle support need you to pick the files again after a restart.

## Upgrading from v1

The old version that used to live at `/mangaview/dist/` has been replaced by v2. v1 kept no reading history, so there is nothing to migrate.

- Visiting the old address, or opening an installed v1 app, takes you to the new version automatically.
- If you had installed v1, install v2 from the address bar, then uninstall the old app from `chrome://apps` (Edge: `edge://apps`).

## Development

There is no build step and there are no dependencies, just plain ES modules served as static files.

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css` | Markup, icons and styles |
| `app.mjs` | App logic: shelf, toolbar, input, sorting, refresh |
| `view.mjs` | Virtualized reader, thumbnail strip, image loading queue |
| `model.mjs` | Sorting and layout math |
| `sources.mjs` | Folder scanning and file access |
| `store.mjs` | IndexedDB storage |
| `lang.mjs` | Built-in translations |
| `sw.js` | Offline cache |
| `dist/` | Migration bridge for v1 users |

Tests need Node 22.12+:

```sh
node --test tests/core.test.mjs
# End-to-end test in headless Chrome or Edge:
node tests/browser.mjs "<path to chrome.exe or msedge.exe>"
```

Things the automated tests can't cover:

- an offline cold start of the installed app;
- importing thousands of images from a real hard drive (not an SSD) and switching books while scrolling;
- middle-click auto-scroll across tall images on Windows;
- the real window frame of the installed app.

### Releasing

1. Change the version in **both** the `<title>` of `index.html` and `cacheName` in `sw.js` (a test checks they match).
2. Push to `main`. GitHub Pages serves the repository root.

Open windows keep the version they started with. The new version downloads in the background and takes over once every old window is closed. If the download fails or you are offline, the current version keeps running. Keep `dist/` for as long as v1 users may still be around.
