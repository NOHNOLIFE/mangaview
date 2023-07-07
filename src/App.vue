<script setup lang="ts">
import {useDropzone} from "vue3-dropzone";
import {computed, watch, ref, nextTick} from "vue";
import type {Ref} from 'vue'
import {AppFullscreen, copyToClipboard} from 'quasar'

let rightDrawerOpen = ref(true)
let rightDrawerOpenWhenHide = ref(true)
let rightDrawerUse = ref(false)

watch([rightDrawerOpen, rightDrawerOpenWhenHide], () => {
  if (rightDrawerOpen.value || (!rightDrawerOpen.value && rightDrawerOpenWhenHide.value))
    rightDrawerUse.value = true
  else
    rightDrawerUse.value = false
})
const default_book = 'My Book'

let showDefaultBook = computed(v => {
  return folders.value[default_book].size > 0
})

let folders: Ref<any> = ref({[default_book]: {}})
let files = computed(() => {
  let o = folders.value[tab.value] || {}
  let list = Object.keys(o).map(v => o[v])
  list.sort((a, b) => {
    let x = a.name.replace(/(\.\w+)$/, '').padStart(9)
    let y = b.name.replace(/(\.\w+)$/, '').padStart(9)
    return x - y
  })
  return list
})
let books = computed(() => {
  let list = []
  for (let i in folders.value) {
    if (i === default_book) {
      showDefaultBook.value && list.push(i)
    } else {
      list.push(i)
    }
  }
  if (filter.value.key) {
    list = list.filter(v => v.toLowerCase().includes((filter.value.key || '').toLowerCase()))
  }
  if (filter.value.minP) {
    list = list.filter(v => Object.keys(folders.value[v]).length >= (filter.value.minP || 0))
  }
  if (filter.value.maxP) {
    list = list.filter(v => Object.keys(folders.value[v]).length <= (filter.value.maxP || 1))
  }
  return list
})
let filter = ref({
  key: null,
  minP: null,
  maxP: null,
})

let tab = ref(default_book)
let tabIndex = computed(v => books.value.indexOf(tab.value))
watch(tab, () => {
  scroll_top(true)
})

function checkShowHeader(e: any) {
  if (e.clientY < 100) {
    showHeader.value = true
  } else {
    showHeader.value = false
  }
  if (e.view.innerWidth - e.clientX < 100 && !showHeader.value) {
    rightDrawerOpenWhenHide.value = true
  }
}

enum targetType {header, main, thumbnail}

let mouseTarget: Ref<targetType> = ref(targetType.main)

watch(mouseTarget, () => {
  if (mouseTarget.value == targetType.main)
    rightDrawerOpenWhenHide.value = false
})

function scroll_top(noChangeBook: boolean) {
  if (scrollArea.scrollTop <= 10 && !noChangeBook) {
    prevBook()
  } else {
    scrollArea.scrollTop = 0
    scrollArea2.scrollTop = 0
  }
}

function scroll_end() {
  if (scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight <= 10) {
    nextBook()
  } else {
    scrollArea.scrollTop = scrollArea.scrollHeight
    scrollArea2.scrollTop = scrollArea2.scrollHeight
  }
}

function scroll_up() {
  scroll_px(100 - scrollArea.clientHeight)
}

function scroll_down() {
  scroll_px(scrollArea.clientHeight - 100)
}

function scroll_px(px: number = 1) {
  scrollArea.scrollTop += px
}

let oldItv: number = 0
let ItvNum = 0

function holdingScroll(step: any = 1) {
  // 100/3 ms once trigger
  ItvNum = 1000
  oldItv = oldItv || setInterval(() => {
    scroll_px(step)
    if (!--ItvNum) {
      clearInterval(oldItv)
      oldItv = 0
    }
  }, 1)
}

function endHolding() {
  clearInterval(oldItv)
  oldItv = 0
  ItvNum = 0
}

let mouseDown = false
let dragScroll = ref(false)
let dragAreaTop = 0
let dragScrollY = 0
let dragScrollTarget = 'main'

