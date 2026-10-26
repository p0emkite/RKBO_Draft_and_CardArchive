/* RKBO personal archive progress. Public cards remain viewable; logged-in users
   see a 50% dark veil on cards they have not acquired. */
(function(root){"use strict";
const teams={DOO:"두산 베어스",HAN:"한화 이글스",KIA:"KIA 타이거즈",KT:"KT 위즈",LG:"LG 트윈스",LOT:"롯데 자이언츠",NC:"NC 다이노스",SAM:"삼성 라이온즈",SSG:"SSG 랜더스",KIW:"키움 히어로즈"};
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let owned=new Set(),userId=null,status="loading",lastError="",container=null,cardList=null,client=null,request=0,observer=null;
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
function paintCardStates(){
 if(!cardList)return;
 cardList.querySelectorAll(".player-card[data-id]").forEach(card=>{
  const locked=status==="ready"&&!!userId&&!owned.has(card.dataset.id);
  card.classList.toggle("rkbo-uncollected",locked);
  if(locked)card.setAttribute("data-collection-status","미수집");
  else card.removeAttribute("data-collection-status");
 });
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
  if(!sessionData?.session?.user){if(ticket!==request)return;userId=null;owned.clear();status="ready";redraw();return}
  const {data:userData,error:userError}=await c.auth.getUser();
  if(userError||!userData?.user)throw userError||Error("로그인 확인 실패");
  const id=userData.user.id;
  const {data,error}=await c.from("rkbo_card_inventory").select("card_id,quantity").eq("user_id",id).limit(20000);
  if(error)throw error;
  if(ticket!==request)return;
  owned=new Set((data||[]).filter(x=>x.quantity>0).map(x=>x.card_id));
  userId=id;status="ready";lastError="";redraw();
 }catch(error){
  if(ticket!==request)return;
  lastError=String(error?.message||error);
  console.warn("[RKBO collection]",lastError);
  status="error";userId=null;owned.clear();redraw();
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
 observer=new MutationObserver(mutations=>{if(mutations.some(m=>m.addedNodes.length||m.removedNodes.length))paintCardStates()});
 observer.observe(cardList,{childList:true});
 root.addEventListener("rkbo-season-change",redraw);
 root.addEventListener("rkbo-player-data-updated",redraw);
 root.addEventListener("rkbo-pack-opened",async()=>{
  await refresh();
 });
 root.addEventListener("focus",()=>{if(userId)refresh()});
 root.RKBOArchiveCollection={refresh,isOwned:id=>owned.has(id),getProgress};
 refresh();
 root.RKBOOnline?.getClient?.().then(c=>{
  c.auth.onAuthStateChange((_event,_session)=>{setTimeout(refresh,0)});
 }).catch(e=>console.warn("[RKBO collection] auth listener",e));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
})(window);
