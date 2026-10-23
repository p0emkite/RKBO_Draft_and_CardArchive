/* RKBO Card Archive · v0.3
   Standalone RKBO Card Archive.
   Public viewer: anonymous read-only.
   Admin: ?admin=1 and an owner-owned GitHub fine-grained token. The token is kept
   in JS memory only; it is NEVER written to localStorage or repository content. */
(function(){
'use strict';
const OWNER='p0emkite', REPO='RKBO_Draft_and_CardArchive', BASE='';
const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
const IMAGE_META=BASE+'data/card-images.json', IMPORT_META=BASE+'data/imports.json';
const EDIT_MODE=new URLSearchParams(location.search).get('admin')==='1';
let token='', authorized=false, activeEditor=null, busy=false;
let imgConfig={version:1,images:{}}, imported={version:1,files:[]};
let previewCache={};
let metaSha=null, importSha=null;
const q=id=>document.getElementById(id);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base64bytes=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384){s+=String.fromCharCode(...bytes.subarray(i,i+16384))}return btoa(s)};
const decode64=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0)));
const encode64=s=>base64bytes(new TextEncoder().encode(s));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const imgSrc=(path)=>{if(!path)return '';const safe=path.split('/').map(encodeURIComponent).join('/');return new URL('./'+safe,document.baseURI).href};
const teamLogo=team=>imgSrc('assets/teams/'+team+(team==='NC'?'.png':'.svg'));
const teamMeta={DOO:['#202f6c','#a9bee8'],HAN:['#d97521','#ffd08f'],KIA:['#bd3445','#ffc0bf'],KT:['#222','#bbb'],LG:['#aa3053','#f7bfd0'],LOT:['#659cbb','#e0f4ff'],NC:['#b79c64','#ffedbd'],SAM:['#407acb','#c0ddff'],SSG:['#ffb81c','#ffe3a1'],KIW:['#6a1e3f','#e6b6c8']};
const gradeMeta={브론즈:{metal:'#d39a73',dark:'#684335',label:'브론즈'},실버:{metal:'#c9d7df',dark:'#617b8d',label:'실버'},골드:{metal:'#f4cf74',dark:'#a57532',label:'골드'},코랄:{metal:'#F6909D',dark:'#ab5e67',label:'코랄'},다이아몬드:{metal:'#90ecff',dark:'#417baa',label:'다이아몬드'}};
const styleVars=p=>{const g=gradeMeta[p.grade],tm=teamMeta[p.team];return `--rim:${g.metal};--metal:${g.metal};--glow:${g.dark}44;--jersey:${tm[0]};--team-dim:${tm[0]}78`};
function photoHtml(p){const temp=previewCache[p.id];const entry=temp||imgConfig.images?.[p.id];if(!entry)return '';
 const x=Number(entry.x)||0,y=Number(entry.y)||0,zoom=Number(entry.zoom)||1;
 const url=entry.url||(entry.path?imgSrc(entry.path)+(entry.rev?'?rev='+encodeURIComponent(entry.rev):''):'');
 if(!url)return '';
 return `<img class="player-photo" src="${h(url)}" draggable="false" alt="${h(p.name)} 이미지" loading="lazy" style="--photo-x:${clamp(x,-150,150)}%;--photo-y:${clamp(y,-150,150)}%;--photo-zoom:${clamp(zoom,.3,5)}">`;
}
function poseHtml(p){
 const file=p.type==='투수'?'assets/default-pitcher.png':'assets/default-batter.png';
 return `<img class="player-pose" src="${h(imgSrc(file))}" draggable="false" alt="${h(p.type==='투수'?'투구':'타격')} 동작 기본 실루엣">`;
}
const art={render(p){return `${photoHtml(p)||poseHtml(p)}${authorized?`<button class="edit-photo" type="button" data-photo-edit="${h(p.id)}" aria-label="${h(p.name)} 사진 편집">✎ 사진 편집</button>`:''}`},refresh};
window.RKBOArt=art;
function refresh(){const sort=q('sort');if(sort)sort.dispatchEvent(new Event('change',{bubbles:true}));if(activeEditor)renderEditor()}
function setStatus(s){if(q('admin-status'))q('admin-status').textContent=s}
async function gh(path,method='GET',data=null,sha=null){
 if(!token)throw new Error('GitHub 토큰이 없습니다.');
 const url=API+path.split('/').map(encodeURIComponent).join('/');
 const options={method,headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}};
 if(data!==null){options.headers['Content-Type']='application/json';options.body=JSON.stringify({message:`RKBO card archive: ${path.split('/').pop()} update`,content:data,branch:'main',...(sha?{sha}:{} )})}
 const res=await fetch(url,options);let payload=null;try{payload=await res.json()}catch(e){}
 if(!res.ok){if(res.status===404&&method==='GET')return null;throw new Error(`GitHub ${res.status}: ${payload?.message||res.statusText}`)}return payload;
}
async function readJson(path){const file=await gh(path);if(!file)return {sha:null,data:null};if(!file.content)throw Error('파일 응답에 데이터가 없습니다.');return {sha:file.sha,data:JSON.parse(decode64(file.content))}}
async function putJson(path,data,sha){return gh(path,'PUT',encode64(JSON.stringify(data,null,2)+'\n'),sha)}
async function loadPublished(){
 try{const source=location.protocol==='file:'?`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${IMAGE_META}`:'./data/card-images.json';
 const response=await fetch(source+(source.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});
 if(response.ok){const data=await response.json();if(data&&typeof data.images==='object'){imgConfig=data;refresh()}}
 }catch(e){/* remain on default SVG silhouettes when offline */}
}
async function connect(){
 const raw=q('admin-token').value.trim();if(!raw){setStatus('토큰을 입력하세요.');return}
 setStatus('GitHub 계정과 저장소 쓰기 권한을 확인하고 있습니다…');
 try{
 const response=await fetch('https://api.github.com/user',{headers:{'Authorization':'Bearer '+raw,'Accept':'application/vnd.github+json'}});
 if(!response.ok)throw Error('토큰 인증 실패 ('+response.status+')');
 const user=await response.json();if(String(user.login).toLowerCase()!==OWNER.toLowerCase())throw Error('제작자 계정('+OWNER+')만 관리자 모드를 사용할 수 있습니다.');
 const check=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`,{headers:{'Authorization':'Bearer '+raw,'Accept':'application/vnd.github+json'}});
 if(!check.ok)throw Error('저장소 접근 거부 ('+check.status+'). 토큰의 저장소 범위를 확인하세요.');
 const repo=await check.json();if(!repo.permissions?.push)throw Error('저장소 Contents: Read and write 권한이 필요합니다.');
 token=raw;q('admin-token').value='';authorized=true;
 await syncAll(true);q('admin-controls').hidden=false;q('admin-login').hidden=true;refresh();
 setStatus(`✓ ${user.login} 연결 완료. 카드 사진과 자료를 새 카드 도감 저장소의 GitHub main에 저장할 수 있습니다.`)
 }catch(e){token='';authorized=false;setStatus('연결 실패: '+e.message)}
}
async function syncAll(show=false){
 if(!token)return;
 const [imgs,files]=await Promise.all([readJson(IMAGE_META),readJson(IMPORT_META)]);
 if(imgs.data&&typeof imgs.data.images==='object')imgConfig=imgs.data;
 if(files.data&&Array.isArray(files.data.files))imported=files.data;
 metaSha=imgs.sha;importSha=files.sha;for(const k of Object.keys(previewCache)){if(previewCache[k]?.url?.startsWith('blob:'))URL.revokeObjectURL(previewCache[k].url)}previewCache={};renderImports();renderImageList();refresh();
 if(show)setStatus('✓ GitHub의 카드 이미지 설정 및 파일 목록을 동기화했습니다.');
}
function renderImageList(){const el=q('admin-image-list'),count=q('admin-image-count');const entries=Object.entries(imgConfig.images||{});if(count)count.textContent=entries.length+'명 등록';if(!el)return;el.innerHTML=entries.length?entries.map(([id,v])=>`<div style="padding:4px 0;border-bottom:1px solid #2d4358">${h(id)} · ${h(v.path||'미등록')}</div>`).join(''):'아직 GitHub에 저장된 선수 이미지가 없습니다.';}
function renderImports(){const container=q('admin-file-list');if(!container)return;container.innerHTML=imported.files.length?imported.files.slice().reverse().map(x=>`<div style="padding:5px 0;border-bottom:1px solid #253b50">${h(x.name)} · ${(x.size/1024/1024).toFixed(2)} MB · ${h(x.kind)} · ${x.chunks?.length||0}개 조각</div>`).join(''):'저장된 추가 원본 파일이 없습니다.'}
function chooseFile(){q('photo-file').click()}
async function imageToWebp(file){if(!file.type.startsWith('image/'))throw Error('이미지 파일만 선택할 수 있습니다.');
 if(file.size>16*1024*1024)throw Error('16MB 이하 이미지 파일만 사용할 수 있습니다.');
 const img=await createImageBitmap(file);const maxDim=1400;const ratio=Math.min(1,maxDim/Math.max(img.width,img.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*ratio));canvas.height=Math.max(1,Math.round(img.height*ratio));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);img.close?.();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));if(!blob)throw Error('WebP 변환에 실패했습니다.');
 if(blob.size>3*1024*1024)throw Error('변환된 이미지가 3MB를 넘습니다. 더 작은 이미지를 사용하세요.');
 return blob;
}
function imgUrlFromBlob(blob){return URL.createObjectURL(blob)}
function startEdit(id){if(!authorized)return;const p=JSON.parse(q('data').textContent).find(x=>x.id===id);if(!p)return;
 const pending=previewCache[id];activeEditor={p,blob:pending?.blob||null,url:pending?.url||null,entry:{x:0,y:0,zoom:1,...(imgConfig.images[id]||{}),...(pending||{})}};
 q('photo-editor-bg').hidden=false;document.body.style.overflow='hidden';q('editor-title').textContent=p.name+' · 카드 사진';q('photo-file').value='';renderEditor()}
function editorImageSource(e){return e.url||(e.entry.path?imgSrc(e.entry.path)+(e.entry.rev?'?rev='+encodeURIComponent(e.entry.rev):''):'')}
function updateEditorTransform(){const e=activeEditor;if(!e)return;const stage=q('editor-stage'),img=stage?.querySelector('.headshot .player-photo');if(img){img.style.setProperty('--photo-x',clamp(Number(e.entry.x)||0,-150,150)+'%');img.style.setProperty('--photo-y',clamp(Number(e.entry.y)||0,-150,150)+'%');img.style.setProperty('--photo-zoom',clamp(Number(e.entry.zoom)||1,.3,5));}q('editor-zoom').value=clamp(Number(e.entry.zoom)||1,.3,5);q('editor-scale-label').textContent=Math.round(Number(q('editor-zoom').value)*100)+'%';}
function renderEditor(){const e=activeEditor;if(!e)return;const src=editorImageSource(e),stage=q('editor-stage');
 if(!window.RKBOCardView?.render){q('editor-photo-status').textContent='카드 렌더링 기능을 불러오지 못했습니다.';return}
 stage.innerHTML='<div class="editor-card-wrap">'+window.RKBOCardView.render(e.p)+'</div>';
 const preview=stage.querySelector('.player-card');preview?.classList.add('preview-card');preview?.removeAttribute('role');preview?.removeAttribute('tabindex');
 if(src){const head=stage.querySelector('.headshot'),old=head?.querySelector('.player-photo,.player-pose');if(old){const img=document.createElement('img');img.className='player-photo';img.src=src;img.alt='선수 사진 카드 미리보기';img.draggable=false;old.replaceWith(img)}}
 updateEditorTransform();
 q('editor-photo-status').textContent=e.blob?'새 이미지 선택됨 · 도감에 적용하거나 GitHub에 저장할 수 있습니다.':src?'실제 카드 배치를 편집하고 있습니다.':'기본 실루엣을 표시 중입니다.';
}
function applyPreview(){if(!activeEditor)return;const e=activeEditor,src=editorImageSource(e);
 if(!src){delete previewCache[e.p.id];refresh();q('editor-photo-status').textContent='등록 이미지가 없어 기본 실루엣으로 표시합니다.';return}
 const old=previewCache[e.p.id];if(old?.url&&old.url.startsWith('blob:')&&old.url!==src)URL.revokeObjectURL(old.url);
 previewCache[e.p.id]={path:e.entry.path||'',rev:e.entry.rev||'',x:clamp(Number(e.entry.x)||0,-150,150),y:clamp(Number(e.entry.y)||0,-150,150),zoom:clamp(Number(e.entry.zoom)||1,.3,5),url:src,blob:e.blob||null};
 refresh();q('editor-photo-status').textContent='✓ 도감에 즉시 적용됐습니다. 다른 방문자와 공유하려면 GitHub 저장을 누르세요.';
}
function closeEditor(){if(activeEditor?.url&&activeEditor.url.startsWith('blob:')&&previewCache[activeEditor.p.id]?.url!==activeEditor.url)URL.revokeObjectURL(activeEditor.url);activeEditor=null;q('photo-editor-bg').hidden=true;document.body.style.overflow=q('modal')&&!q('modal').hidden?'hidden':''}
async function saveImage(reset=false){if(!authorized||busy||!activeEditor)return;
 const e=activeEditor;busy=true;q('editor-save').disabled=true;q('editor-photo-status').textContent='GitHub에 저장 중…';
 try{
 let path=e.entry.path||'';let rev=e.entry.rev||'';
 if(reset){path='';rev=''}
 else if(e.blob){path='assets/cards/'+e.p.id+'.webp';const arr=new Uint8Array(await e.blob.arrayBuffer());const before=await gh(BASE+path);await gh(BASE+path,'PUT',base64bytes(arr),before?.sha||null);rev=Date.now().toString(36)}
 else if(!path)throw Error('먼저 이미지를 선택해 주세요.');
 // Re-read SHA to avoid overwriting an update made in another browser.
 const current=await readJson(IMAGE_META);const latest=current.data||{version:1,images:{}};
 latest.images=latest.images||{};
 if(reset)delete latest.images[e.p.id];
 else latest.images[e.p.id]={path,x:clamp(Number(e.entry.x)||0,-150,150),y:clamp(Number(e.entry.y)||0,-150,150),zoom:clamp(Number(e.entry.zoom)||1,.3,5),rev};
 await putJson(IMAGE_META,latest,current.sha);imgConfig=latest;delete previewCache[e.p.id];
 if(e.url?.startsWith('blob:'))URL.revokeObjectURL(e.url);e.url=null;refresh();closeEditor();renderImageList();setStatus('✓ '+e.p.name+' 카드 이미지와 배치를 GitHub에 저장했습니다. 공개 도감에도 연동됩니다.');
 }catch(err){q('editor-photo-status').textContent='저장 실패: '+err.message}
 finally{busy=false;q('editor-save').disabled=false}
}
async function importFiles(){if(!authorized||busy)return;const fileList=Array.from(q('import-files').files||[]),kind=q('import-kind').value;
 if(!fileList.length){setStatus('먼저 파일을 선택하세요.');return}
 busy=true;q('upload-import').disabled=true;
 try{
 for(const file of fileList){
  if(file.size>80*1024*1024)throw Error(file.name+': 80MB를 초과하여 업로드할 수 없습니다.');
  const safeName=file.name.replace(/[^a-zA-Z0-9가-힣_.()\-]/g,'_').slice(0,100);
  const stamp=Date.now().toString(36);const fileId=stamp+'-'+Math.random().toString(36).slice(2,8);
  const paths=[],step=700*1024,total=Math.ceil(file.size/step);
  if(!total)throw Error('빈 파일은 업로드할 수 없습니다.');
  for(let i=0;i<total;i++){
   // GitHub Contents API is used in small chunks for archives >1 MB.
   const path=`${BASE}imports/${kind}/${fileId}/${String(i+1).padStart(3,'0')}.b64`;
   const slice=new Uint8Array(await file.slice(i*step,Math.min(file.size,(i+1)*step)).arrayBuffer());
   // Contents API body includes base64 of the UTF-8 base64 string.
   await gh(path,'PUT',encode64(base64bytes(slice)),null);paths.push(path);
   setStatus(`업로드 중: ${file.name} (${i+1}/${total} 조각)\n이 창을 닫거나 새로고침하지 마세요.`);
  }
  const curr=await readJson(IMPORT_META);const latest=curr.data||{version:1,files:[]};latest.files=latest.files||[];
  latest.files.push({id:fileId,name:safeName,originalName:file.name,kind,size:file.size,mime:file.type||'application/octet-stream',chunks:paths,format:'base64-chunks',chunkBytes:step,uploadedAt:new Date().toISOString()});
  await putJson(IMPORT_META,latest,curr.sha);imported=latest;importSha=null;renderImports();
 }
 q('import-files').value='';setStatus('✓ 파일이 GitHub에 업로드되었습니다. 원본 보관 단계이며 시즌 카드 자동 생성/반영은 아직 지원하지 않습니다.');
 }catch(e){setStatus('업로드 실패: '+e.message+'\n중단된 업로드 조각은 GitHub에서 정리해야 할 수 있습니다.')}
 finally{busy=false;q('upload-import').disabled=false}
}
function initAdmin(){if(!EDIT_MODE)return;
 const b=document.createElement('button');b.id='admin-open';b.className='admin-open';b.type='button';b.textContent='⚙ 제작자 모드';document.querySelector('.nav-right')?.append(b);
 const drawer=document.createElement('aside');drawer.id='admin-drawer';drawer.className='admin-drawer';drawer.hidden=true;drawer.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><h2>⚙ RKBO 카드 도감 관리자</h2><button type="button" id="admin-close">닫기 ×</button></div>
 <p>선수 카드 이미지, 이미지 배치 설정, HHRecord·시즌 원본 파일을 GitHub에 저장합니다.</p>
 <div id="admin-login"><label for="admin-token">GitHub Fine-grained Personal Access Token</label><input id="admin-token" type="password" autocomplete="off" placeholder="github_pat_…"><div class="admin-actions"><button type="button" class="primary" id="admin-connect">GitHub 연결</button></div><div class="warning">토큰은 현재 열린 페이지의 메모리에서만 사용하며 저장하지 않습니다. ${OWNER}/${REPO} 저장소 Contents 읽기·쓰기 권한이 필요합니다.</div></div>
 <div id="admin-controls" hidden><div class="admin-actions"><button id="admin-sync" type="button">↻ GitHub 전체 동기화</button><button id="admin-logout" type="button">연결 해제</button></div><hr><h2>선수 카드 이미지 저장소 <span id="admin-image-count">0명 등록</span></h2><p>사진은 카드의 ✎ 편집에서 업로드하고, 배치를 적용한 후 GitHub에 저장합니다. 아래 목록과 도감은 같은 이미지 데이터를 사용합니다.</p><div id="admin-image-list" class="admin-file-list"></div><div class="admin-actions"><button type="button" id="admin-image-sync">↻ 카드 이미지 동기화</button></div><hr><h2>시즌·HHRecord 자료 첨부</h2><p>확장자 .html/.htm/.xls/.xlsx/.csv/.zip/.json 등. 선택한 자료는 GitHub에 원본 보관만 되며, 선수 카드 데이터 자동 반영은 다음 단계입니다.</p><label for="import-kind">자료 종류</label><select id="import-kind"><option value="season">다른 시즌 개인 성적</option><option value="hhrecord">HHRecord</option><option value="other">기타 데이터</option></select><label for="import-files">추가 파일 선택</label><input type="file" id="import-files" multiple accept=".html,.htm,.xls,.xlsx,.csv,.zip,.json,.txt"><div class="admin-actions"><button class="primary" id="upload-import" type="button">선택 파일 GitHub 저장</button></div><div class="warning">주의: 공개 GitHub 저장소이므로 업로드한 자료도 공개될 수 있습니다. 저작권·개인정보를 확인하세요.</div><h2 style="margin-top:15px">업로드 내역</h2><div id="admin-file-list" class="admin-file-list"></div><div class="warning" style="margin-top:10px">선수 사진은 <code>assets/cards/</code>, 이미지 배치 정보는 <code>data/card-images.json</code>에 저장되어 함께 연동됩니다.</div></div><hr><div class="admin-status" id="admin-status">토큰으로 제작자 인증한 후 편집할 수 있습니다.</div>`;
 document.body.append(drawer);
 const overlay=document.createElement('div');overlay.id='photo-editor-bg';overlay.className='photo-editor-bg';overlay.hidden=true;
 overlay.innerHTML=`<div class="photo-editor" role="dialog" aria-modal="true" aria-label="선수 카드 사진 편집"><div class="editor-head"><h2 id="editor-title">카드 사진 편집</h2><button id="editor-close" type="button">닫기 ×</button></div><p>사진 업로드 → 실제 카드 미리보기에서 드래그해 위치 조절 → 휠 또는 슬라이더로 확대·축소 → 적용 후 GitHub 저장.</p><input id="photo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"><div class="editor-stage" id="editor-stage"></div><div class="editor-row"><label for="editor-zoom">크기 <span id="editor-scale-label">100%</span></label><input type="range" id="editor-zoom" min="0.3" max="5" value="1" step="0.01"></div><div class="editor-actions"><button id="editor-center" type="button">위치·크기 초기화</button><button id="editor-apply" type="button">도감에 즉시 적용</button><button id="editor-reset" type="button">사진 삭제(기본 실루엣)</button><button class="primary" id="editor-save" type="button">GitHub에 사진·위치 저장</button></div><p id="editor-photo-status" aria-live="polite">등록 이미지 없음</p></div>`;
 document.body.append(overlay);
 b.addEventListener('click',()=>{drawer.hidden=!drawer.hidden});q('admin-close').addEventListener('click',()=>drawer.hidden=true);
 q('admin-connect').addEventListener('click',connect);q('admin-token').addEventListener('keydown',e=>{if(e.key==='Enter')connect()});
 q('admin-sync').addEventListener('click',()=>syncAll(true).catch(e=>setStatus('동기화 실패: '+e.message)));
 q('admin-image-sync').addEventListener('click',()=>syncAll(true).catch(e=>setStatus('이미지 동기화 실패: '+e.message)));
 q('admin-logout').addEventListener('click',()=>{token='';authorized=false;q('admin-login').hidden=false;q('admin-controls').hidden=true;setStatus('연결 해제 완료. 새로 로그인해야 편집할 수 있습니다.');refresh()});
 q('upload-import').addEventListener('click',importFiles);
 q('editor-close').addEventListener('click',closeEditor);
 q('editor-apply').addEventListener('click',applyPreview);
 q('editor-save').addEventListener('click',()=>saveImage(false));
 q('editor-reset').addEventListener('click',()=>{if(confirm('선수의 등록 사진을 삭제하고 기본 실루엣으로 되돌릴까요?'))saveImage(true)});
 q('editor-center').addEventListener('click',()=>{if(!activeEditor)return;Object.assign(activeEditor.entry,{x:0,y:0,zoom:1});renderEditor()});
 q('photo-file').addEventListener('change',async e=>{if(!activeEditor||!e.target.files[0])return;
 try{const blob=await imageToWebp(e.target.files[0]);if(activeEditor.url?.startsWith('blob:')&&previewCache[activeEditor.p.id]?.url!==activeEditor.url)URL.revokeObjectURL(activeEditor.url);activeEditor.blob=blob;activeEditor.url=imgUrlFromBlob(blob);renderEditor()}
 catch(err){q('editor-photo-status').textContent=err.message}});
 q('editor-zoom').addEventListener('input',e=>{if(!activeEditor)return;activeEditor.entry.zoom=Number(e.target.value);updateEditorTransform()});
 const stage=q('editor-stage');let start=null;
 stage.addEventListener('wheel',e=>{if(!activeEditor||!e.target.closest('.headshot'))return;e.preventDefault();activeEditor.entry.zoom=clamp((Number(activeEditor.entry.zoom)||1)*(e.deltaY>0?.93:1.07),.3,5);updateEditorTransform()},{passive:false});
 stage.addEventListener('pointerdown',e=>{if(!activeEditor||!e.target.closest('.headshot'))return;const area=stage.querySelector('.headshot');start={x:e.clientX,y:e.clientY,ax:Number(activeEditor.entry.x)||0,ay:Number(activeEditor.entry.y)||0,width:area.clientWidth||280,height:area.clientHeight||190};stage.setPointerCapture(e.pointerId)});
 stage.addEventListener('pointermove',e=>{if(!start||!activeEditor)return;activeEditor.entry.x=clamp(start.ax+(e.clientX-start.x)/start.width*100,-150,150);activeEditor.entry.y=clamp(start.ay+(e.clientY-start.y)/start.height*100,-150,150);updateEditorTransform()});
 stage.addEventListener('pointerup',()=>start=null);stage.addEventListener('pointercancel',()=>start=null);
 document.querySelector('#cards')?.addEventListener('click',e=>{const edit=e.target.closest('[data-photo-edit]');if(!edit)return;e.preventDefault();e.stopImmediatePropagation();startEdit(edit.dataset.photoEdit)},true);
 overlay.addEventListener('click',e=>{if(e.target===overlay)closeEditor()});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&activeEditor)closeEditor()});
}
document.addEventListener('DOMContentLoaded',()=>{initAdmin();loadPublished()});
})();
