/* RKBO shared team photo backgrounds.
 * One upload per historically displayed club (SK and SSG separately).
 * Backgrounds are composed behind the athlete without altering any player
 * ID, stats, photo, OVR, season card, or favorite.
 */
(function(root){
'use strict';
const OWNER='p0emkite', REPO='RKBO_Draft_and_CardArchive';
const META='data/team-backgrounds.json';
const CLUBS=['DOO','LG','KIA','SAM','LOT','HAN','NC','KT','KIW','SK','SSG'];
const BRAND=root.RKBOTeamBrand;
const names=BRAND?.names||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,low,high)=>Math.min(high,Math.max(low,Number(n)||0));
const validSha=s=>/^[0-9a-f]{40}$/i.test(String(s||''));
const q=id=>document.getElementById(id);
const pathURL=path=>String(path||'').split('/').map(encodeURIComponent).join('/');
const rawURL=entry=>{
 if(!entry?.path)return '';
 const rev=validSha(entry.commit)?entry.commit:'main';
 return 'https://raw.githubusercontent.com/'+OWNER+'/'+REPO+'/'+rev+'/'+pathURL(entry.path)+(entry.rev?'?v='+encodeURIComponent(entry.rev):'');
};
const pagesURL=entry=>entry?.path?new URL('./'+pathURL(entry.path),document.baseURI).href+(entry.rev?'?v='+encodeURIComponent(entry.rev):''):'';
let cfg={version:1,teams:{}},draft=null,selected='SAM',busy=false,hasUi=false;
const backgroundKey=player=>BRAND?.code(player)||player?.displayTeamCode||player?.team||'';
function getEntry(player){
 const code=backgroundKey(player);
 if(draft?.team===code&&draft.enabled)return {...draft.entry,...(draft.url?{url:draft.url}:{})};
 return cfg.teams?.[code]||null;
}
const entryURL=entry=>entry?.url||rawURL(entry);
function imageState(player){
 const entry=getEntry(player);
 return entry&&entryURL(entry)?{...entry,url:entryURL(entry)}:null;
}
function render(player){
 const entry=imageState(player);
 if(!entry)return '';
 const tx=clamp(entry.x,-100,100),ty=clamp(entry.y,-100,100),zoom=clamp(entry.zoom||1,.35,3.5);
 const fallback=entry.url?.startsWith('blob:')?'':pagesURL(entry);
 return '<img class="team-background-photo" src="'+esc(entry.url)+'" alt="" role="presentation" draggable="false" loading="lazy" data-team-bg-blob="'+esc(entry.blobSha||'')+'" data-team-bg-fallback="'+esc(fallback)+'" style="--team-bg-x:'+tx+'%;--team-bg-y:'+ty+'%;--team-bg-zoom:'+zoom+'">';
}
function redraw(){root.RKBOArt?.refresh?.()}
async function fetchPublic(){
 const links=[
  {url:'https://api.github.com/repos/'+OWNER+'/'+REPO+'/contents/'+META+'?ref=main&t='+Date.now(),api:true},
  {url:'https://raw.githubusercontent.com/'+OWNER+'/'+REPO+'/main/'+META+'?t='+Date.now()},
  {url:new URL('./'+META+'?t='+Date.now(),document.baseURI).href}
 ];
 for(const {url,api} of links){
  try{
   const r=await fetch(url,{cache:'no-store',headers:api?{Accept:'application/vnd.github+json'}:{}});
   if(!r.ok)continue;
   const payload=await r.json();
   const json=api&&payload?.encoding==='base64'
    ?JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.content.replace(/\s/g,'')),c=>c.charCodeAt(0))))
    :payload;
   if(json&&json.teams&&typeof json.teams==='object'&&!Array.isArray(json.teams)){
    cfg=json;
    redraw();updatePreview();
    return json;
   }
  }catch(error){console.warn('[RKBO team backgrounds]',error)}
 }
 return cfg;
}
const blobCache=new Map(),blobPending=new Map();
async function publicImageBlob(sha){
 if(!validSha(sha))throw Error('Invalid team photo SHA');
 if(blobCache.has(sha))return blobCache.get(sha);
 if(blobPending.has(sha))return blobPending.get(sha);
 const action=(async()=>{
  const response=await fetch('https://api.github.com/repos/'+OWNER+'/'+REPO+'/git/blobs/'+sha,{
   headers:{Accept:'application/vnd.github+json'},cache:'no-store'
  });
  if(!response.ok)throw Error('Public blob response '+response.status);
  const data=await response.json();
  if(data.encoding!=='base64'||!data.content)throw Error('Invalid image payload');
  const bytes=Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));
  blobCache.set(sha,url);
  return url;
 })();
 blobPending.set(sha,action);
 try{return await action}finally{blobPending.delete(sha)}
}
document.addEventListener('error',e=>{
 const img=e.target;
 if(!(img instanceof HTMLImageElement)||!img.classList.contains('team-background-photo'))return;
 const sha=img.dataset.teamBgBlob;
 if(!img.dataset.teamBgRetry&&validSha(sha)){
  img.dataset.teamBgRetry='blob';
  publicImageBlob(sha).then(url=>{if(img.isConnected)img.src=url}).catch(()=>{
   if(img.isConnected&&img.dataset.teamBgFallback)img.src=img.dataset.teamBgFallback;
   else img.remove();
  });
  return;
 }
 if(img.dataset.teamBgFallback&&img.dataset.teamBgRetry!=='pages'){
  img.dataset.teamBgRetry='pages';img.src=img.dataset.teamBgFallback;return;
 }
 img.remove();
},true);
function status(message){const target=q('team-bg-status');if(target)target.textContent=message}
async function fileToWebp(file){
 if(!file||!file.type.startsWith('image/'))throw Error('이미지 파일을 선택하세요.');
 if(file.size>16*1024*1024)throw Error('원본은 16MB 이하여야 합니다.');
 const bitmap=await createImageBitmap(file);
 const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(bitmap.width*scale));
 canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
 bitmap.close?.();
 const blob=await new Promise(ok=>canvas.toBlob(ok,'image/webp',.88));
 if(!blob)throw Error('이미지 WebP 변환에 실패했습니다.');
 if(blob.size>3*1024*1024)throw Error('변환된 파일이 3MB를 넘습니다. 더 작은 이미지를 선택하세요.');
 return blob;
}
function retireDraft(){
 if(draft?.ownedUrl&&draft.url?.startsWith('blob:'))URL.revokeObjectURL(draft.url);
 draft=null;
}
function makeDraft(){
 if(!draft||draft.team!==selected){
  retireDraft();
  draft={team:selected,entry:{x:0,y:0,zoom:1,...(cfg.teams?.[selected]||{})},url:null,blob:null,enabled:false};
 }
 return draft;
}
function resetForm(){
 retireDraft();
 const entry=cfg.teams?.[selected]||{};
 for(const [field,value] of [['team-bg-x',entry.x??0],['team-bg-y',entry.y??0],['team-bg-zoom',entry.zoom??1]]){if(q(field))q(field).value=value}
 if(q('team-bg-file'))q('team-bg-file').value='';
 updatePreview();
 redraw();
}
function previewState(){
 const entry=draft?.team===selected&&draft.enabled?{...draft.entry,...(draft.url?{url:draft.url}:{})}:cfg.teams?.[selected];
 return entry&&entryURL(entry)?entry:null;
}
function updatePreview(){
 const box=q('team-bg-preview'),label=q('team-bg-selection');
 if(!box)return;
 const entry=previewState();
 if(label)label.textContent=(names[selected]||selected)+(entry?' · 구단 배경 미리보기':' · 기본 카드 배경');
 const img=q('team-bg-preview-image');
 if(img){
  if(entry){
   const url=entryURL(entry);
   if(img.getAttribute('src')!==url)img.src=url;
   img.style.setProperty('--team-bg-x',clamp(entry.x,-100,100)+'%');
   img.style.setProperty('--team-bg-y',clamp(entry.y,-100,100)+'%');
   img.style.setProperty('--team-bg-zoom',clamp(entry.zoom||1,.35,3.5));
   img.hidden=false;
  }else{img.removeAttribute('src');img.hidden=true}
 }
 if(q('team-bg-zoom-value'))q('team-bg-zoom-value').textContent=Math.round(Number(q('team-bg-zoom')?.value||1)*100)+'%';
 const badge=q('team-bg-count');
 if(badge)badge.textContent=Object.keys(cfg.teams||{}).length+'개 구단 등록';
}
function adjust(){
 const d=makeDraft();
 for(const k of ['x','y','zoom'])d.entry[k]=Number(q('team-bg-'+k)?.value|| (k==='zoom'?1:0));
 d.enabled=true;
 updatePreview();redraw();
}
async function chooseFile(){
 const file=q('team-bg-file')?.files?.[0];if(!file)return;
 try{
  status('배경 사진 변환 중…');
  const blob=await fileToWebp(file);
  const entry={...(cfg.teams?.[selected]||{}),x:0,y:0,zoom:1};
  retireDraft();
  draft={team:selected,entry,blob,url:URL.createObjectURL(blob),ownedUrl:true,enabled:true};
  for(const [k,v] of [['x',0],['y',0],['zoom',1]])q('team-bg-'+k).value=v;
  updatePreview();redraw();
  status('✓ '+(names[selected]||selected)+' 배경을 미리보기에 적용했습니다. GitHub에 저장하면 모든 시즌의 해당 구단 카드에 반영됩니다.');
 }catch(error){status('배경 사진 오류: '+error.message)}
}
function handleTeamChange(value){
 if(!CLUBS.includes(value))return;
 selected=value;
 resetForm();
 status((names[selected]||selected)+' · 현재 선택한 구단에만 적용할 배경을 편집합니다.');
}
async function saveBackground(remove=false){
 const bridge=root.RKBOAdminBridge;
 if(!bridge?.isAuthorized?.()){status('GitHub에 연결한 관리자만 구단 배경을 저장할 수 있습니다.');return}
 if(busy)return;
 const code=selected,existing=cfg.teams?.[code],d=draft?.team===code?draft:null;
 if(!remove&&!d?.blob&&!existing){status('먼저 구단 배경 사진을 선택하세요.');return}
 if(remove&&!existing&&!d){status('삭제할 배경이 없습니다.');return}
 busy=true;
 for(const id of ['team-bg-save','team-bg-remove'])if(q(id))q(id).disabled=true;
 try{
  status(remove?'GitHub 구단 배경 설정 삭제 중…':'GitHub에 구단 배경 저장 중…');
  let uploaded=null;
  if(!remove&&d?.blob){
   uploaded=await bridge.uploadBinary('assets/team-backgrounds/'+code+'.webp',d.blob);
   if(!uploaded?.content?.sha||!uploaded?.commit?.sha)throw Error('GitHub에서 이미지 저장 커밋을 반환하지 않았습니다.');
  }
  const remote=await bridge.readJson(META);
  const current=remote.data&&typeof remote.data.teams==='object'?remote.data:{version:1,teams:{}};
  const next={...current,version:1,teams:{...current.teams}};
  if(remove)delete next.teams[code];
  else{
   const placement=d?.entry||existing;
   next.teams[code]={
    path:'assets/team-backgrounds/'+code+'.webp',
    x:clamp(placement.x,-100,100),y:clamp(placement.y,-100,100),
    zoom:clamp(placement.zoom||1,.35,3.5),
    ...(uploaded?{commit:uploaded.commit.sha,blobSha:uploaded.content.sha,rev:Date.now().toString(36)}
      :{commit:existing.commit||'',blobSha:existing.blobSha||'',rev:existing.rev||''})
   };
  }
  await bridge.writeJson(META,next,remote.sha);
  cfg=next;
  // Preserve the selected local image until the remote URL can load (Pages
  // can lag after the metadata commit). The public raw commit URL is pinned.
  if(!remove&&d?.blob){
   d.entry={...next.teams[code]};
   d.enabled=true;
  }else retireDraft();
  updatePreview();redraw();
  status('✓ '+(names[code]||code)+(remove?' 배경 설정 삭제':' 구단 배경 GitHub 저장')+' 완료. 해당 구단의 모든 시즌 카드에 동일하게 적용됩니다.');
 }catch(error){console.error(error);status('GitHub 저장 실패: '+error.message+'\n파일만 업로드된 경우 배경 저장을 다시 눌러 메타데이터 등록을 완료하세요.')}
 finally{busy=false;for(const id of ['team-bg-save','team-bg-remove'])if(q(id))q(id).disabled=false}
}
function makePanel(){
 if(hasUi)return;
 const parent=q('admin-controls');if(!parent)return;
 hasUi=true;
 const toolsRow=parent.querySelector('.admin-actions');
 if(toolsRow){
  const shortcut=document.createElement('button');
  shortcut.type='button';shortcut.id='team-bg-shortcut';shortcut.textContent='▧ 구단 배경 편집';
  shortcut.addEventListener('click',()=>q('rkbo-team-backgrounds')?.scrollIntoView({behavior:'smooth',block:'start'}));
  toolsRow.append(shortcut);
 }
 const section=document.createElement('section');
 section.id='rkbo-team-backgrounds';
 section.innerHTML='<hr><h2>▧ 구단 공통 배경 사진 <span id="team-bg-count">0개 구단 등록</span></h2>'+
 '<p>선수 사진과 별도입니다. 구단별 배경을 한 번 등록하면 <b>모든 시즌의 해당 구단 카드</b>에 공통 적용됩니다. '+
 '구단명·엠블럼과 선수 사진은 그 위에 표시됩니다. <b>SK(1~42차)와 SSG(43차~)는 별도</b>로 관리합니다.</p>'+
 '<label for="team-bg-team">배경을 바꿀 구단</label>'+
 '<select id="team-bg-team">'+CLUBS.map(code=>'<option value="'+code+'"'+(code===selected?' selected':'')+'>'+esc(names[code]||code)+'</option>').join('')+'</select>'+
 '<label for="team-bg-file">배경 이미지 파일 (PNG / JPG / WebP)</label>'+
 '<input id="team-bg-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif">'+
 '<div id="team-bg-preview" class="team-bg-preview" aria-label="구단 배경 실시간 미리보기">'+
 '<img id="team-bg-preview-image" alt="" hidden>'+
 '<span id="team-bg-selection" class="team-bg-preview-note"></span></div>'+
 '<label for="team-bg-zoom">배경 크기 <span id="team-bg-zoom-value">100%</span></label>'+
 '<input id="team-bg-zoom" type="range" min=".35" max="3.5" step=".01" value="1">'+
 '<label for="team-bg-x">가로 위치</label><input id="team-bg-x" type="range" min="-100" max="100" step="1" value="0">'+
 '<label for="team-bg-y">세로 위치</label><input id="team-bg-y" type="range" min="-100" max="100" step="1" value="0">'+
 '<div class="team-bg-actions"><button type="button" id="team-bg-apply">도감에 즉시 적용</button>'+
 '<button type="button" class="primary" id="team-bg-save">GitHub에 구단 배경 저장</button>'+
 '<button type="button" id="team-bg-remove">구단 배경 삭제</button></div>'+
 '<div class="team-bg-status" id="team-bg-status" aria-live="polite">현재 구단에 사진을 등록하면 전체 시즌 카드에 공통 배경이 적용됩니다.</div>';
 parent.append(section);
 q('team-bg-team').addEventListener('change',e=>handleTeamChange(e.target.value));
 q('team-bg-file').addEventListener('change',chooseFile);
 for(const f of ['x','y','zoom'])q('team-bg-'+f).addEventListener('input',adjust);
 q('team-bg-apply').addEventListener('click',()=>{makeDraft().enabled=true;updatePreview();redraw();status('✓ 도감 미리보기에 적용했습니다. 다른 방문자에게도 보이려면 GitHub 저장을 누르세요.')});
 q('team-bg-save').addEventListener('click',()=>saveBackground(false));
 q('team-bg-remove').addEventListener('click',()=>{
  if(root.confirm('이 구단의 공통 배경을 모두 해제할까요? 선수 개별 사진은 유지됩니다.'))saveBackground(true);
 });
 // Position may also be adjusted by dragging inside the preview.
 const preview=q('team-bg-preview');let drag=null;
 preview.addEventListener('pointerdown',event=>{
  if(!previewState())return;
  drag={px:event.clientX,py:event.clientY,x:Number(q('team-bg-x').value),y:Number(q('team-bg-y').value),w:preview.clientWidth||300,h:preview.clientHeight||243};
  preview.setPointerCapture(event.pointerId);
 });
 preview.addEventListener('pointermove',event=>{
  if(!drag)return;
  q('team-bg-x').value=clamp(drag.x+(event.clientX-drag.px)/drag.w*100,-100,100);
  q('team-bg-y').value=clamp(drag.y+(event.clientY-drag.py)/drag.h*100,-100,100);
  adjust();
 });
 preview.addEventListener('pointerup',()=>drag=null);
 preview.addEventListener('pointercancel',()=>drag=null);
 updatePreview();
}
root.RKBOTeamBackground={render,imageState,getTeamKey:backgroundKey,reload:fetchPublic,
 state:()=>cfg, select:team=>handleTeamChange(team),teams:CLUBS.slice()};
document.addEventListener('DOMContentLoaded',()=>{makePanel();fetchPublic().catch(console.warn)});
root.addEventListener('rkbo-admin-connected',()=>fetchPublic().catch(console.warn));
})(window);
