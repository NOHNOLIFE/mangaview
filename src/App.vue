<script setup lang="ts">
import {useDropzone} from "vue3-dropzone";
import {computed, createElementBlock, ref} from "vue";
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
let scroll = (v: any) => {
  if (v - scrollVal > 0) {
    showHeader.value = false
  } else if (v - scrollVal < 0) {
    showHeader.value = true
  }
  scrollVal = v
  scrollSync()
}

let scrollSync = debounce(() => {
  if (scrollArea.value && scrollArea2.value) {
    (scrollArea2.value as Element).scrollTop = ((scrollArea2.value as Element).scrollHeight - (scrollArea2.value as Element).clientHeight)
        * (scrollArea.value as Element).scrollTop / ((scrollArea.value as Element).scrollHeight - (scrollArea.value as Element).clientHeight)
  }
}, 200)

let scrollArea = ref(null)
let scrollArea2 = ref(null)

function refresh() {
  location.reload()
}

let fitWidth = ref(true);
</script>

<template>
  <q-layout view="hHh lpR fFf" class="column full-height bg-grey-8 text-grey-1" @dragenter="dragenter"
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
      <div class="main col scroll-y smooth text-center" :class="{'fit-width':fitWidth}" v-scroll="scroll"
           ref="scrollArea">
        <img v-for="(i,ii) in files" :src="createUrl(i)" :alt="i[1].name" :id="ii.toString()" draggable="false"
             loading="lazy"/>
        <div v-if="files.size===0" class="text-h5 q-pa-lg">drop folder or image files to this page</div>
      </div>
    </q-page-container>
    <q-drawer show-if-above v-model="leftDrawerOpen" side="right" bordered>
      <div class="thumbnail bg-grey-8 smooth full-height scroll-y" ref="scrollArea2">
        <a v-for="(i,ii) in files" :href="'#'+ii" draggable="false">
          <img :src="createUrl(i)" :alt="i[1].name" :id="'t-'+ii.toString()" draggable="false" width="280"
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

  }
}
</style>
