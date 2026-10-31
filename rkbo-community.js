/* RKBO community v1: opt-in public collections, safe card swaps, live chat. */
(function(root){"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const when=v=>{try{return new Date(v).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return ""}};
let overlay=null,panel=null,tab="members",userId="",isPublic=true;
let members=[],names=new Map(),memberQuery="",selected=null,cardQuery="",cards=[],offset=0,hasMore=false,mine=[],wanted="";
let trades=[],cardTitles=new Map(),messages=[],notice="",working=false,channel=null,channelClient=null,poll=null;
const artCache=new Map(),artBusy=new Map();
const $=sel=>panel?.querySelector(sel);
async function account(){
 const c=await root.RKBOOnline?.getClient?.();
 if(!c)throw Error("RKBO ONLINE 로그인이 필요합니다.");
 const {data,error}=await c.auth.getUser();
 if(error||!data?.user||data.user.is_anonymous)throw Error("Google 로그인 후 이용할 수 있습니다.");
 userId=data.user.id;return c;
}
async function call(name,args){
 const c=await account(),{data,error}=await c.rpc(name,args);
 if(error)throw Error(error.message);return data;
}
function inform(s){notice=s;const target=$("#rkbo-community-notice");if(target)target.textContent=s}
function who(id){return names.get(id)||String(id||"").slice(0,8)}
function badge(card){return esc(card.season)+"차 · "+esc(card.grade)}
async function loadMembers(){
 const list=await call("rkbo_community_members",{p_search:memberQuery});
 members=list||[];for(const m of members)names.set(m.user_id,m.nickname);
}
async function loadMine(){
 const c=await account();
 const own=await c.from("rkbo_community_visibility").select("is_public").eq("user_id",userId).maybeSingle();
 if(own.error)throw Error(own.error.message);
 isPublic=own.data?.is_public!==false;mine=[];
 for(let off=0;off<1400;off+=100){
  const portion=await call("rkbo_community_collection",{p_user:userId,p_limit:100,p_offset:off});
  mine.push(...portion);if(portion.length<100)break;
 }
 for(const p of mine)cardTitles.set(p.card_id,p.name);
}
async function loadMemberCards(add=false){
 if(!selected)return;
 const member=members.find(m=>m.user_id===selected);
 if(!member||(selected!==userId&&!member.is_public)){cards=[];offset=0;hasMore=false;render();return}
 const found=await call("rkbo_community_collection",
  {p_user:selected,p_search:cardQuery,p_limit:60,p_offset:add?offset:0});
 cards=add?cards.concat(found):found;offset=(add?offset:0)+found.length;hasMore=found.length===60;
 for(const p of found)cardTitles.set(p.card_id,p.name);
 render();
 const seasons=[...new Set(found.map(p=>p.season))];
 for(const season of seasons)void loadArt(season).then(()=>{if(!overlay?.hidden&&tab==="members")hydrateArt(season)});
}
async function loadArt(season){
 season=Number(season);
 if(artCache.has(season))return artCache.get(season);
 if(artBusy.has(season))return artBusy.get(season);
 const task=(async()=>{
  let players;
  if(season===60)players=(root.RKBOSeason?.builtin?.()||[]).map(p=>({...p}));
  else{
   const response=await fetch("./data/seasons/"+season+".json",{cache:"force-cache"});
   if(!response.ok)throw Error("카드 데이터 확인 실패");
   const payload=await response.json();
   players=(Array.isArray(payload)?payload:payload.players||[]).map(p=>({...p}));
  }
  await root.RKBONameMap?.apply?.(players,null);
  root.RKBOTeamBrand?.decorate?.(players);
  players=root.RKBOCardSpecials?.addTo?.(players,season)||players;
  const map=new Map(players.map(p=>[p.id,p]));
  artCache.set(season,map);return map;
 })().catch(e=>{console.warn("[RKBO community] card art",season,e);return new Map()})
  .finally(()=>artBusy.delete(season));
 artBusy.set(season,task);return task;
}
function mini(p){
 const player=artCache.get(Number(p.season))?.get(p.card_id);
 if(!player||!root.RKBOCardView?.render)return '<div class="rkbo-cm-art-pending">⚾<small>이미지 불러오는 중</small></div>';
 try{return root.RKBOCardView.render(player,true).replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,"")}
 catch(e){return '<div class="rkbo-cm-art-pending">'+esc(p.name)+'</div>'}
}
function hydrateArt(season){
 if(!panel)return;
 for(const el of panel.querySelectorAll('.rkbo-cm-art[data-season="'+season+'"]')){
  const card=cards.find(x=>x.card_id===el.dataset.cardId);
  if(card)el.innerHTML=mini(card);
 }
}
function collectionView(){
 if(!selected)return '<p class="rkbo-cm-muted">회원을 선택하면 공개된 카드 도감을 볼 수 있습니다.</p>';
 const member=members.find(m=>m.user_id===selected);
 if(!member)return "";
 if(!member.is_public&&selected!==userId)return '<div class="rkbo-cm-section"><h3>🔒 '+esc(member.nickname)+'님의 도감</h3>도감이 비공개 상태야.</div>';
 const available=mine.filter(p=>p.tradable);
 const selectedCard=cards.find(p=>p.card_id===wanted);
 return '<section class="rkbo-cm-section"><h3>📚 '+esc(member.nickname)+'님의 카드</h3>'+
 '<form data-cm-card-search class="rkbo-cm-search"><input name="card" placeholder="선수 이름 검색" maxlength="60" value="'+esc(cardQuery)+'"><button>검색</button></form>'+
 '<div class="rkbo-cm-cards">'+cards.map(p=>'<article class="rkbo-cm-card">'+
  '<div class="rkbo-cm-art rkbo-combo-card-art" data-card-id="'+esc(p.card_id)+'" data-season="'+esc(p.season)+'">'+mini(p)+'</div>'+
  '<div class="rkbo-cm-card-meta"><strong>'+esc(p.name)+'</strong><small>'+badge(p)+' · ×'+p.quantity+'</small>'+
  ((selected!==userId&&isPublic&&p.tradable)?'<button data-cm-want="'+esc(p.card_id)+'">교환 제안</button>':'')+'</div></article>').join("")+'</div>'+
 (hasMore?'<button class="rkbo-cm-alt" data-cm-more>카드 더 보기</button>':'')+
 (wanted?'<div class="rkbo-cm-offer"><strong>🔁 교환 요청: '+esc(selectedCard?.name||wanted)+'</strong><label>내가 줄 중복 카드<select id="rkbo-cm-offered">'+
 available.filter(p=>p.card_id!==wanted).map(p=>'<option value="'+esc(p.card_id)+'">'+badge(p)+' '+esc(p.name)+' (×'+p.quantity+')</option>').join("")+
 '</select></label><button data-cm-create'+(!available.filter(p=>p.card_id!==wanted).length?' disabled':'')+'>교환 요청 보내기</button></div>':'')+
 '</section>';
}
function membersView(){
 return '<section class="rkbo-cm-visibility"><label><input type="checkbox" data-cm-public '+(isPublic?'checked':'')+'> 내 도감 공개</label>'+
 '<small>도감은 기본 공개 상태입니다. 체크를 해제하면 비공개로 전환되며 다른 회원이 조회하거나 교환할 수 없습니다.</small></section>'+
 '<form class="rkbo-cm-search" data-cm-member-search><input name="nickname" placeholder="회원 닉네임 검색" maxlength="50" value="'+esc(memberQuery)+'"><button>검색</button></form>'+
 '<div class="rkbo-cm-members">'+members.map(m=>'<button data-cm-member="'+esc(m.user_id)+'" class="rkbo-cm-member">'+
 '<strong>'+esc(m.nickname)+'</strong><small>'+((m.is_public||m.user_id===userId)?'📚 공개':'🔒 비공개')+(m.user_id===userId?' · 나':'')+'</small></button>').join("")+'</div>'+
 collectionView();
}
async function loadTrades(){
 const c=await account();
 const result=await c.from("rkbo_community_trades").select("id,sender_id,receiver_id,offered_card_id,requested_card_id,status,created_at")
  .or("sender_id.eq."+userId+",receiver_id.eq."+userId).order("created_at",{ascending:false}).limit(100);
 if(result.error)throw Error(result.error.message);
 trades=result.data||[];
 const ids=[...new Set(trades.flatMap(t=>[t.offered_card_id,t.requested_card_id]))];
 if(ids.length){
  const meta=await c.from("rkbo_pack_cards").select("card_id,name,season,grade").in("card_id",ids);
  if(!meta.error)for(const p of meta.data||[])cardTitles.set(p.card_id,p.season+"차 "+p.grade+" "+p.name);
 }
 render();
}
function tradesView(){
 return '<div class="rkbo-cm-trades"><div class="rkbo-cm-trade-head"><h3>🔁 나의 교환 요청</h3><button data-cm-refresh>새로고침</button></div>'+
 (trades.length?trades.map(t=>{
  const incoming=t.receiver_id===userId,other=who(incoming?t.sender_id:t.receiver_id);
  const first=cardTitles.get(t.offered_card_id)||t.offered_card_id,second=cardTitles.get(t.requested_card_id)||t.requested_card_id;
  return '<article class="rkbo-cm-trade"><small>'+when(t.created_at)+' · '+esc(other)+' · '+(incoming?'받은 요청':'보낸 요청')+'</small>'+
  '<strong>'+esc(first)+' ↔ '+esc(second)+'</strong>'+
  '<p>'+esc({pending:"⏳ 수락 대기",accepted:"✅ 교환 완료",declined:"거절됨",cancelled:"취소됨"}[t.status]||t.status)+'</p>'+
  (t.status==="pending"?(incoming?'<div><button data-cm-trade="accept" data-id="'+esc(t.id)+'">수락</button><button data-cm-trade="decline" data-id="'+esc(t.id)+'">거절</button></div>':
    '<button data-cm-trade="cancel" data-id="'+esc(t.id)+'">취소</button>'):'')+'</article>';
 }).join(""):'<p class="rkbo-cm-muted">아직 교환 내역이 없습니다. 공개 도감에서 다른 회원의 중복 카드를 선택해 주시기 바랍니다.</p>')+'</div>';
}
function messagesView(){
 return messages.map(m=>'<div class="rkbo-cm-message'+(m.user_id===userId?' mine':'')+'"><div><strong>'+esc(who(m.user_id))+'</strong><small>'+when(m.created_at)+'</small></div>'+
 '<p>'+esc(m.body)+'</p>'+
 (m.deleted?'':m.user_id===userId?'<button data-cm-delete="'+m.id+'">삭제</button>':'<button data-cm-report="'+m.id+'">신고</button>')+'</div>').join("")||
 '<p class="rkbo-cm-muted">첫 번째 메시지를 남겨 주시기 바랍니다.</p>';
}
function chatView(){
 return '<div class="rkbo-cm-chat"><div class="rkbo-cm-stream" id="rkbo-cm-stream">'+messagesView()+'</div>'+
 '<div class="rkbo-cm-compose"><textarea id="rkbo-cm-input" maxlength="240" rows="2" placeholder="카페 회원들에게 메시지를 남겨 주시기 바랍니다."></textarea>'+
 '<button data-cm-send>전송</button></div>'+
 '<p class="rkbo-cm-muted">메시지 삭제와 신고 가능</p></div>';
}
function render(){
 if(!panel)return;
 panel.innerHTML='<header class="rkbo-cm-head"><div><small>RKBO · COMMUNITY</small><h2>🫂 RKBO 커뮤니티</h2><p>도감 · 카드 교환</p></div><button data-cm-close aria-label="닫기">×</button></header>'+
 '<nav class="rkbo-cm-tabs">'+[["members","👥 도감 구경"],["trades","🔁 카드 교환"]]
 .map(([t,n])=>'<button data-cm-tab="'+t+'" class="'+(tab===t?'active':'')+'">'+n+'</button>').join("")+'</nav>'+
 '<p class="rkbo-cm-notice" id="rkbo-cm-notice">'+esc(notice)+'</p>'+
 '<main class="rkbo-cm-main">'+(tab==="members"?membersView():tab==="trades"?tradesView():chatView())+'</main>';
 if(tab==="chat")scroll();
}
function scroll(){const box=$("#rkbo-cm-stream");if(box)box.scrollTop=box.scrollHeight}
async function readMessages(){
 if(overlay?.hidden||tab!=="chat")return;
 const c=await account();
 const {data,error}=await c.from("rkbo_community_chat_messages").select("id,user_id,body,created_at,deleted")
  .order("created_at",{ascending:false}).limit(80);
 if(error)throw Error(error.message);
 messages=(data||[]).reverse();
 const box=$("#rkbo-cm-stream");if(box){box.innerHTML=messagesView();scroll()}
}
async function stopChat(){
 if(poll){root.clearInterval(poll);poll=null}
 if(channel&&channelClient)await channelClient.removeChannel(channel);
 channel=null;channelClient=null;
}
async function startChat(){
 await stopChat();await readMessages();
 const c=await account();channelClient=c;
 channel=c.channel("rkbo-community-chat").on("postgres_changes",
  {event:"*",schema:"public",table:"rkbo_community_chat_messages"},
  ()=>void readMessages().catch(console.warn)).subscribe();
 poll=root.setInterval(()=>{if(!overlay.hidden&&tab==="chat")void readMessages().catch(()=>{})},20000);
}
async function chooseTab(t){
 if(tab==="chat"&&t!=="chat")void stopChat();
 tab=t;wanted="";notice="";render();
 if(t==="chat")await startChat();
 if(t==="trades")await loadTrades();
 if(t==="members"){await loadMembers();render()}
}
async function act(button){
 const d=button.dataset;
 if(d.cmMember){selected=d.cmMember;wanted="";cardQuery="";cards=[];await loadMemberCards();return}
 if(d.cmWant){wanted=d.cmWant;render();return}
 if(d.cmMore!==undefined){await loadMemberCards(true);return}
 if(d.cmCreate!==undefined){
  const offered=$("#rkbo-cm-offered")?.value;
  if(!offered||!selected||!wanted)throw Error("교환 카드를 선택해 주시기 바랍니다.");
  if(!root.confirm("서로 중복 카드 한 장씩 교환을 제안하시겠습니까?"))return;
  const request=root.crypto?.randomUUID?.();
  if(!request)throw Error("보안 연결에서 요청 ID를 생성할 수 없습니다.");
  await call("rkbo_community_trade",{p_action:"create",p_target:selected,p_offered:offered,
   p_requested:wanted,p_request:request});
  await chooseTab("trades");root.dispatchEvent(new Event("rkbo-trade-updated"));inform("교환 요청을 보냈습니다. 상대방이 수락하면 카드가 교환됩니다.");return;
 }
 if(d.cmTrade){
  if(d.cmTrade==="accept"&&!root.confirm("양쪽의 중복 카드가 한 장씩 교환됩니다. 수락하시겠습니까?"))return;
  await call("rkbo_community_trade",{p_action:d.cmTrade,p_trade:d.id});
  if(d.cmTrade==="accept"){await loadMine();root.dispatchEvent(new Event("rkbo-collection-updated"))}
  await loadTrades();root.dispatchEvent(new Event("rkbo-trade-updated"));inform(d.cmTrade==="accept"?"✅ 교환이 완료되었습니다!":"교환 상태가 변경되었습니다.");return;
 }
 if(d.cmRefresh!==undefined){await loadTrades();return}
 if(d.cmSend!==undefined){
  const field=$("#rkbo-cm-input"),body=field?.value.trim();
  if(!body)return;
  await call("rkbo_community_chat_send",{p_body:body});
  if(field)field.value="";await readMessages();return;
 }
 if(d.cmDelete!==undefined){
  if(!root.confirm("메시지를 삭제하시겠습니까?"))return;
  await call("rkbo_community_chat_delete",{p_id:Number(d.cmDelete)});await readMessages();return;
 }
 if(d.cmReport!==undefined){
  if(!root.confirm("이 메시지를 신고하시겠습니까?"))return;
  await call("rkbo_community_chat_report",{p_id:Number(d.cmReport)});inform("신고가 접수되었습니다.");return;
 }
}
async function open(destination){
 if(!overlay)init();
 overlay.hidden=false;document.body.classList.add("rkbo-cm-open");
 tab=destination==="trades"?"trades":"members";selected=null;cards=[];notice="";render();
 try{
  await account();await Promise.all([loadMine(),loadMembers()]);
  if(tab==="trades")await loadTrades();else render();
 }catch(e){inform(e.message)}
}
function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove("rkbo-cm-open");void stopChat()}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const btn=document.createElement("button");btn.type="button";btn.className="rkbo-cm-nav";
 btn.textContent="🫂 커뮤니티";btn.title="RKBO 회원 도감 · 교환 · 채팅";btn.addEventListener("click",open);nav?.prepend(btn);
 overlay=document.createElement("div");overlay.className="rkbo-cm-overlay";overlay.hidden=true;
 overlay.innerHTML='<section class="rkbo-cm-dialog" role="dialog" aria-modal="true" aria-label="RKBO 커뮤니티"></section>';
 document.body.append(overlay);panel=overlay.querySelector(".rkbo-cm-dialog");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 panel.addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.cmClose!==undefined){close();return}
  if(b.dataset.cmTab){try{await chooseTab(b.dataset.cmTab)}catch(ex){inform(ex.message)}return}
  if(working)return;working=true;b.disabled=true;
  try{await act(b)}catch(ex){inform(ex.message);console.warn("[RKBO community]",ex)}
  finally{working=false;if(b.isConnected)b.disabled=false}
 });
 panel.addEventListener("change",async e=>{
  if(!e.target.matches("[data-cm-public]"))return;
  try{isPublic=await call("rkbo_community_set_public",{p_public:e.target.checked});
   await loadMembers();render();inform(isPublic?"내 카드 도감을 공개했습니다.":"내 카드 도감을 비공개로 전환했습니다.");
  }catch(ex){e.target.checked=isPublic;inform(ex.message)}
 });
 panel.addEventListener("submit",async e=>{
  if(e.target.matches("[data-cm-member-search]")){
   e.preventDefault();memberQuery=new FormData(e.target).get("nickname")?.toString()||"";
   selected=null;cards=[];try{await loadMembers();render()}catch(ex){inform(ex.message)}
  }
  if(e.target.matches("[data-cm-card-search]")){
   e.preventDefault();cardQuery=new FormData(e.target).get("card")?.toString()||"";
   try{await loadMemberCards()}catch(ex){inform(ex.message)}
  }
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&overlay&&!overlay.hidden)close()});
}
root.RKBOCommunity={open,close};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})(window);
