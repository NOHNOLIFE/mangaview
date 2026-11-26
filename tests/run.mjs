// 统一的测试入口（无依赖）：
//   node tests/run.mjs                       只跑核心测试（tests/core/*.test.mjs）
//   node tests/run.mjs "<浏览器路径>" [名称…]  先跑核心测试，再逐个串行跑浏览器测试（tests/browser.mjs 与 tests/*.browser.mjs），
//                                            给了名称时只跑文件名包含其中任一名称的浏览器测试
// 浏览器测试失败的自动单独重跑一次（排除偶发的时序超时），最后列出通过 / 失败清单，有失败时退出码为 1。
import {spawn} from 'node:child_process';
import {readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const [browser,...filters]=process.argv.slice(2);
if(browser&&!await stat(browser).then(s=>s.isFile(),()=>false)){console.error('Browser not found: '+browser+'\nUsage: node tests/run.mjs ["<chrome-or-edge-executable>" [name...]]');process.exit(2);}
const LIMIT=10*60*1000; // 单个测试文件的时限
function run(args,label){
  return new Promise(resolve=>{
    console.log('\n=== '+label+' ===');
    const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
    const timer=setTimeout(()=>{console.error(label+': timed out after '+LIMIT/1000+' s');child.kill();},LIMIT);
    child.on('exit',code=>{clearTimeout(timer);resolve(code===0);});
    child.on('error',e=>{clearTimeout(timer);console.error(e);resolve(false);});
  });
}
const passed=[],failed=[];
(await run(['--test','tests/core/*.test.mjs'],'core')?passed:failed).push('core');
if(browser){
  const files=(await readdir(new URL('./',import.meta.url))).filter(f=>f==='browser.mjs'||f.endsWith('.browser.mjs')).sort()
    .filter(f=>!filters.length||filters.some(n=>f.includes(n)));
  for(const f of files){
    let ok=await run(['tests/'+f,browser],f);
    if(!ok)ok=await run(['tests/'+f,browser],f+' (retry)');
    (ok?passed:failed).push(f);
  }
}
console.log('\nPassed ('+passed.length+'): '+(passed.join(', ')||'-'));
console.log('Failed ('+failed.length+'): '+(failed.join(', ')||'-'));
if(!browser)console.log('Browser tests skipped: node tests/run.mjs "<chrome-or-edge-executable>" [name...]');
process.exit(failed.length?1:0);
