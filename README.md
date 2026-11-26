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
- **Video and audio**: videos and audio the browser can play sit in the same strip as images, with their own controls, one volume for the whole app, and autoplay.
- **Import as one book**: a series stored as several folders (one per volume, say) can be joined into a single book and read straight through.
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
3. Add a folder or drop images, videos or audio into the window.

New versions arrive automatically. There is nothing to download, unzip or set up.

## How to use

Use **Add folder** or pick images with **Add to Loose images** on the welcome screen, or drop them anywhere in the window. Dropping only files (images, videos or audio, no folders) adds them to the loose images. When the drop includes folders, the overlay shows **Import as one book** and **Add to Loose images** side by side at the bottom; drop on **Add to Loose images** to add every image, video and audio file, including those inside folders, to the loose images instead of making a book per folder. Move the mouse to the top edge of the window (or press **T**) to open the toolbar.

### Mouse

| Action | Result |
| --- | --- |
| Wheel / left-drag | Scroll |
| Middle click | Browser auto-scroll (where your OS and browser support it) |
| Click the left / right half | Back / forward one screen |
| Click a video / audio (outside its controls) | Play / pause (doesn't turn the screen) |
| Move to the top window edge | Open the toolbar |
| Move to the bottom window edge | Open the control bar: change books, back to top / jump to end, play mode, playback and media controls |
| Move to the left window edge | Pop out the shelf bookmarks (when not pinned) |
| Move to the right window edge | Pop out the thumbnail strip (when not pinned) |
| Button at the top of the shelf bookmarks / thumbnail strip | Open full-screen shelf bookmarks / thumbnails |
| Click a thumbnail | Jump to that exact point |
| Right click | Open the bookmark panel |

The full-screen bookmark and thumbnail views switch between a regular grid (the default) and a masonry layout with one button. Hovering a tile selects it, exactly as the keyboard does.

### Keyboard

| Keys | Result |
| --- | --- |
| `S` / `↓` | Scroll down (hold to keep scrolling) |
| `W` / `↑` | Scroll up (hold to keep scrolling) |
| `Space` | Same as the big play button on the control bar: play / pause the current media (no longer scrolls, nor does `Shift+Space`) |
| `Shift+S` / `Shift+↓` | Next book (one per press; holding doesn't repeat) |
| `Shift+W` / `Shift+↑` | Previous book |
| `D` / `→` | Tap: forward one screen. Hold: fast-forward the current media |
| `A` / `←` | Tap: back one screen. Hold: rewind the current media |
| `Q` / `;` | Volume down 5% (hold to keep going) |
| `E` / `'` | Volume up 5% (hold to keep going) |
| `Z` / `/` | Play the current media in a new window (`/` still jumps to the search box on the shelf and in full-screen views) |
| `F` / `Enter` | Tap: next bookmark. Hold: add a bookmark |
| `Shift+F` / `Shift+Enter` | Tap: previous bookmark. Hold: add a section bookmark |
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
| `T` | Show or hide the toolbar |
| `Esc` | Close the toolbar, the control bar and floating side panels |

The keyboard button in the toolbar shows these controls inside the app as a picture: the left-hand and right-hand parts of a keyboard and the mouse, with the keys that do something highlighted. Hover, focus or tap a key to see what it does in a tooltip; holding and Shift combinations are picked out in accent colours.

### Toolbar and control bar

Rest the mouse at the top edge and the toolbar appears, centred over the page: a row of icons (hover one to see its name) that wraps onto more lines in a narrow window, with the book title and progress just below. You can also press **T**, or press Tab to focus the menu button in the top-left corner and then Enter.

Rest the mouse at the bottom edge for the control bar, centred at the bottom of the reading area (windows opened with **Play in a new window** have one too). It has a left, middle and right zone, each with a line of status text underneath:

- **Left (reading)**: **Previous book**, **Back to top**, **Jump to end**, **Next book**, the **Continue across books** toggle and the scroll speed; underneath, the current position (current page / total · progress). At the start or end the matching button is greyed out. Changing books lives here only; the toolbar has no previous / next buttons. While shelf filters are active, previous / next book only move through the filtered results, and the buttons carry a small dot to show it.
- **Middle (running)**: the **Play bookmark sections only** toggle, the big play button and the **Single file** toggle; underneath, the play mode: Comic, Mixed (the default) or Media. The big play button, like `Space`, plays or pauses the current media; with no media in view it takes the nearest media after the view, scrolls it to the centre and plays it. When playback ends and nothing follows, the button goes back to its stopped state.
- **Right (media)**: **Previous media**, **Next media**, play order, loop, playback speed, volume and **Play in a new window**; underneath, the current media's file name and time. Previous / next follow the play order (with shuffle, previous goes back to the one played before) and scroll the media to the centre of the view; while playing they play it, otherwise they only move there. Without loop, the button at either end of the list is greyed out.

The speed and volume buttons open a small panel above them on hover or keyboard focus (a slider and common values; volume also has mute). The wheel or arrow keys on the button change the value one step at a time; clicking a speed button resets it to 1.0×, and clicking the volume button mutes or unmutes. Scroll speed ranges from 0.25× to 4× and playback speed from 0.5× to 3× (pitch is kept; it applies to every video and audio file). Buttons that don't apply to the current mode are dimmed and disabled, never hidden or moved: in Comic mode the whole right zone, in Mixed mode the play order, in Media mode the scroll speed; in a book without video or audio the whole right zone (and in Media mode the big play button too). In narrow windows, secondary buttons move into **⋯** pop-ups in the left and right zones, and narrower still the three zones stack.

In this version, running in Comic and Mixed mode works the same as in Media mode (playing and pausing media); scroll speed, single file and continue across books only remember their setting and take effect in a later version.

Both fade out when the mouse leaves, and each edge pop-out can be turned off in **Settings → Toolbar**; **T** still works. Clicking the page only turns it (left half back, right half forward); clicking a video or audio plays or pauses it. On a touch screen, tap the top of the page to show or hide the toolbar.

### Shelf, library and tags

The **Bookshelf** button (or **B**) opens a full-screen view with four lists (click the tab of the current list again, or press **B** again, to go back to reading):

- **Shelf**: what you are reading now. Newly added folders, and folders you add again, land here.
- **Library**: everything else, for managing large collections. Books you add or drop while the shelf view is showing the library go to the library.
- **All**: both together, for searching everything.
- **Missing**: only shown when some books' folders can't be found (see below).

*Previous / next book* move through the list the current book is in (shelf or library). Importing while the shelf view is open doesn't switch the book you're reading; you just get a note of how many books were added.

When the shelf opens, the book you're reading is selected and scrolled into view. Hovering a cover and moving with the arrow keys share one selection: the selected cover shows its title, progress and tags, plus buttons to edit the title, edit tags, set the cover, move, copy the title or delete the record. `Enter` opens it and `Delete` deletes its record (after asking). Books with bookmarks show a bookmark count in the bottom-left corner of the cover. The rightmost toolbar button switches between a regular grid (the default, covers cropped to the same size) and a masonry layout (covers at their own proportions). Toolbar buttons show icons only; hover them for a description.

**Search and filters**: search matches titles, folder paths, tags and the folder names of each volume in a joined book; type `#tag` to filter by tag, and press `/` or `Ctrl+F` to jump to the search box. While filters are active, the search box shows the number of results on its right. The **Filters** button opens a panel with a page-count range, **Has bookmarks**, file types (images / videos / audio; pick any number, and a book matches if it has a page of any chosen type) and tags (several tags must all match; there is a search box when you have many). With the panel closed, the active filters are listed below it, and the **Clear filters** button next to the search box clears them all. Filters are remembered and stay in place as you switch between shelf, library and all; previous / next book and the shelf bookmarks also stay within the filtered results.

**Presets**: save the current filters as a preset, then apply it with one click from the preset menu, where you can also rename, delete or update presets. If you change the filters after applying one, the preset button gets a small dot (its tooltip says *modified*).

**Sorting books**: the sort menu sorts by date added (descending, newest first, by default), folder time or name, ascending or descending (ascending: oldest first / A→Z). Shelf, library and all share this setting, and previous / next book and the shelf bookmarks follow the same order. Browsers can't read a folder's own modification time, so *folder time* is the newest modification time of the images inside; it is worked out in the background only when you pick that sort (file info only, no image reading), and books not done yet go last.

The **Batch actions** menu copies the listed titles, has **Move all to shelf / library** for everything the current filters show, and **Clear shelf / library**, which deletes the records of every book in that list (filters don't apply) after asking for confirmation. The original files are never deleted.

The pencil button on a cover edits the title. Only the displayed name changes, not the folder, and searching for the folder name still finds the book; leave it empty to restore the original. When editing tags, existing tags are suggested in a pop-up below the box as you type (`↑` `↓` to choose, then `←` `→` too, Enter to add, `Esc` closes the suggestions first), and an empty box lists your recent and most-used tags. Tag colours are picked automatically from the tag name, so the same tag always has the same colour.

**Custom cover**: the **Set cover** button on a cover lists the thumbnails of the book's bookmarks; pick one to use the picture at that bookmark as the cover (cut again from the original image at the cover's proportions when it can be read, otherwise the bookmark thumbnail is used). A book without bookmarks asks you to add one first. **Reset cover** at the bottom brings back the default cover. A custom cover is a separate small picture: deleting that bookmark, refreshing, restoring or importing again doesn't change it, and it is included in backups. Setting or resetting it only updates that one cover. Folders are still recognised by the default cover only.

### Import as one book

When a series is split across several folders (one per volume, for example), you can join them into one book and read straight through. While dragging, drop the folders on the **Import as one book** area at the bottom of the drop overlay, or use the **Import as one book** button in the shelf header and pick a folder: every folder with images inside it becomes part of one book, in path order.

- Importing the same set of folders again updates that book instead of adding a second copy: new volumes are added, volumes that are gone are removed, and bookmarks and progress are kept.
- The same folder can be a book of its own and a volume in one or more joined books at the same time; refreshing or re-importing it updates all of them.
- The book is named after the folder you picked or dropped; with several folders, after the first one in file name order.
- If only one folder contains images, it is imported as a normal book (recognised and restored by that folder), but named after the folder you picked, and searching for its own folder name still finds it. A title you have edited is kept when you import again. Loose images go to **Loose images**.

### Loose images

There is a single **Loose images** album: images picked with **Add to Loose images**, images dropped on their own, and everything dropped on the **Add to Loose images** area all go there. Different images with the same name can live side by side, and adding the same file again doesn't duplicate it. If some of its images can't be found, the album stays readable and those images show as unreadable; use **Locate originals** (or **Restore** on its cover when the whole album is missing) and pick the folder that holds them, at any depth, to find them again by relative path and file name.

### Video and audio

Videos (mp4, m4v, webm, mkv, mov, ogv) and audio (mp3, flac, wav, ogg, oga, opus, m4a, aac, weba) that the browser can play natively are recognised by extension, just like images, and sit as pages in the same vertical strip; sorting (file name, modification time, shuffle) treats them all alike. A folder with only videos or audio is a book too, and videos or audio dropped on their own join the loose images.

- **Unsupported formats**: media files the browser can't play (avi, wmv, flv, rmvb, ts, mpg, wma, ape and so on) are not imported; the import result says how many and lists their extensions. Refreshing doesn't repeat the note. A file with a supported extension that still won't play (some HEVC mkv files, for example) shows **The browser can't play this file** with **Retry** on its page, without affecting other pages. That result is saved with the file's size and modification time and not tried again while the file is unchanged, only after **Retry** or when the file changes.
- **Layout**: a video follows the same width rule as images (**Fit to width**), with its height from the frame ratio. If it would be taller than the reading area, it shrinks to exactly one screen, centred, so the whole frame is visible (while you resize the window, it is re-laid out about 0.2 s after you stop; until then the picture shrinks inside its old space). The frame size is read the first time a video is shown and saved; until then it takes a 16:9 placeholder, and the real size never pushes the current view away. Audio is a full-width card of fixed height: a type icon and the file name, room for 3 lines of subtitles, and the controls.
- **Controls**: each media's own panel only has controls for that file: play / pause, a seek bar you can click or drag (with bookmark marks), current time / duration, add bookmark and add section bookmark, plus fullscreen for videos (the whole player, picture and controls, goes fullscreen, and keyboard shortcuts keep working). Controls that act on the whole list, such as volume, play order, loop, play bookmark sections only and play in a new window, are on the control bar. Controls are icons with tooltips; when space runs short, secondary controls move into a **More** pop-up. The file name shows only its last part, with the full path in the tooltip. Video controls float over the bottom of the picture and fade out when the mouse leaves, or after a few seconds of stillness while playing; audio controls are always shown. Clicking the picture or the media's own play button is the same as the big play button on the control bar, and makes that media the current one (in Comic mode it plays only that file and stops at its end, without following the play order). Dragging still scrolls, including from blank areas of the panel (anything but buttons, the seek bar and the file name).
- **State**: the current media has an accent outline. While playing, its play button and seek bar are in the accent colour, and an audio card brightens and shows moving level bars (still when the system asks for reduced motion); media not playing are grey, and a paused video is dimmed with a big play button in the middle.
- **Current media**: shortcuts and the control bar act on the media last chosen in this window (by its play button, by starting to play, or with previous / next media) while it is playing or still in view; otherwise on the media playing; otherwise on the one whose middle is in view and closest to the centre of the screen (paused ones count). Only one media plays per window.
- **Autoplay** (**Settings → Reading**, on by default): once scrolling has stopped for about 0.3 s and nothing is playing, the media nearest the centre starts; scrolling quickly past doesn't trigger it. Playing media pause as soon as their middle leaves the view, and media you paused yourself don't start again until they have left the view and come back. After the app opens or you switch books, autoplay waits for a key press, click or wheel turn first, so nothing starts making sound on its own.
- **Volume**: one volume and mute setting for the whole app, shared by every video and audio file, remembered and synced across windows. Change it with the volume button on the control bar, or `Q` / `;` turn it down and `E` / `'` up by 5% (hold to keep going), with a brief volume indicator.
- **Play order and loop**: the **Play order** button on the control bar cycles through list (the default), shuffle and single, and its icon changes with it; **Loop** is a toggle. When a media ends: list plays the next video or audio in page order (skipping images and files that won't play) and stops after the last one, or goes back to the first with loop on; shuffle plays each one once in random order and then stops, or reshuffles and carries on with loop on; single stops, or repeats the same one with loop on. The next media is scrolled to the centre of the view and played from the start. Both settings are remembered and synced across windows.
- **Play position**: each media remembers where you stopped and continues from there when you scroll to it or play it; once it has played to the end (less than 5 s left) it starts from the beginning next time, and media reached through the play order always start from the beginning. Positions are saved with the book (on pause, when the media leaves the view, when switching books or closing the window, and at most every 10 s while playing) and included in backups.
- **Seeking**: hold `D` / `→` to fast-forward or `A` / `←` to rewind the current media (paused ones too). It jumps about every 0.25 s, in steps that grow the longer you hold (2 s, 5 s, 10 s, then 30 s), showing the total offset and target time, and stops when you let go. A tap still turns the screen.
- **Play in a new window**: the **Play in a new window** button on the control bar, or `Z` / `/` (for the current media), opens a smaller new window on the same media of the same book and carries on from the current time; the original window pauses it. The new window is the full app, except that it skips the startup folder check; it keeps playing in the background or minimized, with play order and loop working as usual. If the browser blocks the pop-up, you get a hint (allow pop-ups for this site and try again) and the original keeps playing; if the browser won't let the new window start playing with sound, that window says so and waits at that point for a click.
- **Disk use**: importing and refreshing only look at file names and never open media files. Only media in view are handed to the browser, which reads them on demand (never into memory as a whole), and they are released when they leave the view; neighbouring media are not preloaded.
- **Thumbnails and covers**: in the thumbnail strip and full-screen thumbnails, videos show a real frame: the picture at the video's earliest bookmark, or, without bookmarks, at about 10% of its length (trying 30% and then 50% if that frame is nearly black). Frames are saved as small compressed pictures and made one at a time, only for videos you can see, while the app is idle (they wait while media is playing or the page is loading images); they are reused as long as the file doesn't change. A video the browser can't play isn't tried again and keeps its type-icon tile. Audio shows as a tile with a type icon, the file name and the duration. On the shelf, the default cover is the first page with a picture (an image or a video) by file name; a book with only audio gets a text cover made from its title. Books with video or audio show a type badge in the top-right corner of the cover.

### Bookmarks

- **Hold `F` or `Enter`** to add a bookmark at the centre of the screen. A ring fills up while you hold, so you can see what is happening; let go early and it counts as a tap.
- **Tap `F` or `Enter`** to jump to the next bookmark. After the last one it wraps to the first. Add `Shift` to go backwards.
- **Hold `Shift+F` or `Shift+Enter`** to add a section bookmark (see below).
- **Right click** the page to open the bookmark panel at the mouse, with the **Add bookmark** button right under the pointer and **Add section bookmark** below it. The bookmark nearest your reading position is highlighted like a hovered one. Click a bookmark to jump there and close the panel; hovering does nothing. **Esc** or a click outside closes it without moving.

Bookmarks are stored with a small picture of the page and follow the file, not the scroll position, so they survive re-sorting.

**Video and audio bookmarks**: when there is a current media (the one playing, or the one nearest the centre), holding `F` / `Enter`, **Add bookmark** in the panel, or the bookmark button on the player adds a bookmark at its current time; if that media already has a bookmark within 2 seconds you get a hint instead. Tapping `F` / `Enter` onto a media bookmark scrolls that media to the centre and seeks to the bookmark; with autoplay on it plays from there, otherwise it stays on that frame. In bookmark lists, video and audio bookmarks carry a type badge and their time; a video bookmark's picture is the frame at that moment (taken straight from the player when you add it there, otherwise captured in the background once it shows up in a list, and saved), while audio bookmarks show a small tile with an icon and the file name and can't be used as a cover. The seek bar shows all of the file's bookmarks at their times: hover for the time, click to jump there.

**PotPlayer bookmarks**: PotPlayer bookmark files (`.pbf`) next to videos or audio are imported too. A `.pbf` pairs with the media file of the same base name in the same folder (`X.flac` with `X.pbf`, or `X.flac.pbf`; if several media files share that base name it is skipped), and media dropped on their own pair only with `.pbf` files dropped together with them; a `.pbf` is never a page. Imported bookmarks join the bookmark list like any other and keep their PotPlayer names (shown in tooltips and full-screen bookmarks, and searchable). The `.pbf` is read in the background when idle; after that, the usual folder checks (on opening, on returning to the window, on manual refresh) only compare its size and modification time and re-read it when it changed, merging the changes: new entries are added, renamed ones get the new name, and anything less than 1 second from an existing bookmark is not added again. Entries deleted in PotPlayer stay in MangaView, and bookmarks you delete in MangaView are not brought back. Nothing is captured at import; a video bookmark's picture is made when it first shows up in a bookmark list.

**Section bookmarks**: a section bookmark pairs with a bookmark before it, and the stretch between them is a bookmark section. It is added at the centre of the screen: if that spot is inside a section, the section's end moves there; otherwise it pairs with the nearest thing before it, either a section (whose end is extended) or a bookmark that is not inside any section (which starts a new section). With nothing before it you only get a hint. An end less than half a screen from its start counts as "already a bookmark here". Sections never nest or cross, and you can still add ordinary bookmarks inside a section; they don't take part in pairing. A section bookmark doesn't count as a bookmark and isn't a stop for tapping `F` / `Enter`. In bookmark lists it is a smaller picture in the bottom-left corner of its start's thumbnail; the start and the section bookmark carry matching marks, hovering either highlights both, clicking either jumps to it, and the small picture has its own delete button. Deleting a section bookmark turns its start back into an ordinary bookmark; deleting the start deletes its section bookmark too. If re-sorting puts the section bookmark before its start, the section is set aside (greyed out, not drawn) but kept, and comes back when the order does. For video and audio, a section bookmark pairs by time within the same file only (at the current play time; less than 2 seconds from its start counts as "already a bookmark here"), and the player has an **Add section bookmark** button too; image and media bookmarks never pair with each other. On the seek bar the start and the section bookmark are a pair of brackets, and hovering or focusing either highlights the section between them along with the times of both ends.

**Play bookmark sections only**: a toggle on the control bar, remembered and synced across windows. When on, only a media's bookmark sections play: it starts at the first section after the current time, jumps to the next section at the end of each one, and counts as finished after the last, at which point play order and loop decide what comes next; media without sections are skipped when moving on automatically (playing one yourself plays all of it). Dragging outside the sections plays on normally, and section jumps resume once a later section is reached. The seek bar shows the sections and dims everything else. In a book without any sections the toggle still turns on, with the hint "This book has no bookmark sections".

**Shelf bookmarks**: works like the thumbnail strip. It gathers the bookmarks of every book on the shelf, in shelf order (not the library or missing books; with shelf filters active, only the filtered books; if that leaves it empty, it suggests clearing or changing the filters). It isn't pinned by default: rest the mouse at the left edge and it pops out over the page, then fades out when the mouse leaves (turn this off in **Settings → Reading**). The **Shelf bookmarks** button in the toolbar pins it on the left, and the page narrows to make room; drag the list's right edge to resize it. Hovering does nothing; click a bookmark to jump there, opening its book if needed. The list is compact: one group of thumbnails per book (the current book's group is highlighted, and the bookmark nearest your reading position is highlighted like a hovered one), with no titles or file names. When you switch books, jump to a bookmark or the list pops out, it scrolls to the current book's bookmarks (it stays put if the current book has none, and never scrolls while the mouse is over it or right after you scrolled it yourself). The full-width button at its top opens full-screen shelf bookmarks. While the list is pinned, tapping `F` / `Enter` (`Shift` for backwards) follows it too: after the last bookmark in the current book it moves on to the next book, and wraps back to the start at the end. A book in the library still cycles through its own bookmarks.

**Focus mode** (on by default, turn it off in **Settings → Reading**): when the mouse isn't over them and they don't have keyboard focus, the pinned shelf bookmark list and thumbnail strip hide their content but keep their space, on the same background as the page, so there is less to distract you. Move the mouse over them to bring the content back. Showing and hiding fade with a short delay, so sweeping the mouse past them does not flicker.

### Thumbnail strip

Rest the mouse at the right edge to pop it out over the page. It closes when the mouse leaves (turn this off in **Settings → Reading**). The thumbnail button in the toolbar pins it instead: pinned, it sits beside the page and the page narrows so nothing is covered. Drag its left edge to resize it. Its top row is a full-width **Full screen** button that also shows the page count.

Pages with bookmarks show a bookmark badge in the top-right corner of their thumbnail (with a count when a page has several; section starts and section bookmarks use their matching marks), and thin marks on the left edge at each bookmark's position in the page: a short line for a bookmark, and a pair of brackets for a section's start and its section bookmark. Point at a page with either end and both ends light up. Adding or deleting a bookmark only redraws the pages it touches.

Thumbnails are cached in memory for the session (up to 64 MB, never written to disk). Opening full-screen thumbnails again for the same book, or coming back from another book, doesn't read the images again until you close the app.

**Full-screen thumbnails**: the button at the top of the strip, or `V` / `]`, opens an overview of the whole book; press it again or `Esc` to close. Pages sit in a regular grid by default; the button in the title row switches to a masonry layout that follows each page's proportions (both full-screen views share this choice). A wide scrollbar on the right makes long books quick to skim. The current page is selected and keeps an outline (without shrinking, so it stays distinct from the moving selection); `A` `D` / `←` `→` move in page order, `W` `S` / `↑` `↓` move within a column, and `Page Up` / `Page Down`, `Home` / `End` also work. Click a thumbnail, or press `Space` / `Enter`, to jump to the top of that page and close the overview. Pages with bookmarks carry the same badges; selecting (hovering or using the keyboard) a page with a section start or section bookmark outlines every page the section covers, until you move on.

**Searching the full-screen views**: both full-screen views have a search box in the title row. Results narrow as you type, and the keyboard moves only through the results. Full-screen thumbnails match file names (and the volume folder names of a joined book); full-screen shelf bookmarks match book titles and the file names the bookmarks are on, and a matching title shows all of that book's bookmarks. Next to the search box, three toggles (images / videos / audio) show only the chosen types; pick any number, or none for all (full-screen shelf bookmarks go by the type of the page each bookmark is on). The view still opens on the current content; `/` or `Ctrl+F` jumps to the search box, and `Esc` in the box first clears it and returns to the list, then closes the view. With no results you get "No matching items" and a link that clears the search (and the type toggles). The search and types last only while the view is open and don't affect previous / next book or bookmark jumps.

**Full-screen shelf bookmarks**: the button at the top of the shelf bookmark list, or `C` / `[`, shows every shelf bookmark full screen, grouped by book with the book title as a heading (the current book is highlighted). It switches between grid and masonry in the same way. The bookmark nearest your current position is selected; `A` `D` / `←` `→` move in order, `W` `S` / `↑` `↓` move to the nearest bookmark in the row above or below. Click or `Space` / `Enter` jumps to it, switching books if needed. Pressing `V` / `]` or `C` / `[` in one full-screen view switches to the other.

Both full-screen views have a bookshelf button in the title row (or press `B`): the bookshelf opens on top and the full-screen view stays open underneath. Switching books in the bookshelf switches full-screen thumbnails to the new book; closing the bookshelf returns to the full-screen view. A full-screen view closes only when you jump to a page / bookmark or close it yourself.

### Sorting

In **Sort**, choose **This folder / book** to set an order for the current book only, or **Default for all folders** to change the default. **Use default** removes a book's own setting. Choosing shuffle reshuffles every time you pick it, but reopening a book keeps its shuffled order. Time-based sorting reads file modification times on demand. Re-import a folder to refresh those times.

### Refreshing folders

MangaView checks your folders for added or removed files in three cases (the first can be turned off in **Settings**):

- each time the app opens or the page is reloaded, it checks the current book first, then works through every other folder it still has access to, one at a time in the background while the browser is idle, so reading isn't slowed down; with several windows open, only one of them checks the other folders, once;
- when you switch back to the window, it checks the current book;
- when you press a **Refresh** button (next to **Bookshelf** in the toolbar, and on the shelf), it checks everything. A manual refresh can also ask for access to the current book again.

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
- When one window deletes a book, other windows reading it say so and move on to the next book; the record is not written back.
- Settings (everything in the settings panel, the language, the default sort, volume and mute, play order, loop, play bookmark sections only, and the control bar's play mode, scroll speed, playback speed, single file and continue across books) apply to all windows at once. Layout (pinned thumbnail strip or shelf bookmarks, widths, list styles) is separate for each window; the last change is used the next time you open the app.
- Each window has its own current book and reading position; for the same book, the position saved last wins. A video or audio file can move to a small window of its own with **Play in a new window**.
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
| `src/app.mjs` | Core logic: books, importing (including import as one book), sorting, refresh, keyboard, restoring defaults; installs the feature modules |
| `src/core/control.mjs` | Control bar play modes, speed ranges and steps, which buttons each mode disables |
| `src/core/lang.mjs` | Built-in translations |
| `src/core/match.mjs` | Matching missing books (volume by volume) to folders, tag colours |
| `src/core/merge.mjs` | Field-by-field / entry-by-entry merging when several windows save the same book |
| `src/core/model.mjs` | Page types, sorting and layout math |
| `src/core/playlist.mjs` | Rules for play order, loop and playing bookmark sections only; new-window address and size |
| `src/core/sections.mjs` | Pairing rules for section bookmarks |
| `src/core/sources.mjs` | Folder scanning and file access, books and their source folders (volumes) |
| `src/core/store.mjs` | IndexedDB storage |
| `src/core/windows.mjs` | Coordination between windows: change notices, background disk work in one window only, reloading after global operations |
| `src/marks/bookmarks.mjs`, `src/marks/bookmarks.css` | Bookmarks, bookmark panel, shelf bookmark list |
| `src/marks/pbf.mjs` | PotPlayer bookmarks (.pbf): parsing, merging and background reading |
| `src/media/media.mjs`, `src/media/media.css` | Video and audio: player and controls, current media, autoplay, shared volume, media keys, play order and loop, play position memory, play in a new window, the control bar's media driver |
| `src/panels/help.mjs`, `src/panels/help.css` | Keyboard and mouse map (left hand, right hand and mouse) |
| `src/panels/settings.mjs`, `src/panels/backup.mjs`, `src/panels/settings.css` | Settings panel, export and import |
| `src/reader/controlbar.mjs`, `src/reader/controlbar-dial.mjs`, `src/reader/controlbar.css` | Bottom control bar, speed and volume pop-up panels |
| `src/reader/focus.mjs`, `src/reader/focus.css` | Focus mode |
| `src/reader/overview.mjs`, `src/reader/overview.css` | Full-screen thumbnails and shelf bookmarks (grid / masonry, search) |
| `src/reader/thumbs.mjs` | Compressed thumbnails (covers, bookmarks), video frames and video thumbnails, session cache of page thumbnails |
| `src/reader/toolbar.mjs`, `src/reader/toolbar.css` | Top toolbar |
| `src/reader/transport.mjs` | Control state (play mode, speeds, toggles) and running (the big play button) |
| `src/reader/view.mjs` | Virtualized reader, thumbnail strip, image loading queue |
| `src/shelf/cover.mjs` | Custom covers |
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
- a large video library on a real hard drive (disk use when opening, seeking and making video thumbnails), how videos look while dragging a real window edge, and real video fullscreen.

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
