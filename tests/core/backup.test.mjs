import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeMarks} from '../../src/panels/backup.mjs';

test('合并备份：书签取并集，区段书签补缺，冲突的区段书签不并入，本机的保留',()=>{
  const pages=['0','1','2','3','4','5'].map(name=>({name}));
  const mine=[{id:'a',name:'1',f:.5,end:{name:'2',f:.5}},{id:'b',name:'3',f:.2}];
  const theirs=[{id:'a',name:'1',f:.5,end:{name:'4',f:.1}},{id:'b',name:'3',f:.2,end:{name:'4',f:.9}},{id:'c',name:'0',f:.1,end:{name:'1',f:.9}},{id:'d',name:'5',f:.1,end:{name:'5',f:.8}},{id:'e',name:'9',f:.1,end:{name:'9',f:.5}}];
  const out=mergeMarks(pages,mine.map(m=>({...m})),theirs);
  const get=id=>out.find(m=>m.id===id);
  assert.deepEqual(get('a').end,{name:'2',f:.5},'本机已有的区段书签不被覆盖');
  assert.deepEqual(get('b').end,{name:'4',f:.9},'本机没有区段书签的同一个书签补上');
  assert.equal(get('c').end,undefined,'与已有区段交叉的区段书签不并入');assert.equal(get('c').name,'0','书签本身照常并入');
  assert.deepEqual(get('d').end,{name:'5',f:.8});
  assert.deepEqual(get('e').end,{name:'9',f:.5},'位置无法换算（页不存在）时照常保留');
  assert.equal(out.length,5);
});
test('合并备份：媒体的区段书签只与同一文件的区段比较冲突',()=>{
  const pages=[{name:'1.jpg'},{name:'a.webm'},{name:'b.webm'},{name:'2.jpg'}];
  const mine=[{id:'i1',name:'1.jpg',f:.2,end:{name:'2.jpg',f:.5}},{id:'a1',name:'a.webm',t:10,end:{name:'a.webm',t:20}}];
  const incoming=[{id:'a2',name:'a.webm',t:15,end:{name:'a.webm',t:30}},{id:'b1',name:'b.webm',t:15,end:{name:'b.webm',t:30}},{id:'a3',name:'a.webm',t:25,end:{name:'a.webm',t:28}}];
  const out=mergeMarks(pages,structuredClone(mine),incoming);
  assert.deepEqual(out.map(m=>[m.id,!!m.end]),[['i1',true],['a1',true],['a2',false],['b1',true],['a3',true]],'Crossing a section of the same file is dropped; other files and the image section spanning them do not matter');
});
