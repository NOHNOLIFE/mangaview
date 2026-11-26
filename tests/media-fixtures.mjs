// 测试用的媒体素材：在测试页里现场生成极短的视频和音频，不依赖 ffmpeg 等外部工具，也不使用任何真实文件。
// 用法：把 MEDIA_FIXTURES 注入页面（Runtime.evaluate 或 Page.addScriptToEvaluateOnNewDocument），之后页面里有 window.mvMedia：
// - mvMedia.wav({seconds,rate,freq}) → Blob：手写的 16 位单声道 PCM WAV，立即生成；
// - await mvMedia.webm({seconds,width,height,audio,fps}) → Blob：用 MediaRecorder 从 canvas（和 AudioContext）录制的 WebM，
//   录制按真实时间进行；MediaRecorder 不写时长，生成后补上 Segment Info 的 Duration，浏览器才能读到时长并定位；
// - mvMedia.withDuration(blob,ms) → Blob：给 MediaRecorder 录出的 WebM 补写时长；
// - await mvMedia.write(dir,name,blob)：写进 OPFS 目录（测试里的书都放在 OPFS）。
export const MEDIA_FIXTURES=`(()=>{
  function wav({seconds=1,rate=8000,freq=440}={}){
    const n=Math.round(seconds*rate),buf=new ArrayBuffer(44+n*2),v=new DataView(buf),s=(o,str)=>{for(let i=0;i<str.length;i++)v.setUint8(o+i,str.charCodeAt(i));};
    s(0,'RIFF');v.setUint32(4,36+n*2,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.round(Math.sin(2*Math.PI*freq*i/rate)*6000),true);
    return new Blob([buf],{type:'audio/wav'});
  }
  // EBML：Segment Info（1549A966）里补一个 Duration（4489，float64，单位为 TimecodeScale，MediaRecorder 用 1ms）。
  async function withDuration(blob,ms){
    const a=new Uint8Array(await blob.arrayBuffer());
    let p=-1;for(let i=0;i<Math.min(a.length-4,65536);i++)if(a[i]===0x15&&a[i+1]===0x49&&a[i+2]===0xA9&&a[i+3]===0x66){p=i;break;}
    if(p<0)return blob;
    const b=a[p+4];let len=1;while(len<=8&&!(b&(0x80>>(len-1))))len++;
    let size=b&(0xFF>>len);for(let k=1;k<len;k++)size=size*256+a[p+4+k];
    const start=p+4+len,end=start+size,dur=new Uint8Array(11),dv=new DataView(dur.buffer);
    dur[0]=0x44;dur[1]=0x89;dur[2]=0x88;dv.setFloat64(3,ms);
    const total=size+11,head=new Uint8Array(8);head[0]=0x01;for(let k=7,x=total;k>=1;k--){head[k]=x&0xFF;x=Math.floor(x/256);}
    return new Blob([a.subarray(0,p+4),head,a.subarray(start,end),dur,a.subarray(end)],{type:blob.type||'video/webm'});
  }
  async function webm({seconds=1.2,width=320,height=180,audio=false,fps=24}={}){
    const c=document.createElement('canvas');c.width=width;c.height=height;const g=c.getContext('2d');
    const stream=c.captureStream(fps);let ac=null;
    if(audio){ac=new AudioContext();const o=ac.createOscillator(),d=ac.createMediaStreamDestination();o.connect(d);o.start();stream.addTrack(d.stream.getAudioTracks()[0]);}
    const type=[audio?'video/webm;codecs=vp8,opus':'video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    const rec=new MediaRecorder(stream,{mimeType:type}),chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    let f=0;const draw=()=>{g.fillStyle='hsl('+(f*47%360)+',60%,45%)';g.fillRect(0,0,width,height);g.fillStyle='#fff';g.font=Math.round(height/4)+'px sans-serif';g.fillText(String(f++),8,height/3);};
    draw();const timer=setInterval(draw,1000/fps);
    rec.start(100);await new Promise(r=>setTimeout(r,seconds*1000));
    const done=new Promise(r=>{rec.onstop=r;});rec.stop();await done;clearInterval(timer);for(const t of stream.getTracks())t.stop();await ac?.close();
    return withDuration(new Blob(chunks,{type:'video/webm'}),seconds*1000);
  }
  async function write(dir,name,blob){const out=await (await dir.getFileHandle(name,{create:true})).createWritable();await out.write(blob);await out.close();}
  window.mvMedia={wav,webm,withDuration,write};
})();`;
