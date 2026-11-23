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
- **Import as one book**: a series stored as several folders (one per volume, say) can be joined into a single book and read straight through.
- **Built for long strips**: each book is one continuous vertical strip with no snapping at image borders, so tall webtoon pages read naturally.
- **Fast with big libraries**: only visible pages are created and decoded, behind a small read queue. Thousands of images on a spinning hard drive stay responsive.
- **Thumbnail navigator**: pops out at the right window edge or stays pinned beside the page, and can show the whole book full screen. Click any point of a thumbnail to jump to that exact spot, even inside a very tall image.
- **Shelf and library**: keep what you are reading on the shelf and everything else in the library. Both show a cover-only wall, as a regular grid or a masonry layout; titles and actions appear when you hover a cover or select it with the arrow keys.
- **Search, filters and presets**: filter by title, path, tags, page count or whether a book has bookmarks, and save the filters you use often as presets.
- **Tags**: add your own tags to any book, with suggestions from the tags you already use. Each tag gets its own colour, and you can filter by clicking a tag or typing `#tag` in the search box.
- **Bookmarks**: press and hold `F` to bookmark the current spot. Bookmarks are listed as small pictures of the page, because nobody remembers file names.
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

Open a folder or pick images with **Add to Loose images** on the welcome screen, or drop them anywhere in the window. Drop on the **Add to Loose images** area at the bottom of the drop overlay to add every image, including those inside folders, to the loose images instead of making a book per folder. Move the mouse to the top edge of the window (or press **T**) to open the toolbar.

### Mouse

| Action | Result |
| --- | --- |
| Wheel / left-drag | Scroll |
| Middle click | Browser auto-scroll (where your OS and browser support it) |
| Click the left / right half | Back / forward one screen |
| Move to the top window edge | Open the toolbar |
| Move to the bottom window edge | Open the action bar: previous book, back to top, jump to end, next book |
| Move to the left window edge | Pop out the shelf bookmarks (when not pinned) |
| Move to the right window edge | Pop out the thumbnail strip (when not pinned) |
| Button at the top of the shelf bookmarks / thumbnail strip | Open full-screen shelf bookmarks / thumbnails |
| Click a thumbnail | Jump to that exact point |
| Right click | Open the bookmark panel |

The full-screen bookmark and thumbnail views switch between a regular grid (the default) and a masonry layout with one button. Hovering a tile selects it, exactly as the keyboard does.

### Keyboard

| Keys | Result |
| --- | --- |
| `Space` / `S` / `↓` | Scroll down (hold to keep scrolling) |
| `Shift+Space` / `W` / `↑` | Scroll up (hold to keep scrolling) |
| `D` / `→` | Tap: forward one screen. Hold: next book (a ring fills while you hold) |
| `A` / `←` | Tap: back one screen. Hold: previous book |
| `F` / `Enter` | Tap: next bookmark. Hold: add a bookmark |
| `Shift+F` / `Shift+Enter` | Previous bookmark |
| `Home` / `End` | Start / end of the book. Press again to change books |
| `Page Up` / `Page Down` | Previous / next book |
| `C` / `[` | Open or close full-screen shelf bookmarks |
| `V` / `]` | Open or close full-screen thumbnails |
| `W` `A` `S` `D` / arrow keys (in full-screen views) | Choose; `Space` / `Enter` jumps there |
| `Delete` | Delete the current book's record |
| `Ctrl+C` | Copy the titles currently listed on the shelf |
| `B` | Open or close the shelf |
| `/` / `Ctrl+F` (on the shelf) | Jump to the search box |
| Arrow keys / `Enter` / `Delete` (on the shelf) | Move between books / open / delete the record |
| `T` | Show or hide the toolbar |
| `Esc` | Close the toolbar, the action bar and floating side panels |

The keyboard button in the toolbar shows this list inside the app.

### Toolbar and action bar

Rest the mouse at the top edge and the toolbar appears, centred over the page: a row of icons (hover one to see its name) that wraps onto more lines in a narrow window, with the book title and progress just below. You can also press **T**, or press Tab to focus the menu button in the top-left corner and then Enter.

