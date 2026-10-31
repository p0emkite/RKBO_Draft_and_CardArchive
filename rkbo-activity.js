/* RKBO Community Activity: server-verified pack highlights and private trade alerts. */
(function(root){"use strict";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const when=x=>{try{return new Date(x).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return ""}};
const special=new Set(["신인왕","드림","나눔","MVP","베스트릴리프"]);
const HIGHLIGHT_LIFETIME_MS=24*60*60*1000;
const isFresh=row=>Number.isFinite(Date.parse(row?.obtained_at))&&Date.parse(row.obtained_at)>Date.now()-HIGHLIGHT_LIFETIME_MS;
let bar=null,bell=null,popup=null,toast=null,client=null,user=null,connected=false;
let feed=[],alerts=[],feedIndex=0,listExpanded=false,noticesExpanded=false;
let feedChannel=null,alertChannel=null,starting=null,seenIds=new Set(),initialized=false;
const marks={다이아몬드:"💎",MVP:"🏆",신인왕:"🏅",드림:"✨",나눔:"✨",베스트릴리프:"🏆"};
function brief(row){return (marks[row.grade]||"✨")+" "+row.nickname+"님이 "+row.season+"차 "+row.card_name+" ("+row.grade+") 카드를 획득했습니다!"}
function safeText(target,value){if(target)target.textContent=value}
function renderBar(){
 if(!bar)return;
 const cur=feed.length?feed[feedIndex%feed.length]:null;
 bar.innerHTML='<div class="rkbo-activity-brand"><span aria-hidden="true">📣</span><strong>TRT | Tsuki&#39;s RKBO Together · 획득 전광판</strong>'+
  '<span class="rkbo-activity-live">LIVE</span></div>'+
 '<div class="rkbo-activity-current" data-activity-current aria-live="polite">'+
  (cur?esc(brief(cur)):'고등급 카드를 획득하면 이곳에 표시됩니다.')+'</div>'+
 '<button type="button" class="rkbo-activity-list-button" data-activity-list aria-expanded="'+listExpanded+'">최근 기록 '+(listExpanded?"접기":"보기")+'</button>'+
 (listExpanded?'<div class="rkbo-activity-history">'+
  (feed.length?feed.map(item=>'<article><span>'+esc(marks[item.grade]||"✨")+'</span><strong>'+
   esc(item.nickname)+'</strong> · '+esc(item.season)+'차 '+esc(item.card_name)+' <b>'+esc(item.grade)+'</b>'+
   '<time>'+esc(when(item.obtained_at))+'</time></article>').join(""):
   '<p>아직 고등급 획득 기록이 없습니다.</p>')+'</div>':'');
}
function renderAlerts(){
 if(!bell||!popup)return;
 const pending=alerts.filter(a=>!a.read_at);
 const badge=bell.querySelector("[data-activity-unread]");
 if(badge){badge.hidden=pending.length===0;badge.textContent=pending.length>99?"99+":String(pending.length)}
 const communityButton=document.querySelector(".rkbo-cm-nav");
 if(communityButton){
  let ownBadge=communityButton.querySelector(".rkbo-community-trade-badge");
  if(!ownBadge){
   ownBadge=document.createElement("span");
   ownBadge.className="rkbo-community-trade-badge";
   communityButton.append(ownBadge);
  }
  const offers=pending.filter(a=>a.kind==="trade_offer");
  ownBadge.hidden=offers.length===0;ownBadge.textContent=String(offers.length);
 }
 popup.hidden=!noticesExpanded;
 popup.innerHTML='<div class="rkbo-activity-alert-head"><strong>🔔 카드 교환 알림</strong>'+
  '<button type="button" data-activity-read-all '+(pending.length?'':'disabled')+'>모두 읽음</button></div>'+
  '<div class="rkbo-activity-alert-list">'+(alerts.length?alerts.map(a=>
   '<button type="button" class="rkbo-activity-alert-item'+(a.read_at?'':' unread')+
   '" data-activity-alert="'+a.id+'"><small>'+esc(when(a.created_at))+'</small><span>'+
   esc(a.body)+'</span></button>').join(""):'<p>새 교환 알림이 없습니다.</p>')+'</div>'+
  '<button type="button" class="rkbo-activity-open-trades" data-activity-trades>내 교환 내역으로 이동</button>';
}
function toastMessage(content,openTrades=false){
 if(!toast)return;
 toast.textContent=content;
 toast.classList.add("is-visible");
 toast.dataset.trade=openTrades?"true":"false";
 root.clearTimeout?.(toast._timeout);
 toast._timeout=root.setTimeout(()=>toast.classList.remove("is-visible"),7000);
}
async function getUser(){
 const c=await root.RKBOOnline?.getClient?.();
 if(!c)throw Error("로그인이 필요합니다.");
 const {data,error}=await c.auth.getUser();
 if(error||!data?.user||data.user.is_anonymous)throw Error("로그인이 필요합니다.");
 client=c;user=data.user.id;return c;
}
async function refreshFeed(){
 if(!client||!user)return;
 const {data,error}=await client.from("rkbo_community_highlights").select("id,nickname,season,card_name,grade,obtained_at")
  .gte("obtained_at",new Date(Date.now()-HIGHLIGHT_LIFETIME_MS).toISOString())
   .order("obtained_at",{ascending:false}).limit(20);
 if(error)throw Error(error.message);
 feed=(data||[]).filter(isFresh);
 if(feedIndex>=feed.length)feedIndex=0;
 renderBar();
}
async function refreshAlerts(){
 if(!client||!user)return;
 const {data,error}=await client.from("rkbo_community_alerts")
  .select("id,kind,body,created_at,read_at,trade_id")
  .eq("recipient_id",user).order("created_at",{ascending:false}).limit(50);
 if(error)throw Error(error.message);
 alerts=data||[];renderAlerts();
}
async function markRead(ids){
 if(!client||!user)return;
 const {error}=await client.rpc("rkbo_community_alerts_read",{p_ids:ids??null});
 if(error)throw Error(error.message);
 await refreshAlerts();
}
async function onHighlight(evt){
 const row=evt.new||{};
 if(!row.id||!isFresh(row))return;
 if(seenIds.has("h"+row.id))return;
 seenIds.add("h"+row.id);
 if(seenIds.size>100)seenIds.clear();
 await refreshFeed();
 toastMessage(brief(row),false);
}
async function onAlert(evt){
 const row=evt.new||{};
 if(!row.id||row.recipient_id!==user)return;
 if(seenIds.has("a"+row.id))return;
 seenIds.add("a"+row.id);
 await refreshAlerts();
 toastMessage(row.body,true);
 root.RKBOChatDock?.notify?.(row.body);
}
async function connect(){
 if(connected&&client)return;
 if(starting)return starting;
 starting=(async()=>{
  const c=await getUser();
  await Promise.all([refreshFeed(),refreshAlerts()]);
  if(!feedChannel){
   feedChannel=c.channel("rkbo-activity-feed").on("postgres_changes",
    {event:"INSERT",schema:"public",table:"rkbo_community_highlights"},
    p=>void onHighlight(p).catch(console.warn)).subscribe();
  }
  if(!alertChannel){
   alertChannel=c.channel("rkbo-private-card-trades").on("postgres_changes",
    {event:"INSERT",schema:"public",table:"rkbo_community_alerts",filter:"recipient_id=eq."+user},
    p=>void onAlert(p).catch(console.warn)).subscribe();
  }
  connected=true;
 })().catch(error=>{connected=false;throw error}).finally(()=>{starting=null});
 return starting;
}
function init(){
 if(initialized)return;
 initialized=true;
 const header=document.querySelector(".site>.nav")||document.querySelector(".nav");
 const nav=header?.querySelector(".nav-right")||document.querySelector(".nav-right");
 if(!header)return;
 bar=document.createElement("section");bar.className="rkbo-activity-bar";
 bar.setAttribute("aria-label","실시간 고등급 카드 획득 전광판");
 header.after(bar);renderBar();
 bell=document.createElement("button");bell.type="button";bell.className="rkbo-activity-bell";
 bell.title="교환 요청과 수락 알림";
 bell.innerHTML='🔔 알림 <span data-activity-unread class="rkbo-activity-count" hidden></span>';
 nav?.prepend(bell);
 popup=document.createElement("section");popup.className="rkbo-activity-alerts";popup.hidden=true;
 popup.setAttribute("aria-label","내 카드 교환 알림");document.body.append(popup);
 toast=document.createElement("button");toast.type="button";toast.className="rkbo-activity-toast";
 toast.setAttribute("aria-label","최근 게임 알림");document.body.append(toast);
 renderAlerts();
 bar.addEventListener("click",e=>{
  if(e.target.closest("[data-activity-list]")){
   listExpanded=!listExpanded;renderBar();
  }
 });
 bell?.addEventListener("click",async()=>{
  noticesExpanded=!noticesExpanded;renderAlerts();
  if(noticesExpanded)try{await connect();await refreshAlerts()}catch(e){console.warn("[RKBO activity] notification",e)}
 });
 popup.addEventListener("click",async event=>{
  if(event.target.closest("[data-activity-read-all]")){
   try{await markRead(null)}catch(e){console.warn("[RKBO alerts] mark all",e.message)}return;
  }
  const item=event.target.closest("[data-activity-alert]");
  if(item){
   try{await markRead([Number(item.dataset.activityAlert)])}catch(e){console.warn("[RKBO alerts] read",e.message)}
   noticesExpanded=false;renderAlerts();root.RKBOCommunity?.open?.("trades");return;
  }
  if(event.target.closest("[data-activity-trades]")){
   noticesExpanded=false;renderAlerts();root.RKBOCommunity?.open?.("trades");
  }
 });
 toast.addEventListener("click",()=>{if(toast.dataset.trade==="true")root.RKBOCommunity?.open?.("trades");
  toast.classList.remove("is-visible")});
 root.addEventListener?.("rkbo-trade-updated",()=>{if(client)void refreshAlerts().catch(()=>{})});
 root.addEventListener?.("rkbo-pack-opened",()=>{if(client)void refreshFeed().catch(()=>{})});
 root.addEventListener?.("focus",()=>{if(!connected)void connect().catch(()=>{});
  else void Promise.all([refreshFeed(),refreshAlerts()]).catch(()=>{})});
 root.setInterval(()=>{
  feed=feed.filter(isFresh);if(feedIndex>=feed.length)feedIndex=0;
   if(feed.length)feedIndex=(feedIndex+1)%feed.length;
   renderBar()
 },6500);
 root.setInterval(()=>{if(!connected)void connect().catch(()=>{})},22000);
 root.setInterval(()=>{if(connected)void Promise.all([refreshFeed(),refreshAlerts()]).catch(()=>{})},60000);
 void connect().catch(()=>{});
}
root.RKBOActivity={refresh:()=>Promise.all([refreshFeed(),refreshAlerts()]),openTrades:()=>root.RKBOCommunity?.open?.("trades")};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
})(window);
