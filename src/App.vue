<script setup lang="ts">
import {useDropzone} from "vue3-dropzone";
import {computed, watch, ref} from "vue";
import type {Ref} from 'vue'
import {AppFullscreen, debounce} from 'quasar'

let rightDrawerOpen = ref(true)
let rightDrawerOpenWhenHide = ref(true)
let rightDrawerUse = ref(true)

watch([rightDrawerOpen, rightDrawerOpenWhenHide], () => {
  if (rightDrawerOpen.value || (!rightDrawerOpen.value && rightDrawerOpenWhenHide.value))
    rightDrawerUse.value = true
  else
    rightDrawerUse.value = false
})
const default_book='My Book'
let folders: Ref<{ [key: string]: Map<string, any> }> = ref({[default_book]: new Map()})
let files = computed(() => {
  return folders.value[tab.value]
})
let books = computed(() => {
  let list = []
  for (let i in folders.value) {
    list.push(i)
  }
  return list
})
let tab = ref(default_book)
watch(tab, () => {
  scroll_top()
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

function scroll_top() {
  scrollArea.value.scrollTop = 0
  scrollArea2.value.scrollTop = 0
}

enum targetType {header, main, thumbnail}

let mouseTarget: Ref<targetType> = ref(targetType.main)

watch(mouseTarget, () => {
  if (mouseTarget.value == targetType.main)
    rightDrawerOpenWhenHide.value = false

})

function scroll_end() {
  scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  scrollArea2.value.scrollTop = scrollArea2.value.scrollHeight
}

function scroll_px(px: number = 2) {
  scrollArea.value.scrollTop += px
}

let showDragInput = ref(false)
const {getRootProps, getInputProps, open} = useDropzone({multiple: true, accept: 'image/*', onDrop});

function dragenter(e: any) {
  showDragInput.value = true
}

function onDrop(acceptFiles: File[]) {
  showDragInput.value = false
  folders.value[default_book] = new Map()
  let lastFolder = default_book
  acceptFiles.forEach((v: any) => {
    let p = v.path.split('/')
    lastFolder = p.length > 1 ? p[p.length - 2] : default_book
    if (!folders.value[lastFolder]) folders.value[lastFolder] = new Map()
    folders.value[lastFolder].set(v.name, v)
  })
  tab.value = lastFolder
}

let ImageUrls: { [key: string]: string } = {}

function createUrl(file: any) {
  if (!file) return './img-default.png'
  return ImageUrls[file.path] || (ImageUrls[file.path] = URL.createObjectURL(file))
}

let showHeader = ref(true)
let scroll = (e: MouseEvent) => {
  e.preventDefault()
  scrollSync()
}

let scrollSync = (e?: any) => {
  let clientHeight = scrollArea.value.clientHeight
  let clientHeight2 = scrollArea2.value.clientHeight
  if (mouseTarget.value == targetType.main) {
    scrollArea2.value.scrollTop = scrollArea2.value.scrollHeight * (scrollArea.value.scrollTop + clientHeight / 2) / scrollArea.value.scrollHeight - clientHeight2 / 2
  } else if (mouseTarget.value == targetType.thumbnail && e) {
    let y = e.layerY
    scrollArea.value.scrollTop = scrollArea.value.scrollHeight * (scrollArea2.value.scrollTop + y) / scrollArea2.value.scrollHeight - clientHeight / 2
  }
}

let scrollArea = ref({} as Element)
let scrollArea2 = ref({} as Element)

function refresh() {
  location.reload()
}

let fitWidth = ref(true);
</script>

<template>
  <q-layout view="hHh lpR fFf" class="column full-height bg-grey-8 text-grey-1"
            @dragenter="dragenter" @keydown.shift.space="scroll_px(20-scrollArea.clientHeight)"
            @keydown.space.exact="scroll_px(scrollArea.clientHeight-20)"
            @mousemove="checkShowHeader"
            style="z-index: 0">
    <q-header reveal height-hint="98" v-model="showHeader"
              @mouseenter="mouseTarget=targetType.header" @mousemove="targetType.header">
      <q-toolbar class="bg-grey-9">
        <q-btn stretch flat icon="folder_open" @click="open"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat icon="refresh" @click="refresh"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat icon="help_outline" href="https://github.com/NOHNOLIFE/mangaview" type="a" target="_blank"/>
        <div class="col text-center full-height">
          <q-btn class="bg-primary text-grey-1 ellipsis overflow-hidden" align="left" flat :label="tab"
                 style="width: 100%">
            <q-menu fit anchor="bottom middle" self="top middle" square>
              <q-list class="bg-blue-grey-10">
                <q-item v-for="n in books" v-close-popup clickable class="bg-blue-grey-10 text-grey-1 relative-position"
                        @click="tab=n" v-ripple.early>
                  <q-item-section thumbnail>
                    <img :src="createUrl(folders[n].values().next().value)">
                  </q-item-section>
                  <q-item-section side top>
                    <q-badge color="primary" :label="folders[n].size+' P'"/>
                    <q-icon v-if="n===tab" name="gps_fixed" color="green" class="q-mt-md"/>
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ n }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
        <q-btn stretch flat icon="fa-solid fa-arrows-left-right" @click="fitWidth=!fitWidth"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat icon="open_in_full" @click="AppFullscreen.toggle()"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat icon="menu" @click="rightDrawerOpen=rightDrawerOpenWhenHide=!rightDrawerUse"/>
      </q-toolbar>
    </q-header>
    <q-page-container class="col column">
      <div class="col column relative-position" @mousemove="mouseTarget=targetType.main"
           @mouseenter="mouseTarget=targetType.main">
        <div class="main col scroll-y text-center smooth" :class="{'fit-width':fitWidth}"
             @scroll="scroll" ref="scrollArea" style=" direction: rtl">
          <div class="up-page control" @click="scroll_top" v-ripple.early="{ color: 'dark' }">
            <q-icon name="fa-solid fa-circle-up"/>
          </div>
          <div class="down-page control" @click="scroll_end" v-ripple.early="{ color: 'dark' }">
            <q-icon name="fa-solid fa-circle-down"/>
          </div>
          <div v-if="files.size===0" class="text-h4 q-pa-lg absolute-center" style="direction: ltr">Drag and drop folders here<br><br>请拖拽文件夹到此处<br><br>フォルダをドラッグ＆<br>ドロップしてしてください
          </div>
          <div class="relative-position">
            <div class="left-page control" @click="scroll_px(0+70-scrollArea.clientHeight)" v-ripple.early="{ color: 'dark' }"></div>
            <div class="right-page control" @click="scroll_px(scrollArea.clientHeight-20)" v-ripple.early="{ color: 'dark' }"></div>
            <img v-for="(i,ii) in files.values()" :src="createUrl(i)" :alt="i.name" :id="ii.toString()"
                 draggable="false" loading="lazy"/>
          </div>
        </div>
      </div>
    </q-page-container>
    <q-drawer show-if-above v-model="rightDrawerUse" side="right" width="323" class="text-center" bordered dark
              :overlay="!rightDrawerOpen">
      <div class="thumbnail bg-grey-8 full-height scroll-y" ref="scrollArea2" @click.prevent="scrollSync"
           @mousemove="mouseTarget=targetType.thumbnail" @mouseenter="mouseTarget=targetType.thumbnail">
        <a v-for="(i,ii) in files.values()" draggable="false">
          <img :src="createUrl(i)" :alt="i.name" :id="'t-'+ii.toString()" draggable="false" width="300"
               loading="lazy"/>
        </a>
      </div>
    </q-drawer>
  </q-layout>
  <div id="drag-input" :class="[showDragInput&&'show']" v-bind="getRootProps()">
    <input v-bind="getInputProps()" accept="image/*" webkitdirectory multiple/>
  </div>
</template>

<style lang="scss" scoped>
#drag-input {
  position: absolute;
  z-index: 999;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  opacity: 0.3;
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
</style>
