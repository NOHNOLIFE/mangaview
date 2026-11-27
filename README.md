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

- **Open anything local**: pick or drag in folders and loose images. Every folder that directly contains images, videos or audio becomes a book.
- **Video and audio**: videos and audio the browser can play sit in the same strip as images, with their controls in the file bar at the bottom, one volume for the whole app, and optional autoplay.
- **Add as one book**: a series stored as several folders (one per volume, say) can be joined into a single book and read straight through.
- **Built for long strips**: each book is one continuous vertical strip with no snapping at image borders, so tall webtoon pages read naturally.
- **Fast with big libraries**: only visible pages are created and decoded, behind a small read queue. Thousands of images on a spinning hard drive stay responsive.
- **Thumbnail navigator**: pops out at the right window edge or stays pinned beside the page, and can show the whole book full screen. Click any point of a thumbnail to jump to that exact spot, even inside a very tall image.
- **Shelf and library**: keep what you are reading on the shelf and everything else in the library. Both show a cover-only wall, as a regular grid or a masonry layout; titles and actions appear when you hover a cover or select it with the arrow keys.
- **Search, filters and presets**: filter by title, path, tags, page count, whether a book has bookmarks or which file types it contains (images / videos / audio), and save the filters you use often as presets.
- **Tags**: add your own tags to any book, with suggestions from the tags you already use. Each tag gets its own colour, and you can filter by clicking a tag or typing `#tag` in the search box.
- **Bookmarks**: press and hold `F` to bookmark the current spot, or `Shift+F` to mark the end of a section. Bookmarks are listed as small pictures of the page, because nobody remembers file names, and thumbnails show which pages have them.
- **Sorting**: by file name or modification time (either direction), or shuffle. Set a default or override it per book.
- **Picks up where you left off** in every book, and refreshes folders to pick up added or removed files.
- **Nothing is lost when files move**: books whose folder can't be found go to *Missing* with their covers, tags and bookmarks intact, and can be reconnected later.
- **Backup**: export all app data to one file and import it on another computer.
- **Installable and offline**: install it as an app. After the first load it runs without a network connection.
- **Four languages**: English, 中文, 日本語 and 한국어, chosen automatically from your browser settings.

## Getting started

1. Open **https://nohnolife.github.io/mangaview/** in the latest desktop **Chrome** or **Edge**.
2. *(Optional)* Install it: click the install icon at the right end of the address bar, or open the browser menu and choose *Install MangaView*. It opens in its own window, can be pinned to the taskbar and works offline.
3. Click **Add** and pick a folder, or drop images, videos or audio into the window.

New versions arrive automatically. There is nothing to download, unzip or set up.

## How to use

Click **Add** (on the welcome screen, in the toolbar or in the shelf header) and pick a folder, or click **Add to Loose images** and pick files (several at once). Either way the add dialog opens with what you picked (remove any item from the list); add more with **+ Folder** and **+ Files**, or drop several folders and files onto the dialog at once. The same folder or file is listed only once, and nothing is scanned until you confirm:

- **Add as separate books** (the default): every folder becomes a book by the usual rules, and loose files go to the loose images;
- **Add as one book**: everything is joined into one book (see *Add as one book* below); available when the list contains a folder;
- When you came from **Add to Loose images**, the only button is **Add to Loose images**: the files inside folders (subfolders included) go to the loose images too.

The file picker also accepts subtitle files (.srt .vtt .ass .ssa .lrc).

You can also drop things anywhere in the window, which skips the dialog. Dropping only files (images, videos or audio, no folders) adds them to the loose images. When the drop includes folders, the overlay shows **Add as one book** and **Add to Loose images** side by side at the bottom; drop on **Add to Loose images** to add every image, video and audio file, including those inside folders, to the loose images instead of making a book per folder. Move the mouse to the top edge of the window (or press **T**) to open the toolbar.

### Mouse

