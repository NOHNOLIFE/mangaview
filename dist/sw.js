if(!self.define){let e,i={};const s=(s,n)=>(s=new URL(s+".js",n).href,i[s]||new Promise((i=>{if("document"in self){const e=document.createElement("script");e.src=s,e.onload=i,document.head.appendChild(e)}else e=s,importScripts(s),i()})).then((()=>{let e=i[s];if(!e)throw new Error(`Module ${s} didn’t register its module`);return e})));self.define=(n,r)=>{const o=e||("document"in self?document.currentScript.src:"")||location.href;if(i[o])return;let l={};const a=e=>s(e,o),c={module:{uri:o},exports:l,require:a};i[o]=Promise.all(n.map((e=>c[e]||a(e)))).then((e=>(r(...e),l)))}}define(["./workbox-3ea082d2"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"assets/fa-brands-400.3fe890d0.woff2",revision:null},{url:"assets/fa-brands-400.c7ae37d3.ttf",revision:null},{url:"assets/fa-regular-400.fdc1f753.ttf",revision:null},{url:"assets/fa-regular-400.fe69d948.woff2",revision:null},{url:"assets/fa-solid-900.6d53c706.ttf",revision:null},{url:"assets/fa-solid-900.d27bc752.woff2",revision:null},{url:"assets/fa-v4compatibility.4d73f280.ttf",revision:null},{url:"assets/fa-v4compatibility.7d1c2ce5.woff2",revision:null},{url:"assets/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.83be7b2f.woff2",revision:null},{url:"assets/HomeView.78bdb74a.js",revision:null},{url:"assets/index.7d96afe9.css",revision:null},{url:"assets/index.d92514be.js",revision:null},{url:"favicon.ico",revision:"d01d1b73214cf33ab1e8bedcbb30fb6f"},{url:"icons/icon-128.png",revision:"b5cc31bb2927d2a84c43435ac209d985"},{url:"icons/icon-256.png",revision:"ad183e1bd2f93aae1f77e7c681161078"},{url:"icons/icon-32.png",revision:"d01d1b73214cf33ab1e8bedcbb30fb6f"},{url:"icons/icon-512.png",revision:"6ef763054248aa721d0c96084bfc9e08"},{url:"icons/icon-64.png",revision:"72a63aece340d508abfa7631429babe5"},{url:"img-default.png",revision:"b71b2a9cb2b3175526b82bda38bafe1b"},{url:"index.html",revision:"8557459df10ccd5533e8d1ad7d626421"},{url:"registerSW.js",revision:"402b66900e731ca748771b6fc5e7a068"},{url:"./icons/icon-64.png",revision:"72a63aece340d508abfa7631429babe5"},{url:"./icons/icon-128.png",revision:"b5cc31bb2927d2a84c43435ac209d985"},{url:"./icons/icon-256.png",revision:"ad183e1bd2f93aae1f77e7c681161078"},{url:"./icons/icon-512.png",revision:"6ef763054248aa721d0c96084bfc9e08"},{url:"manifest.webmanifest",revision:"970c70b903fa87a48ced3856a55d9d6a"}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")))}));
