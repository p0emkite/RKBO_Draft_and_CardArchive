/* RKBO CARD PACKS v1. Server-backed draws and private collection.
 * The browser never chooses cards, determines drops or writes inventory. */
(function(root){"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const RARITIES=["브론즈","실버","골드","코랄","다이아몬드"];
const PRIORITIES={"브론즈":0,"실버":1,"골드":2,"코랄":3,"다이아몬드":4};
const displayGrade=g=>g;
let overlay=null,dialog=null,tab="pack",season=60,opening=false,draws=[],cursor=0,packResult=null,revealToken=0;
let owned=new Map(),catalog=[],packsState=null,history=[],cache=new Map(),collectionFilter="all",collectionGrade="all",collectionLimit=36;
let packChoices=[],adminAuthorized=false,adminSeason=60,adminBusy=false;
const defaultPackArt="https://raw.githubusercontent.com/p0emkite/RKBO-/main/pack.webp";
const packFor=n=>packChoices.find(p=>p.season===n);
const packArt=()=>packFor(season)?.image_url||defaultPackArt;
const $=selector=>dialog?.querySelector(selector);
const client=()=>root.RKBOOnline?.getClient?.();
async function context(){
 if(!root.RKBOOnline?.getClient)throw Error("RKBO ONLINE 연결이 필요해요.");
 const c=await client(),{data,error}=await c.auth.getUser();
 if(error||!data?.user)throw Error("Google 계정으로 로그인하면 카드팩과 내 수집 도감을 이용할 수 있어요.");
 return {c,user:data.user};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function message(s){const el=$("#rkbo-pack-status");if(el)el.textContent=s}
async function playersFor(n){
 if(cache.has(n))return cache.get(n);
 let list;
 if(n===60)list=(root.RKBOSeason?.builtin?.()||[]).map(p=>({...p}));
 else {
  const response=await fetch("./data/seasons/"+n+".json",{cache:"force-cache"});
  if(!response.ok)throw Error(n+"차 시즌 선수 카드를 불러오지 못했어요.");
  const data=await response.json();list=(Array.isArray(data)?data:data.players||[]).map(p=>({...p}));
 }
 if(!list.length)throw Error(n+"차 시즌 카드 데이터가 비어 있어요.");
 try{await root.RKBONameMap?.apply?.(list,null)}catch(e){console.warn("[RKBO packs] name map",e)}
 try{root.RKBOTeamBrand?.decorate?.(list)}catch(e){console.warn("[RKBO packs] team metadata",e)}
 const map=new Map(list.map(p=>[p.id,p]));cache.set(n,map);return map;
}
async function playerFor(cardId){
 const n=Number(String(cardId||"").split("-")[0]);
 const map=await playersFor(n);
 return map.get(cardId)||null;
}
function renderPlayer(p){
 if(!p)return '<div class="rkbo-pack-card-missing">공식 카드 데이터를 불러오지 못했어요.</div>';
 try{return root.RKBOCardView?.render?.(p,true)||'<b>'+esc(p.name)+'</b>'}
 catch(e){console.warn("[RKBO packs] render",e);return '<div class="rkbo-pack-card-missing">'+esc(p.name)+'</div>'}
}
function loginView(error){
 return '<div class="rkbo-pack-login"><div class="rkbo-pack-lock-icon">🔐</div><h3>이 브라우저에서 Google 로그인이 필요해요</h3><p>'+esc(error||"카드팩 개봉 기록과 수집 도감은 계정별로 저장돼요.")+'</p><button type="button" data-pack="login">Google 로그인</button></div>';
}
function frame(){
 dialog.innerHTML='<header class="rkbo-pack-header"><div><small>RKBO · CARD COLLECTION</small><h2>🎴 RKBO CARD PACK</h2><p>60차 선수 카드 · 5장 개봉 · 50팩 천장</p></div><button type="button" data-pack="close" aria-label="닫기">×</button></header>'+
 '<nav class="rkbo-pack-tabs"><button data-pack-tab="pack">🎁 카드팩</button><button data-pack-tab="collection">📚 내 수집 도감</button><button data-pack-tab="history">📜 개봉 기록</button></nav>'+
 '<div class="rkbo-pack-body" id="rkbo-pack-body"></div><p class="rkbo-pack-status" id="rkbo-pack-status" role="status"></p>';
 dialog.querySelectorAll("[data-pack-tab]").forEach(b=>b.classList.toggle("active",b.dataset.packTab===tab));
}
function renderPack(){
 const body=$("#rkbo-pack-body");
 if(!body)return;
 body.innerHTML='<section class="rkbo-pack-summary" id="rkbo-pack-summary"><div><small>총 개봉 팩</small><strong>'+(packsState?.total_packs||0)+'</strong></div>'+
 '<div><small>연속 다이아 미획득</small><strong>'+(packsState?.no_diamond_streak||0)+'/49</strong></div>'+
 '<div><small>보유 종류</small><strong>'+owned.size+'종</strong></div></section>'+
 '<div class="rkbo-pack-odds"><b>'+esc(packFor(season)?.label||season+'차 카드팩')+'</b><span>브론즈 45% · 실버 30% · 골드 15% · 코랄 7% · 다이아몬드 3%</span>'+
 '<small>5장 모두 개별 확률 적용. 다이아몬드를 49팩 연속 얻지 못했다면 50번째 팩에 최소 1장 보장. 중복 획득 가능.</small></div>'+
 '<div class="rkbo-pack-season-toggle"><label for="rkbo-pack-season">카드팩 선택</label><select id="rkbo-pack-season" data-pack-season>'+
 packChoices.filter(p=>p.active).map(p=>'<option value="'+p.season+'"'+(p.season===season?' selected':'')+'>'+esc(p.label)+'</option>').join("")+'</select></div>'+ 
 '<div class="rkbo-pack-stage" id="rkbo-pack-stage" '+(draws.length?'data-pack="next" title="터치해서 다음 카드 공개"':'')+'><div class="rkbo-pack-aura"></div>'+
 (draws.length?'<div id="rkbo-pack-reveal"></div>':
  '<button type="button" class="rkbo-pack-cover" data-pack="open"><img src="'+esc(packArt())+'" alt="RKBO 카드팩 포장" onerror="this.onerror=null;this.src=\'https://raw.githubusercontent.com/p0emkite/RKBO-/main/pack.webp\'">'+
  '<span>터치해서 카드팩 개봉</span></button>')+'</div>'+
 '<div class="rkbo-pack-controls"><button type="button" data-pack="'+(draws.length?"next":"open")+'" class="rkbo-pack-primary" '+(opening?'disabled':'')+'>'+
 (draws.length?(cursor<draws.length?"다음 카드 공개 ("+(cursor+1)+"/5)":"결과 확인"):"⚾ 카드팩 5장 개봉")+'</button></div>'+
 '<div class="rkbo-pack-footnote">계정별 무료 카드팩 · 서버 추첨 · 5초 개봉 간격 · 유료 구매 없음</div>';
 if(draws.length)showCurrentReveal();
}
function renderResult(){
 const body=$("#rkbo-pack-body");if(!body||!packResult)return;
 const vals=packResult.draws||[];
 body.innerHTML='<div class="rkbo-pack-results"><h3>🎉 '+packResult.packNumber+'번째 카드팩 개봉 완료!</h3>'+
 '<p>'+(packResult.hitDiamond?'💎 다이아몬드 획득!':'다음 팩에는 더 좋은 카드가 나올지도!')+'</p>'+
 '<div class="rkbo-pack-result-grid">'+vals.map((v,i)=>'<div class="rkbo-pack-result-tile rarity-'+esc(v.grade)+'"><span>'+esc(displayGrade(v.grade))+'</span>'+
 '<strong>'+esc(cache.get(Number(v.cardId.split("-")[0]))?.get(v.cardId)?.name||v.name)+'</strong>'+
 '<small>OVR '+v.ovr+' · '+(v.isNew?"NEW!":"중복 ×"+v.quantity)+'</small></div>').join("")+'</div>'+
 '<div class="rkbo-pack-result-buttons"><button type="button" data-pack="reset">🎁 다음 카드팩</button><button type="button" data-pack="collection">📚 내 도감 보기</button></div></div>';
}
function showCurrentReveal(){
 const target=$("#rkbo-pack-reveal");if(!target)return;
 const draw=draws[cursor-1];
 if(!draw){target.innerHTML='<div class="rkbo-pack-ready">팩 개봉 완료! 결과를 확인해줘.</div>';return}
 const p=cache.get(Number(draw.cardId.split("-")[0]))?.get(draw.cardId);
 const special=PRIORITIES[draw.grade]>=3;
 const card=renderPlayer(p),front=special?'<div class="rkbo-pack-flip">'+
  '<div class="rkbo-pack-flip-inner"><div class="rkbo-pack-flip-back"><span>RKBO</span><strong>LEGENDARY CARD</strong><small>✨ CLICK TO REVEAL ✨</small></div>'+
  '<div class="rkbo-pack-flip-front">'+card+'</div></div></div>':card;
 target.innerHTML='<div class="rkbo-pack-reveal-heading rarity-'+esc(draw.grade)+'"><span>'+(cursor)+'/5</span><strong>'+esc(displayGrade(draw.grade))+'</strong>'+
 '<span>'+(draw.isNew?'✨ NEW':'중복 카드 ×'+draw.quantity)+'</span></div>'+
 '<div class="rkbo-pack-revealed-card '+(special?'is-'+(draw.grade==="코랄"?"coral":"diamond"):'')+'">'+front+'</div>';
}
async function showNext(){
 if(opening)return;
 if(cursor>=draws.length){draws=[];cursor=0;renderResult();return}
 opening=true;const token=++revealToken;
 const value=draws[cursor],player=cache.get(Number(value.cardId.split("-")[0]))?.get(value.cardId);
 const stage=$("#rkbo-pack-stage"),special=PRIORITIES[value.grade]>=3;
 if(special&&stage){
  let logo="";
  try{logo=player?root.RKBOTeamBrand?.logo?.(player)||"":""}catch{}
  const steps=[
   {html:'<img src="'+esc(logo)+'" alt="팀 심볼" onerror="this.style.display=\'none\'">',duration:1450},
   {html:'<div>'+esc(player?.pos||value.pos)+'</div>',duration:1350},
   {html:'<strong>'+esc(displayGrade(value.grade))+'</strong>',duration:1600}
  ];
  for(const step of steps){
   if(token!==revealToken||overlay.hidden){opening=false;return}
   stage.innerHTML='<div class="rkbo-pack-prelude rarity-'+esc(value.grade)+'">'+step.html+'</div>';
   await wait(step.duration);
  }
 }
 if(token!==revealToken||overlay.hidden){opening=false;return}
 cursor++;
 const body=$("#rkbo-pack-body");
 const target=body?.querySelector("#rkbo-pack-stage");
 if(target)target.innerHTML='<div id="rkbo-pack-reveal"></div>';
 showCurrentReveal();
 if(special){
  await wait(1650); // Complete the 3D back-to-front animation before accepting taps.
  if(token!==revealToken||overlay.hidden){opening=false;return}
 }
 const btn=body?.querySelector(".rkbo-pack-controls button");
 if(btn){btn.disabled=false;btn.textContent=cursor<5?"다음 카드 공개 ("+(cursor+1)+"/5)":"5장 결과 확인"}
 opening=false;
}
async function openPack(){
 if(opening||draws.length)return;
 opening=true;message("서버에서 카드 5장을 추첨하는 중…");
 const button=$('[data-pack="open"]');if(button)button.disabled=true;
 try{
  const {c}=await context();
  const {data,error}=await c.rpc("rkbo_open_card_pack",{p_season:season});
  if(error)throw Error(error.message);
  if(!data||!Array.isArray(data.draws)||data.draws.length!==5)throw Error("서버 응답이 올바르지 않아요.");
  await playersFor(season);
  packResult=data;draws=data.draws;cursor=0;message("카드팩 개봉 성공! 카드를 차례로 공개합니다.");
  await refreshStats();
  root.dispatchEvent(new CustomEvent("rkbo-pack-opened",{detail:{season:data.season,draws:data.draws}}));
  renderPack();opening=false;
  await showNext();
 }catch(e){
  opening=false;
  message("카드팩 개봉 실패: "+e.message+" · 이미 개봉됐다면 개봉 기록에서 확인해 주세요.");
  if(!draws.length){
   if(/로그인|JWT|Auth session missing|session.*missing/i.test(e.message))$("#rkbo-pack-body").innerHTML=loginView("휴대폰과 PC는 Google 로그인을 각각 해야 해요. 계정은 동일하게 연결됩니다.");
   else renderPack();
  }
 }
}
async function loadPackChoices(){
 const c=await root.RKBOOnline.getClient();
 const [result,administrator]=await Promise.all([
  c.from("rkbo_pack_settings").select("season,label,image_url,active").order("season",{ascending:false}),
  new URLSearchParams(location.search).get("admin")==="1"?
   c.rpc("rkbo_is_pack_admin"):Promise.resolve({data:false,error:null})
 ]);
 if(result.error)throw Error("카드팩 설정을 불러오지 못했습니다: "+result.error.message);
 packChoices=result.data||[];
 adminAuthorized=administrator.error?false:administrator.data===true;
 const active=packChoices.filter(p=>p.active);
 if(!active.some(p=>p.season===season))season=active[0]?.season||60;
}
async function refreshStats(){
 const {c,user}=await context();
 const [inventory,state]=await Promise.all([
  c.from("rkbo_card_inventory").select("card_id,quantity,gold_border,prism").eq("user_id",user.id),
  c.from("rkbo_pack_state").select("total_packs,no_diamond_streak,last_open_at").eq("user_id",user.id).maybeSingle()
 ]);
 if(inventory.error)throw Error(inventory.error.message);
 if(state.error)throw Error(state.error.message);
 owned=new Map((inventory.data||[]).map(v=>[v.card_id,v]));
 packsState=state.data||null;
}
async function loadCollection(){
 const body=$("#rkbo-pack-body");if(!body)return;
 body.innerHTML='<p class="rkbo-pack-loading">도감 불러오는 중…</p>';
 try{
  const {c}=await context();
  const {data,error}=await c.from("rkbo_pack_cards").select("card_id,season,grade,name,team,position,ovr").eq("season",season).order("season",{ascending:false}).order("ovr",{ascending:false}).limit(1000);
  if(error)throw Error(error.message);
  catalog=data||[];
  await Promise.all([playersFor(season),refreshStats()]);
  renderCollection();
 }catch(e){body.innerHTML=loginView(e.message)}
}
function renderCollection(){
 const body=$("#rkbo-pack-body");if(!body)return;
 const filtered=catalog.filter(c=>(collectionFilter==="all"||collectionFilter==="owned"&&owned.has(c.card_id)||collectionFilter==="missing"&&!owned.has(c.card_id))
  &&(collectionGrade==="all"||c.grade===collectionGrade));
 const ownedTotal=catalog.filter(c=>owned.has(c.card_id)).length,all=catalog.length;
 body.innerHTML='<section class="rkbo-pack-collect-head"><h3>📚 '+season+'차 나의 카드 수집 도감</h3>'+
 '<strong>'+ownedTotal+' / '+all+'종 · '+(all?Math.round(ownedTotal/all*100):0)+'%</strong>'+
 '<p>미보유 카드는 잠금 표시돼요. 기존 전체 선수 도감은 누구나 볼 수 있어요.</p></section>'+
 '<div class="rkbo-pack-collect-controls">'+
 '<select data-pack-filter aria-label="보유 여부"><option value="all" '+(collectionFilter==="all"?"selected":"")+'>전체 카드</option>'+
 '<option value="owned" '+(collectionFilter==="owned"?"selected":"")+'>보유 카드</option><option value="missing" '+(collectionFilter==="missing"?"selected":"")+'>미보유 카드</option></select>'+
 '<select data-pack-grade aria-label="등급"><option value="all">모든 등급</option>'+RARITIES.map(g=>'<option value="'+esc(g)+'" '+(collectionGrade===g?"selected":"")+'>'+esc(displayGrade(g))+'</option>').join("")+'</select></div>'+
 '<div class="rkbo-pack-collection-grid">'+filtered.slice(0,collectionLimit).map(c=>{
 const count=owned.get(c.card_id)||0,p=cache.get(c.season)?.get(c.card_id);
 return '<div class="rkbo-pack-collection-item '+(count?"is-owned":"is-locked")+'">'+
  (count?'<div class="rkbo-pack-collection-card">'+renderPlayer(p)+'</div><span class="rkbo-pack-owned-label">보유 ×'+count+'</span>':
  '<div class="rkbo-pack-silhouette"><span>🔒</span><strong>???</strong><small>'+esc(c.season)+'차 · 미보유</small></div>')+
 '</div>';
 }).join("")+'</div>'+
 (filtered.length>collectionLimit?'<button type="button" data-pack="more" class="rkbo-pack-more">더 보기 ('+collectionLimit+' / '+filtered.length+')</button>':'')+
 (!filtered.length?'<p class="rkbo-pack-loading">조건에 해당하는 카드가 없어요.</p>':'');
}
async function loadHistory(){
 const body=$("#rkbo-pack-body");if(!body)return;
 body.innerHTML='<p class="rkbo-pack-loading">개봉 기록 불러오는 중…</p>';
 try{
  const {c,user}=await context();
  const {data,error}=await c.from("rkbo_pack_history").select("id,pack_number,season,draws,opened_at").eq("user_id",user.id).order("opened_at",{ascending:false}).limit(30);
  if(error)throw Error(error.message);
  history=data||[];await Promise.all([playersFor(59),playersFor(60)]);
  body.innerHTML=history.length?'<div class="rkbo-pack-history">'+history.map(h=>
   '<section class="rkbo-pack-history-entry"><h3>📦 '+h.pack_number+'번째 개봉 · '+h.season+'차 <small>'+new Date(h.opened_at).toLocaleString("ko-KR")+'</small></h3>'+
    '<div>'+h.draws.map(v=>'<span class="rarity-'+esc(v.grade)+'">'+esc(cache.get(h.season)?.get(v.cardId)?.name||v.name||v.cardId)+' · '+esc(displayGrade(v.grade))+'</span>').join("")+'</div></section>'
  ).join("")+'</div>':'<p class="rkbo-pack-loading">아직 개봉한 카드팩이 없어!</p>';
 }catch(e){body.innerHTML=loginView(e.message)}
}
async function showTab(next){
 if(!["pack","collection","history"].includes(next))return;
 if(opening)return;
 tab=next;draws=[];cursor=0;revealToken++;frame();
 try{
  if(tab==="pack"){await Promise.all([refreshStats(),loadPackChoices()]);if(overlay.hidden||tab!=="pack")return;frame();renderPack()}
  if(tab==="collection"){await loadPackChoices();frame();await loadCollection()}
  if(tab==="history")await loadHistory();
 }catch(e){$("#rkbo-pack-body").innerHTML=loginView(e.message)}
}
function close(){if(!overlay)return;overlay.hidden=true;revealToken++;document.body.classList.remove("rkbo-pack-open")}
function open(){if(!overlay)init();if(!overlay)return;overlay.hidden=false;tab="pack";draws=[];cursor=0;document.body.classList.add("rkbo-pack-open");frame();showTab("pack")}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const button=document.createElement("button");button.id="rkbo-pack-open";button.type="button";button.className="rkbo-pack-nav";button.textContent="🎴 카드팩";
 nav?.prepend(button);button.addEventListener("click",open);
 overlay=document.createElement("div");overlay.className="rkbo-pack-overlay";overlay.hidden=true;overlay.id="rkbo-pack-overlay";
 overlay.innerHTML='<section class="rkbo-pack-dialog" role="dialog" aria-modal="true" aria-label="RKBO 카드팩"></section>';
 document.body.append(overlay);dialog=overlay.querySelector(".rkbo-pack-dialog");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 dialog.addEventListener("click",async e=>{
  const target=e.target.closest("[data-pack-tab],[data-pack]");if(!target)return;
  if(target.dataset.packTab){showTab(target.dataset.packTab);return}

  const action=target.dataset.pack;
  if(action==="close"){close();return}
  if(action==="login"){close();root.RKBOOnline?.open?.("account");return}
  if(action==="open"){await openPack();return}
  if(action==="next"){await showNext();return}
  if(action==="reset"){draws=[];cursor=0;packResult=null;await showTab("pack");return}
  if(action==="collection"){await showTab("collection");return}
  if(action==="more"){collectionLimit+=36;renderCollection()}
 });
 dialog.addEventListener("change",e=>{
  if(e.target.matches("[data-pack-filter]")){collectionFilter=e.target.value;collectionLimit=36;renderCollection()}
  if(e.target.matches("[data-pack-season]")){if(opening)return;season=Number(e.target.value);if(tab==="collection")loadCollection();else renderPack()}
  if(e.target.matches("[data-pack-grade]")){collectionGrade=e.target.value;collectionLimit=36;renderCollection()}
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.RKBOCardPacks={open};
document.addEventListener("DOMContentLoaded",init);
})(window);
