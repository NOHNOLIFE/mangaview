if(!self.define){let e,i={};const s=(s,n)=>(s=new URL(s+".js",n).href,i[s]||new Promise((i=>{if("document"in self){const e=document.createElement("script");e.src=s,e.onload=i,document.head.appendChild(e)}else e=s,importScripts(s),i()})).then((()=>{let e=i[s];if(!e)throw new Error(`Module ${s} didn’t register its module`);return e})));self.define=(n,r)=>{const f=e||("document"in self?document.currentScript.src:"")||location.href;if(i[f])return;let o={};const l=e=>s(e,f),c={module:{uri:f},exports:o,require:l};i[f]=Promise.all(n.map((e=>c[e]||l(e)))).then((e=>(r(...e),o)))}}define(["./workbox-3ea082d2"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"assets/fa-brands-400.3fe890d0.woff2",revision:null},{url:"assets/fa-brands-400.c7ae37d3.ttf",revision:null},{url:"assets/fa-regular-400.fdc1f753.ttf",revision:null},{url:"assets/fa-regular-400.fe69d948.woff2",revision:null},{url:"assets/fa-solid-900.6d53c706.ttf",revision:null},{url:"assets/fa-solid-900.d27bc752.woff2",revision:null},{url:"assets/fa-v4compatibility.4d73f280.ttf",revision:null},{url:"assets/fa-v4compatibility.7d1c2ce5.woff2",revision:null},{url:"assets/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.83be7b2f.woff2",revision:null},{url:"assets/HomeView.204296fe.js",revision:null},{url:"assets/index.68f3837b.js",revision:null},{url:"assets/index.7c6068e9.css",revision:null},{url:"favicon.ico",revision:"1ba2ae710d927f13d483fd5d1e548c9b"},{url:"icons/icon-128.png",revision:"f51962da60411fbd43fdc9b3ccd77f47"},{url:"icons/icon-256.png",revision:"c60959a23adfc509f8dc4e00f0a52a04"},{url:"icons/icon-512.png",revision:"4917b47db98b426864dfc0ae3da08b37"},{url:"icons/icon-64.png",revision:"6c1ca3707e7851d9fc3fd91f01014141"},{url:"index.html",revision:"6dee6d9263a49b7fb16862204cd1c25c"},{url:"registerSW.js",revision:"402b66900e731ca748771b6fc5e7a068"},{url:"icons/icon-64.png",revision:"6c1ca3707e7851d9fc3fd91f01014141"},{url:"icons/icon-128.png",revision:"f51962da60411fbd43fdc9b3ccd77f47"},{url:"icons/icon-256.png",revision:"c60959a23adfc509f8dc4e00f0a52a04"},{url:"icons/icon-512.png",revision:"4917b47db98b426864dfc0ae3da08b37"},{url:"manifest.webmanifest",revision:"344282d17074ffa46a0b0f13a6956d7f"}],{}),e.cleanupOutdatedCaches(),e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")))}));