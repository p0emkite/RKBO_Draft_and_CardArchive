/* RKBO LEAGUE v1 — server-authoritative 10-team snake draft & 144 game season. */
(function(root){"use strict";
const CLUBS=["KIA","HAN","SAM","LOT","LG","DOO","SSG","NC"];
const LABELS={KIA:"KIA 타이거즈",HAN:"한화 이글스",SAM:"삼성 라이온즈",LOT:"롯데 자이언츠",
 LG:"LG 트윈스",DOO:"두산 베어스",SSG:"SSG 랜더스",NC:"NC 다이노스"};
const POS=["C","1B","2B","3B","SS","LF","CF","RF","DH","SP1","SP2","SP3","SP4","SP5","RP1","RP2","RP3","CP"];
const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const logo=c=>c==="NC"?"./assets/teams/NC.png":"./assets/teams/"+c+".svg";
const ko=c=>LABELS[c]||c;
const formatN=v=>Number(v||0).toLocaleString("ko-KR");
let overlay=null,panel=null,room=null,roomId=null,client=null,user=null;
let people=[],members=[],picks=[],rights=[],trades=[],standings=[],stats=[],games=[],publicRooms=[],message="",code="";
let channel=null,subscribedId=null,refreshing=false,processing=false,autoRun=false,timer=null;
let rosterArt=new Map(),rosterLoading=new Map(),memberNames=new Map(),lastState="",view="list";
const $=s=>panel?.querySelector(s);
function flash(s){message=s;const el=$("[data-league-message]");if(el)el.textContent=s}
async function login(){
 const c=await root.RKBOOnline?.getClient?.();
 if(!c)throw Error("RKBO ONLINE에 로그인해 줘.");
 const {data,error}=await c.auth.getUser();
 if(error||!data?.user||data.user.is_anonymous)throw Error("Google 로그인 후 리그에 참가할 수 있어.");
 client=c;user=data.user.id;return c;
}
async function act(method,params={}){
 const c=await login();const {data,error}=await c.rpc("rkbo_league_action",{p_action:method,p_room:roomId,...params});
 if(error)throw Error(error.message);return data;
}
async function trade(method,params={}){
 const c=await login();const {data,error}=await c.rpc("rkbo_league_trade",{p_action:method,p_room:roomId,...params});
 if(error)throw Error(error.message);return data;
}
async function query(q){
 const {data,error}=await q;if(error)throw Error(error.message);return data||[];
}
async function getPublic(){
 const c=await login();
 publicRooms=await query(c.from("rkbo_league_rooms")
  .select("id,name,mode,visibility,season,phase,week,created_at").eq("visibility","public")
  .order("created_at",{ascending:false}).limit(40));
 render();
}
async function acquireRoom(){
 const c=await login();
 const r=await c.from("rkbo_league_rooms").select("*").eq("id",roomId).maybeSingle();
 if(r.error||!r.data)throw Error(r.error?.message||"리그 방에 접근할 수 없어.");
 const queries=[
 c.from("rkbo_league_members").select("club,user_id,is_ai,roster").eq("room_id",roomId),
 c.from("rkbo_league_picks").select("round,pick,club,slot,card_id,auto_selected").eq("room_id",roomId).order("round",{ascending:true}).order("pick",{ascending:true}),
 c.from("rkbo_league_rights").select("round,pick,owner_club,original_club").eq("room_id",roomId),
 c.from("rkbo_league_trades").select("*").eq("room_id",roomId).order("created_at",{ascending:false}).limit(60),
 c.from("rkbo_league_stats").select("*").eq("room_id",roomId),
 c.from("rkbo_league_games").select("game_no,week,home_club,away_club,home_runs,away_runs").eq("room_id",roomId).order("game_no",{ascending:false}).limit(60)
 ];
 const rr=await Promise.all(queries.map(query));
 for(const x of rr)if(x.error)throw Error(x.error.message);
 [members,picks,rights,trades,stats,games]=rr.map(x=>x.data||[]);
 room=r.data;
 const uu=[...new Set([room.host_id,...members.filter(m=>m.user_id).map(m=>m.user_id)])];
 if(uu.length){
  const prof=await c.from("rkbo_profiles").select("user_id,nickname").in("user_id",uu);
  if(!prof.error)for(const p of prof.data||[])memberNames.set(p.user_id,p.nickname);
 }
 if(room.week>0){
  const t=await c.rpc("rkbo_league_standings",{p_room:roomId});
  if(!t.error)standings=t.data||[];
 }
 if(room.phase==="draft") {
  for(const c of room.draft_candidates||[])void ensureArt(c.season);
 }
 render();
}
async function refresh(){
 if(refreshing||processing)return;
 refreshing=true;
 try{
  if(roomId)await acquireRoom();
  else if(overlay&&!overlay.hidden)await getPublic();
 }catch(e){if(overlay&&!overlay.hidden)flash(e.message);console.warn("[RKBO League] refresh",e)}
 finally{refreshing=false}
}
async function subscribe(){
 if(!client||!roomId||subscribedId===roomId)return;
 if(channel)try{await client.removeChannel(channel)}catch{}
 subscribedId=roomId;
 channel=client.channel("rkbo-league-"+roomId)
 .on("postgres_changes",{event:"*",schema:"public",table:"rkbo_league_rooms",filter:"id=eq."+roomId},
  ()=>{if(!autoRun)void refresh()})
 .on("postgres_changes",{event:"*",schema:"public",table:"rkbo_league_trades",filter:"room_id=eq."+roomId},
  ()=>{if(!autoRun)void refresh()}).subscribe();
}
function img(club){return '<img src="'+logo(club)+'" alt="'+esc(ko(club))+'" loading="lazy">'}
function clubsMarkup(chosen="",name="club"){
 return '<div class="rkbo-league-club-pick" data-league-clubs="'+name+'">'+
 CLUBS.map(c=>'<label class="rkbo-league-club-radio"><input type="radio" name="'+name+
 '" value="'+c+'"'+(c===chosen?' checked':'')+'>'+img(c)+'<span>'+esc(ko(c))+'</span></label>').join("")+'</div>';
}
function optionClubs(exclude=""){
 return CLUBS.filter(c=>c!==exclude).map(c=>'<option value="'+c+'">'+esc(ko(c))+'</option>').join("");
}
function member(club){return members.find(x=>x.club===club)}
function myClub(){return members.find(x=>x.user_id===user)?.club}
function nickname(club){
 const m=member(club);
 return m?.is_ai?"AI":m?.user_id?memberNames.get(m.user_id)||"회원":"모집 중";
}
function rosterFor(club){return member(club)?.roster||{}}
function rosterName(club,slot){const c=rosterFor(club)[slot];return c?c.name+" ("+c.ovr+")":"–"}
function renderList(){
 return '<section class="rkbo-league-lobby"><div class="rkbo-league-two-col">'+
 '<div class="rkbo-league-box"><h3>🏟️ 새 리그 만들기</h3>'+
 '<form data-league-create><label>방 이름<input name="title" maxlength="48" required value="RKBO 8구단 리그"></label>'+
 '<label>방 공개 설정<select name="visibility"><option value="public" selected>🌐 공개방 (기본)</option>'+
 '<option value="code">🔑 초대 코드 전용</option></select></label>'+
 '<label>참가 방식<select name="mode"><option value="multi">실시간 멀티 (빈 팀은 AI)</option>'+
 '<option value="solo">혼자 + AI 7구단</option></select></label>'+
 '<label>카드 시즌<select name="season">'+
 Array.from({length:60},(_,i)=>60-i).map(n=>'<option value="'+n+'"'+(n===60?' selected':'')+'>'+n+'차</option>').join("")+
 '</select></label><strong>내 구단 선택</strong>'+clubsMarkup("KIA","createClub")+
 '<button class="rkbo-league-primary" type="submit">방 생성</button></form></div>'+
 '<div class="rkbo-league-box"><h3>🌐 공개 리그 방</h3>'+
 '<p>카페 회원이 자유롭게 참여할 수 있어. 초대 코드는 선택 사항이야.</p>'+
 '<button type="button" data-league-reload>공개방 새로고침</button>'+
 '<div class="rkbo-league-public">'+
 (publicRooms.length?publicRooms.map(r=>'<button type="button" data-league-select="'+esc(r.id)+'">'+
 '<strong>'+esc(r.name)+'</strong><span>'+esc(r.season)+'차 · '+
 (r.mode==="solo"?"혼자 + AI":"멀티")+' · '+(r.phase==="lobby"?"참가 모집 중":"진행 중")+
 '</span></button>').join(""):'<p>공개방이 없어. 첫 방을 만들어 봐!</p>')+'</div>'+
 '<form data-league-code><label>🔑 초대 코드로 참가<input name="invite" required maxlength="16" placeholder="12자리 초대 코드"></label>'+
 '<strong>참가할 구단</strong>'+clubsMarkup("HAN","codeClub")+
 '<button type="submit">코드로 입장</button></form></div></div></section>';
}
function renderLobby(){
 const mine=myClub(),isHost=room.host_id===user;
 return '<section class="rkbo-league-box"><div class="rkbo-league-room-meta"><div><h3>'+esc(room.name)+'</h3>'+
 '<small>'+room.season+'차 · '+(room.visibility==="public"?"🌐 공개방":"🔑 초대방")+
 ' · '+(room.mode==="solo"?"혼자 + AI":"실시간 멀티")+'</small></div>'+
 '<button data-league-back>방 목록</button></div>'+
 (code?'<div class="rkbo-league-invite">초대 코드: <strong>'+esc(code)+'</strong>'+
 '<button type="button" data-league-copy="'+esc(code)+'">복사</button></div>':'')+
 '<h3>참가 구단</h3><div class="rkbo-league-ten">'+CLUBS.map(c=>{
 const m=member(c);return '<div class="rkbo-league-team'+(m?' joined':'')+'">'+img(c)+
 '<strong>'+esc(ko(c))+'</strong><small>'+esc(nickname(c))+'</small></div>';
 }).join("")+'</div>'+
 (!mine?'<form data-league-join><h3>내 구단 선택</h3>'+clubsMarkup("","joinClub")+
 '<button type="submit" class="rkbo-league-primary">이 구단으로 참가</button></form>':
 '<p class="rkbo-league-hint">✅ '+esc(ko(mine))+' 구단으로 참가했어.</p>')+
 (isHost?'<button class="rkbo-league-primary" data-league-start>🏁 드래프트 시작 · 빈 구단 AI 충원</button>':
 '<p class="rkbo-league-hint">방장이 드래프트를 시작하면 자동으로 이동해.</p>')+
 '</section>';
}
function miniMarkup(c){
 const season=Number(c.season),p=rosterArt.get(season)?.get(c.cardId);
 if(p&&root.RKBOCardView?.render){
  try{return root.RKBOCardView.render(p,true).replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,"")}
  catch(e){console.warn("[RKBO League] card art",e)}
 }
 return '<div class="rkbo-league-card-fallback"><div>'+esc(c.grade)+'</div><strong>'+esc(c.ovr)+'</strong>'+
 '<span>'+esc(c.name)+'</span><small>'+season+'차 · '+esc(c.position)+'</small></div>';
}
async function ensureArt(season){
 const s=Number(season);
 if(rosterArt.has(s)||rosterLoading.has(s))return rosterLoading.get(s);
 const pending=(async()=>{
  let players;
  if(s===60)players=(root.RKBOSeason?.builtin?.()||[]).map(p=>({...p}));
  else{
   const resp=await fetch("./data/seasons/"+s+".json",{cache:"force-cache"});
   if(!resp.ok)return;
   const data=await resp.json();players=(Array.isArray(data)?data:data.players||[]).map(p=>({...p}));
  }
  if(!players?.length)return;
  await root.RKBONameMap?.apply?.(players,null);
  root.RKBOTeamBrand?.decorate?.(players);
  players=root.RKBOCardSpecials?.addTo?.(players,s)||players;
  rosterArt.set(s,new Map(players.map(p=>[p.id,p])));
  if(overlay&&!overlay.hidden&&room?.phase==="draft")hydrateCards(s);
 })().catch(e=>console.warn("[RKBO League] asset loading",e)).finally(()=>rosterLoading.delete(s));
 rosterLoading.set(s,pending);return pending;
}
function hydrateCards(season){
 if(!panel)return;
 for(const el of panel.querySelectorAll('.rkbo-league-art[data-season="'+season+'"]')){
  const c=(room?.draft_candidates||[]).find(x=>x.cardId===el.dataset.cardId);
  if(c)el.innerHTML=miniMarkup(c);
 }
}
function renderDraft(){
 const mine=myClub(),r=room.draft_round,t=room.draft_turn;
 const club=room.current_club,slot=room.current_slot;
 const mineTurn=club===mine,host=room.host_id===user;
 const timerVal=room.expires_at?Math.max(0,Math.ceil((new Date(room.expires_at)-Date.now())/1000)):0;
 const recent=picks.slice(-12).reverse();
 return '<section class="rkbo-league-box"><div class="rkbo-league-draft-head">'+
 '<div><small>ROUND '+String(r).padStart(2,"0")+' · PICK '+String(t).padStart(2,"0")+
 ' / 8 · 전체 '+(picks.length)+'/144 지명</small><h3>'+
 (club?esc(ko(club))+" 지명 차례":"드래프트 진행 중")+'</h3>'+
 '<p>현재 포지션: <strong>'+esc(slot||"–")+'</strong>'+
 ' · '+(club?"선택 구단: "+esc(nickname(club)):"다음 지명 준비")+'</p></div>'+
 '<div class="rkbo-league-timer"><strong data-league-countdown>'+timerVal+'</strong><small>초 남음</small></div></div>'+
 '<div class="rkbo-league-ten mini">'+CLUBS.map(c=>'<div class="rkbo-league-team'+(club===c?' active':'')+'">'+img(c)+
 '<strong>'+esc(c)+'</strong><small>'+esc(nickname(c))+'</small></div>').join("")+'</div>'+
 '<h3>🎴 '+esc(slot||"")+' 포지션 무작위 후보 '+(room.draft_candidates||[]).length+'명</h3>'+
 '<p class="rkbo-league-hint">같은 포지션의 실제 선수 카드 중 최대 15명을 무작위로 제시해. 이전에 지명된 카드는 다시 나오지 않아.</p>'+
 '<div class="rkbo-league-candidates">'+(room.draft_candidates||[]).map(c=>
 '<article class="rkbo-league-candidate"><div class="rkbo-league-art" data-card-id="'+esc(c.cardId)+
 '" data-season="'+esc(c.season)+'">'+miniMarkup(c)+'</div>'+
 '<strong>'+esc(c.name)+'</strong><small>'+esc(c.season)+'차 · '+esc(c.position)+
 ' · OVR '+esc(c.ovr)+'</small>'+
 '<button type="button" data-league-pick="'+esc(c.cardId)+'" '+(!mineTurn?'disabled':'')+'>'+
 (mineTurn?'이 선수 지명':'지명 대기')+'</button></article>').join("")+'</div>'+
 '<h3>최근 지명 결과</h3><div class="rkbo-league-picks">'+(recent.length?
 recent.map(p=>'<div><strong>'+p.round+'R '+p.pick+'픽 · '+esc(p.club)+'</strong><span>'+
 esc(p.slot)+' · '+esc(p.card_id)+'</span></div>').join(""):'첫 번째 지명을 기다리는 중')+'</div>'+
 (mine?renderTradePanel("pick"):'')+'</section>';
}
function renderTradePanel(kind){
 const mine=myClub();
 if(!mine)return "";
 const pending=trades.filter(t=>t.status==="pending");
 const roomClubOpts=CLUBS.filter(c=>c!==mine);
 return '<details class="rkbo-league-trade-panel"'+(room.phase==="midseason"?' open':'')+'><summary>🔄 '+
 (kind==="pick"?"다음 라운드 지명권 트레이드":"시즌 중반 선수 트레이드")+'</summary>'+
 '<form data-league-trade-create><input type="hidden" name="tradeType" value="'+kind+'">'+
 '<label>상대 구단<select name="target">'+roomClubOpts.map(c=>'<option value="'+c+'">'+
 esc(ko(c))+' ('+esc(nickname(c))+')</option>').join("")+'</select></label>'+
 (kind==="player"?'<label>교환할 포지션<select name="slot">'+POS.map(s=>
 '<option value="'+s+'">'+s+' · '+esc(rosterName(mine,s))+'</option>').join("")+'</select></label>':
 '<p>다음 라운드의 서로 다른 지명 순서를 맞바꿔. 상대가 수락하면 바로 적용돼.</p>')+
 '<button type="submit">교환 제안</button></form>'+
 '<div class="rkbo-league-trade-records">'+(pending.length?pending.map(t=>{
 const receivable=t.recipient===mine,other=receivable?t.proposer:t.recipient;
 return '<div><small>'+esc(ko(other))+' · '+(t.trade_type==="pick"?"지명권":"선수 "+t.from_ref)+
 '</small><strong>'+esc(t.proposer)+' ↔ '+esc(t.recipient)+'</strong>'+
 (receivable?'<button data-league-trade-resolve="accept" data-trade-id="'+esc(t.id)+'">수락</button>'+
 '<button data-league-trade-resolve="decline" data-trade-id="'+esc(t.id)+'">거절</button>':
 '<button data-league-trade-resolve="cancel" data-trade-id="'+esc(t.id)+'">취소</button>')+
 '</div>';
 }).join(""):'현재 대기 중인 교환 제안이 없어.')+'</div></details>';
}
function renderStandings(){
 return '<table class="rkbo-league-table"><thead><tr><th>순위</th><th>구단</th>'+
 '<th>경기</th><th>승</th><th>패</th><th>무</th><th>승률</th></tr></thead><tbody>'+
 standings.map((s,i)=>'<tr><td>'+ (i+1)+'</td><td>'+img(s.club)+esc(s.club)+'</td><td>'+formatN(s.played)+
 '</td><td>'+formatN(s.wins)+'</td><td>'+formatN(s.losses)+'</td><td>'+formatN(s.ties)+
 '</td><td>'+esc(s.percentage??".000")+'</td></tr>').join("")+'</tbody></table>';
}
function rateStat(s,stat){
 if(stat==="AVG")return s.ab?Number(s.hits/s.ab).toFixed(3):"–";
 if(stat==="ERA")return s.ip_outs?(s.er*27/s.ip_outs).toFixed(2):"–";
 const field={HR:"hr",RBI:"rbi",H:"hits",W:"wins",SO:"strikeouts",SV:"saves"}[stat];
 return formatN(s[field]);
}
function leaderboard(kind,stat){
 const rank=stats.filter(s=>s.kind===kind&&((stat==="AVG")?s.ab>0:(stat==="ERA")?s.ip_outs>0:true))
 .sort((a,b)=>stat==="AVG"?(b.hits/b.ab)-(a.hits/a.ab):
 stat==="ERA"?(a.er/a.ip_outs)-(b.er/b.ip_outs):
 Number(b[{HR:"hr",RBI:"rbi",H:"hits",W:"wins",SO:"strikeouts",SV:"saves"}[stat]])-
 Number(a[{HR:"hr",RBI:"rbi",H:"hits",W:"wins",SO:"strikeouts",SV:"saves"}[stat]])).slice(0,5);
 const allCards=members.flatMap(m=>Object.values(m.roster||{}).map(p=>({id:p.cardId,name:p.name,club:m.club})));
 const lookup=new Map(allCards.map(p=>[p.id,p.name]));
 return '<div class="rkbo-league-leader"><strong>'+stat+' TOP 5</strong>'+
 '<ol>'+rank.map(s=>'<li><span>'+esc(lookup.get(s.card_id)||s.card_id)+'</span>'+
 '<small>'+esc(s.club)+'</small><b>'+rateStat(s,stat)+'</b></li>').join("")+'</ol></div>';
}
function renderSeason(){
 const phase=room.phase,host=room.host_id===user;
 const atMid=phase==="midseason",finished=phase==="finished";
 const awards=room.awards||{};
 return '<section class="rkbo-league-box"><div class="rkbo-league-season-head"><div>'+
 '<small>RKBO LEAGUE · '+esc(room.name)+'</small><h3>'+
 (finished?'🏆 리그 종료':atMid?'🔄 시즌 중반 트레이드 기간':'⚾ 정규리그 진행 중')+
 '</h3><p>'+room.week+'주차 / 36주차 · 각 팀 '+(room.week*4)+'/144경기 · 총 '+(room.week*16)+'/576경기</p></div>'+
 '<div class="rkbo-league-progress"><div style="width:'+Math.round(room.week/36*100)+'%"></div></div></div>'+
 (!finished&&host?'<div class="rkbo-league-actions">'+
 (atMid?'<button type="button" data-league-resume>트레이드 마감하고 후반기 진행 ▶</button>':
 '<button type="button" data-league-simulate '+(autoRun?'disabled':'')+'>⏩ '+
 (autoRun?"주차별 시뮬레이션 중":"리그를 연속 시뮬레이션")+'</button>')+'</div>':'')+
 (atMid?'<p class="rkbo-league-hint">전반기 72경기가 끝났어. 트레이드를 진행한 뒤 후반기를 시작해!</p>':"")+
 '<h3>📊 정규리그 순위</h3>'+renderStandings()+
 (atMid?renderTradePanel("player"):"")+
 '<h3>최근 경기</h3><div class="rkbo-league-game-list">'+games.slice(0,20).map(g=>
 '<div><small>'+g.week+'주차</small><strong>'+esc(g.away_club)+' '+g.away_runs+
 ' : '+g.home_runs+' '+esc(g.home_club)+'</strong></div>').join("")+'</div>'+
 (finished?'<h3>🏅 개인 MVP</h3><div class="rkbo-league-mvps">'+
 ['battingMVP','pitchingMVP'].map((field,i)=>{
 const s=awards[field];return '<div><small>'+(i?'투수 MVP':'타자 MVP')+'</small><strong>'+
 esc(s?.name||"–")+'</strong><span>'+esc(s?.club||"")+' · '+
 (i?'승 '+esc(s?.wins)+' · 탈삼진 '+esc(s?.strikeouts):
 '타율 '+esc(s?.average)+' · 홈런 '+esc(s?.hr))+'</span></div>';
 }).join("")+'</div>'+
 '<h3>주요 투타 지표 TOP 5</h3><div class="rkbo-league-leaders">'+
 ["AVG","HR","RBI","H"].map(s=>leaderboard("batter",s)).join("")+
 ["ERA","W","SO","SV"].map(s=>leaderboard("pitcher",s)).join("")+
 '</div>':'')+'</section>';
}
function render(){
 if(!panel)return;
 const status=room?room.phase:"none";
 panel.innerHTML='<header class="rkbo-league-header"><div><small>RKBO ONLINE · LEAGUE DRAFT</small>'+
 '<h2>🏟️ RKBO 8구단 리그</h2><p>공개방 · 포지션 드래프트 · 144경기 시뮬레이션</p></div>'+
 '<button type="button" data-league-close aria-label="닫기">×</button></header>'+
 '<p class="rkbo-league-message" data-league-message>'+esc(message)+'</p>'+
 '<main class="rkbo-league-content">'+(!room?renderList():
 status==="lobby"?renderLobby():status==="draft"?renderDraft():renderSeason())+'</main>';
}
async function loadRoom(id){
 roomId=id;code="";room=null;message="";await acquireRoom();await subscribe();
}
async function doSim(){
 if(autoRun||!roomId)return;
 autoRun=true;
 try{
  while(room&&room.phase==="season"){
   const id=roomId;
   const c=await login();
   const {data,error}=await c.rpc("rkbo_league_week",{p_room:id,p_action:"next"});
   if(error)throw Error(error.message);
   await acquireRoom();
   flash("✅ "+data.week+"주차 완료 · "+(data.week*4)+"/144경기");
   if(data.phase!=="season")break;
   await new Promise(done=>root.setTimeout(done,105));
  }
 }catch(e){flash("시뮬레이션 중단: "+e.message)}
 finally{autoRun=false;render()}
}
async function click(button){
 const d=button.dataset;
 if(d.leagueClose!==undefined){close();return}
 if(d.leagueReload!==undefined){await getPublic();return}
 if(d.leagueBack!==undefined){roomId=null;room=null;view="list";code="";await getPublic();return}
 if(d.leagueSelect){await loadRoom(d.leagueSelect);return}
 if(d.leagueStart!==undefined){
  if(!root.confirm("빈 구단은 AI로 채우고 드래프트를 시작할까?"))return;
  await act("start");await acquireRoom();return;
 }
 if(d.leaguePick){
  const card=(room.draft_candidates||[]).find(c=>c.cardId===d.leaguePick);
  if(!card)return;
  if(!root.confirm(card.name+" 선수를 "+room.current_slot+"에 지명할까?"))return;
  await act("pick",{p_card:d.leaguePick});await acquireRoom();return;
 }
 if(d.leagueSimulate!==undefined){await doSim();return}
 if(d.leagueResume!==undefined){
  if(!root.confirm("시즌 중반 트레이드를 마감하고 후반기로 진행할까?"))return;
  const c=await login(),result=await c.rpc("rkbo_league_week",{p_room:roomId,p_action:"resume"});
  if(result.error)throw Error(result.error.message);
  await acquireRoom();await doSim();return;
 }
 if(d.leagueTradeResolve){
  await trade(d.leagueTradeResolve,{p_offer:d.tradeId});await acquireRoom();return;
 }
 if(d.leagueCopy){
  if(root.navigator?.clipboard?.writeText)await root.navigator.clipboard.writeText(d.leagueCopy);
  flash("초대 코드 복사: "+d.leagueCopy);return;
 }
}
async function submit(form){
 const values=new FormData(form);
 if(form.matches("[data-league-create]")){
  const club=values.get("createClub");if(!club)throw Error("KBO 구단을 선택해 줘.");
  const result=await act("create",{p_name:String(values.get("title")||"").trim(),
   p_club:club,p_visibility:values.get("visibility"),p_mode:values.get("mode"),
   p_season:Number(values.get("season")||60)});
  await loadRoom(result.roomId);code=result.inviteCode||"";render();return;
 }
 if(form.matches("[data-league-code]")){
  const club=values.get("codeClub");if(!club)throw Error("참가할 구단을 골라 줘.");
  const result=await act("join_code",{p_code:String(values.get("invite")||"").trim(),p_club:club});
  await loadRoom(result.roomId);return;
 }
 if(form.matches("[data-league-join]")){
  const club=values.get("joinClub");if(!club)throw Error("비어 있는 구단을 선택해 줘.");
  await act("join",{p_club:club});await acquireRoom();return;
 }
 if(form.matches("[data-league-trade-create]")){
  const kind=values.get("tradeType"),target=values.get("target"),slot=values.get("slot");
  const result=await trade("create",{p_type:kind,p_target:target,
   p_from:kind==="player"?slot:"next",p_to:kind==="player"?slot:"next"});
  await acquireRoom();
  flash(result.status==="accepted"?"🤝 AI 구단과 교환 완료!":result.status==="declined"?
   (result.reason||"AI가 교환을 거절했어"):"교환 제안을 보냈어.");return;
 }
}
function countdown(){
 if(!room||room.phase!=="draft")return;
 const node=$("[data-league-countdown]");
 if(node&&room.expires_at)node.textContent=String(Math.max(0,Math.ceil((new Date(room.expires_at)-Date.now())/1000)));
}
async function tick(){
 if(!overlay||overlay.hidden||!roomId||processing||autoRun)return;
 if(room?.phase==="draft"&&room.expires_at&&new Date(room.expires_at)<=new Date()){
  try{processing=true;await act("tick");}catch(e){console.warn("[RKBO League] draft timer",e)}
  finally{processing=false}
 }
 await refresh();
}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const btn=document.createElement("button");btn.type="button";btn.className="rkbo-league-nav";
 btn.textContent="🏟️ LEAGUE";btn.addEventListener("click",open);nav?.prepend(btn);
 overlay=document.createElement("div");overlay.hidden=true;overlay.className="rkbo-league-overlay";
 overlay.innerHTML='<section role="dialog" aria-modal="true" aria-label="RKBO 8구단 리그" class="rkbo-league-panel"></section>';
 document.body.append(overlay);panel=overlay.firstElementChild;
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 panel.addEventListener("click",async event=>{
  const btn=event.target.closest("button");if(!btn||processing)return;
  processing=true;btn.disabled=true;
  try{await click(btn)}catch(e){flash(e.message);console.warn("[RKBO League]",e)}
  finally{processing=false;if(btn.isConnected)btn.disabled=false}
 });
 panel.addEventListener("submit",async event=>{
  event.preventDefault();if(processing)return;processing=true;
  try{await submit(event.target)}catch(e){flash(e.message);console.warn("[RKBO League]",e)}
  finally{processing=false}
 });
 timer=root.setInterval(countdown,500);
 root.setInterval(()=>{void tick()},3000);
}
async function open(){
 if(!overlay)init();overlay.hidden=false;message="";render();
 try{
  await login();
  if(roomId){await acquireRoom();await subscribe()}
  else await getPublic();
 }catch(e){flash(e.message)}
}
function close(){if(!overlay)return;overlay.hidden=true}
root.RKBOLeague={open,close};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})(window);
