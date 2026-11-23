<div align="center">

<img src="icons/192.png" width="88" alt="MangaView">

# MangaView

**A local manga & webtoon reader that runs in your browser.**<br>
Handles huge libraries, works offline, and never uploads your files.

**English** · [简体中文](README.zh-CN.md)

#漫画阅读器 #本子阅读器 #同人志阅读器 #条漫阅读器<br>
#漫画ビューア #同人誌ビューア #漫画リーダー #만화뷰어 #웹툰뷰어<br>
#manga-reader #comic-reader #webtoon-reader

### [▶ Open MangaView](https://nohnolife.github.io/mangaview/)

</div>

> [!IMPORTANT]
> **There is nothing to download or install from this repository.** MangaView is a web app: open the link above in Chrome or Edge and start reading. If you want it as a desktop app, use the browser's own *Install* button. It then gets its own window, works offline and updates itself. The files here are the source code, needed only if you want to develop MangaView.

## Showcase

<!-- Screenshots, GIFs or demo videos go here. -->

*Screenshots and a demo video are coming soon.*

## Features

- **Open anything local**: pick or drag in folders and loose images. Every folder that directly contains images becomes a book.
- **Built for long strips**: each book is one continuous vertical strip with no snapping at image borders, so tall webtoon pages read naturally.
- **Fast with big libraries**: only visible pages are created and decoded, behind a small read queue. Thousands of images on a spinning hard drive stay responsive.
- **Thumbnail navigator**: pops out at the right window edge or stays pinned beside the page. Click any point of a thumbnail to jump to that exact spot, even inside a very tall image.
- **Shelf and library**: keep what you are reading on the shelf and everything else in the library. Both show a cover-only masonry wall; titles and actions appear on hover.
- **Tags**: add your own tags to any book. Each tag gets its own colour, and you can filter by clicking a tag or typing `#tag` in the search box.
- **Bookmarks**: press and hold `G` to bookmark the current spot. Bookmarks are listed as small pictures of the page, because nobody remembers file names.
- **Sorting**: by file name or modification time (either direction), or shuffle. Set a default or override it per book.
- **Picks up where you left off** in every book, and refreshes folders to pick up added or removed images.
- **Nothing is lost when files move**: books whose folder can't be found go to *Missing* with their covers, tags and bookmarks intact, and can be reconnected later.
- **Backup**: export all app data to one file and import it on another computer.
- **Installable and offline**: install it as an app. After the first load it runs without a network connection.
- **Four languages**: English, 中文, 日本語 and 한국어, chosen automatically from your browser settings.

## Getting started

1. Open **https://nohnolife.github.io/mangaview/** in the latest desktop **Chrome** or **Edge**.
2. *(Optional)* Install it: click the install icon at the right end of the address bar, or open the browser menu and choose *Install MangaView*. It opens in its own window, can be pinned to the taskbar and works offline.
3. Open a folder or drop images into the window.

New versions arrive automatically. There is nothing to download, unzip or set up.

## How to use

Open a folder or images from the welcome screen, or drop them anywhere in the window. Move the mouse to the top edge of the window (or hover the menu button in the top-left corner, or press **T**) to open the toolbar.

### Mouse

| Action | Result |
| --- | --- |
| Wheel / left-drag | Scroll |
| Middle click | Browser auto-scroll (where your OS and browser support it) |
| Click the left / right half | Back / forward one screen |
| Move to the top window edge | Open the toolbar |
| Move to the bottom window edge | Open the start / end bar. At either end its buttons switch to the previous / next book |
| Move to the left window edge | Pop out the shelf bookmarks (when not pinned) |
| Move from the page into the top-left corner | Open full-screen shelf bookmarks |
| Move to the right window edge | Pop out the thumbnail strip |
| Move from the page into the top-right corner | Open full-screen thumbnails |
| `V` / `]` | Open or close full-screen thumbnails |
| `C` / `[` | Open or close full-screen shelf bookmarks |
| `W` `A` `S` `D` / arrow keys (in full-screen views) | Choose a thumbnail; `Space` / `Enter` jumps to it |
| Click a thumbnail | Jump to that exact point |
| Right click | Open the bookmark panel |

### Keyboard