| Action | Result |
| --- | --- |
| Wheel / left-drag | Scroll (a drag keeps gliding after release; a click, wheel turn or key press stops it) |
| Middle click | Browser auto-scroll (where your OS and browser support it) |
| Click the left / right half | Back / forward one screen |
| Click a video picture / audio card (outside its controls) | Select it and play / pause (doesn't turn the screen) |
| Drag sideways on a video picture / an audio card's subtitle area | Seek (on release; `Esc` cancels) |
| Move to the top window edge | Open the toolbar |
| Move to the bottom window edge | Open the file bar and the control bar: playback and buttons for the current file, change books, back to top / jump to end, play mode, auto-scroll and media controls |
| Move to the left window edge | Pop out the shelf bookmarks (when not pinned) |
| Move to the right window edge | Pop out the thumbnail strip (when not pinned) |
| Button at the top of the shelf bookmarks / thumbnail strip | Open full-screen shelf bookmarks / thumbnails |
| Click a thumbnail | Jump to that exact point |
| Right click | Open the bookmark panel |

The full-screen bookmark and thumbnail views switch between a regular grid (the default) and a masonry layout with one button. Hovering a tile selects it, exactly as the keyboard does.

Left-drag scrolling works everywhere something scrolls: the page, the thumbnail strip, the shelf, bookmark lists, full-screen thumbnails / bookmarks, settings, help and the other lists, sideways too where a list scrolls sideways. A drag never counts as a click (it doesn't turn the screen or open a book or bookmark), and you can start one on a button, cover or bookmark. Pressing on a text box, slider, seek bar, resize edge or selectable text such as a title works as before (or selects the text) instead of dragging.

After you let go it keeps gliding at your speed: slow drags feel like a touch screen, and the faster the flick the further it goes (the fastest one glides about 12,000 pixels). Flick again the same way while it is still gliding and the speeds add up, so long lists go faster and faster; flicking the other way glides that way at the new speed, and a click, the wheel or a key stops it. The thumbnail strip and full-screen thumbnails don't start reading new thumbnails while you drag or glide fast, only once it slows down or stops; thumbnails not read yet keep a fixed-size placeholder, so ones that arrive while you drag or glide don't make the list jump, and they take their real proportions once you stop.

### Keyboard

| Keys | Result |
| --- | --- |
| `S` / `↓` | Scroll down (hold to keep scrolling) |
| `W` / `↑` | Scroll up (hold to keep scrolling) |
| `Space` | Stops auto-scroll while it runs; otherwise plays / pauses the video or audio shown in the file bar (background play), or starts **Auto-scroll** when the file bar shows an image |
| `Shift+Space` | Same as **Auto-scroll** on the control bar: start / stop (works in any book) |
| `Shift+S` / `Shift+↓` | Next book (one per press; holding doesn't repeat) |
| `Shift+W` / `Shift+↑` | Previous book |
| `D` / `→` | Tap: forward one screen (lands with a video centred when one comes into range). Hold: fast-forward the media shown in the file bar |
| `A` / `←` | Tap: back one screen (likewise). Hold: rewind the media shown in the file bar |
| `Q` / `;` | Volume down 5% (hold to keep going) |
| `E` / `'` | Volume up 5% (hold to keep going) |
| `F` / `Enter` | Tap: next bookmark. Hold: add a bookmark |
| `Shift+F` / `Shift+Enter` | Tap: previous bookmark. Hold: add a section bookmark |
| `F2` | Rename the selected bookmark (in the bookmark panel, shelf bookmarks and full-screen bookmarks) |
| `Home` / `End` | Start / end of the book. Press again to change books |
| `Page Up` / `Page Down` | Previous / next book |
| `C` / `[` | Open or close full-screen shelf bookmarks |
| `V` / `]` | Open or close full-screen thumbnails |
| `W` `A` `S` `D` / arrow keys (in full-screen views) | Choose; `Space` / `Enter` jumps there |
| `Delete` | Delete the current book's record |
| `Ctrl+C` | Copy the titles currently listed on the shelf |
| `B` | Open or close the shelf |
| `/` / `Ctrl+F` (on the shelf and in full-screen views) | Jump to the search box |
| Arrow keys / `Enter` / `Delete` (on the shelf) | Move between books / open / delete the record |
| `T` | Show or hide the toolbar and the control bar together |
| `Esc` | Close the toolbar, the control bar and floating side panels |

The keyboard button in the toolbar shows these controls inside the app as a picture: the left-hand and right-hand parts of a keyboard and the mouse, with the keys that do something highlighted. Hover, focus or tap a key to see what it does in a tooltip; holding and Shift combinations are picked out in accent colours.

### Toolbar and control bar

Rest the mouse at the top edge and the toolbar appears, centred over the page: a row of icons (hover one to see its name) that wraps onto more lines in a narrow window. Below it, the name area is one big button with a bookshelf icon and “title · current page / total · progress” on one line, cutting a long title short at the end (the full title is in its tooltip); clicking it (or focusing it and pressing Enter) opens the shelf. There is no separate **Shelf** button in the toolbar. You can also press **T**, or press Tab to focus the menu button in the top-left corner and then Enter.

Rest the mouse at the bottom edge for the control bar, centred at the bottom of the reading area (also with a video in fullscreen), with the file bar on the row above its zones (see below). The control bar is a single row with a left, middle and right zone:

- **Left (reading)**: **Previous book**, **Back to top**, **Jump to end**, **Next book**, then the scroll speed. At the start or end the matching button is greyed out. Changing books lives here only; the toolbar has no previous / next buttons. While shelf filters are active, previous / next book only move through the filtered results, and the buttons carry a small dot to show it.
- **Middle (auto-scroll)**: the play mode, the **Play bookmark sections only** toggle, the big **Auto-scroll** button (in the very centre), the **Single file** toggle and **Loop**. The play mode button shows the current mode; on hover or keyboard focus it opens Comic, Mixed (the default) and Media above it, and you pick one there. Clicking the button itself moves on to the next mode, and the arrow keys step through them. **Auto-scroll**, like `Shift+Space`, starts or stops; what it does is described under **Play modes** below. While it runs the button shows a pause icon; when it stops by itself (a media paused elsewhere, nothing left to go through, and so on), the button goes back to its stopped state. **Loop** is one button with three states: single file, this book (the default) and across books; clicking moves on to the next, each state has its own icon and the tooltip names the current one. There is no "no loop": auto-scroll goes on until you stop it.
- **Right (media)**: **Previous media** and **Next media**, then playback speed, volume and **Subtitles**. With a current track (see "Background play" under Video and audio), previous / next switch within the play list without scrolling or jumping, keeping it playing or paused; without one they go in page order (wrapping around at both ends) and scroll the media to the centre of the view without playing it; while auto-scrolling, auto-scroll moves there and plays it. **Subtitles** acts on the media shown in the file bar: it turns a single subtitle on or off, or opens a menu when there are several; it is greyed out when the current file isn't media or has no subtitles.

The speed buttons show the current value with one decimal (1.0, 1.5 and so on) and are as wide as the other buttons. The speed and volume buttons open a small panel right above them on hover or keyboard focus (a slider and common values; volume also has mute). The wheel or arrow keys on the button change the value one step at a time; for speeds the slider, the preset values, the wheel and the arrow keys all move in steps of 0.1. Clicking a speed button resets it to 1.0, and clicking the volume button mutes or unmutes. Scroll speed ranges from 0.2 to 4.0 and playback speed from 0.5 to 3.0 (pitch is kept; it applies to every video and audio file); speeds saved by older versions are rounded to 0.1 and kept in range. Buttons that can't be used are dimmed and disabled, never hidden or moved: the right zone except **Subtitles** in a book without video or audio when there is no current track either, and in Media mode **Auto-scroll** in a book without video or audio; in Media mode the scroll speed; in Comic mode **Auto-scroll** when the book has no images. A disabled **Auto-scroll** says why in its tooltip. The right zone doesn't depend on the play mode, and the toggles in the middle work in every mode. In a narrow window the left zone keeps only **Previous book** and **Next book** and the right zone only **Next media** and volume; the other buttons move into a **⋯** pop-up at the end of each zone (it opens right above the button on hover, keyboard focus or click, in the same place as the speed panels), still on one row. Narrower still, the bar takes two rows: the middle zone on top, the left and right zones side by side below.

**File bar**: two rows above the control bar, popping up and hiding together with it, acting on the current file (see "Current file" under Video and audio: the current track, even out of view or in another book, otherwise the page in the middle of the view). The top row is the file name: only its last part, without the extension (a long name is cut in the middle; the full path is in the tooltip and can be selected and copied); at its right end are **Locate** (go to the current track's page, switching books if needed) and **Stop** (end background play), greyed out without a current track. The bottom row has play / pause (background play, the same as the media's own play button), a seek bar you can click or drag (with bookmark and section marks) and the current time / duration; for an image this part is empty. Hovering or focusing the time swaps it in place for **Rewind** and **Fast-forward** buttons of the same width: a click jumps 2 seconds, and holding one seeks like holding `A` / `D`, with the same hint. At the right end are three fixed places for icon buttons with tooltips: **Add bookmark** and **Add section bookmark** are shown directly and the rest go into a **⋯** in the third place, which opens on hover; a file type with three buttons or fewer shows them all. For an image: **Add bookmark**, **Add section bookmark** and **Set as cover**; for a video: **Add bookmark**, **Add section bookmark** and **⋯** (**Set as cover**, **Fullscreen**); for audio: **Add bookmark** and **Add section bookmark** (the third place stays empty). Buttons never move between file types, and **Add section bookmark** uses the normal colour. In a narrow window nothing overflows: the file name shrinks first, then the seek bar. The file bar only updates while it is shown.

When they pop out from an edge, both fade out once the mouse leaves. The bottom edge reacts a little further in than the other three (48px rather than 32px), so the control bar is easy to reach. **T** shows or hides both together (if only one is showing, **T** shows both); opened this way they don't close when the mouse moves, only with **T** again or **Esc**. Each edge pop-out can be turned off in **Settings → Toolbar**; **T** still works. Clicking the page only turns it (left half back, right half forward); clicking a video picture or an audio card plays or pauses it in the background. On a touch screen, tap the top of the page to show or hide the toolbar.

**Play modes**: **Auto-scroll** (or `Shift+Space`) starts. Each window runs on its own and running isn't remembered; the mode, speeds, sections only and loop are remembered and synced across windows. Only auto-scroll scrolls or jumps the view; background play (see Video and audio) is separate and doesn't depend on the play mode.

- **Comic**: scrolls only images, down at a steady speed; videos and audio never come into view. Consecutive images form a run: when the end of a run reaches the bottom of the view, it jumps straight to the start of the next run of images; a run shorter than the view stays put at its start for as long as scrolling past its height would take. It doesn't play or pause any media; background play carries on. **Auto-scroll** is disabled in a book without images.
- **Mixed** (the default): scrolls the same way; when the middle of a video or audio reaches the centre of the view it stops there and plays it (sections only and play position memory apply), then scrolls on. When the very next page is a video or audio too, it goes straight to it (centred) and plays it instead of scrolling there. It always goes in page order. At the start it begins with the current track if it is in view (carrying on if it is playing), otherwise with the media nearest the centre of the view, or simply scrolls when there is none; it doesn't interrupt background play until it reaches a media.
- **Media**: doesn't scroll; starts with a media in view (picked as in Mixed mode; with none in view, the nearest one after the view, scrolled to the centre first), and when it ends moves on to the next one in page order, scrolling it to the centre. **Auto-scroll** is disabled in a book without media.

A media played by auto-scroll becomes the current track (replacing the previous one, shown in the page) but doesn't read or change the play list; when it ends, auto-scroll decides what comes next. Playing or pausing any media by hand while auto-scroll runs: if it is the one auto-scroll is playing, it pauses and auto-scroll stops; if it is another media, auto-scroll stops and that media plays in the background; a background track unrelated to auto-scroll (in Comic mode, or in Mixed mode before a media is reached) can be paused or move on without affecting auto-scroll.

**Loop** (the three-state button in the middle, this book by default): this book goes back to the start at the end of the book (in Media mode, the first media follows the last); across books carries on from the top of the next book in the reading list (see "Shelf, library and tags"; the same as previous / next book), and the first book follows the last (Comic mode skips books without images, Media mode books without media); single file plays the current video or audio again and again in Mixed and Media mode (only its sections with **Play bookmark sections only** on), while images loop the book. Tapping `F` / `Enter` follows shelf bookmarks across books with the cross-book loop too (see "Shelf bookmarks"). The previous / next book buttons, `Shift+W` / `Shift+S` and clicking bookmarks are not affected by the loop.

Scroll speed 1.0× scrolls 10% of the view height per second, advanced by the real time between frames so it stays smooth even when slow. Pausing while running leaves the page where it is, or pauses the media that is playing; pressing again carries on from there. Scrolling by hand, turning screens and dragging while running don't stop it; it carries on from the new place. In Mixed mode, when a playing media is scrolled out of view scrolling continues from the new place (the media keeps playing as the current track and doesn't move on when it ends); switching books keeps running. Scrolling pauses while the window is in the background and resumes when it comes back (media keep playing).

**Single file**: with the **Single file** toggle on, the reader shows one file at a time: images fit the window whole (a tall webtoon strip shrinks to fit too; with **Fit to width** off, small images keep their own size instead of being enlarged), videos fit the window and audio cards sit in the middle. `A` / `D` / `←` / `→`, `W` / `S` / `↑` / `↓` (hold to keep turning), `Page Up` / `Page Down`, the mouse wheel (one notch, one file; spinning it fast never skips a run of pages) and clicking the left / right half all go to the previous / next file; after a drag the view settles on the nearest file. `Home` / `End`, switching books, bookmarks, the thumbnail strip and full-screen thumbnails work as usual, and clicking a bookmark or thumbnail opens its file. Turning the mode on or off keeps the same page; when you turn it off you return to that page's place in the strip (where you were before, if you didn't turn the page; otherwise the top of a page taller than the window, or a shorter page centred). Reading position and bookmarks work the same in both views. The toggle is remembered and synced across windows.

Running in single file mode turns pages instead of scrolling: Comic mode moves to the next image at an interval (5 seconds a page at 1.0×; the interval is 5 seconds ÷ scroll speed), skipping video and audio pages; Mixed mode shows images for the interval and plays video and audio pages to the end (sections only applies) before moving on; Media mode only moves between media (in page order, going to the page of the next one). With **Play bookmark sections only** on, it only visits pages inside image sections and the media that should play. Looping at the end of the book works as in the strip; turning a page by hand doesn't stop the run and restarts the interval on the new page, resuming after a pause restarts it on the current page, and the interval pauses while the window is in the background. Turning single file mode on or off while running keeps the run going in the new view.

### Shelf, library and tags

The name area under the toolbar (or **B**) opens a full-screen view with four lists (click the tab of the current list again, or press **B** again, to go back to reading):

- **Shelf**: what you are reading now. Newly added folders, and folders you add again, land here.
- **Library**: everything else, for managing large collections. Books you add or drop while the shelf view is showing the library go to the library.
- **All**: both together, for searching everything.
- **Missing**: only shown when some books' folders can't be found (see below).

**Reading list**: the books in the list selected in the shelf view (shelf, library or all; while *Missing* is selected, the one selected before it) that match the filters, in the book sort order. Previous / next book, the cross-book loop, bookmark keys across books and the shelf bookmarks all follow it; if the book you're reading isn't in it, they go from where it would sort to the nearest book. Each window keeps its own selection, and the last one selected is used the next time you open the app. Importing while the shelf view is open doesn't switch the book you're reading; you just get a note of how many books were added.

When the book you're reading is deleted (`Delete`, the delete button on its card, clearing the shelf / library, deleting all missing books, or in another window), you move to the book after it in the reading list, or the one before it if there is none; if the list is now empty you go back to the shelf view (or the welcome page when there are no books at all).

When the shelf opens, the book you're reading is selected and scrolled into view. Hovering a cover and moving with the arrow keys share one selection: the selected cover shows its title, progress and tags, plus four buttons: edit tags, move to library / shelf, delete the record, and **More** (⋯), a menu with edit title, set cover and copy title. For a book with a missing source folder the first button becomes **Restore** and edit tags moves into the menu; a missing book has restore, delete and More (edit title, set cover). The buttons keep their places whatever the state. In the menu, `↑` `↓` choose, Enter runs the item, and `Esc` closes it and returns to **More**. `Enter` opens it and `Delete` deletes its record (after asking). Books with bookmarks show a bookmark count in the bottom-left corner of the cover. The rightmost toolbar button switches between a regular grid (the default, covers cropped to the same size) and a masonry layout (covers at their own proportions). Toolbar buttons show icons only; hover them for a description. Long titles, folder names and file names (on covers, in the toolbar, on audio cards, in full-screen captions, bookmark tooltips and notices alike) are cut to one or two lines: file names lose their middle, keeping the start and end, and titles lose their end; the full name is in the tooltip, the text can still be selected and copied, and a long name never moves anything else. (Names on buttons, such as the name area under the toolbar, can't be selected.)