function dragScrollStart(e: any, isPrev: Boolean = false) {
  mouseDown = true
  dragScrollTarget = isPrev ? 'prev' : 'main'
  dragAreaTop = isPrev ? scrollArea2.scrollTop : scrollArea.scrollTop
  dragScrollY = e.screenY
  e.stopPropagation()
}

function dragScrollEnd() {
  mouseDown = false
  dragScroll.value = false
  dragScrollTarget = 'main'
  dragAreaTop = 0
  dragScrollY = 0
}

function mouseMove(e: any) {
  if (dwChange.value) {
    let offsetX = e.screenX - dwChangeX
    drawerWidth.value = dwChangeW - offsetX
    localStorage.setItem('drawerWidth', drawerWidth.value.toString())
  } else if (mouseDown && Math.abs(e.screenY - dragScrollY) > 0) {
    dragScroll.value = true
    let offsetX = dragScrollY - e.screenY
    if (dragScrollTarget === 'main') {
      scrollArea.scrollTop = dragAreaTop + offsetX
    } else {
      scrollArea2.scrollTop = dragAreaTop + offsetX
    }
  } else {
    checkShowHeader(e)
  }
}

let showDragInput = ref(false)
const {getRootProps, getInputProps, open} = useDropzone({multiple: true, accept: 'image/*', onDrop});

function dragenter(e: any) {
  showDragInput.value = true
}

//start
function onDrop(acceptFiles: File[]) {
  showDragInput.value = false
  folders.value[default_book] = {}
  let lastFolder = default_book

  let oldFolders = {...folders.value}
  let newFolders: any = {}

  lastFolder = default_book
  acceptFiles.forEach((v: any) => {
    let p = v.path.split('/')
    lastFolder = p.length > 1 ? p[p.length - 2] : default_book
    if (oldFolders[lastFolder]) {
      delete oldFolders[lastFolder]
    }
    if (!newFolders[lastFolder]) {
      newFolders[lastFolder] = {}
    }
    newFolders[lastFolder][v.name] = v
  })
  folders.value = {...newFolders, ...oldFolders}
  tab.value = Object.keys(folders.value)[0] || default_book
  console.log(tab.value)
}

let ImageUrls: { [key: string]: string } = {}

function createUrl(file: any) {
  if (!file) return './img-default.png'
  return ImageUrls[file.path] || (ImageUrls[file.path] = URL.createObjectURL(file))
}

let showHeader = ref(true)
let scroll = (e: MouseEvent) => {
  showHeader.value = false
  e.preventDefault()
  scrollSync()
}

let scrollSync = (e?: any) => {
  let clientHeight = scrollArea.clientHeight
  let clientHeight2 = scrollArea2.clientHeight
  if (mouseTarget.value == targetType.main) {
    scrollArea2.scrollTop = scrollArea2.scrollHeight * (scrollArea.scrollTop + clientHeight / 2) / scrollArea.scrollHeight - clientHeight2 / 2
  } else if (mouseTarget.value == targetType.thumbnail && e) {
    let y = e.layerY
    scrollArea.scrollTop = scrollArea.scrollHeight * (scrollArea2.scrollTop + y) / scrollArea2.scrollHeight - clientHeight / 2
  }
}

function removeBook(name: any = tab.value) {
  if (name !== tab.value) {
    delete folders.value[name]
  } else {
    let idx = tabIndex.value
    idx = idx === (books.value.length - 1) ? idx - 1 : idx + 1
    if (idx < 0) {
      tab.value = default_book
    } else {
      tab.value = books.value[idx]
    }
    delete folders.value[name]
  }
}

function refresh() {
  location.reload()
}

function prevBook() {
  if (tabIndex.value > 0) {
    tab.value = books.value[tabIndex.value - 1]
  } else {
    tab.value = books.value[books.value.length - 1]
  }
}

function nextBook() {
  if (tabIndex.value < books.value.length - 1) {
    tab.value = books.value[tabIndex.value + 1]
  } else {
    tab.value = books.value[0]
  }
}

let fitWidth = ref(true)

function showMenuBook() {
  let dom = document.getElementById('my-book-' + tabIndex.value)
  dom && dom.scrollIntoView({block: "center"})
}

function toggleDrawer() {
  rightDrawerOpen.value = rightDrawerOpenWhenHide.value = !rightDrawerUse.value
}

