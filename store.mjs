// books：书目记录（含只读文件句柄，不能导出）；thumbs：封面 / 书签缩略图，键为 `${bookId}:${kind}`。
const db = new Promise((resolve,reject)=>{
  const req=indexedDB.open('mangaview-reader-v2',2);
  req.onupgradeneeded=()=>{const d=req.result;
    if(!d.objectStoreNames.contains('books'))d.createObjectStore('books',{keyPath:'id'});
    if(!d.objectStoreNames.contains('thumbs'))d.createObjectStore('thumbs');};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
const reads=new Set(['get','getAll','getAllKeys','count']);
async function run(store,method,...args){
  const conn=await db;
  return new Promise((resolve,reject)=>{
    const tx=conn.transaction(store,reads.has(method)?'readonly':'readwrite');
    const req=tx.objectStore(store)[method](...args);
    tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||req.error);
  });
}
export const library=(method,...args)=>run('books',method,...args);
export const thumbs=(method,...args)=>run('thumbs',method,...args);
