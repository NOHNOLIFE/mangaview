<script setup lang="ts">
import {useDropzone} from "vue3-dropzone";
import {computed, ref} from "vue";
import type {Ref} from 'vue'
import {debounce} from 'quasar'

let leftDrawerOpen = ref(false)
let folders: Ref<{ [key: string]: Map<string, any> }> = ref({'book': new Map()})
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
let tab = ref('book')
let showDragInput = ref(false)
const {getRootProps, getInputProps} = useDropzone({multiple: true, onDrop});

function dragenter(e: any) {
  showDragInput.value = true
}

function onDrop(acceptFiles: File[]) {
  console.log(acceptFiles)
  showDragInput.value = false
  folders.value['book'] = new Map()
  let lastFolder = 'book'
  acceptFiles.forEach((v: any) => {
    lastFolder = v.path.split('/')[1] || 'book'
    if (!folders.value[lastFolder]) folders.value[lastFolder] = new Map()
    folders.value[lastFolder].set(v.name, v)
  })
  tab.value = lastFolder
}

function createUrl(file: any) {
  return URL.createObjectURL(file[1])
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
}

</script>

<template>
  <q-layout view="hHh lpR fFf" class="column full-height bg-grey-10 text-grey-1" @dragenter="dragenter"
            style="z-index: 0">
    <q-header reveal height-hint="98" v-model="showHeader">
      <q-toolbar class="bg-grey-9">
        <q-btn stretch flat label="full-screen"/>
        <q-separator dark vertical inset/>
        <q-btn stretch flat label="Link"/>
        <div class="col text-right full-height">
          <q-btn-dropdown class="bg-primary text-grey-1" stretch flat :label="tab">
            <q-list>
              <q-item v-for="n in books" clickable v-close-popup tabindex="0" class="bg-blue-grey-10 text-grey-1">
                <q-item-section>
                  <q-item-label @click="tab=n">{{ n }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
        <q-btn stretch flat icon="menu" label="preview" @click="leftDrawerOpen = !leftDrawerOpen"/>
      </q-toolbar>
    </q-header>
    <q-page-container class="col column">
      <div class="main col scroll-y smooth text-center" v-scroll="scroll">
        <img v-for="(i,ii) in files" :src="createUrl(i)" :alt="i[1].name" :id="ii">
        <div v-if="files.size===0" class="text-h5 q-pa-lg">drop folder or image files to this page</div>
      </div>
    </q-page-container>
    <q-drawer show-if-above v-model="leftDrawerOpen" side="right" bordered class="bg-grey-10">
      <div class="thumbnail">
        <a v-for="(i,ii) in files" :href="'#'+ii">
          <img :src="createUrl(i)" :alt="i[1].name">
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
    width: 100%;
  }
}

.thumbnail {
  img {
    max-width: 280px;
  }
}
</style>