Rest the mouse at the bottom edge for the action bar. Its buttons are always the same: **Previous book**, **Back to top**, the current position (images read / total), **Jump to end** and **Next book**; at the start or end the matching button is greyed out. Changing books lives here only; the toolbar has no previous / next buttons. While shelf filters are active, previous / next book only move through the filtered results, and the buttons carry a small dot to show it.

Both fade out when the mouse leaves, and each edge pop-out can be turned off in **Settings → Toolbar**; **T** still works. Clicking the page only turns it (left half back, right half forward). On a touch screen, tap the top of the page to show or hide the toolbar.

### Shelf, library and tags

The **Bookshelf** button (or **B**) opens a full-screen view with four lists (click the tab of the current list again, or press **B** again, to go back to reading):

- **Shelf**: what you are reading now. Newly opened folders, and folders you open again, land here.
- **Library**: everything else, for managing large collections. Books you open or drop while the shelf view is showing the library go to the library.
- **All**: both together, for searching everything.
- **Missing**: only shown when some books' folders can't be found (see below).

*Previous / next book* move through the list the current book is in (shelf or library). Importing while the shelf view is open doesn't switch the book you're reading; you just get a note of how many books were added.

When the shelf opens, the book you're reading is selected and scrolled into view. Hovering a cover and moving with the arrow keys share one selection: the selected cover shows its title, progress and tags, plus buttons to edit the title, edit tags, move, copy the title or delete the record. `Enter` opens it and `Delete` deletes its record (after asking). Books with bookmarks show a bookmark count in the bottom-left corner of the cover. The rightmost toolbar button switches between a regular grid (the default, covers cropped to the same size) and a masonry layout (covers at their own proportions). Toolbar buttons show icons only; hover them for a description.

**Search and filters**: search matches titles, folder paths, tags and the folder names of each volume in a joined book; type `#tag` to filter by tag, and press `/` or `Ctrl+F` to jump to the search box. While filters are active, the search box shows the number of results on its right. The **Filters** button opens a panel with a page-count range, **Has bookmarks** and tags (several tags must all match; there is a search box when you have many). With the panel closed, the active filters are listed below it, and the **Clear filters** button next to the search box clears them all. Filters are remembered and stay in place as you switch between shelf, library and all; previous / next book and the shelf bookmarks also stay within the filtered results.

**Presets**: save the current filters as a preset, then apply it with one click from the preset menu, where you can also rename, delete or update presets. If you change the filters after applying one, the preset button gets a small dot (its tooltip says *modified*).

**Sorting books**: the sort menu sorts by date added (descending, newest first, by default), folder time or name, ascending or descending (ascending: oldest first / A→Z). Shelf, library and all share this setting, and previous / next book and the shelf bookmarks follow the same order. Browsers can't read a folder's own modification time, so *folder time* is the newest modification time of the images inside; it is worked out in the background only when you pick that sort (file info only, no image reading), and books not done yet go last.

