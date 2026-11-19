const languages = ['en','zh','ja','ko'];
const strings = {
  welcome:['Open a comic','打开一本漫画','漫画を開く','만화 열기'],
  intro:['Drop image folders or loose images anywhere in this window.','将漫画文件夹或散图拖入窗口任意位置即可开始阅读。','画像フォルダーや画像をウィンドウにドロップしてください。','이미지 폴더나 낱장 이미지를 창에 끌어다 놓으세요.'],
  featLocal:['Files stay on this device','文件只在本机读取','ファイルは端末内でのみ読み取り','파일은 기기에서만 읽음'],
  featStrip:['Built for long strips','为长条漫画优化','縦読みマンガに最適','세로 스크롤 만화에 최적화'],
  dropHere:['Drop to add to your shelf','松开即可添加到书架','ドロップして本棚に追加','놓으면 책장에 추가됩니다'],
  nowReading:['Reading','在读','閲覧中','읽는 중'],unread:['New','未读','未読','새 책'],
  toTop:['Back to top','回到顶部','先頭へ','맨 위로'],toEnd:['Jump to end','滚到底部','末尾へ','맨 아래로'],
  github:['GitHub project','GitHub 项目主页','GitHub プロジェクト','GitHub 프로젝트'],
  refresh:['Refresh folders','刷新文件夹','フォルダーを更新','폴더 새로고침'],
  refreshing:['Checking folders…','正在检查文件夹…','フォルダーを確認中…','폴더 확인 중…'],
  refreshDone:['Everything is up to date','内容已是最新','すべて最新です','모두 최신 상태입니다'],
  updatedN:['{n} updated','{n} 本已更新','{n} 冊を更新','{n}권 업데이트'],
  removedN:['{n} removed','{n} 本已移除','{n} 冊を削除','{n}권 제거'],
  deniedN:['{n} need access','{n} 本需要授权','{n} 冊は許可が必要','{n}권 권한 필요'],
  goneN:['{n} folders missing','{n} 个文件夹已不存在','{n} 個のフォルダーが見つかりません','{n}개 폴더를 찾을 수 없음'],
  goneHint:['{n} folders missing — use Refresh to clean up','{n} 个文件夹已不存在，可点「刷新」清理记录','{n} 個のフォルダーが見つかりません。「更新」で記録を整理できます','{n}개 폴더를 찾을 수 없습니다. 새로고침으로 기록을 정리하세요'],
  pagesChanged:['Updated: +{a} / −{r} images','内容已更新：新增 {a} 张，移除 {r} 张','更新：{a} 枚追加・{r} 枚削除','업데이트: {a}장 추가, {r}장 제거'],
  missingFolder:['Folder missing','文件夹不存在','フォルダーなし','폴더 없음'],
  confirmPrune:['These folders no longer exist. Remove their records?\nIf a removable drive is just disconnected, cancel, reconnect it and refresh again.','以下文件夹已不存在，是否删除它们的记录？\n如果只是移动硬盘未连接，请取消，连接后再刷新。','以下のフォルダーが見つかりません。記録を削除しますか？\nドライブが未接続なだけなら、キャンセルして接続後に再度更新してください。','다음 폴더를 찾을 수 없습니다. 기록을 삭제할까요?\n외장 드라이브가 연결되지 않은 것뿐이라면 취소하고 연결한 뒤 다시 새로고침하세요.'],
  upgraded:['MangaView has been upgraded and moved here. Install this version from the address bar, then uninstall the old app.','MangaView 已升级并迁移到此地址。可从地址栏安装新版，然后卸载旧版应用。','MangaView は新しいアドレスに移行しました。アドレスバーから新版をインストールし、旧版を削除してください。','MangaView가 업그레이드되어 이 주소로 이동했습니다. 주소창에서 새 버전을 설치하고 이전 앱을 삭제하세요.'],
  emptyShelf:['Your shelf is empty','书架还是空的','本棚は空です','책장이 비어 있습니다'],
  folder:['Open folder','打开文件夹','フォルダーを開く','폴더 열기'],files:['Add images','添加图片','画像を追加','이미지 추가'],
  reading:['Reading area','阅读区','閲覧エリア','읽기 영역'],tools:['Reading tools','阅读工具','閲覧ツール','읽기 도구'],
  shelf:['Bookshelf','书架','本棚','책장'],prev:['Previous book','上一本','前の本','이전 책'],next:['Next book','下一本','次の本','다음 책'],
  shuffle:['Shuffle images','打乱图片','画像をシャッフル','이미지 섞기'],sort:['Sort','排序','並べ替え','정렬'],
  nameAsc:['Filename: ascending','文件名：正序','ファイル名：昇順','파일명: 오름차순'],nameDesc:['Filename: descending','文件名：反序','ファイル名：降順','파일명: 내림차순'],
  timeAsc:['Modified: oldest first','修改时间：从旧到新','更新日時：古い順','수정일: 오래된 순'],timeDesc:['Modified: newest first','修改时间：从新到旧','更新日時：新しい順','수정일: 최신순'],
  sortScope:['Apply sort to','排序设置范围','並べ替えの対象','정렬 적용 범위'],
  folderSort:['This folder / book','当前文件夹／书本','このフォルダー／本','현재 폴더 / 책'],
  globalSort:['Default for all folders','统一默认排序','共通の既定順','공통 기본 정렬'],
  followSort:['Use default','跟随默认排序','既定順を使う','기본 정렬 따르기'],
  readingTimes:['Reading modification times…','正在读取文件修改时间…','更新日時を取得中…','수정 시간을 읽는 중…'],
  unknownTimes:['Images with unavailable timestamps are listed last.','无法读取修改时间的图片已排在最后。','更新日時を取得できない画像は末尾に表示します。','수정 시간을 알 수 없는 이미지는 마지막에 표시합니다.'],
  fit:['Fit to width','铺满宽度','幅に合わせる','너비에 맞춤'],preview:['Preview strip','缩略图导航','サムネイルナビ','미리보기 탐색'],
  full:['Toggle fullscreen','切换全屏','全画面切替','전체 화면 전환'],width:['Preview width','预览宽度','プレビュー幅','미리보기 너비'],
  help:['Keyboard & mouse','键鼠操作','キーとマウス操作','키보드와 마우스'],close:['Close','关闭','閉じる','닫기'],
  search:['Book title','书名关键词','書名で検索','책 제목 검색'],min:['Min pages','最少页数','最少ページ数','최소 쪽수'],max:['Max pages','最多页数','最大ページ数','최대 쪽수'],reset:['Reset','重置','リセット','초기화'],
  copy:['Copy listed titles','复制筛选书名','表示中の書名をコピー','표시된 제목 복사'],titleCopy:['Copy title','复制书名','書名をコピー','제목 복사'],copied:['Copied','已复制','コピーしました','복사됨'],
  clear:['Clear history','清空历史','履歴を消去','기록 지우기'],remove:['Remove from shelf','从书架移除','本棚から外す','책장에서 제거'],
  confirmClear:['Clear all books and reading positions? The image files will not be deleted.','清空全部书架和进度？不会删除原图。','すべての本と読書位置を消去しますか？ 元画像は削除されません。','모든 책과 읽기 위치를 지울까요? 원본 이미지는 삭제되지 않습니다.'],
  confirmRemove:['Remove this record? The image files will not be deleted.','移除这本书的记录？不会删除原图。','この本の記録を消去しますか？ 元画像は削除されません。','이 책의 기록을 지울까요? 원본 이미지는 삭제되지 않습니다.'],
  loose:['Loose images','散图图集','個別の画像','낱장 이미지'],pages:['images','张','枚','장'],noBooks:['No matching books','没有符合条件的书','該当する本がありません','일치하는 책 없음'],
  missing:['Source unavailable. Reconnect the drive, grant access or locate the originals.','暂时无法读取源文件。请连接磁盘、授权或重新指定原文件。','元画像を読み取れません。ドライブを接続するか、許可または再指定してください。','원본을 읽을 수 없습니다. 드라이브를 연결하거나 권한을 허용하거나 원본을 다시 지정하세요.'],
  allow:['Grant access','重新授权','アクセスを許可','권한 허용'],locate:['Locate originals','定位原文件','元画像を再指定','원본 다시 지정'],
  invalid:['Cannot display image','图片无法显示','画像を表示できません','이미지를 표시할 수 없음'],noImages:['No supported images found','没有找到支持的图片','対応画像がありません','지원하는 이미지가 없습니다'],
  failed:['Operation failed. Check access and try again.','操作未完成，请检查权限后重试。','操作できません。権限を確認して再試行してください。','작업을 완료하지 못했습니다. 권한을 확인하고 다시 시도하세요.'],
  storage:['Cannot save history on this device.','无法在此设备保存历史。','この端末に履歴を保存できません。','기기에 기록을 저장할 수 없습니다.'],
  scanning:['Indexing local images…','正在索引本地图片…','画像を確認中…','로컬 이미지 목록을 읽는 중…'],
  ready:['Ready for offline reading','已可离线阅读','オフラインで読めます','오프라인 읽기 준비 완료'],
  // 帮助页的快捷键表：[[按键或鼠标操作…], 说明]，多个按键之间是“或”，“+”表示组合键。
  shortcuts:[
    [[['Wheel','Left drag'],'Scroll'],[['Middle click'],'Browser auto-scroll (where supported)'],[['Space','↓'],'Scroll down; hold to keep going'],[['Shift+Space','↑'],'Scroll up'],
     [['F','→','Enter'],'Forward one screen'],[['D','←'],'Back one screen'],[['Click top'],'Jump to start; at the start, previous book'],[['Click bottom'],'Jump to end; at the end, next book'],[['Click middle'],'Left half: back one screen · Right half: forward'],
     [['Home','End'],'Start / end; press again to change books'],[['Page Up','Page Down'],'Previous / next book'],[['Delete'],'Remove current book'],
     [['Ctrl+C'],'Copy listed titles'],[['T'],'Show or hide tools'],[['Esc'],'Close tools and preview'],[['Right edge'],'Hover to show the preview strip'],[['Click preview'],'Jump to that exact point']],
    [[['滚轮','左键拖动'],'滚动'],[['中键'],'浏览器原生自动滚动（需平台支持）'],[['空格','↓'],'向下滚动，按住持续滚动'],[['Shift+空格','↑'],'向上滚动'],
     [['F','→','Enter'],'后一屏'],[['D','←'],'前一屏'],[['单击上方'],'回到书首；已在书首时切换上一本'],[['单击下方'],'滚到书尾；已在书尾时切换下一本'],[['单击中部'],'左半屏：前一屏 · 右半屏：后一屏'],
     [['Home','End'],'书首 / 书尾，再按一次切换上 / 下一本'],[['Page Up','Page Down'],'上一本 / 下一本'],[['Delete'],'从书架移除当前书'],
     [['Ctrl+C'],'复制筛选出的书名'],[['T'],'显示 / 隐藏工具栏'],[['Esc'],'收起工具栏和预览'],[['鼠标移到右缘'],'弹出缩略图栏'],[['点击缩略图'],'跳到对应画面位置']],
    [[['ホイール','左ドラッグ'],'スクロール'],[['中クリック'],'自動スクロール（対応環境のみ）'],[['スペース','↓'],'下へスクロール（長押しで連続）'],[['Shift+スペース','↑'],'上へスクロール'],
     [['F','→','Enter'],'1画面進む'],[['D','←'],'1画面戻る'],[['上部をクリック'],'先頭へ。先頭なら前の本へ'],[['下部をクリック'],'末尾へ。末尾なら次の本へ'],[['中央部をクリック'],'左半分：1画面戻る · 右半分：1画面進む'],
     [['Home','End'],'先頭／末尾。もう一度押すと前後の本へ'],[['Page Up','Page Down'],'前の本／次の本'],[['Delete'],'現在の本を本棚から外す'],
     [['Ctrl+C'],'表示中の書名をコピー'],[['T'],'ツールの表示／非表示'],[['Esc'],'ツールとプレビューを閉じる'],[['右端にマウス'],'サムネイルを表示'],[['プレビューをクリック'],'その位置へジャンプ']],
    [[['휠','왼쪽 드래그'],'스크롤'],[['가운데 클릭'],'자동 스크롤(지원 환경)'],[['스페이스','↓'],'아래로 스크롤, 누르고 있으면 계속'],[['Shift+스페이스','↑'],'위로 스크롤'],
     [['F','→','Enter'],'한 화면 앞으로'],[['D','←'],'한 화면 뒤로'],[['위쪽 클릭'],'처음으로, 이미 처음이면 이전 책'],[['아래쪽 클릭'],'끝으로, 이미 끝이면 다음 책'],[['중앙 영역 클릭'],'왼쪽 절반: 한 화면 뒤로 · 오른쪽 절반: 앞으로'],
     [['Home','End'],'처음 / 끝, 다시 누르면 책 전환'],[['Page Up','Page Down'],'이전 / 다음 책'],[['Delete'],'현재 책 제거'],
     [['Ctrl+C'],'표시된 제목 복사'],[['T'],'도구 표시 / 숨기기'],[['Esc'],'도구와 미리보기 닫기'],[['오른쪽 가장자리'],'마우스를 대면 미리보기 표시'],[['미리보기 클릭'],'해당 지점으로 이동']]
  ]
};
export function detect(list) {
  for (const tag of list) {
    const base = tag.toLowerCase().split('-')[0];
    if (languages.includes(base)) return base;
  }
  return 'en';
}
export function translate(key, lang) { return strings[key][languages.indexOf(lang)] ?? strings[key][0]; }