| Keys | Result |
| --- | --- |
| `Space` / `↓` | Scroll down (hold to keep scrolling) |
| `Shift+Space` / `↑` | Scroll up |
| `F` / `→` | Tap: forward one screen. Hold: next book (a ring fills while you hold) |
| `D` / `←` | Tap: back one screen. Hold: previous book |
| `G` / `Enter` | Tap: next bookmark. Hold: add a bookmark |
| `Home` / `End` | Start / end of the book. Press again to change books |
| `Page Up` / `Page Down` | Previous / next book |
| `Delete` | Delete the current book's record |
| `Ctrl+C` | Copy the titles currently listed on the shelf |
| `B` | Open or close the shelf |
| `T` | Show or hide the toolbar |
| `Esc` | Close the toolbar, the start / end bar and floating side panels |

The keyboard button in the toolbar shows this list inside the app.

### Toolbar and start / end bar

Rest the mouse at the top edge and the toolbar appears, centred over the page: one row of icons (hover one to see its name), with the book title and progress just below. Rest it at the bottom edge for the start / end bar: **Back to top**, **Jump to end** and the current page; at the start or end the buttons become **Previous book** / **Next book**. Both fade out when the mouse leaves, and each edge pop-out can be turned off in **Settings → Toolbar**; the menu button and **T** still work. Clicking the page only turns it (left half back, right half forward); there are no top / bottom click zones any more.

### Shelf, library and tags

The **Bookshelf** button opens a full-screen view with four lists:

- **Shelf**: what you are reading now. Newly opened folders, and folders you open again, land here. *Previous / next book* move through this list.
- **Library**: everything else, for managing large collections.
- **All books**: both together, for searching everything.
- **Missing**: only shown when some books' folders can't be found (see below).

Search matches titles, folder paths and tags. Type `#tag` to filter by tag, or click tags in the tag bar (several tags must all match). The drop-down at the top left sorts books by date added (newest first by default), folder time or name, in either direction. Shelf, library and all books share this setting, and previous / next book and the shelf bookmark list follow the same order. Browsers can't read a folder's own modification time, so *folder time* is the newest modification time of the images inside; it is worked out in the background only when you pick that sort (file info only, no image reading), and books not done yet go last. The pencil button on a cover edits the title. Only the displayed name changes, not the folder, and searching for the folder name still finds the book; leave it empty to restore the original. **Move all to shelf / library** applies to everything the current filters show, while **Clear shelf / library** deletes the records of every book in that list (filters don't apply) after asking for confirmation; image files are never deleted. Hover or focus a cover to see its title, progress and tags, and buttons to edit tags, move, copy the title or delete the record. Tag colours are picked automatically from the tag name, so the same tag always has the same colour.

### Bookmarks

- **Hold `G` or `Enter`** to add a bookmark at the centre of the screen. A ring fills up while you hold, so you can see what is happening; let go early and it counts as a tap.
- **Tap `G` or `Enter`** to jump to the next bookmark. After the last one it wraps to the first.
- **Right click** the page to open the bookmark panel at the mouse. Hovering a bookmark jumps there immediately; moving the mouse out closes the panel and keeps the new position, while **Esc** closes it and goes back to where you were. The **Add bookmark** button sits right under the mouse when the panel opens.

Bookmarks are stored with a small picture of the page and follow the image, not the scroll position, so they survive re-sorting.

**Shelf bookmarks**: works like the thumbnail strip. By default a list is pinned on the left that gathers the bookmarks of every book on the shelf (not the library or missing books), in shelf order; the page narrows to make room, and you can drag the list's right edge to resize it. The **Shelf bookmarks** button in the toolbar unpins it; it then pops out over the page when you rest the mouse at the left edge and fades out when the mouse leaves (turn this off in **Settings → Reading**). Hovering does nothing; click a bookmark to jump there, opening its book if needed. The list is compact: one group of thumbnails per book (the current book's group is highlighted), with no titles or file names. While the list is pinned, tapping `G` / `Enter` follows it too: after the last bookmark in the current book it moves on to the next book, and wraps back to the start at the end. A book in the library still cycles through its own bookmarks.