The **Batch actions** menu copies the listed titles, has **Move all to shelf / library** for everything the current filters show, and **Clear shelf / library**, which deletes the records of every book in that list (filters don't apply) after asking for confirmation. Image files are never deleted.

The pencil button on a cover edits the title. Only the displayed name changes, not the folder, and searching for the folder name still finds the book; leave it empty to restore the original. When editing tags, existing tags are suggested in a pop-up below the box as you type (`↑` `↓` to choose, then `←` `→` too, Enter to add, `Esc` closes the suggestions first), and an empty box lists your recent and most-used tags. Tag colours are picked automatically from the tag name, so the same tag always has the same colour.

### Import as one book

When a series is split across several folders (one per volume, for example), you can join them into one book and read straight through. While dragging, drop the folders on the **Import as one book** area at the bottom of the drop overlay, or use the **Import as one book** button in the shelf header and pick a folder: every folder with images inside it becomes part of one book, in path order.

- Importing the same set of folders again updates that book instead of adding a second copy: new volumes are added, volumes that are gone are removed, and bookmarks and progress are kept.
- The same folder can be a book of its own and a volume in one or more joined books at the same time; refreshing or re-importing it updates all of them.
- If only one folder contains images, it is imported as a normal book. Loose images are still imported separately.

### Bookmarks

- **Hold `F` or `Enter`** to add a bookmark at the centre of the screen. A ring fills up while you hold, so you can see what is happening; let go early and it counts as a tap.
- **Tap `F` or `Enter`** to jump to the next bookmark. After the last one it wraps to the first. Add `Shift` to go backwards.
- **Right click** the page to open the bookmark panel at the mouse, with the **Add bookmark** button right under the pointer. Click a bookmark to jump there and close the panel; hovering does nothing. **Esc** or a click outside closes it without moving.

Bookmarks are stored with a small picture of the page and follow the image, not the scroll position, so they survive re-sorting.

**Shelf bookmarks**: works like the thumbnail strip. It gathers the bookmarks of every book on the shelf, in shelf order (not the library or missing books; with shelf filters active, only the filtered books; if that leaves it empty, it suggests clearing or changing the filters). It isn't pinned by default: rest the mouse at the left edge and it pops out over the page, then fades out when the mouse leaves (turn this off in **Settings → Reading**). The **Shelf bookmarks** button in the toolbar pins it on the left, and the page narrows to make room; drag the list's right edge to resize it. Hovering does nothing; click a bookmark to jump there, opening its book if needed. The list is compact: one group of thumbnails per book (the current book's group is highlighted), with no titles or file names. The full-width button at its top opens full-screen shelf bookmarks. While the list is pinned, tapping `F` / `Enter` (`Shift` for backwards) follows it too: after the last bookmark in the current book it moves on to the next book, and wraps back to the start at the end. A book in the library still cycles through its own bookmarks.

**Focus mode** (on by default, turn it off in **Settings → Reading**): when the mouse isn't over them and they don't have keyboard focus, the pinned shelf bookmark list and thumbnail strip hide their content but keep their space, on the same background as the page, so there is less to distract you. Move the mouse over them to bring the content back. Showing and hiding fade with a short delay, so sweeping the mouse past them does not flicker.

### Thumbnail strip

Rest the mouse at the right edge to pop it out over the page. It closes when the mouse leaves (turn this off in **Settings → Reading**). The thumbnail button in the toolbar pins it instead: pinned, it sits beside the page and the page narrows so nothing is covered. Drag its left edge to resize it. Its top row is a full-width **Full screen** button that also shows the page count.

Thumbnails are cached in memory for the session (up to 64 MB, never written to disk). Opening full-screen thumbnails again for the same book, or coming back from another book, doesn't read the images again until you close the app.

**Full-screen thumbnails**: the button at the top of the strip, or `V` / `]`, opens an overview of the whole book; press it again or `Esc` to close. Pages sit in a regular grid by default; the button in the title row switches to a masonry layout that follows each page's proportions (both full-screen views share this choice). A wide scrollbar on the right makes long books quick to skim. The current page is selected; `A` `D` / `←` `→` move in page order, `W` `S` / `↑` `↓` move within a column, and `Page Up` / `Page Down`, `Home` / `End` also work. Click a thumbnail, or press `Space` / `Enter`, to jump to the top of that page and close the overview.

**Full-screen shelf bookmarks**: the button at the top of the shelf bookmark list, or `C` / `[`, shows every shelf bookmark full screen, grouped by book with the book title as a heading (the current book is highlighted). It switches between grid and masonry in the same way. The bookmark nearest your current position is selected; `A` `D` / `←` `→` move in order, `W` `S` / `↑` `↓` move to the nearest bookmark in the row above or below. Click or `Space` / `Enter` jumps to it, switching books if needed. Pressing `V` / `]` or `C` / `[` in one full-screen view switches to the other.

### Sorting

In **Sort**, choose **This folder / book** to set an order for the current book only, or **Default for all folders** to change the default. **Use default** removes a book's own setting. Choosing shuffle reshuffles every time you pick it, but reopening a book keeps its shuffled order. Time-based sorting reads file modification times on demand. Re-import a folder to refresh those times.

### Refreshing folders

MangaView checks your folders for added or removed images in three cases (the first can be turned off in **Settings**):

- each time the app opens or the page is reloaded, it checks the current book first, then works through every other folder it still has access to, one at a time in the background while the browser is idle, so reading isn't slowed down;
- when you switch back to the window, it checks the current book;
- when you press a **Refresh** button (next to **Bookshelf** in the toolbar, and on the shelf), it checks everything. A manual refresh can also ask for access to the current book again.

New subfolders are not detected: open the parent folder again to add them.

### Missing books and moving your files

A book whose folder can't be found is **never** deleted automatically, because the browser can't tell a deleted folder from an unplugged drive. Only when **all** of a book's folders are gone does it move to **Missing**, keeping its cover, tags, bookmarks and progress. Plug the drive back in and refresh, and it returns on its own. If only some volumes of a joined book are missing, the book stays readable: the missing volumes are hidden for now and its cover shows a small warning. They come back on their own once found, or you can reconnect them with **Restore** on the cover. Records are deleted only when you delete them.

Browsers never reveal a folder's full path on disk, so after files are moved MangaView recognises books by their **folder name** plus a fingerprint of the **cover** (the first image by file name). Joined books are matched volume by volume:

- **Open the parent folder again**: a missing book or volume with the same folder name and cover is reconnected automatically instead of being added twice.
- **Restore from folder…** (in *Missing*): pick a folder that contains your books, at any depth. Exact matches are restored at once. Likely matches (renamed folder with the same cover, or same name with a different cover) are listed for you to tick. Anything else stays missing.
- **Restore** on a single book: pick its folder. If it doesn't match, you can still **Restore anyway** to keep the tags, bookmarks and progress. For a joined book that is entirely missing and where no volume matches, this rebuilds the book from the chosen folder, and volumes at the same relative paths keep their bookmarks and progress. If only one volume of a joined book is missing, you can link the chosen folder to that volume anyway; the other volumes are left untouched. When several volumes are missing, a folder that doesn't match is reported as not found rather than guessed at.

### Your data

Images are read on your device and never uploaded or copied. The browser stores a book index, read-only file handles, sort settings, reading positions, tags, bookmarks, search presets and small compressed thumbnails (covers and bookmarks, never the original images). Clearing site data erases all of this.

**Settings → Data** shows how much storage is used, and can export everything to one JSON file and import it again, merging with or replacing the current data. The file contains no images and no folder access, so after importing on another computer the books appear under *Missing*: use **Restore from folder…** to reconnect them. Backups use format 2: older backups can still be imported, but older versions of the app can't import new ones. When storage gets close to the browser's quota, MangaView suggests deleting records of books you no longer need.

**Restore default settings** at the bottom of the settings panel resets the settings and layout (side panels, widths, default sort and so on) and reloads the page. Books, bookmarks, tags, reading progress and search presets are kept.

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
| `app.mjs` | Core logic: books, importing (including import as one book), sorting, refresh, keyboard, restoring defaults; installs the feature modules |
| `shelf.mjs`, `shelf.css` | Shelf, library, missing books, filters and presets, tags, restore, storage usage |
| `match.mjs` | Matching missing books (volume by volume) to folders, tag colours |
| `toolbar.mjs`, `toolbar.css` | Top toolbar, bottom action bar |
| `bookmarks.mjs`, `bookmarks.css` | Bookmarks, bookmark panel, shelf bookmark list |
| `focus.mjs`, `focus.css` | Focus mode |
| `overview.mjs`, `overview.css` | Full-screen thumbnails and shelf bookmarks (grid / masonry) |
| `settings.mjs`, `backup.mjs`, `settings.css` | Settings panel, export and import |
| `thumbs.mjs` | Compressed thumbnails (covers, bookmarks), session cache of page thumbnails |
| `view.mjs` | Virtualized reader, thumbnail strip, image loading queue |
| `model.mjs` | Sorting and layout math |
| `sources.mjs` | Folder scanning and file access, books and their source folders (volumes) |
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
node tests/shelfui.browser.mjs "<path>"
node tests/shelfsort.browser.mjs "<path>"
node tests/import.browser.mjs "<path>"
node tests/toolbar.browser.mjs "<path>"
node tests/bookmarks.browser.mjs "<path>"
node tests/shelfmarks.browser.mjs "<path>"
node tests/overview.browser.mjs "<path>"
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