**Search and filters**: search matches titles, folder paths, tags and the folder names of each volume in a joined book; type `#tag` to filter by tag, and press `/` or `Ctrl+F` to jump to the search box. While filters are active, the search box shows the number of results on its right. The **Filters** button opens a panel with a page-count range, **Has bookmarks**, file types (images / videos / audio; pick any number, and a book matches if it has a page of any chosen type) and tags (several tags must all match; there is a search box when you have many). With the panel closed, the active filters are listed below it, and the **Clear filters** button next to the search box clears them all. Filters are remembered and stay in place as you switch between shelf, library and all; previous / next book and the shelf bookmarks also stay within the filtered results.

**Presets**: save the current filters as a preset, then apply it with one click from the preset menu, where you can also rename, delete or update presets. If you change the filters after applying one, the preset button gets a small dot (its tooltip says *modified*).

**Sorting books**: the sort menu sorts by date added (descending, newest first, by default), folder time or name, ascending or descending (ascending: oldest first / A→Z). Shelf, library and all share this setting, and previous / next book and the shelf bookmarks follow the same order. Browsers can't read a folder's own modification time, so *folder time* is the newest modification time of the images inside; it is worked out in the background only when you pick that sort (file info only, no image reading), and books not done yet go last.

The **Batch actions** menu copies the listed titles, has **Move all to shelf / library** for everything the current filters show, and **Clear shelf / library**, which deletes the records of every book in that list (filters don't apply) after asking for confirmation. The original files are never deleted.

**Edit title** in a cover's **More** menu changes the title. Only the displayed name changes, not the folder, and searching for the folder name still finds the book; leave it empty to restore the original. When editing tags, existing tags are suggested in a pop-up below the box as you type (`↑` `↓` to choose, then `←` `→` too, Enter to add, `Esc` closes the suggestions first), and an empty box lists your recent and most-used tags. Tag colours are picked automatically from the tag name, so the same tag always has the same colour.

**Custom cover**: **Set cover** in a cover's **More** menu lists the thumbnails of the book's bookmarks; pick one to use the picture at that bookmark as the cover (cut again from the original image at the cover's proportions when it can be read, otherwise the bookmark thumbnail is used). A book without bookmarks asks you to add one first. You can also skip the bookmark: the small **Set as cover** button at the top of the right-click bookmark panel, or **Set as cover** on the file bar, makes the current view the book's cover. When the page in the middle of the view is an image, the part around the centre of the view is cut at the cover's proportions; for a video it takes the current frame; on audio the button is disabled. A short notice confirms it. **Reset cover** at the bottom brings back the default cover. A custom cover is a separate small picture: deleting that bookmark, refreshing, restoring or importing again doesn't change it, and it is included in backups. Setting or resetting it only updates that one cover. Folders are still recognised by the default cover only.

### Add as one book

When a series is split across several folders (one per volume, for example), you can join them into one book and read straight through. Pick the folders in the add dialog and choose **Add as one book**, or while dragging, drop the folders on the **Add as one book** area at the bottom of the drop overlay: the chosen folders and every folder with images inside them become one book, in path order.

- Importing the same set of folders again updates that book instead of adding a second copy: new volumes are added, volumes that are gone are removed, and bookmarks and progress are kept.
- The same folder can be a book of its own and a volume in one or more joined books at the same time; refreshing or re-importing it updates all of them.
- The book is named after the folder you picked or dropped; with several folders, after the first one in file name order.
- If only one folder contains images, it is imported as a normal book (recognised and restored by that folder), but named after the folder you picked, and searching for its own folder name still finds it. A title you have edited is kept when you import again. Loose images go to **Loose images**.

### Loose images

There is a single **Loose images** album: files and folders added with **Add to Loose images**, loose files added together with folders in the add dialog, images dropped on their own, and everything dropped on the **Add to Loose images** area all go there. Different images with the same name can live side by side, and adding the same file again doesn't duplicate it. If some of its images can't be found, the album stays readable and those images show as unreadable; use **Locate originals** (or **Restore** on its cover when the whole album is missing) and pick the folder that holds them, at any depth, to find them again by relative path and file name.

### Video and audio

Videos (mp4, m4v, webm, mkv, mov, ogv) and audio (mp3, flac, wav, ogg, oga, opus, m4a, aac, weba) that the browser can play natively are recognised by extension, just like images, and sit as pages in the same vertical strip; sorting (file name, modification time, shuffle) treats them all alike. A folder with only videos or audio is a book too, and videos or audio dropped on their own join the loose images.

- **Unsupported formats**: media files the browser can't play (avi, wmv, flv, rmvb, ts, mpg, wma, ape and so on) are not imported; the import result says how many and lists their extensions. Refreshing doesn't repeat the note. A file with a supported extension that still won't play (some HEVC mkv files, for example) shows **The browser can't play this file** with **Retry** on its page, without affecting other pages. That result is saved with the file's size and modification time and not tried again while the file is unchanged, only after **Retry** or when the file changes.
- **Layout**: a video follows the same width rule as images (**Fit to width**), with its height from the frame ratio. If it would be taller than the reading area, it shrinks to exactly one screen, centred, so the whole frame is visible (while you resize the window, it is re-laid out about 0.2 s after you stop; until then the picture shrinks inside its old space). The frame size is read the first time a video is shown and saved; until then it takes a 16:9 placeholder, and the real size never pushes the current view away. A video has no controls over its picture: only subtitles, and a big play button in the middle while it isn't selected. Audio is a plain full-width card of fixed height: a type icon and the file name, room for 3 lines of subtitles (the height is the same with or without subtitles), the controls, and a square picture on the right, like embedded album art. When the book has a cover, the picture is the book's current cover (a custom cover first), and cards already on screen follow when the cover changes; without a cover it is a light placeholder coloured from the file name (a gradient with a music note; files with the same name get the same colours). Audio cards, audio bookmarks and audio in thumbnails all use this same picture.
- **Controls**: the controls for a single file are on the file bar at the bottom (see "Toolbar and control bar"): play / pause, seek bar, time (rewind / fast-forward on hover), add bookmark and add section bookmark, plus set as cover and fullscreen for videos. An audio card's title also leaves out the extension; the card always shows its own row of controls too: play / pause, a seek bar you can click or drag (with bookmark marks), current time / duration (also swapping to rewind / fast-forward on hover), add bookmark and add section bookmark, kept in sync with the file bar; when the card runs short of space, secondary controls move into a **More** pop-up. Subtitles, volume, loop and play bookmark sections only are on the control bar. Controls are icons with tooltips. Clicking the picture, the big play button or the media's own play button plays or pauses that media in the background (see "Background play" below); it doesn't start auto-scroll or move the page, whatever the play mode. Dragging up or down still scrolls, including from blank areas of an audio card (anything but buttons, the seek bar and the file name), and the wheel over a video scrolls the page rather than changing the volume.
- **Fullscreen**: the fullscreen button in the file bar's **⋯** makes the video fill the whole screen (and the current track), shown whole and centred (portrait videos too, with nothing of the other pages beside it); everything else works as usual: the file bar and control bar pop up from the bottom edge, and keyboard shortcuts and subtitles keep working. In fullscreen neither the wheel nor dragging up or down scrolls the page; dragging sideways still seeks. Press the button again or `Esc` to leave; you are back at the reading position you had before.
- **Current track**: each window has at most one current track (the selected media), and only one media plays at a time. A video or audio becomes the current track when you click its picture or play button, when it starts playing (the play list moving on, auto-scroll reaching it and autoplay included), when previous / next media moves to it, or when a bookmark jump lands on it; it stays so when paused, scrolled out of view or when you change books, and stops being the current track only when another media is selected, you press **Stop**, or its file can't be read (videos started by autoplay and not yet touched are the exception, see Autoplay). Images have no such state. Video and audio look the same way: not selected, they are dimmed (an audio card together with its picture) with a big play button in the middle; selected, they are neither dimmed nor outlined. An unselected video in the middle of the view, under the mouse or with keyboard focus keeps the usual dimming, and the other unselected videos are darker, so the current file stands out. Playing and paused differ only in the play button icon, the seek bar colour (accent while playing) and the moving level bars of audio (still when the system asks for reduced motion). A selected audio file without subtitles (or with them turned off) shows a row of stepped bars in its subtitle area: moving while it plays, still when paused or when the system asks for reduced motion; with subtitles it shows them instead. Media the browser can't play show no big play button.
- **Current file**: the current track if there is one (even out of view or in another book), otherwise the page in the middle of the view (image, video or audio). The file bar, holding `A` / `D` to seek and `Space` act on it (with an image in the file bar, seeking does nothing). The bookmark shortcuts (hold `F` / `Shift+F`) and the right-click bookmark panel act on the current track only while it is in this book with its middle in view, otherwise on the page in the middle of the view.
- **Background play**: clicking a picture, a card or a play button, the file bar's play button, `Space` and playback started by a bookmark jump all just play that file: no scrolling, no jumping, no focus change. The current track keeps playing when scrolled out of view or when you switch books (the file stays open in the background, and when you come back to its page the picture is back in place without reloading or a gap); it only stops when another media starts. When it ends the play list moves on to the next one, from the start (by sections with **Play bookmark sections only** on), without scrolling or jumping the main window. Sections only, play position memory, subtitles, bookmark marks on the seek bar, volume and playback speed all apply to it as usual, also out of view or in another book; it moves on while the window is in the background too. **Locate** on the file bar goes to its page (switching books if needed); **Stop** ends background play: stops playback, clears the play list and drops the current track, and the file bar goes back to the page in the middle of the view.
- **Play list**: the playable videos and audio of the current track's book, in page order; it only lives in this window's memory. It is rebuilt when you start a file by clicking it in the reading area, when you change the loop scope or the types, and when you start a file that isn't in the list some other way (the file bar's play button, `Space`, a bookmark); pausing / resuming, switching within the list, auto-scroll and autoplay never rebuild it. The loop scope is single file, this book (the default) or across books, always looping: across books, once this book's list is done it moves on to the next book in the reading list with something playable, the list becomes that book's, and after the last book it goes back to the first. It can shuffle (playing a whole round without repeats before reshuffling) and can be limited to audio or video (this only affects what plays next; a file you start yourself always plays). Loop scope, shuffle and types are remembered and synced across windows (this book, no shuffle and no type limit by default); the main window has no play list panel.
- **Autoplay** (**Settings → Reading**, off by default): when turned on and not auto-scrolling, in Mixed and Media mode, once scrolling has stopped for about 0.3 s and nothing at all is playing (background play included), the video nearest the centre starts; scrolling quickly past doesn't trigger it. Audio never starts just because scrolling or a screen turn brought it into view: only a click on an audio bookmark, Media mode moving on to it, or auto-scroll reaching it starts it. Nothing autoplays in Comic mode. When `A` / `D` / `←` / `→` turn a screen and a video comes into range, the turn lands with that video centred in one move (the wheel, dragging and the scrollbar don't do this, nor does Comic mode or turning autoplay off). A video started by autoplay pauses and stops being the current track as soon as its middle leaves the view or you switch books, doesn't move on when it ends and doesn't rebuild the play list; once you play or pause it yourself it counts as background play. Media you paused yourself don't start again until they have left the view and come back. After the app opens or you switch books, autoplay waits for a key press, click or wheel turn first, so nothing starts making sound on its own.
- **Volume**: one volume and mute setting for the whole app, shared by every video and audio file, remembered and synced across windows. Change it with the volume button on the control bar, or `Q` / `;` turn it down and `E` / `'` up by 5% (hold to keep going), with a brief volume indicator.
- **When a media ends**: background play moves on through the play list (see above). A media played by auto-scroll is up to auto-scroll: in Media mode the next video or audio in page order plays (skipping images and files that won't play), scrolled to the centre of the view and from the start, and what happens at the end and whether it repeats is up to **Loop** on the control bar (see "Play modes"); Mixed mode scrolls on in page order. A video started by autoplay just stops.
- **Play position**: each media remembers where you stopped and continues from there when you scroll to it or play it; once it has played to the end (less than 5 s left) it starts from the beginning next time, and media moved on to automatically always start from the beginning. Positions are saved with the book (on pause, when the media leaves the view, when switching books or closing the window, and at most every 10 s while playing) and included in backups.
- **Seeking**: hold `D` / `→` to fast-forward or `A` / `←` to rewind the media shown in the file bar (paused ones and ones out of view too). It jumps about every 0.25 s, in steps that grow the longer you hold (2 s, 5 s, 10 s, then 30 s), showing the total offset and target time, and stops when you let go. A tap still turns the screen.
- **Drag to seek**: press on a video picture or an audio card's subtitle area and drag sideways to seek. The direction is decided after a short movement and then locked: sideways seeks (no scrolling, no click, no glide after release), up or down scrolls as usual. While dragging, the offset and target time are shown (changing a whole second at a time, without flickering between two seconds); the seek happens when you let go, and `Esc` cancels. Dragging across the full width of the media covers about a quarter of its length, at least 30 seconds and at most 5 minutes, never more than the whole length, and never past the start or end.
- **Subtitles**: only external subtitle files are supported: `.srt`, `.vtt`, `.ass`, `.ssa` and `.lrc` (lyrics). Subtitle tracks embedded in video files are not available to web pages, so they are not supported. A subtitle pairs with the media file in the same folder whose base name its file name starts with, followed by "." (`Movie.mp4` with `Movie.srt`, `Movie.zh.srt`, `Movie.chs.ass`; case doesn't matter). They are noted while listing folders on import and refresh, without opening any file; subtitle files are not pages and are not counted. In the loose album, media pair with subtitles picked or dropped together with them, and subtitles added to the album later pair with the media already there. Only the text and timing are used (styles, effects, positioning and drawings are dropped), shown as white text on a translucent dark background, at most 3 lines: over the bottom of the picture for videos (also in fullscreen), inside the card for audio. The **Subtitles** button in the right zone of the control bar (for the media shown in the file bar) turns subtitles on or off (remembered and synced across windows); when a file has several subtitles, the button opens a menu to pick **Off** or one of them. The choice is remembered per file; by default the one named exactly like the media is used, otherwise the first by file name. The button is greyed out for media without subtitles. A subtitle file is read only when it is first needed, cached for the session, and read again only if its size or modification time changed. Encodings: a BOM first, then UTF-8, then GB18030, Big5, Shift_JIS and EUC-KR in an order that depends on the interface language. If a file can't be read, a short hint appears and playback is unaffected. Subtitle file names and choices are included in backups.
- **Disk use**: importing and refreshing only look at file names and never open media files. Only media in view and the current track are handed to the browser, which reads them on demand (never into memory as a whole), and the others are released when they leave the view; neighbouring media are not preloaded.
- **Thumbnails and covers**: in the thumbnail strip and full-screen thumbnails, videos show a real frame: the picture at the video's earliest bookmark, or, without bookmarks, at about 10% of its length (trying 30% and then 50% if that frame is nearly black). Frames are saved as small compressed pictures and made one at a time, only for videos you can see, while the app is idle (they wait while media is playing or the page is loading images); they are reused as long as the file doesn't change. A video the browser can't play isn't tried again and keeps its type-icon tile. Video and audio tiles have the same size and proportions as the cells of full-screen thumbnails (not squeezed flat). Audio looks just like an audio bookmark in the bookmark lists: its tile is filled with the same picture as its audio card (the book's cover or the placeholder, not dimmed and without a big icon), with a small music icon and the duration at the bottom right, the file name on a strip along the bottom and the bookmark badge at the top right; it follows any cover change. Clicking a video or audio thumbnail puts that file in the middle of the view (without selecting or playing it); hovering or selecting it with the keyboard shows the file details card (below).
- **File details card**: hovering or selecting with the keyboard a video or audio in the thumbnail strip or full-screen thumbnails, or a video or audio bookmark in the bookmark panel, shelf bookmarks, full-screen bookmarks or **Choose the section start**, pops up a details card beside it at once, in place of the tooltip: the file name, its type, the play progress (where it was last played / its length, live while it plays; if the length isn't known yet, the file is not read and only what is known is shown) and a seek bar with all of that file's bookmarks and sections. On a bookmark the card is the same as for its file, except that this bookmark has an extra, prominent pointer on the bar and its time and name on the last line (pointing at a section bookmark's small picture shows that end). The card never covers the item it belongs to, can't be clicked and disappears when you move away. On the shelf, the default cover is the first page with a picture (an image or a video) by file name; a book with only audio gets a text cover made from its title. Books with video or audio show a type badge in the top-right corner of the cover.

### Bookmarks

- **Hold `F` or `Enter`** to add a bookmark at the centre of the screen. A ring fills up while you hold, so you can see what is happening; let go early and it counts as a tap.
- **Tap `F` or `Enter`** to jump to the next bookmark. After the last one it wraps to the first. Add `Shift` to go backwards.
- **Hold `Shift+F` or `Shift+Enter`** to add a section bookmark (see below).
- **Right click** the page to open the bookmark panel at the mouse, with two icon buttons at the top, **Add bookmark** and **Add section bookmark** (in the section colour; hover for the name and the hold shortcut), and a small **Set as cover** button beside them; **Add bookmark** is right under the pointer. The nearest bookmark (see below) is highlighted like a hovered one. Click a bookmark to jump there and close the panel; hovering does nothing. **Esc** or a click outside closes it without moving.

Bookmarks are stored with a small picture of the page and follow the file, not the scroll position, so they survive re-sorting.

**Nearest bookmark**: bookmarks are lined up by book (in the order of the shelf bookmark list), then page, then position in the page (time for video and audio), with a section's start and its section bookmark counted separately. The nearest bookmark is the last one before your reading position (one exactly here counts); bookmarks after it never do. When the centre of the view is a video or audio file, its current play time is the position: playing at 6:30, a bookmark at 5:23 in that file is nearer than one at 4:20, and bookmarks in earlier files or images are further still. The bookmark panel looks at the current book only and marks nothing if there is nothing before; the shelf bookmarks fall back to the last bookmark of the nearest earlier book that has any; full-screen shelf bookmarks open on it, and adding a section bookmark selects it by default. A section is never highlighted as a whole, only the one item. A bookmark you just jumped to (with the scroll position unchanged, say held at the top or end of the book) still counts as the nearest.

**Video and audio bookmarks**: when the file bookmarks act on (the current track while it is in this book with its middle in view, otherwise the page in the middle of the view) is a video or audio, holding `F` / `Enter` or **Add bookmark** in the panel adds a bookmark at its current time, and the bookmark button on the file bar or an audio card adds one to the file it shows; if that media already has a bookmark within 2 seconds you get a hint instead. Bookmarks are in page order, and by time within the same video or audio file. Tapping `F` / `Enter` onto a media bookmark scrolls that media to the centre and seeks to the bookmark; with autoplay on it plays from there, otherwise it stays on that frame. In bookmark lists, video and audio bookmarks carry a type badge and their time; a video bookmark's picture is the frame at that moment (taken straight from the player when you add it there, otherwise captured in the background once it shows up in a list, and saved), while audio bookmarks show the audio picture (the book's cover or the placeholder, not dimmed and without a big icon) and can't be used as a cover. The name sits along the bottom of the picture. The seek bar shows all of the file's bookmarks at their times: point at one for its time (where marks crowd together, the one nearest the pointer), click to jump there.

**PotPlayer bookmarks**: PotPlayer bookmark files (`.pbf`) next to videos or audio are imported too. A `.pbf` pairs with the media file of the same base name in the same folder (`X.flac` with `X.pbf`, or `X.flac.pbf`; if several media files share that base name it is skipped), and media dropped on their own pair only with `.pbf` files dropped together with them; a `.pbf` is never a page. Imported bookmarks join the bookmark list like any other, named "<file name>-<PotPlayer name>" (numbered like other bookmarks when PotPlayer has no name; see **Bookmark names** below). The `.pbf` is read in the background when idle; after that, the usual folder checks (on opening, on returning to the window, on manual refresh) only compare its size and modification time and re-read it when it changed, merging the changes: new entries are added, entries renamed in PotPlayer get the new name (unless you renamed them in MangaView), and anything less than 1 second from an existing bookmark is not added again. Entries deleted in PotPlayer stay in MangaView, and bookmarks you delete in MangaView are not brought back. Nothing is captured at import; a video bookmark's picture is made when it first shows up in a bookmark list.

**Section bookmarks**: a section bookmark pairs with a bookmark before it, and the stretch between them is a bookmark section. Holding `Shift+F` / `Shift+Enter`, **Add section bookmark** in the bookmark panel and the section button on the file bar or an audio card all open **Choose the section start** first: for images it lists the book's image bookmarks before the current position, for video and audio the bookmarks in that file before the current time, in order, with the nearest one selected and scrolled into view; with many bookmarks you can also drag the list to scroll. The arrow keys or a click change the selection, Enter or **OK** confirms (a double click confirms straight away), and `Esc` or **Cancel** cancels; hovering only highlights. The section bookmark goes where you were when you triggered it (for media, the play time at that moment; playback doesn't pause for the dialog). If the chosen start already has a section (its tile has the section mark and a dashed outline, and the line at the bottom says its end moves here), that section's end moves here; a section bookmark itself can't be a start. With nothing before to choose from you only get a hint. An end less than half a screen (2 seconds for media) from its start counts as "already a bookmark here", and image and media bookmarks never pair with each other. Sections may nest and may cross, and you can still add ordinary bookmarks inside a section. Bookmarks imported from PotPlayer can get section bookmarks in the app too, and section bookmarks are included in backups. A section bookmark doesn't count as a bookmark and isn't a stop for tapping `F` / `Enter`. In bookmark lists (the bookmark panel, shelf bookmarks and full-screen bookmarks) a section takes a single cell: the section bookmark is a small picture in the bottom-left corner of its start's thumbnail (above the name strip when there is a name), and the start and the small picture carry matching marks in the section colour (blue), with no outline of their own. Hovering the cell (or selecting it in full-screen bookmarks) highlights both in the section colour; when the nearest bookmark is a section bookmark, only the small picture is highlighted. Clicking either picture jumps to it (media: to its time), and the small picture has its own delete button. In full-screen bookmarks the arrow keys move cell by cell, and `Space` / `Enter` jumps to the start. Deleting a section bookmark turns its start back into an ordinary bookmark; deleting the start deletes its section bookmark too. If re-sorting puts the section bookmark before its start, the section is set aside (the small picture is greyed out and neither end shows a section mark) but kept, and comes back when the order does. Thumbnail badges, the marks in the page, section ranges in full-screen thumbnails, section marks and ranges on the seek bar, the **Add section bookmark** button in the bookmark panel and the progress ring when holding to add a section bookmark all use the same section colour. On the seek bar a section is a pair of brackets joined by a line along the top, drawn in layers by nesting (up to 3: nested sections sit inside, crossing ones one layer down, anything deeper joins the third); pointing at a mark (where marks crowd together, the one nearest the pointer) highlights just that pair with the times of both ends, and clicking jumps to that mark's time.

**Bookmark names**: video and audio bookmarks always have a name, shown along the bottom of their picture and in tooltips, seek bar marks and full-screen bookmark search. Bookmarks added in the app are named "<file name>-Bookmark N" (the file name without folders or extension; N follows the highest number already used in that file; the word "Bookmark" is in the interface language at the time), and media bookmarks from older versions get a name when opened. Image bookmarks have no default name and still show just the picture (read out as "Page N"). Any bookmark can be renamed: select it in the bookmark panel, shelf bookmarks or full-screen bookmarks (hover or keyboard) and press `F2`, or click its pencil button, then edit in place; `Enter` confirms, `Esc` cancels, and confirming an empty name restores the default (the automatic name for media, no name for images). Renamed image bookmarks show their name too.

**Play bookmark sections only**: a toggle on the control bar, remembered and synced across windows. When on, auto-scroll only goes through sections: in Comic and Mixed mode scrolling only passes through image sections, jumping from the end of one straight to the start of the next (Comic mode only through the images inside them); when sections nest or cross, their union is used, so overlapping parts are passed or played once; within a media only its bookmark sections play: it starts at the first section after the current time, jumps to the next section at the end of each one, and counts as finished after the last (the single file loop goes back to the first section). In Mixed and Media mode, media without sections are skipped unless they lie entirely within an image section (then they play in full); playing one yourself plays all of it. Dragging outside the sections plays on normally, and section jumps resume once a later section is reached. The seek bar dims everything outside the union of the sections. In a book without any sections the toggle still turns on, with the hint "This book has no bookmark sections"; **Auto-scroll** then shows the same hint and doesn't start.

**Shelf bookmarks**: works like the thumbnail strip. It gathers the bookmarks of the books in the reading list, in its order (the shelf, library or all, whichever is selected in the shelf view, without missing books; with filters active, only the filtered books; if that leaves it empty, it suggests clearing or changing the filters). With a very large collection it still only lays out and draws what you can see, so it opens and scrolls smoothly. It isn't pinned by default: rest the mouse at the left edge and it pops out over the page, then fades out when the mouse leaves (turn this off in **Settings → Reading**). The **Shelf bookmarks** button in the toolbar pins it on the left, and the page narrows to make room; drag the list's right edge to resize it. Hovering does nothing; click a bookmark to jump there, opening its book if needed. The list is compact: one group of thumbnails per book (the current book's group is highlighted, and the nearest bookmark is highlighted like a hovered one), with no titles or file names. When you switch books, jump to a bookmark or the list pops out, it scrolls to the nearest bookmark, which may be in an earlier book's group (without one, to the current book's group; it stays put if there is neither, and never scrolls while the mouse is over it or right after you scrolled it yourself). The full-width button at its top opens full-screen shelf bookmarks. While the list is pinned and **Loop** on the control bar is set to across books, tapping `F` / `Enter` (`Shift` for backwards) follows it too: after the last bookmark in the current book it moves on to the next book, and wraps back to the start at the end; otherwise it cycles through the current book only. A book that isn't in the reading list still cycles through its own bookmarks.

**Focus mode** (on by default, turn it off in **Settings → Reading**): when the mouse isn't over them and they don't have keyboard focus, the pinned shelf bookmark list and thumbnail strip hide their content but keep their space, on the same background as the page, so there is less to distract you. Move the mouse over them to bring the content back. Showing and hiding fade with a short delay, so sweeping the mouse past them does not flicker.

### Thumbnail strip

Rest the mouse at the right edge to pop it out over the page. It closes when the mouse leaves (turn this off in **Settings → Reading**). The thumbnail button in the toolbar pins it instead: pinned, it sits beside the page and the page narrows so nothing is covered (whenever the page changes width, the window is resized or you enter or leave fullscreen, whatever is in the middle of the view stays put, and the start or end of the book stays at the start or end). Drag its left edge to resize it. Its top row is a full-width **Full screen** button that also shows the page count. The strip follows your reading position without drawing the area of the view on it. Clicking an image thumbnail goes to the matching spot in that image; clicking a video or audio puts that file in the middle of the view.

Pages with bookmarks show a bookmark badge in the top-right corner of their thumbnail (a single bookmark icon, with a count when a page has several; the icon is in the section colour when the page has a section start or section bookmark), and thin marks on the left edge at each bookmark's position in the page: a short line for a bookmark, and a pair of brackets for a section's start and its section bookmark, nested sections indented one step (up to 3). Point at a page with either end and both ends light up. Adding or deleting a bookmark only redraws the pages it touches.

Thumbnails are cached in memory for the session (up to 64 MB, never written to disk). Opening full-screen thumbnails again for the same book, or coming back from another book, doesn't read the images again until you close the app.

**Full-screen thumbnails**: the button at the top of the strip, or `V` / `]`, opens an overview of the whole book; press it again or `Esc` to close. Pages sit in a regular grid by default; the button in the title row switches to a masonry layout that follows each page's proportions (both full-screen views share this choice). A wide scrollbar on the right makes long books quick to skim. The current page is selected and keeps an outline (without shrinking, so it stays distinct from the moving selection); `A` `D` / `←` `→` move in page order, `W` `S` / `↑` `↓` move within a column, and `Page Up` / `Page Down`, `Home` / `End` also work. Click a thumbnail, or press `Space` / `Enter`, to jump to the top of that page (a video or audio goes to the middle of the view) and close the overview. Pages with bookmarks carry the same badges; selecting (hovering or using the keyboard) a page with a section start or section bookmark outlines every page those sections cover (one outline per section, nested sections indented one step, up to 3), until you move on.

**Searching the full-screen views**: both full-screen views have a search box in the title row. Results narrow as you type, and the keyboard moves only through the results. Full-screen thumbnails match file names (and the volume folder names of a joined book); full-screen shelf bookmarks match book titles and the file names the bookmarks are on, and a matching title shows all of that book's bookmarks. Next to the search box, three toggles (images / videos / audio) show only the chosen types; pick any number, or none for all (full-screen shelf bookmarks go by the type of the page each bookmark is on). The view still opens on the current content; `/` or `Ctrl+F` jumps to the search box, and `Esc` in the box first clears it and returns to the list, then closes the view. With no results you get "No matching items" and a link that clears the search (and the type toggles). The search and types last only while the view is open and don't affect previous / next book or bookmark jumps.

**Full-screen shelf bookmarks**: the button at the top of the shelf bookmark list, or `C` / `[`, shows every bookmark in the shelf bookmark list full screen, grouped by book with the book title as a heading (the current book is highlighted). It switches between grid and masonry in the same way. The nearest bookmark is selected (or the current book's first bookmark if there is none); `A` `D` / `←` `→` move in order, `W` `S` / `↑` `↓` move to the nearest bookmark in the row above or below. Click or `Space` / `Enter` jumps to it, switching books if needed. Pressing `V` / `]` or `C` / `[` in one full-screen view switches to the other.

On the right of both full-screen views' title row are the grid / masonry switch, a wide orange bookshelf button (or press `B`) and close; no key hints are shown. The bookshelf opens on top and the full-screen view stays open underneath. Switching books in the bookshelf switches full-screen thumbnails to the new book; closing the bookshelf returns to the full-screen view. A full-screen view closes only when you jump to a page / bookmark or close it yourself.

### Sorting

In **Sort**, choose **This folder / book** to set an order for the current book only, or **Default for all folders** to change the default. **Use default** removes a book's own setting. Choosing shuffle reshuffles every time you pick it, but reopening a book keeps its shuffled order. Time-based sorting reads file modification times on demand. Re-import a folder to refresh those times.

### Refreshing folders

MangaView checks your folders for added or removed files in three cases (the first can be turned off in **Settings**):

- each time the app opens or the page is reloaded, it checks the current book first, then works through every other folder it still has access to, one at a time in the background while the browser is idle, so reading isn't slowed down; with several windows open, only one of them checks the other folders, once;
- when you switch back to the window, it checks the current book;
- when you press a **Refresh** button (at the left end of the toolbar, and on the shelf), it checks everything. A manual refresh can also ask for access to the current book again.

New subfolders are not detected: add the parent folder again to pick them up.

### Missing books and moving your files

A book whose folder can't be found is **never** deleted automatically, because the browser can't tell a deleted folder from an unplugged drive. Only when **all** of a book's folders are gone does it move to **Missing**, keeping its cover, tags, bookmarks and progress. Plug the drive back in and refresh, and it returns on its own. If only some volumes of a joined book are missing, the book stays readable: the missing volumes are hidden for now and its cover shows a small warning. They come back on their own once found, or you can reconnect them with **Restore** on the cover. Records are deleted only when you delete them.

Browsers never reveal a folder's full path on disk, so after files are moved MangaView recognises books by their **folder name** plus a fingerprint of the **first file** by file name (image, video or audio; unrelated to the cover picture or any custom cover). The fingerprint is the file name, its exact size and a digest of its first 64 KB; whole files are never hashed. For books with video or audio, the size of each media file is also noted in the background (from file information only): if the folder was renamed or its first file no longer matches, a folder where most media files match by name and size is listed for you to confirm, and a file with the same name but a different size is never reconnected automatically. Videos and audio in the loose album are found again by relative path and file name, and their size must match too. Joined books are matched volume by volume:

- **Add the parent folder again**: a missing book or volume with the same folder name and cover is reconnected automatically instead of being added twice.
- **Restore from folder…** (in *Missing*): pick a folder that contains your books, at any depth. Exact matches are restored at once. Likely matches (renamed folder with the same cover, or same name with a different cover) are listed for you to tick. Anything else stays missing. Lost images of the loose album are found again too. Restoring only reconnects existing records and **never adds books**: content with no matching record is ignored. Restoring a single book, or **Locate originals**, also reconnects any other missing books and loose images found in the chosen folder.
- **Restore** on a single book: pick its folder. If it doesn't match, you can still **Restore anyway** to keep the tags, bookmarks and progress. For a joined book that is entirely missing and where no volume matches, this rebuilds the book from the chosen folder, and volumes at the same relative paths keep their bookmarks and progress. If only one volume of a joined book is missing, you can link the chosen folder to that volume anyway; the other volumes are left untouched. When several volumes are missing, a folder that doesn't match is reported as not found rather than guessed at.

### Several windows

You can open several MangaView windows at once (browser tabs or windows of the installed app), even on the same book:

- Changes to books, bookmarks, tags, covers, titles and which list a book is in show up in the other windows within a second, updating only what changed. Different changes to the same book from different windows are all kept (for example, a bookmark added in each).
- When one window deletes a book, other windows reading it say so and move on just as if it had been deleted there (the next book in the reading list, else the previous one, or back to the shelf view when the list is empty); the record is not written back.
- Settings (everything in the settings panel, the language, the default sort, volume and mute, play bookmark sections only, and the control bar's play mode, scroll speed, playback speed, single file and loop) apply to all windows at once. Layout (pinned thumbnail strip or shelf bookmarks, widths, list styles) is separate for each window; the last change is used the next time you open the app.
- Each window has its own current book and reading position; for the same book, the position saved last wins.
- Background disk work, such as checking every folder at startup and making covers, runs in one window only, so the other windows don't read the drive again. If that window closes, or goes to the background while another window is in front, another window takes over.
- After **Restore default settings**, importing a backup or clearing all data, the other windows reload automatically.
- When a new version changes how data is stored, windows still running the old version let go of the storage and ask you to reload, so the new window isn't blocked.

### Your data

Images, videos and audio are read on your device and never uploaded or copied. The browser stores a book index, read-only file handles, sort settings, reading positions, tags, bookmarks, search presets and small compressed thumbnails (covers, bookmarks and video frames, never the original files). Clearing site data erases all of this.

**Settings → Data** shows how much storage is used, and can export everything to one JSON file and import it again, merging with or replacing the current data. The file contains no images and no folder access, so after importing on another computer the books appear under *Missing*: use **Restore from folder…** to reconnect them. Backups use format 2: older backups can still be imported, but older versions of the app can't import new ones. When storage gets close to the browser's quota, MangaView suggests deleting records of books you no longer need.

**Restore default settings** at the bottom of the settings panel resets the settings and layout (side panels, widths, default sort and so on) and reloads the page. Books, bookmarks, tags, reading progress and search presets are kept.

- If the browser has revoked access when you reopen a book, use **Grant access**.
- After a browser update, previously saved folder access can stop working altogether (the browser no longer answers for those grants, while choosing the same folder again works). This is the browser's doing: a web app never sees disk paths and cannot reopen folders on its own. MangaView detects this within seconds at startup (it only asks the browser and reads nothing from disk, so a slow hard drive is not mistaken for it) and shows a hint naming the browser update. Click **Restore from folder…** in the hint and choose the folder that holds your comics: single-folder books, the volumes of merged works and the loose album all reconnect to their records, keeping tags, bookmarks and progress; the picker opens where you restored last time. When a drive is merely slow, pages show **Cannot display image** after a wait and are retried later.
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
| `index.html`, `src/style.css` | Markup, icons and styles |
| `src/app.mjs` | Start-up: builds the context the modules share, installs the feature modules in order, loads the books and opens the last one read |
| `src/core/control.mjs` | Control bar play modes, speed ranges and steps, button layout of the three zones, which buttons each mode disables |
| `src/core/engine.mjs` | Auto-scroll rules: scroll speed, the next step (scroll / stop and play / jump / hold / end of book), Comic mode's runs of images, page by page in single file mode, the next book for the cross-book loop, screen turns landing on a video |
| `src/core/lang.mjs` | Built-in translations |
| `src/core/match.mjs` | Matching missing books (volume by volume) to folders, tag colours |
| `src/core/merge.mjs` | Field-by-field / entry-by-entry merging when several windows save the same book |
| `src/core/model.mjs` | Page types, sorting and layout math |
| `src/core/playlist.mjs` | Rules for what follows a finished media and for playing bookmark sections only |
| `src/core/reading.mjs` | Reading list rules: the list the shelf tab selects, previous / next book, which book opens after deleting the current one |
| `src/core/recent.mjs` | Rules for the nearest bookmark |
| `src/core/sections.mjs` | Section bookmark rules: possible starts, the union of sections, layers for nested and crossing sections |
| `src/core/sources.mjs` | Folder scanning and file access, books and their source folders (volumes) |
| `src/core/store.mjs` | IndexedDB storage |
| `src/core/subtitles.mjs` | Subtitle decoding and parsing (.srt .vtt .ass .ssa .lrc) |
| `src/core/windows.mjs` | Coordination between windows: change notices, background disk work in one window only, reloading after global operations |
| `src/marks/bookmarks.mjs`, `src/marks/bookmarks.css` | Bookmarks, bookmark panel, shelf bookmark list |
| `src/marks/pbf.mjs` | PotPlayer bookmarks (.pbf): parsing, merging and background reading |
| `src/marks/startpick.mjs`, `src/marks/startpick.css` | The **Choose the section start** dialog for adding section bookmarks |
| `src/media/media.mjs`, `src/media/media.css` | Video and audio: player and controls, current track and background play, play list, current file, autoplay, shared volume, media keys, drag to seek, moving on when a media ends, play position memory, the control bar's media driver |
| `src/media/art.mjs`, `src/media/art.css` | The audio picture: the book's cover, or a placeholder coloured from the file name (shared by audio cards, audio bookmarks and thumbnails) |
| `src/media/filecard.mjs`, `src/media/filecard.css` | File details card: name, play progress and a seek bar with bookmark marks for video and audio in thumbnails and bookmark lists |
| `src/media/subtitles.mjs`, `src/media/subtitles.css` | External subtitles: reading and caching, display, the subtitles button and menu |
| `src/panels/help.mjs`, `src/panels/help.css` | Keyboard and mouse map (left hand, right hand and mouse) |
| `src/panels/settings.mjs`, `src/panels/backup.mjs`, `src/panels/settings.css` | Settings panel, export and import |
| `src/reader/controlbar.mjs`, `src/reader/controlbar-dial.mjs`, `src/reader/controlbar.css` | Bottom control bar (with the file bar row above it), speed, volume and play mode pop-up panels |
| `src/reader/filebar.mjs`, `src/reader/filebar.css`, `src/core/filebar.mjs` | File bar: the title row (file name without extension, a button area for other modules) and the playback row (play and progress, time with rewind / fast-forward, bookmark / section buttons, the rest in **⋯**) |
| `src/core/selection.mjs` | Rules for the current track (selected media), the current file and what bookmarks act on |
| `src/reader/focus.mjs`, `src/reader/focus.css` | Focus mode |
| `src/reader/overview.mjs`, `src/reader/overview.css` | Full-screen thumbnails and shelf bookmarks (grid / masonry, search) |
| `src/reader/thumbs.mjs` | Compressed thumbnails (covers, bookmarks), video frames and video thumbnails, session cache of page thumbnails |
| `src/reader/toolbar.mjs`, `src/reader/toolbar.css` | Top toolbar and the name area below it |
| `src/reader/transport.mjs` | Control state (play mode, speeds, loop, toggles) and starting / stopping auto-scroll |
| `src/reader/engine.mjs`, `src/reader/autoscroll.mjs` | Auto-scroll in Comic and Mixed mode (only images in Comic mode, stopping to play media in Mixed mode, looping at the end of the book, page by page in single file mode); the steady-scroll stepping shared with holding `W` / `S` |
| `src/reader/single.mjs`, `src/reader/single.css` | Single file mode: one page per screen, page turns, wheel and snapping |
| `src/reader/view.mjs`, `src/reader/thumbworker.mjs` | Virtualized reader, thumbnail strip, image loading queue; thumbnails decoded in a worker, not read while scrolling fast |
| `src/shelf/add.mjs`, `src/shelf/addlist.mjs` | Add dialog: items to add (handles only, de-duplicated), importing on confirm |
| `src/shelf/cover.mjs`, `src/shelf/bookcover.mjs` | Custom covers and **Set as cover**; a book's current cover (the audio picture) |
| `src/shelf/shelf.mjs`, `src/shelf/shelf.css` | Shelf, library, missing books, filters and presets, tags, restore, storage usage |
| `sw.js` | Offline cache |
| `dist/` | Migration bridge for v1 users |
| `docs/dev-guidelines.zh-CN.md` | Design requirements and development conventions (Chinese) |

Tests need Node 22.12+ and run from `tests/run.mjs`:

```sh
# Everything: core tests first, then the headless Chrome / Edge end-to-end tests one at a time; a failed one is rerun once on its own, then passes and failures are listed
node tests/run.mjs "<path to chrome.exe or msedge.exe>"
# Only the end-to-end tests whose file name contains one of the given names (core tests still run first)
node tests/run.mjs "<path>" shelf media
# Core tests only (pure logic, tests/core/*.test.mjs)
node tests/run.mjs
```

The end-to-end tests (`tests/browser.mjs`, `tests/*.browser.mjs`) each use a throwaway browser profile and generated images; videos and audio are generated in the test page by `tests/media-fixtures.mjs`.

Things the automated tests can't cover:

- an offline cold start of the installed app;
- importing thousands of images from a real hard drive (not an SSD) and switching books while scrolling;
- middle-click auto-scroll across tall images on Windows;
- the real window frame of the installed app;
- handing background disk work over as real windows move between the foreground, the background and minimized;
- a large video library on a real hard drive (disk use when opening, seeking and making video thumbnails), how videos look while dragging a real window edge, and real video fullscreen;
- how smooth slow auto-scrolling is, and how drag-scrolling momentum feels;
- long auto-scrolling in Mixed mode, and moving the window to the background and back while it runs;
- background play: the play list moving on (across books too) while the window is minimised or in the background, and a large video picture coming back into its page seamlessly after scrolling away or switching books;
- the encoding of real subtitle files, and subtitles and the file bar in real fullscreen;
- the real system pickers, and dragging real folders into the add dialog.

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