**Focus mode** (on by default, turn it off in **Settings → Reading**): when the mouse isn't over them and they don't have keyboard focus, the shelf bookmark list and the docked thumbnail strip hide their content but keep their space. Their background becomes a slightly dimmed extension of the left / right edge colours of the page you're reading, following you as you scroll, so there is less to distract you. Move the mouse over them to bring the content back. Showing and hiding fade with a short delay, so sweeping the mouse past them does not flicker.

### Thumbnail strip

Move the mouse to the right edge to pop it out over the page. It closes when the mouse leaves. The thumbnail button in the toolbar pins it instead: pinned, it sits beside the page and the page narrows so nothing is covered. Drag its left edge to resize it.

**Full-screen thumbnails** (on by default, turn it off in **Settings → Reading**): moving from the page into the top-right corner opens a full-screen overview of the whole book. The corner is the upper 30% of the right edge, or of the docked strip while focus mode is on; the lower part still pops out or reveals the strip as before. It only triggers when the mouse comes in from the page: entering from the top or bottom band, or sliding up the edge or the strip into the corner, does nothing. `V` or `]` opens and closes it at any time, whether or not the setting is on. Thumbnails are packed in a tight masonry layout with a wide scrollbar on the right, so long books can be skimmed and located quickly. The current page is selected; `A` `D` / `←` `→` move in page order, `W` `S` / `↑` `↓` move within a column, `Page Up` / `Page Down`, `Home` / `End` also work. Click a thumbnail, or press `Space` / `Enter`, to jump to the top of that page and close the overview; `Esc` closes it. After it closes, the mouse has to go back to the page before it triggers again.

**Full-screen shelf bookmarks** (on by default, separate switch in **Settings → Reading**): the left side works the same way. Moving from the page into the top-left corner (the upper 30% of the left edge, or of the pinned shelf bookmark list while focus mode is on) opens every shelf bookmark full screen, grouped by book with the book title as a heading (the current book is highlighted). `C` or `[` opens and closes it. The bookmark nearest the middle of the screen is selected; `A` `D` / `←` `→` move in order, `W` `S` / `↑` `↓` move to the nearest bookmark in the row above or below. Click or `Space` / `Enter` jumps to it, switching books if needed. Pressing `V` / `]` or `C` / `[` in one full-screen view switches to the other. With no bookmarks on the shelf, the corner shows the list as before.

### Sorting

In **Sort**, choose **This folder / book** to set an order for the current book only, or **Default for all folders** to change the default. **Use default** removes a book's own setting. Choosing shuffle reshuffles every time you pick it, but reopening a book keeps its shuffled order. Time-based sorting reads file modification times on demand. Re-import a folder to refresh those times.

### Refreshing folders

MangaView checks your folders for added or removed images in three cases (the first can be turned off in **Settings**):

- each time the app opens or the page is reloaded, it checks every folder it still has access to;
- when you switch back to the window, it checks the current book;
- when you press a **Refresh** button (next to **Bookshelf** in the toolbar, and on the shelf), it checks everything. A manual refresh can also ask for access to the current book again.

New subfolders are not detected: open the parent folder again to add them.

### Missing books and moving your files

A book whose folder can't be found is **never** deleted automatically, because the browser can't tell a deleted folder from an unplugged drive. It moves to **Missing** instead, keeping its cover, tags, bookmarks and progress. Plug the drive back in and refresh, and it returns on its own. Records are deleted only when you delete them.

Browsers never reveal a folder's full path on disk, so after files are moved MangaView recognises books by their **folder name** plus a fingerprint of the **cover** (the first image by file name):

- **Open the parent folder again**: a missing book with the same folder name and cover is reconnected automatically instead of being added twice.
- **Restore from folder…** (in *Missing*): pick a folder that contains your books, at any depth. Exact matches are restored at once. Likely matches (renamed folder with the same cover, or same name with a different cover) are listed for you to tick. Anything else stays missing.
- **Restore** on a single book: pick its folder. If it doesn't match, you can still **Restore anyway** to keep the tags, bookmarks and progress.

### Your data

Images are read on your device and never uploaded or copied. The browser stores a book index, read-only file handles, sort settings, reading positions, tags, bookmarks and small compressed thumbnails (covers and bookmarks, never the original images). Clearing site data erases all of this.

