if(!self.define){let i,e={};const s=(s,n)=>(s=new URL(s+".js",n).href,e[s]||new Promise((e=>{if("document"in self){const i=document.createElement("script");i.src=s,i.onload=e,document.head.appendChild(i)}else i=s,importScripts(s),e()})).then((()=>{let i=e[s];if(!i)throw new Error(`Module ${s} didn’t register its module`);return i})));self.define=(n,r)=>{const o=i||("document"in self?document.currentScript.src:"")||location.href;if(e[o])return;let c={};const f=i=>s(i,o),l={module:{uri:o},exports:c,require:f};e[o]=Promise.all(n.map((i=>l[i]||f(i)))).then((i=>(r(...i),c)))}}define(["./workbox-3ea082d2"],(function(i){"use strict";self.skipWaiting(),i.clientsClaim(),i.precacheAndRoute([{url:"assets/fa-brands-400.3fe890d0.woff2",revision:null},{url:"assets/fa-brands-400.c7ae37d3.ttf",revision:null},{url:"assets/fa-regular-400.fdc1f753.ttf",revision:null},{url:"assets/fa-regular-400.fe69d948.woff2",revision:null},{url:"assets/fa-solid-900.6d53c706.ttf",revision:null},{url:"assets/fa-solid-900.d27bc752.woff2",revision:null},{url:"assets/fa-v4compatibility.4d73f280.ttf",revision:null},{url:"assets/fa-v4compatibility.7d1c2ce5.woff2",revision:null},{url:"assets/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.83be7b2f.woff2",revision:null},{url:"assets/HomeView.4d2e2acc.js",revision:null},{url:"assets/index.5409aab8.js",revision:null},{url:"assets/index.9ac1f8b3.css",revision:null},{url:"favicon.ico",revision:"1ba2ae710d927f13d483fd5d1e548c9b"},{url:"icons/icon-128.png",revision:"f51962da60411fbd43fdc9b3ccd77f47"},{url:"icons/icon-256.png",revision:"c60959a23adfc509f8dc4e00f0a52a04"},{url:"icons/icon-512.png",revision:"4917b47db98b426864dfc0ae3da08b37"},{url:"icons/icon-64.png",revision:"6c1ca3707e7851d9fc3fd91f01014141"},{url:"index.html",revision:"f324033c84d7f71485adc9b1815b9e42"},{url:"registerSW.js",revision:"402b66900e731ca748771b6fc5e7a068"},{url:"./icons/icon-64.png",revision:"6c1ca3707e7851d9fc3fd91f01014141"},{url:"./icons/icon-128.png",revision:"f51962da60411fbd43fdc9b3ccd77f47"},{url:"./icons/icon-256.png",revision:"c60959a23adfc509f8dc4e00f0a52a04"},{url:"./icons/icon-512.png",revision:"4917b47db98b426864dfc0ae3da08b37"},{url:"manifest.webmanifest",revision:"970c70b903fa87a48ced3856a55d9d6a"}],{}),i.cleanupOutdatedCaches(),i.registerRoute(new i.NavigationRoute(i.createHandlerBoundToURL("index.html")))}));
