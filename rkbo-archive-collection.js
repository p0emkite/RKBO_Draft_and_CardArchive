/* RKBO personal archive progress. Public cards remain viewable; logged-in users
   see a 50% dark veil on cards they have not acquired. */
(function(root){"use strict";
const teams={DOO:"두산 베어스",HAN:"한화 이글스",KIA:"KIA 타이거즈",KT:"KT 위즈",LG:"LG 트윈스",LOT:"롯데 자이언츠",NC:"NC 다이노스",SAM:"삼성 라이온즈",SSG:"SSG 랜더스",KIW:"키움 히어로즈"};
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let owned=new Set(),upgrades=new Map(),inventory=new Map(),userId=null,status="loading",lastError="",container=null,cardList=null,client=null,request=0,observer=null;
const upgrading=new Set();
const percent=(a,b)=>b?Math.round(a/b*100):0;
function cards(){return root.RKBOSeason?.players?.()||[]}
function getProgress(){
 const list=cards(),unique=new Set(list.map(p=>p.id)),total=unique.size;
 const collected=[...unique].filter(id=>owned.has(id)).length;
 const groups=new Map();
 for(const p of list){
  const key=p.team||"기타";
  if(!groups.has(key))groups.set(key,{code:key,label:p.teamLabel||teams[key]||key,total:new Set(),found:new Set()});
  const g=groups.get(key);g.total.add(p.id);
  if(owned.has(p.id))g.found.add(p.id);
 }
 return {collected,total,groups:[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,"ko"))};
}
function decorateCard(card){
 if(!card?.dataset?.id)return;
 const effects=upgrades.get(card.dataset.id);
 const locked=status==="ready"&&!!userId&&!owned.has(card.dataset.id);
 card.classList.toggle("rkbo-gold-border",!!effects?.gold_border&&!locked);
 card.classList.toggle("rkbo-prism",!!effects?.prism&&!locked);
}

function upgradeButtons(id,inv){
 const count=Math.max(0,Number(inv?.quantity)||0),actions=[];
 for(const [kind,label,cost,enabled] of [
  ["gold","✨ 금테",5,!!inv?.gold_border],
  ["prism","🌈 프리즘",10,!!inv?.prism]
 ]){
  if(enabled){
   actions.push('<span class="rkbo-archive-upgrade-done">'+label+' 완료</span>');
  }else{
   const disabled=count<cost||upgrading.has(id);
   actions.push('<button type="button" class="rkbo-archive-upgrade-btn '+(kind==="prism"?"is-prism":"is-gold")+
    '" data-archive-upgrade="'+kind+'" data-archive-card="'+esc(id)+'" '+(disabled?'disabled':'')+
    ' title="'+label+' 강화: 동일 카드 '+cost+'장 소모">'+label+' '+count+'/'+cost+'</button>');
  }
 }
 return actions.join("");
}
function inventoryMarkup(id,modal=false){
 const inv=inventory.get(id),collected=owned.has(id),count=Math.max(0,Number(inv?.quantity)||0);
 if(!collected){
  return '<div class="rkbo-archive-owned-line is-missing">🔒 미수집 카드</div>'+
   (modal?'<p class="rkbo-archive-owned-description">카드팩에서 획득하면 여기에 보유 수량과 강화 기능이 표시돼.</p>':'');
 }
 return '<div class="rkbo-archive-owned-line"><strong>보유 ×'+count+'</strong>'+
   (inv?.gold_border?'<span class="rkbo-archive-earned is-gold">✨ 금테</span>':'')+
   (inv?.prism?'<span class="rkbo-archive-earned is-prism">🌈 프리즘</span>':'')+
   '</div><div class="rkbo-archive-upgrade-actions">'+upgradeButtons(id,inv)+'</div>'+
   (modal?'<p class="rkbo-archive-owned-description">금테는 동일 카드 5장, 프리즘은 10장을 소모하며 한 번 적용하면 영구 유지돼.</p>':'');
}
function galleryState(card){
 const id=card.dataset.id;
 let slot=card.parentElement?.classList.contains("rkbo-archive-card-slot")?card.parentElement:null;
 if(!slot){
  slot=document.createElement("div");
  slot.className="rkbo-archive-card-slot";
  card.replaceWith(slot);
  slot.append(card);
 }
 let footer=slot.querySelector(":scope > .rkbo-archive-card-footer");
 if(!footer){
  footer=document.createElement("div");
  footer.className="rkbo-archive-card-footer";
  slot.append(footer);
 }
 const inv=inventory.get(id),key=[id,owned.has(id),inv?.quantity??"",!!inv?.gold_border,!!inv?.prism,upgrading.has(id)].join("|");
 if(footer.dataset.renderKey!==key){
  footer.innerHTML=inventoryMarkup(id);
  footer.dataset.renderKey=key;
 }
}
function resetGallery(card){
 const slot=card.parentElement?.classList.contains("rkbo-archive-card-slot")?card.parentElement:null;
 if(slot)slot.replaceWith(card);
}
function modalState(){
 const modal=document.getElementById("modal-body");
 const card=modal?.querySelector(".player-card[data-id]");
 if(!card)return;
 decorateCard(card);
 const content=modal.querySelector(".dialog-content");
 if(!content)return;
 let panel=content.querySelector(":scope > .rkbo-archive-modal-collection");
 if(status!=="ready"||!userId){
  if(panel)panel.remove();
  return;
 }
 if(!panel){
  panel=document.createElement("section");
  panel.className="rkbo-archive-modal-collection";
  panel.setAttribute("aria-label","내 카드 보유 및 강화");
  content.prepend(panel);
 }
 const id=card.dataset.id,inv=inventory.get(id);
 const key=[id,owned.has(id),inv?.quantity??"",!!inv?.gold_border,!!inv?.prism,upgrading.has(id)].join("|");
 if(panel.dataset.renderKey!==key){
  panel.innerHTML='<h3>🎫 내 카드 보유 · 강화</h3>'+inventoryMarkup(id,true);
  panel.dataset.renderKey=key;
 }
}
function paintCardStates(){
 if(!cardList)return;
 if(status==="loading")return;
 cardList.querySelectorAll(".player-card[data-id]").forEach(card=>{
  const locked=status==="ready"&&!!userId&&!owned.has(card.dataset.id);
  card.classList.toggle("rkbo-uncollected",locked);
  decorateCard(card);
  if(locked)card.setAttribute("data-collection-status","미수집");
  else card.removeAttribute("data-collection-status");
  if(status==="ready"&&userId)galleryState(card);
  else resetGallery(card);
 });
 modalState();
}
async function applyUpgrade(id,kind){
 if(status!=="ready"||!userId)throw Error("Google 로그인 후 이용할 수 있어요.");
 if(!["gold","prism"].includes(kind)||!id)throw Error("강화 요청이 올바르지 않아.");
 if(upgrading.has(id))return;
 const count=Number(inventory.get(id)?.quantity||0),cost=kind==="gold"?5:10;
 const already=kind==="gold"?inventory.get(id)?.gold_border:inventory.get(id)?.prism;
 if(already)throw Error("이미 적용된 강화야.");
 if(count<cost)throw Error("강화에 필요한 카드가 부족해.");
 const label=kind==="gold"?"금색 추가 테두리":"프리즘 표면 효과";
 if(!confirm("동일 카드 "+cost+"장을 소모해 "+label+"를 영구 적용할까? 사용한 카드는 복구할 수 없어."))return;
 upgrading.add(id);paintCardStates();
 try{
  const c=client||(client=await root.RKBOOnline.getClient());
  const {error}=await c.rpc("rkbo_upgrade_card",{p_card_id:id,p_kind:kind});
  if(error)throw Error(error.message);
  await refresh();
  root.dispatchEvent(new CustomEvent("rkbo-collection-updated",{detail:{origin:"main-archive"}}));
 }finally{
  upgrading.delete(id);
  paintCardStates();
 }
}

function markup(){
 if(!container)return;
 const selected=Number(root.RKBOSeason?.current?.()||60);
 if(status==="loading"){
  container.innerHTML='<p class="rkbo-archive-collection-hint">개인 수집 현황 확인 중…</p>';return;
 }
 if(status==="error"){
  container.innerHTML='<p class="rkbo-archive-collection-hint">개인 수집 현황을 불러오지 못했어. <button type="button" data-collection-refresh>다시 시도</button></p>';return;
 }
 if(!userId){
  container.innerHTML='<p class="rkbo-archive-collection-hint">🌐 전체 선수 도감은 누구나 볼 수 있어. 로그인하면 내 카드 수집률과 미수집 표시가 나타나!</p>';return;
 }
 const {collected,total,groups}=getProgress();
 const bars=groups.map(t=>{
  const count=t.found.size,den=t.total.size,progress=percent(count,den);
  return '<div class="rkbo-archive-team-progress" title="'+esc(t.label)+'">'+
   '<div><strong>'+esc(t.label)+'</strong><span>'+count+'/'+den+'장 · '+progress+'%</span></div>'+
   '<div class="rkbo-archive-progress-track"><div style="width:'+progress+'%"></div></div></div>';
 }).join("");
 container.innerHTML='<div class="rkbo-archive-summary-head"><div><small>MY CARD COLLECTION · '+selected+'차 시즌</small>'+
  '<h3>📚 '+selected+'차 전체 수집률 <strong>'+percent(collected,total)+'%</strong></h3>'+
  '<p>'+collected+' / '+total+'종 보유 · 아직 획득하지 않은 카드에는 검은색 50% 오버레이가 표시돼.</p></div>'+
  '<button type="button" data-collection-refresh>↻ 동기화</button></div>'+
  '<div class="rkbo-archive-progress-track rkbo-archive-total-track"><div style="width:'+percent(collected,total)+'%"></div></div>'+
  '<div class="rkbo-archive-progress-label">구단별 수집률 · '+selected+'차</div>'+
  '<div class="rkbo-archive-team-grid">'+bars+'</div>';
}
function redraw(){markup();paintCardStates()}
async function refresh(){
 const ticket=++request;
 status="loading";redraw();
 try{
  const c=client||(client=await root.RKBOOnline?.getClient?.());
  if(!c)throw Error("Supabase 연결이 준비되지 않았어요.");
  const {data:sessionData,error:sessionError}=await c.auth.getSession();
  if(sessionError)throw sessionError;
  if(!sessionData?.session?.user){if(ticket!==request)return;userId=null;owned.clear();upgrades.clear();inventory.clear();status="ready";redraw();return}
  const {data:userData,error:userError}=await c.auth.getUser();
  if(userError||!userData?.user)throw userError||Error("로그인 확인 실패");
  const id=userData.user.id;
  const {data,error}=await c.from("rkbo_card_inventory").select("card_id,quantity,gold_border,prism").eq("user_id",id).limit(20000);
  if(error)throw error;
  if(ticket!==request)return;
  inventory=new Map((data||[]).map(x=>[x.card_id,x]));
  owned=new Set((data||[]).filter(x=>x.quantity>0||x.gold_border||x.prism).map(x=>x.card_id));
  upgrades=new Map((data||[]).map(x=>[x.card_id,{gold_border:x.gold_border,prism:x.prism}]));
  userId=id;status="ready";lastError="";redraw();
 }catch(error){
  if(ticket!==request)return;
  lastError=String(error?.message||error);
  console.warn("[RKBO collection]",lastError);
  status="error";userId=null;owned.clear();upgrades.clear();inventory.clear();redraw();
 }
}
function init(){
 cardList=document.getElementById("cards");
 const section=document.querySelector('section[aria-label="선수 카드 도감"]');
 if(!section||!cardList||container)return;
 container=document.createElement("section");
 container.id="rkbo-archive-collection";container.className="rkbo-archive-collection";
 const heading=section.querySelector(".section-h");
 (heading||section).insertAdjacentElement("afterend",container);
 container.addEventListener("click",e=>{if(e.target.closest("[data-collection-refresh]"))refresh()});
 async function upgradeClick(e){
  const target=e.target.closest("[data-archive-upgrade]");
  if(!target)return;
  e.preventDefault();e.stopPropagation();
  if(target.disabled)return;
  try{await applyUpgrade(target.dataset.archiveCard,target.dataset.archiveUpgrade)}
  catch(error){console.error("[RKBO card upgrade]",error);alert("카드 강화 실패: "+error.message)}
 }
 cardList.addEventListener("click",upgradeClick);
 document.getElementById("modal-body")?.addEventListener("click",upgradeClick);

 observer=new MutationObserver(mutations=>{if(mutations.some(m=>m.addedNodes.length||m.removedNodes.length))paintCardStates()});
 observer.observe(cardList,{childList:true});
 const detail=document.getElementById("modal-body");
 if(detail){
  const detailObserver=new MutationObserver(changes=>{
   if(changes.some(c=>c.addedNodes.length||c.removedNodes.length))modalState();
  });
  detailObserver.observe(detail,{childList:true,subtree:true});
 }
 root.addEventListener("rkbo-season-change",redraw);
 root.addEventListener("rkbo-player-data-updated",redraw);
 root.addEventListener("rkbo-collection-updated",e=>{if(e.detail?.origin!=="main-archive")refresh()});
 root.addEventListener("rkbo-pack-opened",async()=>{
  await refresh();
 });
 root.addEventListener("focus",()=>{if(userId)refresh()});
 root.RKBOArchiveCollection={refresh,isOwned:id=>owned.has(id),getEffects:id=>upgrades.get(id)||null,getQuantity:id=>inventory.get(id)?.quantity||0,getProgress};
 refresh();
 root.RKBOOnline?.getClient?.().then(c=>{
  c.auth.onAuthStateChange((_event,_session)=>{setTimeout(refresh,0)});
 }).catch(e=>console.warn("[RKBO collection] auth listener",e));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
})(window);