**Settings → Data** can export everything to one JSON file and import it again, merging with or replacing the current data. The file contains no images and no folder access, so after importing on another computer the books appear under *Missing*: use **Restore from folder…** to reconnect them.

- If the browser has revoked access when you reopen a book, use **Grant access**.
- If the files have moved, use **Locate originals**.
- Browsers without file-handle support need you to pick the files again after a restart.

## Upgrading from v1

The old version that used to live at `/mangaview/dist/` has been replaced by v2. v1 kept no reading history, so there is nothing to migrate.

- Visiting the old address, or opening an installed v1 app, takes you to the new version automatically.
- If you had installed v1, install v2 from the address bar, then uninstall the old app from `chrome://apps` (Edge: `edge://apps`).

## Development

There is no build step and there are no dependencies, just plain ES modules served as static files.

### Run locally

This is only for working on the code; to read manga, use the online version.

- **Windows**: install [Python 3](https://www.python.org/) and double-click `local_run.bat` in the repository root. It starts a server at http://127.0.0.1:4173/ and opens your browser. Close the console window to stop it.
- **Any platform**: run `python -m http.server 4173 --bind 127.0.0.1` from the repository root, then open http://127.0.0.1:4173/.

Opening `index.html` straight from disk does not work, because installing, offline mode and file access all need a secure context (HTTPS or localhost).

### Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css` | Markup, icons and styles |
| `app.mjs` | Core logic: books, input, sorting, refresh, keyboard; installs the feature modules |
| `shelf.mjs`, `shelf.css` | Shelf, library, missing books, tags, restore |
| `match.mjs` | Matching missing books to folders, tag colours |
| `toolbar.mjs`, `toolbar.css` | Top toolbar, bottom start / end bar |
| `bookmarks.mjs`, `bookmarks.css` | Bookmarks, shelf bookmark list |
| `focus.mjs`, `focus.css` | Focus mode |
| `overview.mjs`, `overview.css` | Full-screen thumbnails and shelf bookmarks |
| `settings.mjs`, `backup.mjs`, `settings.css` | Settings panel, export and import |
| `thumbs.mjs` | Compressed thumbnails |
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
# End-to-end tests in headless Chrome or Edge (each uses a throwaway profile and generated images):
node tests/browser.mjs "<path to chrome.exe or msedge.exe>"
node tests/shelf.browser.mjs "<path>"
node tests/toolbar.browser.mjs "<path>"
node tests/bookmarks.browser.mjs "<path>"
node tests/shelfmarks.browser.mjs "<path>"
node tests/shelfsort.browser.mjs "<path>"
node tests/settings.browser.mjs "<path>"
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

## Keywords

Local manga reader, comic viewer, webtoon / manhwa / manhua long-strip reader and doujinshi viewer for desktop browsers. Reads image folders offline, with no upload.

#漫画阅读器 #本子阅读器 #同人志阅读器 #条漫阅读器 #韩漫阅读器 #本地漫画阅读器 #网页漫画阅读器 #在线漫画阅读器 #离线漫画阅读器 #漫画查看器 #看漫画软件 #看图软件 #图片浏览器 #长条漫画 #竖屏漫画 #PWA漫画阅读器

#漫畫閱讀器 #本子閱讀器 #同人誌閱讀器 #條漫閱讀器 #韓漫閱讀器 #本地漫畫閱讀器 #看圖軟體 #圖片瀏覽器

#漫画ビューア #同人誌ビューア #漫画リーダー #マンガビューア #マンガリーダー #コミックビューア #縦読み漫画 #縦スクロール漫画 #ウェブトゥーンビューア #画像ビューア #ローカル漫画ビューア #オフライン漫画リーダー

#만화뷰어 #만화리더 #웹툰뷰어 #웹툰리더 #동인지뷰어 #코믹뷰어 #로컬만화뷰어 #이미지뷰어 #세로스크롤만화 #오프라인만화뷰어

#manga-reader #manga-viewer #comic-reader #comic-viewer #webtoon-reader #manhwa-reader #manhua-reader #doujinshi-reader #image-viewer #local-manga-reader #offline-manga-reader #pwa
