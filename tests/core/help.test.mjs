import test from 'node:test';
import assert from 'node:assert/strict';
import {translate} from '../../src/core/lang.mjs';
import {KEYS,ZONES,ROWS,MOUSE,MORE,pieces,plain} from '../../src/panels/help.mjs';

test('键鼠操作图示：功能键都在显示的键盘局部内，文案四语齐全；长按 / Shift 的标记与说明一致；Delete 是删除这本书的记录（不删原文件）',()=>{
  const shown=new Set();
  for(const z of ZONES)for(const r of z.rows){if(!r)continue;let x=0;for(const [id,w] of ROWS[r]){if(id&&Math.min(x+w,z.to)-Math.max(x,z.from)>=.25)shown.add(id);x+=w;}}
  for(const id of Object.keys(KEYS))assert.ok(shown.has(id),id+' 在图示范围内');
  const keys=new Set();for(const f of Object.values(KEYS))keys.add(f.tip);
  for(const m of [...MOUSE.buttons,...MOUSE.areas]){keys.add(m.label);if(m.tip)keys.add(m.tip);}for(const [,k] of MORE)keys.add(k);
  for(const k of keys)for(const lang of ['en','zh','ja','ko'])assert.ok(translate(k,lang),k+' '+lang);
  // 有长按功能的键，说明里恰好一个“长按”强调片段；受 Shift 影响的键，说明里有 Shift 片段；其余键都没有。
  for(const [id,f] of Object.entries(KEYS))for(const lang of ['en','zh','ja','ko']){
    const p=pieces(translate(f.tip,lang));
    assert.equal(p.filter(x=>x[0]==='hold').length,f.hold?1:0,id+' '+lang+' hold');
    assert.equal(p.some(x=>x[0]==='shift'),!!f.shift,id+' '+lang+' Shift');
    assert.equal(p.map(x=>x[1]).join(''),plain(translate(f.tip,lang)),id+' '+lang+' pieces');
  }
  assert.deepEqual(pieces('上一屏，*长按*上一本'),[['','上一屏，'],['hold','长按'],['','上一本']]);
  const want={en:/Delete this book's record.*files kept/,zh:/删除本书记录.*不删原文件/,ja:/記録を削除.*元のファイルは残す/,ko:/기록 삭제.*원본 파일 유지/};
  for(const [lang,re] of Object.entries(want)){
    assert.match(translate(KEYS.Delete.tip,lang),re,lang);
    assert.doesNotMatch(translate('hkMoreShelf',lang),/Delete: remove|Delete 移除|Delete で外す|Delete 제거/,lang);
  }
});
