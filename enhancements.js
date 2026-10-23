(function rkboEnhancements(){
"use strict";
const OWNER="p0emkite",REPO="RKBO_Draft_and_CardArchive",ROOT="",BRANCH="main";
const API="https://api.github.com/repos/"+OWNER+"/"+REPO+"/contents/";
const IMG=ROOT+"data/card-images.json",IMPORT=ROOT+"data/imports.json";
const EDIT=new URLSearchParams(location.search).get("admin")==="1";
const $=id=>document.getElementById(id);
let token="",allowed=false,working=false,editor=null;
let imageDB={version:1,images:{}},importDB={version:1,files:[]};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const encBytes=a=>{let str="";for(let i=0;i<a.length;i+=16384)str+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(str)};
const encText=s=>encBytes(new TextEncoder().encode(s));
const decText=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,"")),c=>c.charCodeAt(0)));
const urlOf=path=>path?new URL("./"+path.split("/").map(encodeURIComponent).join("/"),location.href).href:"";
function pose(p){
 const file=p.type==="투수"?"assets/default-pitcher.svg":"assets/default-batter.svg";
 return `<img class="player-pose" src="${esc(urlOf(file))}" alt="${esc(p.type==="투수"?"투구":"타격")} 동작 기본 실루엣">`;
}
function art(p){
 const a=imageDB.images?.[p.id];
 const photo=a?.path?`<img class="player-photo" src="${esc(urlOf(a.path)+(a.rev?"?rev="+a.rev:""))}" alt="${esc(p.name)} 선수 사진" loading="lazy" draggable="false" style="--photo-x:${clamp(Number(a.x)||0,-150,150)}%;--photo-y:${clamp(Number(a.y)||0,-150,150)}%;--photo-zoom:${clamp(Number(a.zoom)||1,.3,5)}">`:pose(p);
 return `${photo}<div class="emblem">${esc(p.team)}</div>${allowed?`<button type="button" class="edit-photo" data-photo-edit="${esc(p.id)}">✎ 사진 편집</button>`:""}`;
}
function refresh(){const s=$("sort");if(s)s.dispatchEvent(new Event("change",{bubbles:true}));if(editor)renderEditor()}
window.RKBOArt={render:art,refresh};
function status(t){if($("admin-status"))$("admin-status").textContent=t}
async function request(path,method="GET",content=null,sha=null){
 if(!token)throw Error("GitHub 인증이 필요합니다.");
 const options={method,headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28"}};
 if(content!==null){options.headers["Content-Type"]="application/json";options.body=JSON.stringify({message:"RKBO cards update: "+path,content,branch:BRANCH,...(sha?{sha}:{})})}
 const r=await fetch(API+path.split("/").map(encodeURIComponent).join("/"),options);
 let obj=null;try{obj=await r.json()}catch{}
 if(!r.ok){if(method==="GET"&&r.status===404)return null;throw Error("GitHub "+r.status+": "+(obj?.message||r.statusText))}
 return obj;
}
async function readJson(path){const a=await request(path);return a?{data:JSON.parse(decText(a.content)),sha:a.sha}:{data:null,sha:null}}
async function putJson(path,obj,sha){return request(path,"PUT",encText(JSON.stringify(obj,null,2)+"\n"),sha)}
async function loadPublic(){
 try{
 const path=location.protocol==="file:"?`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${IMG}`:"./data/card-images.json";
 const r=await fetch(path+"?v="+Date.now(),{cache:"no-store"});
 if(r.ok){const j=await r.json();if(j?.images&&typeof j.images==="object"){imageDB=j;refresh()}}
 }catch{}
}
function importsRender(){if(!$("admin-file-list"))return;$("admin-file-list").innerHTML=(importDB.files||[]).length?importDB.files.slice().reverse().map(f=>`<div style="border-bottom:1px solid #344b5d;padding:5px 0">${esc(f.name)} · ${(f.size/1048576).toFixed(2)} MB · ${esc(f.kind)} · ${f.chunks.length}조각</div>`).join(""):"추가된 데이터 파일이 없습니다."}
async function sync(){
 if(!token)return;
 const [a,b]=await Promise.all([readJson(IMG),readJson(IMPORT)]);
 if(a.data?.images)imageDB=a.data;
 if(b.data?.files)importDB=b.data;
 importsRender();refresh();status("✓ GitHub의 카드 사진 설정과 첨부 파일 목록을 동기화했습니다.");
}
async function login(){
 const newToken=$("admin-token").value.trim();if(!newToken)return status("토큰을 입력하세요.");
 status("계정과 쓰기 권한을 확인하는 중…");
 try{
 const opts={headers:{Authorization:"Bearer "+newToken,Accept:"application/vnd.github+json"}};
 const userRes=await fetch("https://api.github.com/user",opts);
 if(!userRes.ok)throw Error("토큰 인증 실패 ("+userRes.status+")");
 const user=await userRes.json();
 if(user.login.toLowerCase()!==OWNER.toLowerCase())throw Error("제작자 "+OWNER+" 계정만 로그인할 수 있습니다.");
 const repoRes=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`,opts);
 if(!repoRes.ok)throw Error("저장소 접근 거부 ("+repoRes.status+")");
 const repo=await repoRes.json();
 if(!repo.permissions?.push)throw Error("저장소 Contents 읽기/쓰기 권한이 필요합니다.");
 token=newToken;await sync();allowed=true;
 $("admin-token").value="";$("admin-login").hidden=true;$("admin-controls").hidden=false;refresh();
 status("✓ "+user.login+" 연결 완료. 사진·파일을 GitHub에 저장할 수 있습니다.");
 }catch(e){token="";allowed=false;status("로그인 실패: "+e.message)}
}
function imageUrl(entry){return entry?.path?urlOf(entry.path)+(entry.rev?"?rev="+entry.rev:""):""}
function renderEditor(){
 if(!editor)return;
 const a=editor.entry,src=editor.objectUrl||imageUrl(a);
 $("editor-stage").innerHTML=src?`<img alt="선수 사진 배치 미리보기" draggable="false" src="${esc(src)}" style="--photo-x:${clamp(Number(a.x)||0,-150,150)}%;--photo-y:${clamp(Number(a.y)||0,-150,150)}%;--photo-zoom:${clamp(Number(a.zoom)||1,.3,5)}">`:'<div class="editor-placeholder">이미지를 업로드하세요.<br>드래그로 위치 이동 / 휠로 확대·축소</div>';
 $("editor-zoom").value=clamp(Number(a.zoom)||1,.3,5);
 $("editor-scale-label").textContent=Math.round(Number($("editor-zoom").value)*100)+"%";
 $("editor-photo-status").textContent=editor.blob?"업로드할 새 이미지 선택됨":src?"현재 등록된 사진을 편집 중":"등록된 사진 없음";
}
function openEditor(id){
 if(!allowed)return;
 const player=JSON.parse($("data").textContent).find(p=>p.id===id);if(!player)return;
 editor={player,entry:{x:0,y:0,zoom:1,...(imageDB.images[id]||{})},blob:null,objectUrl:null};
 $("editor-title").textContent=player.name+" · 카드 사진";
 $("photo-editor-bg").hidden=false;
 $("photo-file").value="";document.body.style.overflow="hidden";renderEditor();
}
function closeEditor(){
 if(editor?.objectUrl)URL.revokeObjectURL(editor.objectUrl);
 editor=null;$("photo-editor-bg").hidden=true;document.body.style.overflow=$("modal")&&!$("modal").hidden?"hidden":"";
}
async function blobFromFile(file){
 if(!file.type.startsWith("image/"))throw Error("이미지만 업로드할 수 있습니다.");
 if(file.size>16*1048576)throw Error("16MB 이하 이미지만 선택할 수 있습니다.");
 const img=await createImageBitmap(file),ratio=Math.min(1,1400/Math.max(img.width,img.height));
 const c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));
 c.getContext("2d").drawImage(img,0,0,c.width,c.height);img.close?.();
 const blob=await new Promise(r=>c.toBlob(r,"image/webp",.88));
 if(!blob||blob.size>3*1048576)throw Error("이미지 변환 실패 또는 결과 파일 3MB 초과");
 return blob;
}
async function savePhoto(remove=false){
 if(!allowed||working||!editor)return;
 working=true;$("editor-save").disabled=true;
 const e=editor;$("editor-photo-status").textContent="GitHub에 저장하는 중…";
 try{
 let path=remove?"":e.entry.path||"",rev=remove?"":e.entry.rev||"";
 if(!remove&&e.blob){
 path="assets/cards/"+e.player.id+".webp";
 const old=await request(ROOT+path);
 await request(ROOT+path,"PUT",encBytes(new Uint8Array(await e.blob.arrayBuffer())),old?.sha||null);
 rev=Date.now().toString(36);
 }else if(!remove&&!path)throw Error("이미지를 먼저 선택하세요.");
 const latest=await readJson(IMG),db=latest.data||{version:1,images:{}};
 db.images=db.images||{};
 if(remove)delete db.images[e.player.id];
 else db.images[e.player.id]={path,x:clamp(Number(e.entry.x)||0,-150,150),y:clamp(Number(e.entry.y)||0,-150,150),zoom:clamp(Number(e.entry.zoom)||1,.3,5),rev};
 await putJson(IMG,db,latest.sha);
 imageDB=db;const playerName=e.player.name;closeEditor();refresh();
 status("✓ "+playerName+" 카드 이미지와 배치를 GitHub에 저장했습니다.");
 }catch(err){$("editor-photo-status").textContent="저장 실패: "+err.message}
 finally{working=false;$("editor-save").disabled=false}
}
async function importFiles(){
 if(!allowed||working)return;
 const list=Array.from($("import-files").files||[]),kind=$("import-kind").value;
 if(!list.length)return status("업로드할 파일을 선택해 주세요.");
 working=true;$("upload-import").disabled=true;
 try{
 for(const file of list){
 if(file.size>80*1048576)throw Error(file.name+": 80MB 초과");
 const id=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
 const parts=[],piece=700*1024,count=Math.ceil(file.size/piece);
 if(!count)throw Error("빈 파일은 첨부할 수 없습니다.");
 for(let i=0;i<count;i++){
 const path=ROOT+"imports/"+kind+"/"+id+"/"+String(i+1).padStart(3,"0")+".b64";
 const fragment=new Uint8Array(await file.slice(i*piece,Math.min(file.size,(i+1)*piece)).arrayBuffer());
 await request(path,"PUT",encText(encBytes(fragment)));parts.push(path);
 status("GitHub 업로드 중: "+file.name+" ("+(i+1)+"/"+count+")");
 }
 const curr=await readJson(IMPORT),db=curr.data||{version:1,files:[]};
 db.files=db.files||[];
 db.files.push({id,name:file.name,kind,size:file.size,format:"base64-chunks",chunkBytes:piece,chunks:parts,uploadedAt:new Date().toISOString()});
 await putJson(IMPORT,db,curr.sha);importDB=db;importsRender();
 }
 $("import-files").value="";status("✓ 원본 파일 GitHub 저장 완료. 카드 데이터 자동 추가는 다음 단계에서 지원합니다.");
 }catch(e){status("업로드 실패: "+e.message+" (중단된 조각 파일은 GitHub에서 정리 필요)")}
 finally{working=false;$("upload-import").disabled=false}
}
function init(){
 if(!EDIT)return;
 const button=document.createElement("button");button.className="admin-open";button.textContent="⚙ 제작자 모드";button.type="button";
 document.querySelector(".nav-right")?.append(button);
 const pane=document.createElement("aside");pane.id="admin-drawer";pane.className="admin-drawer";pane.hidden=true;
 pane.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between"><h2>⚙ 카드 도감 관리자</h2><button id="admin-close">닫기 ×</button></div><p>기존 도감은 그대로, 카드 사진과 데이터 파일만 GitHub에 저장합니다.</p><div id="admin-login"><label>GitHub Fine-grained Personal Access Token</label><input type="password" id="admin-token" autocomplete="off" placeholder="github_pat_…"><div class="admin-actions"><button class="primary" id="admin-connect">GitHub 연결</button></div><p class="warning">토큰은 브라우저 메모리에서만 사용합니다. ${OWNER}/${REPO}의 Contents 읽기·쓰기 권한이 필요합니다.</p></div><div id="admin-controls" hidden><div class="admin-actions"><button id="admin-sync">↻ GitHub 동기화</button><button id="admin-logout">연결 해제</button></div><hr><h2>다른 시즌·HHRecord 파일 첨부</h2><p>ZIP, XLS, HTML, CSV 등 원본을 GitHub 저장소에 보관합니다. 지금 단계에서는 업로드만 가능하고 카드 DB 자동 병합은 아직 지원하지 않습니다.</p><label>파일 종류</label><select id="import-kind"><option value="season">다른 시즌 개인성적</option><option value="hhrecord">HHRecord</option><option value="other">기타 자료</option></select><label>원본 파일</label><input type="file" id="import-files" multiple accept=".html,.htm,.xls,.xlsx,.csv,.zip,.json,.txt"><div class="admin-actions"><button id="upload-import" class="primary">선택 파일 GitHub 저장</button></div><p class="warning">공개 저장소이므로 업로드 자료도 공개됩니다. 권리·개인정보 확인 후 업로드하세요.</p><h2>첨부 내역</h2><div id="admin-file-list" class="admin-file-list"></div></div><hr><div class="admin-status" id="admin-status">GitHub로 제작자 인증 후 편집할 수 있습니다.</div>`;
 document.body.append(pane);
 const dialog=document.createElement("div");dialog.className="photo-editor-bg";dialog.id="photo-editor-bg";dialog.hidden=true;
 dialog.innerHTML=`<div class="photo-editor" role="dialog" aria-modal="true"><div class="editor-head"><h2 id="editor-title">선수 이미지</h2><button id="editor-close">닫기 ×</button></div><p>사진을 선택하고 드래그 / 휠로 배치를 조정한 다음 GitHub에 저장하세요.</p><input id="photo-file" type="file" accept="image/*"><div class="editor-stage" id="editor-stage"></div><div class="editor-row"><label>크기 <span id="editor-scale-label">100%</span></label><input id="editor-zoom" type="range" min="0.3" max="5" step="0.01" value="1"></div><div class="editor-actions"><button id="editor-center">위치·크기 초기화</button><button id="editor-reset">사진 삭제 / 실루엣 복귀</button><button id="editor-save" class="primary">GitHub에 이미지 저장</button></div><p id="editor-photo-status" aria-live="polite">등록된 사진 없음</p></div>`;
 document.body.append(dialog);
 button.addEventListener("click",()=>pane.hidden=!pane.hidden);
 $("admin-close").addEventListener("click",()=>pane.hidden=true);
 $("admin-connect").addEventListener("click",login);
 $("admin-token").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
 $("admin-sync").addEventListener("click",()=>sync().catch(e=>status("동기화 실패: "+e.message)));
 $("admin-logout").addEventListener("click",()=>{token="";allowed=false;$("admin-login").hidden=false;$("admin-controls").hidden=true;status("연결 해제되었습니다.");refresh()});
 $("upload-import").addEventListener("click",importFiles);
 $("editor-close").addEventListener("click",closeEditor);
 $("editor-save").addEventListener("click",()=>savePhoto());
 $("editor-reset").addEventListener("click",()=>{if(confirm("이미지를 삭제하고 기본 실루엣으로 복귀할까요?"))savePhoto(true)});
 $("editor-center").addEventListener("click",()=>{if(!editor)return;Object.assign(editor.entry,{x:0,y:0,zoom:1});renderEditor()});
 $("photo-file").addEventListener("change",async e=>{if(!editor||!e.target.files[0])return;try{const blob=await blobFromFile(e.target.files[0]);if(editor.objectUrl)URL.revokeObjectURL(editor.objectUrl);editor.blob=blob;editor.objectUrl=URL.createObjectURL(blob);renderEditor()}catch(err){$("editor-photo-status").textContent=err.message}});
 $("editor-zoom").addEventListener("input",e=>{if(!editor)return;editor.entry.zoom=Number(e.target.value);renderEditor()});
 const stage=$("editor-stage");let drag=null;
 stage.addEventListener("wheel",e=>{if(!editor)return;e.preventDefault();editor.entry.zoom=clamp((Number(editor.entry.zoom)||1)*(e.deltaY>0?.93:1.07),.3,5);renderEditor()},{passive:false});
 stage.addEventListener("pointerdown",e=>{if(!editor)return;drag={x:e.clientX,y:e.clientY,a:Number(editor.entry.x)||0,b:Number(editor.entry.y)||0};stage.setPointerCapture(e.pointerId)});
 stage.addEventListener("pointermove",e=>{if(!drag||!editor)return;const box=stage.getBoundingClientRect();editor.entry.x=clamp(drag.a+(e.clientX-drag.x)/box.width*100,-150,150);editor.entry.y=clamp(drag.b+(e.clientY-drag.y)/box.height*100,-150,150);renderEditor()});
 stage.addEventListener("pointerup",()=>drag=null);stage.addEventListener("pointercancel",()=>drag=null);
 $("cards").addEventListener("click",e=>{const b=e.target.closest("[data-photo-edit]");if(!b)return;e.preventDefault();e.stopImmediatePropagation();openEditor(b.dataset.photoEdit)},true);
 dialog.addEventListener("click",e=>{if(e.target===dialog)closeEditor()});
 window.addEventListener("keydown",e=>{if(e.key==="Escape"&&editor)closeEditor()});
}
document.addEventListener("DOMContentLoaded",()=>{init();loadPublic()});
})();