let drawerWidth = ref(Number(localStorage.getItem('drawerWidth') || ((window.innerWidth / 4) > 280 ? 280 : window.innerWidth / 4)))
let dwChange = ref(false)
let dwChangeW = 0
let dwChangeX = 0

function dwStartChange(e: any) {
  dwChange.value = true
  dwChangeW = drawerWidth.value
  dwChangeX = e.screenX
}

function mobileToggleMenu() {
  rightDrawerUse.value = true
}

function copyBooksName() {
  let list = books.value.map(v => `".\/${v}\/"`)
  copyToClipboard(list.join('\n'))
}


let scrollArea: HTMLElement
let scrollArea2: HTMLElement
nextTick(() => {
  scrollArea = document.getElementById('scrollArea') || document.createElement('')
  scrollArea2 = document.getElementById('scrollArea2') || document.createElement('')
})
</script>

<template>
  <q-layout view="hHh lpR fFf" class="column full-height bg-grey-8 text-grey-1"
            @dragenter="dragenter"
            @keydown.shift.space="holdingScroll(-1)"
            @keyup.shift.space="endHolding()"
            @keydown.up.exact="holdingScroll(-1)"
            @keyup.up.exact="endHolding()"
            @keydown.d.exact="scroll_up()"
            @keydown.left.exact="scroll_up()"
            @keydown.space.exact="holdingScroll(2)"
            @keyup.space.exact="endHolding()"
            @keydown.enter.exact="scroll_down()"
            @keydown.f.exact="scroll_down()"
            @keydown.down.exact="holdingScroll(2)"
            @keyup.down.exact="endHolding()"
            @keydown.right.exact="scroll_down()"
            @keydown.home.exact="scroll_top()"
            @keydown.end.exact="scroll_end()"
            @keyup.page-up.exact="prevBook()"
            @keyup.page-down.exact="nextBook()"
            @keydown.delete.exact="removeBook()"
            @keydown.ctrl.c.exact="copyBooksName()"
            @mousemove="mouseMove"
            @mouseup.left="dragScrollEnd"
            style="z-index: 0">
    <q-header reveal height-hint="98" v-model="showHeader"
              @mouseenter="mouseTarget=targetType.header" @mousemove="targetType.header">
      <q-toolbar class="bg-grey-9 no-padding">
        <div class="row q-pa-sm full-width">
          <div style="min-width: fit-content">
            <q-btn flat icon="folder_open" @click="open">
              <q-tooltip>open folder</q-tooltip>
            </q-btn>
            <q-btn flat icon="refresh" @click="refresh">
              <q-tooltip>reload & empty</q-tooltip>
            </q-btn>
            <q-btn flat icon="help_outline" href="https://github.com/NOHNOLIFE/mangaview" type="a" target="_blank">
              <q-tooltip>help</q-tooltip>
            </q-btn>
          </div>
          <div class="col text-center full-height" style="flex-basis: 300px">
            <q-btn unelevated class="bg-primary text-grey-1 ellipsis overflow-hidden full-width" id="title-btn"
                   align="left" flat
                   :label="tab">
              <q-menu @dragenter="dragenter"
                      @show="showMenuBook()">
                <div>
                  <div class="bg-blue-grey-10 column" id="books"
                       style="position: fixed;left: 0;right: 0;top: 0;bottom: 0;">
                    <div class="col-auto">
                      <div class="q-pa-md bg-blue-grey-2 row q-gutter-md items-center full-width">
                        <q-input v-model="filter.key" debounce="800" dense clearable rounded standout="bg-teal text-white"
                                 placeholder="search keyword" class="col" style="min-width: 300px"/>
                        <q-input v-model="filter.minP" debounce="800" dense clearable rounded standout="bg-teal text-white"
                                 type="number" placeholder="min pages" min="0" style="flex-basis: 120px"/>
                        <q-input v-model="filter.maxP" debounce="800" dense clearable rounded standout="bg-teal text-white"
                                 type="number" placeholder="max pages" min="0" style="flex-basis: 120px"/>
                        <q-btn color="primary" icon="refresh" @click="filter={key:null,minP:null,maxP:null}">
                          <q-tooltip>reset search</q-tooltip>
                        </q-btn>
                        <q-btn color="primary" icon="close" v-close-popup>
                          <q-tooltip>home</q-tooltip>
                        </q-btn>
                      </div>
                    </div>
                    <div class="col q-pa-lg scroll-y">
                      <div class="row q-gutter-lg justify-center">
                        <q-card v-for="(n,idx) in books" flat class="my-card column relative-position"
                                :class="[n===tab?'bg-primary':'bg-transparent']"
                                @click="tab=n" v-close-popup
                                :id="'my-book-'+idx">
                          <div class="absolute-top-right cursor-pointer" style="z-index: 2">
                            <q-icon name="close" class="close-book" @click.stop.prevent="removeBook(n)"/>
                          </div>
                          <div class="img-outer row items-center cursor-pointer bg-blue-grey-10" v-ripple.early>
                            <img :src="createUrl(Object.entries(folders[n])[0][1])">
                          </div>
                          <q-card-section class="col text-white cursor-pointer book-title no-padding" v-ripple.early>
                            <div class="q-pa-sm">
                              <q-badge color="secondary" class="q-py-xs q-mr-sm"
                                       :label="Object.keys(folders[n]).length+' P'"
                                       @click.stop="copyToClipboard(n)">
                                <q-tooltip>click to copy title</q-tooltip>
                              </q-badge>
                              {{ n }}
                            </div>
                          </q-card-section>
                        </q-card>
                      </div>
                    </div>
                  </div>
                </div>
              </q-menu>
            </q-btn>
          </div>
          <div style="min-width: fit-content">
            <q-btn flat icon="fa-solid fa-backward-step" @click="prevBook()">
              <q-tooltip>previous book (Page Up)</q-tooltip>
            </q-btn>
            <q-btn flat icon="fa-solid fa-forward-step" @click="nextBook()">
              <q-tooltip>next book (Page Down)</q-tooltip>
            </q-btn>
            <q-btn flat icon="fa-solid fa-arrows-left-right" @click="fitWidth=!fitWidth">
              <q-tooltip>fit width</q-tooltip>
            </q-btn>
            <q-btn flat icon="open_in_full" @click="AppFullscreen.toggle()">
              <q-tooltip>fullscreen</q-tooltip>
            </q-btn>
            <q-btn flat icon="menu" id="pc-tool-btn" @click="toggleDrawer()">
              <q-tooltip>hide/show preview</q-tooltip>
            </q-btn>
          </div>
        </div>
      </q-toolbar>
    </q-header>
    <q-page-container class="col column">
      <q-page-sticky position="top-right" :offset="[4, 4]" style="z-index: 999" class="mobile-tool-btn"
                     @click="mobileToggleMenu()">
        <q-btn round color="primary" icon="apps"/>
      </q-page-sticky>
      <div class="col column relative-position" @mousemove="mouseTarget=targetType.main"
           @mouseenter="mouseTarget=targetType.main">
        <div class="main col scroll-y text-center smooth" :class="{'fit-width':fitWidth}"
             @scroll="scroll"
             id="scrollArea" style=" direction: rtl">
          <div @mousedown.left.capture="dragScrollStart"
               @mouseup.left="dragScrollEnd"
          >
            <div class="up-page control" @click="scroll_top()">
              <q-icon name="fa-solid fa-circle-up"/>
            </div>
            <div class="down-page control" @click="scroll_end()">
              <q-icon name="fa-solid fa-circle-down"/>
            </div>
            <div v-if="files.length===0" class="text-h4 q-pa-lg absolute-full cursor-pointer" style="direction: ltr"
                 @click="open">
              <div class="absolute-center">
                Drag and drop folders here<br><br>请拖拽文件夹到此处<br><br>フォルダをドラッグ＆<br>ドロップしてしてください
              </div>
            </div>
            <div class="relative-position">
              <div class="left-page control" @mouseup.left="!dragScroll && scroll_up()"></div>
              <div class="right-page control" @mouseup.left="!dragScroll && scroll_down()"></div>
              <img v-for="(i,ii) in files" :src="createUrl(i)" :alt="i.name" :id="ii.toString()"
                   draggable="false" loading="lazy"/>
            </div>
          </div>
        </div>
      </div>
    </q-page-container>
    <q-drawer show-if-above no-swipe-backdrop v-model="rightDrawerUse" side="right" :width="drawerWidth"
              class="row bg-grey-8"
              bordered
              dark :overlay="!rightDrawerOpen">
      <div class="thumbnail full-height scroll-y"
           id="scrollArea2"
           @mousemove="mouseTarget=targetType.thumbnail"
           @mouseenter="mouseTarget=targetType.thumbnail">
        <div @mousedown.left.capture="dragScrollStart($event,true)"
             @mouseup.left="dragScrollEnd">
          <div @mouseup.left="!dragScroll && scrollSync($event)">
            <a v-for="(i,ii) in files" draggable="false">
              <q-tooltip anchor="center left" self="center right" :offset="[0,-10]">{{ i.name }}</q-tooltip>
              <img :src="createUrl(i)" :alt="i.name" :id="'t-'+ii.toString()" draggable="false" class="full-width"
                   loading="lazy"/>
            </a>
          </div>
        </div>
      </div>
      <div style="cursor: col-resize;width: 8px;margin-left: -4px" class="absolute-left full-height"
           @mousedown.left="dwStartChange" @mouseup.left="dwChange=false"
      />
    </q-drawer>
  </q-layout>
  <div id="drag-input" :class="[showDragInput&&'show']" v-bind="getRootProps()">
    <input v-bind="getInputProps()" accept="image/*" webkitdirectory multiple/>
  </div>
