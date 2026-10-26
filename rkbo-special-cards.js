/* RKBO special award cards: separate collectibles derived from verified season originals.
 * Definitions/asset metadata live in GitHub; no browser writes Supabase inventory or alters pack odds.
 * Admin save requires RKBOAdminBridge's verified GitHub Contents-write token.
 */
(function(root){"use strict";
const PATH="data/special-cards.json";
const CODES=["ROY","DREAM","NANUM","MVP","RELIEF"];
const TYPES={
 ROY:{label:"신인왕",bonus:5,metal:"#e5b966",dark:"#6d491d"},
 DREAM:{label:"드림",bonus:3,metal:"#9bd5f4",dark:"#38779e"},
 NANUM:{label:"나눔",bonus:3,metal:"#9bc5de",dark:"#235371"},
 MVP:{label:"MVP",bonus:5,metal:"#ffdc91",dark:"#915d1e"},
 RELIEF:{label:"베스트릴리프",bonus:5,metal:"#eabb74",dark:"#604725"}
};
const dreamTeams=new Set(["SAM","LOT","DOO","SSG","SK"]);
const nanumTeams=new Set(["KIA","HAN","LG","NC"]);
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp=(x,l,h)=>Math.max(l,Math.min(h,Number(x)||0));
const suffix=(base,code)=>base+"-SPECIAL-"+code;
let cfg={version:1,cards:[],backgrounds:{},emblems:{}},saving=false,uiReady=false;
const q=id=>document.getElementById(id);
const bridge=()=>root.RKBOAdminBridge;
const fileURL=(path,commit,rev)=>{
 if(!path)return "";
 const clean=String(path).split("/").map(encodeURIComponent).join("/");
 const pinned=/^[0-9a-f]{40}$/i.test(String(commit||""))?commit:"main";
 return "https://raw.githubusercontent.com/p0emkite/RKBO_Draft_and_CardArchive/"+pinned+"/"+clean+(rev?"?v="+encodeURIComponent(rev):"");
};
const sourcePath=code=>"assets/special-emblems/"+code+".webp";
const bgPath=code=>"assets/special-backgrounds/"+code+".webp";
function icon(code){
 const entry=cfg.emblems?.[code];
 return entry?.path?fileURL(entry.path,entry.commit,entry.rev):fileURL(sourcePath(code));
}
function backgroundFor(p){
 if(!p?.specialKind)return null;
 const entry=cfg.backgrounds?.[p.specialKind];
 return entry?.path?{...entry,url:fileURL(entry.path,entry.commit,entry.rev)}:null;
}
function backgroundMarkup(p){
 const entry=backgroundFor(p);if(!entry)return "";
 return '<img class="team-background-photo rkbo-special-background" src="'+esc(entry.url)+'" alt="" aria-hidden="true" draggable="false" style="--team-bg-x:'+
 clamp(entry.x,-100,100)+'%;--team-bg-y:'+clamp(entry.y,-100,100)+'%;--team-bg-zoom:'+clamp(entry.zoom??1,.35,3.5)+'">'+
 '<span class="team-background-shade" style="--team-bg-overlay:'+clamp(entry.overlay,0,100)/100+'" aria-hidden="true"></span>';
}
function definition(baseId,code){return (cfg.cards||[]).find(d=>d.baseId===baseId&&d.kind===code)||null}
function derived(base,kind){
 const type=TYPES[kind];if(!type||base.specialKind)return null;
 const ratings={...base.ratings};
 for(const key of base.type==="타자"?["정확","파워","선구","주루","수비"]:["구위","제구","피안타 억제","피홈런 억제","체력"]){
  if(Number.isFinite(Number(ratings[key]))&&ratings[key]!==null&&ratings[key]!==undefined)
   ratings[key]=Math.min(99,Math.round(Number(ratings[key]))+type.bonus);
 }
 const id=suffix(base.id,kind);
 return {...base,id,baseCardId:base.id,specialKind:kind,specialBonus:type.bonus,grade:type.label,
  ovr:Math.min(99,Math.round(Number(base.ovr))+type.bonus),ratings,
  rank:base.rank,sourceGrade:base.grade,sourceOVR:base.ovr,
  sourceSeason:base.season};
}
function addTo(plain,season){
 if(!Array.isArray(plain))return plain;
 const bases=plain.filter(p=>!p.specialKind),byId=new Map(bases.map(p=>[p.id,p]));
 const variants=[];
 for(const record of cfg.cards||[]){
  if(Number(record.season)!==Number(season)||!CODES.includes(record.kind))continue;
  const base=byId.get(record.baseId);if(!base||record.baseId!==base.id)continue;
  // All Star conference membership follows the team's season identity.
  const code=root.RKBOTeamBrand?.code?.(base)||base.team;
  if(record.kind==="DREAM"&&!dreamTeams.has(code))continue;
  if(record.kind==="NANUM"&&!nanumTeams.has(code))continue;
  if(record.kind==="RELIEF"&&(base.type!=="투수"||base.pos!=="RP"))continue;
  const copy=derived(base,record.kind);
  if(copy)variants.push(copy);
 }
 return bases.concat(variants);
}
async function load(){
 try{
  const response=await fetch("./"+PATH+"?v="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw Error("HTTP "+response.status);
  const data=await response.json();
  if(data.version!==1||!Array.isArray(data.cards)||!data.backgrounds||!data.emblems)
   throw Error("특수카드 설정 형식이 올바르지 않습니다.");
  cfg=data;
 }catch(e){console.warn("[RKBO special cards] Public metadata unavailable",e)}
 return cfg;
}
function status(message){const el=q("rkbo-special-status");if(el)el.textContent=message}
function editStatus(message){const el=q("rkbo-special-editor-status");if(el)el.textContent=message}
async function saveManifest(next,message){
 const api=bridge();if(!api?.isAuthorized?.())throw Error("GitHub 관리자 인증이 필요합니다.");
 // Always merge against latest public repository state to avoid losing another admin's edits.
 const remote=await api.readJson(PATH);
 const current=remote?.data&&Array.isArray(remote.data.cards)?remote.data:{version:1,cards:[],backgrounds:{},emblems:{}};
 const result=next(current);
 const saved=await api.writeJson(PATH,result,remote?.sha||null);
 cfg=result;
 root.RKBOSeason?.refreshSpecial?.();
 root.dispatchEvent(new CustomEvent("rkbo-special-updated"));
 return saved;
}
function allowed(base,code){
 const club=root.RKBOTeamBrand?.code?.(base)||base.team;
 if(code==="DREAM")return dreamTeams.has(club);
 if(code==="NANUM")return nanumTeams.has(club);
 if(code==="RELIEF")return base.type==="투수"&&base.pos==="RP";
 return true;
}
async function setCard(base,code,enabled){
 if(saving)return;
 if(!allowed(base,code))throw Error("이 선수는 "+TYPES[code]?.label+" 구단/포지션 조건에 해당하지 않습니다.");
 if(base.specialKind)throw Error("특수카드가 아닌 원본 선수 카드를 선택하세요.");
 if(!root.confirm((enabled?"생성":"삭제")+": "+base.season+"차 "+base.name+" · "+TYPES[code].label+
  " 특수카드를 "+(enabled?"지정할까요? (원본 카드와 스탯은 유지됩니다.)":"도감에서 제거할까요?")))return;
 saving=true;editStatus("GitHub에 특수카드 지정 저장 중…");
 try{
  await saveManifest(old=>{
   const cards=(old.cards||[]).filter(r=>!(r.baseId===base.id&&r.kind===code));
   if(enabled)cards.push({season:Number(base.season),baseId:base.id,kind:code,createdAt:new Date().toISOString()});
   return {...old,version:1,cards};
  },"special "+code);
  editStatus("✓ "+TYPES[code].label+(enabled?" 특수카드 생성":" 지정 해제")+" 완료");
  // Open the newly generated distinct card immediately, not just the normal card.
  root.RKBOSeason?.showPlayer?.(enabled?suffix(base.id,code):base.id);
 }finally{saving=false}
}
function mount(p){
 const stats=q("modal-body")?.querySelector(".detail-stats");
 if(!stats||!bridge()?.isAuthorized?.())return;
 const prev=stats.querySelector("#rkbo-special-editor");if(prev)prev.remove();
 const original=p.specialKind
  ?root.RKBOSeason?.players?.().find(x=>x.id===p.baseCardId)
  :p;
 if(!original)return;
 const section=document.createElement("section");section.id="rkbo-special-editor";
 section.className="rkbo-special-editor";
 section.innerHTML='<div class="mini-title">SPECIAL CARD · 특수카드 지정 (제작자 전용)</div>'+
  '<p>'+esc(original.season)+'차 '+esc(original.name)+' · 원본 등급 '+esc(original.grade)+
  '. 특수카드는 별도 카드 ID로 생성하며 원본 스탯을 수정하지 않습니다.</p>'+
  '<div class="rkbo-special-editor-list">'+CODES.map(code=>{
   const item=TYPES[code],exists=!!definition(original.id,code),ok=allowed(original,code);
   return '<div class="rkbo-special-editor-row"><span><b>'+esc(item.label)+'</b><small>능력치·OVR +'+item.bonus+
    (ok?"":" · 구단/포지션 대상 아님")+'</small></span>'+
    '<button type="button" data-special-kind="'+code+'" data-special-on="'+(!exists?"1":"0")+'"'+(!ok?" disabled":"")+'>'+
    (exists?"특수카드 지정 해제":"특수카드 만들기")+'</button></div>';
  }).join("")+'</div><p id="rkbo-special-editor-status" role="status"></p>';
 stats.append(section);
 section.addEventListener("click",async e=>{
  const btn=e.target.closest("[data-special-kind]");if(!btn||btn.disabled||saving)return;
  btn.disabled=true;
  try{await setCard(original,btn.dataset.specialKind,btn.dataset.specialOn==="1")}
  catch(err){editStatus("저장 실패: "+err.message);btn.disabled=false}
 });
}
async function compressed(file){
 if(!file||!file.type.startsWith("image/"))throw Error("이미지 파일을 선택해 주세요.");
 if(file.size>16*1024*1024)throw Error("16MB 이하 이미지가 필요합니다.");
 const bmp=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bmp.width,bmp.height));
 const canvas=document.createElement("canvas");
 canvas.width=Math.max(1,Math.round(bmp.width*scale));
 canvas.height=Math.max(1,Math.round(bmp.height*scale));
 canvas.getContext("2d").drawImage(bmp,0,0,canvas.width,canvas.height);
 bmp.close?.();
 const blob=await new Promise(ok=>canvas.toBlob(ok,"image/webp",.88));
 if(!blob||blob.size>3*1024*1024)throw Error("이미지 변환에 실패했거나 3MB를 초과했습니다.");
 return blob;
}
async function uploadOne(code,file,kind){
 const api=bridge();if(!api?.isAuthorized?.())throw Error("관리자 GitHub 토큰이 필요합니다.");
 const blob=await compressed(file),path=kind==="emblems"?sourcePath(code):bgPath(code);
 const result=await api.uploadBinary(path,blob);
 if(!result?.commit?.sha)throw Error("GitHub 업로드 커밋이 없습니다.");
 return {path,commit:result.commit.sha,rev:Date.now().toString(36)};
}
async function uploadEmblemZip(){
 const file=q("rkbo-special-zip")?.files?.[0];if(!file)throw Error("5개 특수 엠블럼 ZIP을 선택하세요.");
 if(!root.JSZip)throw Error("ZIP 라이브러리를 사용할 수 없습니다.");
 const zip=await root.JSZip.loadAsync(await file.arrayBuffer());
 const names={ROY:"신인왕",DREAM:"드림",NANUM:"나눔",MVP:"MVP",RELIEF:"베스트릴리프"};
 const upload={};
 for(const code of CODES){
  const entry=Object.entries(zip.files).find(([name,e])=>!e.dir&&new RegExp("(?:^|/)"+names[code]+"\\.(png|webp|jpe?g)$","i").test(name));
  if(!entry)throw Error("ZIP에 "+names[code]+".png 파일이 없습니다.");
  const [filename,asset]=entry;
  const bytes=await asset.async("uint8array"),ext=filename.split(".").pop().toLowerCase();
  upload[code]=new File([bytes],names[code]+"."+ext,{type:ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg"});
 }
 for(const code of CODES){
  status(TYPES[code].label+" 엠블럼 업로드 중…");
  upload[code]=await uploadOne(code,upload[code],"emblems");
 }
 await saveManifest(old=>({...old,emblems:{...old.emblems,...upload}}),"emblems");
 status("✓ 5개 엠블럼이 GitHub에 업로드되었고 카드 디자인에 적용됐습니다.");
}
async function saveBackground(){
 const code=q("rkbo-special-kind")?.value,file=q("rkbo-special-background-file")?.files?.[0];
 if(!TYPES[code])throw Error("특수 등급을 선택하세요.");
 const previous=cfg.backgrounds[code]||{};
 const hasOld=!!previous.path;
 if(!file&&!hasOld)throw Error("배경 이미지를 선택해 주세요.");
 status("특수카드 공통 배경 GitHub 저장 중…");
 const image=file?await uploadOne(code,file,"backgrounds"):previous;
 const entry={...image,x:Number(q("rkbo-special-x")?.value||0),y:Number(q("rkbo-special-y")?.value||0),
  zoom:Number(q("rkbo-special-zoom")?.value||1),overlay:Number(q("rkbo-special-shade")?.value||0)};
 await saveManifest(old=>({...old,backgrounds:{...old.backgrounds,[code]:entry}}),"background");
 populateBackground();status("✓ "+TYPES[code].label+" 등급의 공통 배경 설정이 저장되었습니다.");
}
async function removeBackground(){
 const code=q("rkbo-special-kind")?.value;
 if(!TYPES[code]||!root.confirm(TYPES[code].label+" 특수카드 배경 지정을 삭제할까요?"))return;
 await saveManifest(old=>{const b={...old.backgrounds};delete b[code];return {...old,backgrounds:b}},"delete background");
 populateBackground();status("✓ "+TYPES[code].label+" 배경 삭제 완료");
}
function populateBackground(){
 const code=q("rkbo-special-kind")?.value,e=cfg.backgrounds[code]||{};
 for(const [id,value] of [["rkbo-special-x",e.x??0],["rkbo-special-y",e.y??0],
  ["rkbo-special-zoom",e.zoom??1],["rkbo-special-shade",e.overlay??0]]){if(q(id))q(id).value=value}
 const img=q("rkbo-special-preview");
 if(img){
  if(img.dataset.previewURL){URL.revokeObjectURL(img.dataset.previewURL);delete img.dataset.previewURL}
  img.src=e.path?fileURL(e.path,e.commit,e.rev):"";
  img.hidden=!e.path;img.style.objectPosition="center";img.style.transform="scale("+(e.zoom??1)+")";
  img.style.filter="brightness("+(1-Number(e.overlay||0)/100)+")";
 }
}
function makePanel(){
 if(uiReady)return;
 const controls=q("admin-controls");if(!controls)return;
 uiReady=true;
 const section=document.createElement("section");section.id="rkbo-special-settings";
 section.className="rkbo-special-settings";
 section.innerHTML='<hr><h2>🏆 특수카드 엠블럼 · 공통 배경</h2>'+
  '<p>신인왕(+5) · 드림/나눔 올스타(+3) · MVP(+5) · 베스트 릴리프(+5). 선수 지정은 선수 카드 상세창의 PLAYER EDIT 바로 아래에서 해주세요.</p>'+
  '<label>첨부된 5개 엠블럼 ZIP을 한 번에 등록<input type="file" id="rkbo-special-zip" accept=".zip,application/zip"></label>'+
  '<div class="admin-actions"><button type="button" id="rkbo-special-zip-upload">🏅 특수카드 엠블럼 5종 GitHub 등록</button></div>'+
  '<label>등급별 공통 배경 설정<select id="rkbo-special-kind">'+CODES.map(code=>
   '<option value="'+code+'">'+esc(TYPES[code].label)+'</option>').join("")+'</select></label>'+
  '<label>배경 이미지<input type="file" id="rkbo-special-background-file" accept="image/png,image/jpeg,image/webp,image/avif"></label>'+
  '<div class="rkbo-special-bg-preview"><img id="rkbo-special-preview" alt="특수카드 배경 미리보기" hidden></div>'+
  '<div class="rkbo-special-sliders">'+
  '<label>배경 크기<input type="range" id="rkbo-special-zoom" min=".35" max="3.5" value="1" step=".05"></label>'+
  '<label>가로 위치<input type="range" id="rkbo-special-x" min="-100" max="100" value="0"></label>'+
  '<label>세로 위치<input type="range" id="rkbo-special-y" min="-100" max="100" value="0"></label>'+
  '<label>검은색 오버레이<input type="range" id="rkbo-special-shade" min="0" max="100" value="0"></label></div>'+
  '<div class="admin-actions"><button type="button" id="rkbo-special-bg-save">배경 GitHub 저장</button>'+
  '<button type="button" id="rkbo-special-bg-remove">배경 지정 해제</button></div>'+
  '<p id="rkbo-special-status" role="status">특수카드는 일반 5등급의 카드팩 확률과 별도로 관리됩니다.</p>';
 controls.append(section);
 const perform=async fn=>{
  if(saving)return;
  saving=true;
  try{await fn()}catch(e){console.error("[RKBO specials]",e);status("실패: "+e.message)}
  finally{saving=false}
 };
 q("rkbo-special-zip-upload").addEventListener("click",()=>perform(uploadEmblemZip));
 q("rkbo-special-zip").addEventListener("change",e=>{if(e.target.files?.length)perform(uploadEmblemZip)});
 q("rkbo-special-bg-save").addEventListener("click",()=>perform(saveBackground));
 q("rkbo-special-bg-remove").addEventListener("click",()=>perform(removeBackground));
 q("rkbo-special-background-file").addEventListener("change",e=>{
  const file=e.target.files?.[0],img=q("rkbo-special-preview");if(!img)return;
  if(img.dataset.previewURL){URL.revokeObjectURL(img.dataset.previewURL);delete img.dataset.previewURL}
  if(file){img.dataset.previewURL=URL.createObjectURL(file);img.src=img.dataset.previewURL;img.hidden=false}
  else populateBackground();
 });
 for(const key of ["x","y","zoom","shade"])q("rkbo-special-"+key).addEventListener("input",()=>{
  const img=q("rkbo-special-preview");if(!img||img.hidden)return;
  img.style.objectPosition=(50+Number(q("rkbo-special-x").value)/2)+"% "+(50+Number(q("rkbo-special-y").value)/2)+"%";
  img.style.transform="scale("+q("rkbo-special-zoom").value+")";
  img.style.filter="brightness("+(1-Number(q("rkbo-special-shade").value)/100)+")";
 });
 q("rkbo-special-kind").addEventListener("change",populateBackground);
 populateBackground();
}
root.RKBOCardSpecials={TYPES,CODES,load,addTo,derived,definition,icon,backgroundFor,backgroundMarkup,mount,
 makePanel,refresh:load,getConfig:()=>cfg};
root.document.addEventListener("DOMContentLoaded",makePanel);
root.addEventListener("rkbo-admin-connected",()=>{
 makePanel();
 // Let the existing PLAYER EDIT handler insert its form first.
 Promise.resolve().then(()=>{
  const card=q("modal-body")?.querySelector(".player-card[data-id]");
  if(card){const p=root.RKBOSeason?.players?.().find(x=>x.id===card.dataset.id);if(p)mount(p)}
 });
});
root.addEventListener("rkbo-admin-disconnected",()=>{
 q("rkbo-special-editor")?.remove();
});
})(window);
