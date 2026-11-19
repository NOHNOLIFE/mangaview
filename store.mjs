const db = new Promise((resolve,reject)=>{
  const req=indexedDB.open('mangaview-reader-v2',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('books',{keyPath:'id'});
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
export async function library(method,...args){
  const conn=await db;
  return new Promise((resolve,reject)=>{
    const tx=conn.transaction('books',method==='getAll'?'readonly':'readwrite');
    const req=tx.objectStore('books')[method](...args);
    tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||req.error);
  });
}