</template>

<style lang="scss" scoped>

#drag-input {
  position: absolute;
  z-index: 9999;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  opacity: 0.5;
  background: #000;
  display: none;

  &.show {
    display: inline-block;
  }
}

.main {
  img {
    display: inline-block;
    max-width: 100%;
    width: auto;
    margin: -2.5px 0;
  }

  &.fit-width img {
    width: 100%;
  }
}

.thumbnail {
  a {
    display: inline-block;
  }

  img {
    cursor: pointer;
    margin: -2.5px 0;
  }
}

.control {
  display: inline-block;
  position: absolute;
  z-index: 9;
  text-align: center;
  padding: 4% 0;
  left: 22px;
  cursor: pointer;

  &.up-page {
    z-index: 11;
    top: 0;
    right: 0;
  }

  &.down-page {
    bottom: 0;
    right: 0;
    z-index: 11;
  }

  &.left-page {
    width: 50%;
    top: 0;
    left: 0;
    padding: 0;
    height: 100%;
    box-sizing: content-box;

    > i {
      top: 50%;
      transform: translateY(-50%);
    }
  }

  &.right-page {
    width: 50%;
    top: 0;
    right: 0;
    left: unset;
    padding: 0;
    height: 100%;
    box-sizing: content-box;


    > i {
      top: 50%;
      transform: translateY(-50%);
    }
  }

  > i {
    position: relative;
    z-index: 1;
    color: #1abfff;
    font-size: 70px;
    opacity: 0;

    &:after {
      z-index: -1;
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      background-color: #ace1ff;
      border-radius: 100px;
      filter: blur(1px);
    }
  }

  &:hover > i {
    opacity: 0.2;
  }
}

.my-card {
  width: 240px;
  padding: 8px;
  transition: all 0.3s ease;
  overflow: hidden;

  &:hover {
    transform: scale(1.05);

    .book-title {
      background: #17202f;
    }

    .img-outer::after {
      content: '';
      border-radius: inherit;
      position: absolute;
      background: rgba(255, 255, 255, 0.2);
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
    }
  }

  .img-outer {
    text-align: center;
    height: 300px;
    overflow-y: hidden;

    img {
      width: 100%;
    }
  }

  .close-book {
    margin-top: 10px;
    margin-right: 10px;
    font-size: 30px;
    text-shadow: 0px 0px 3px #ffffff;
    opacity: 0.5;

    &:hover {
      opacity: 1;
    }
  }
}

.mobile-tool-btn {
  display: none;
}

@media (max-width: 1000px) {
  #pc-tool-btn {
    display: none;
  }
  .mobile-tool-btn {
    display: initial;
  }
}

</style>
