<script setup lang="ts">
import {useDropzone} from "vue3-dropzone";
import {computed, watch, ref} from "vue";
import type {Ref} from 'vue'
import {AppFullscreen, debounce} from 'quasar'

let leftDrawerOpen = ref(false)
let folders: Ref<{ [key: string]: Map<string, any> }> = ref({'manga': new Map()})
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
let tab = ref('manga')
watch(tab, () => {
  scroll_top()
})

function scroll_top() {
  scrollArea.value.scrollTop = 0
  scrollArea2.value.scrollTop = 0
}

function scroll_end() {
  scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  scrollArea2.value.scrollTop = scrollArea2.value.scrollHeight
}

function scroll_px(px: number = 2) {
  scrollArea.value.scrollTop+=px
}

let showDragInput = ref(false)
const {getRootProps, getInputProps} = useDropzone({multiple: true, onDrop});

function dragenter(e: any) {
  showDragInput.value = true
}

function onDrop(acceptFiles: File[]) {
  showDragInput.value = false
  folders.value['manga'] = new Map()
  let lastFolder = 'manga'
  acceptFiles.forEach((v: any) => {
    lastFolder = v.path.split('/')[1] || 'manga'
    if (!folders.value[lastFolder]) folders.value[lastFolder] = new Map()
    folders.value[lastFolder].set(v.name, v)
  })
  tab.value = lastFolder
}

let ImageUrls: { [key: string]: string } = {}

function createUrl(file: any[]) {
  return ImageUrls[file[1].path] || (ImageUrls[file[1].path] = URL.createObjectURL(file[1]))
}

let showHeader = ref(true)
let scrollVal = 0
let scroll = debounce((v: any) => {
  if (showHeader && v - scrollVal > 60) {
    showHeader.value = false
  } else if (v - scrollVal < -60) {
    showHeader.value = true
  }
  scrollVal = v
  scrollSync()
}, 200)

let scrollSync = (revert?: boolean) => {
  if (!revert) {
    scrollArea2.value.scrollTop = (scrollArea2.value.scrollHeight - scrollArea2.value.clientHeight)
        * scrollArea.value.scrollTop / (scrollArea.value.scrollHeight - scrollArea.value.clientHeight)
  } else {
    scrollArea.value.scrollTop = (scrollArea.value.scrollHeight - scrollArea.value.clientHeight)
        * scrollArea2.value.scrollTop / (scrollArea2.value.scrollHeight - scrollArea2.value.clientHeight)
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
            @dragenter="dragenter"  @keydown.shift.space="scroll_px(0+70-scrollArea.clientHeight)"  @keydown.space.exact="scroll_px(scrollArea.clientHeight-20)"
            style="z-index: 0">
    <q-header reveal height-hint="98" v-model="showHeader">
      <q-toolbar class="bg-grey-9">
        <q-btn stretch flat icon="refresh" @click="refresh"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat icon="open_in_full" @click="AppFullscreen.request()"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat icon="fa-solid fa-arrows-left-right" @click="fitWidth=!fitWidth"/>
        <div class="col text-right full-height">
          <q-btn-dropdown class="bg-primary text-grey-1 ellipsis" stretch flat :label="tab" style="max-width: 100%"
                          align="left">
            <q-list>
              <q-item v-for="n in books" clickable v-close-popup tabindex="0" class="bg-blue-grey-10 text-grey-1">
                <q-item-section>
                  <q-item-label @click="tab=n">{{ n }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
        <q-btn stretch flat icon="menu" @click="leftDrawerOpen = !leftDrawerOpen"/>
      </q-toolbar>
    </q-header>
    <q-page-container class="col column">
      <div class="col column relative-position">
        <div class="left-page control" @click="scroll_px(0+70-scrollArea.clientHeight)"><q-icon name="fa-solid fa-circle-left"/></div>
        <div class="right-page control" @click="scroll_px(scrollArea.clientHeight-20)"><q-icon name="fa-solid fa-circle-right"/></div>
        <div class="up-page control" @click="scroll_top"><q-icon name="fa-solid fa-circle-up"/></div>
        <div class="down-page control" @click="scroll_end"><q-icon name="fa-solid fa-circle-down"/></div>
      <div class="main col scroll-y smooth text-center relative-position" :class="{'fit-width':fitWidth}" v-scroll="scroll" ref="scrollArea">
        <img v-for="(i,ii) in files" :src="createUrl(i)" :alt="i[1].name" :id="ii.toString()" draggable="false" loading="lazy"/>
        <div v-if="files.size===0" class="text-h5 q-pa-lg">drop folder or image files to this page</div>
      </div>
      </div>
    </q-page-container>
    <q-drawer show-if-above v-model="leftDrawerOpen" side="right" width="323" class="text-center" bordered>
      <div class="thumbnail bg-grey-8 smooth full-height scroll-y" ref="scrollArea2">
        <a v-for="(i,ii) in files" draggable="false" @click.stop="scrollSync(true)">
          <img :src="createUrl(i)" :alt="i[1].name" :id="'t-'+ii.toString()" draggable="false" width="300"
               loading="lazy"/>
        </a>
      </div>
    </q-drawer>
  </q-layout>
  <div id="drag-input" :class="[showDragInput&&'show']" v-bind="getRootProps()">
    <input v-bind="getInputProps()"/>
  </div>
</template>

<style lang="scss" scoped>
#drag-input {
  position: absolute;
  z-index: 99999;
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
  > img {
    display: inline-block;
    max-width: 100%;
    width: auto;
  }

  &.fit-width > img {
    width: 100%;
  }
}

.thumbnail {
  img {
    cursor: pointer;
  }
}

.control{
  display: inline-block;
  position: absolute;
  z-index: 9;
  text-align: center;
  padding: 30px 8%;
  right: 22px;
  cursor: pointer;
  &.up-page{
    top: 0;
    left: 0;
  }
  &.down-page{
    bottom: 0;
    left: 0;
  }
  &.left-page{
    z-index: 10;
    top: 0;
    left: 0;
    width: fit-content;
    opacity: 0;
    height: 100%;
    >i{
      top: 50%;
      transform:translateY(-50%);
    }
  }
  &.right-page{
    z-index: 10;
    top: 0;
    height: 100%;
    opacity: 0;
    >i{
      top: 50%;
      transform:translateY(-50%);
    }
  }
  >i{
    position: relative;
    z-index: 1;
    color: #1abfff;
    font-size: 70px;
    opacity: 0;
    &:after{
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
  &:hover>i{
    opacity: 0.2;
  }
}
</style>
