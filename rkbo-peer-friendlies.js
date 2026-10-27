/* RKBO ONLINE: asynchronous member-vs-member friendly baseball. */
(function(root){"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let overlay=null,panel=null,button=null,user=null,client=null,ready=false,busy=false;
let members=[],teams=[],matches=[],channel=null,notice="",active=false;
const find=s=>panel?.querySelector(s);
const date=v=>{try{return new Date(v).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return ""}};
async function context(){
 const c=await root.RKBOOnline?.getClient?.();
 if(!c)throw Error("로그인 후 이용해 줘.");
 const {data,error}=await c.auth.getUser();
 if(error||!data?.user||data.user.is_anonymous)throw Error("Google 로그인 후 친선경기를 이용할 수 있어.");
 client=c;user=data.user.id;return c;
}
async function rpc(action,extra){
 const c=await context();
 const {data,error}=await c.rpc("rkbo_community_friendly",{p_action:action,...extra});
 if(error)throw Error(error.message);return data;
}
function name(id){return members.find(p=>p.user_id===id)?.nickname||String(id||"").slice(0,8)}
function teamsHTML(){return teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+' (OVR '+
 esc(Math.round(Number(t.average_ovr||0)*10)/10)+')</option>').join("")}
function scoreboard(m){
 if(m.status!=="completed")return "";
 const rows=Array.isArray(m.innings)?m.innings:[];
 const a=m.challenger_id===user?m.challenger_runs:m.opponent_runs;
 const b=m.challenger_id===user?m.opponent_runs:m.challenger_runs;
 return '<div class="rkbo-pvp-score">'+esc(a)+' : '+esc(b)+'</div>'+
 '<div class="rkbo-pvp-verdict">'+(a>b?'🏆 승리!':a<b?'아쉽게 패배':'🤝 무승부')+'</div>'+
 '<details><summary>9이닝 스코어보드 보기</summary><div class="rkbo-pvp-score-scroll"><table><thead><tr>'+
 '<th>팀</th>'+rows.map(x=>'<th>'+esc(x.inning)+'</th>').join("")+'<th>합계</th></tr></thead><tbody>'+
 '<tr><th>도전자</th>'+rows.map(x=>'<td>'+esc(x.away)+'</td>').join("")+
 '<td>'+esc(m.challenger_runs)+'</td></tr>'+
 '<tr><th>수락자</th>'+rows.map(x=>'<td>'+esc(x.home)+'</td>').join("")+
 '<td>'+esc(m.opponent_runs)+'</td></tr></tbody></table></div></details>';
}
function entry(m){
 const incoming=m.opponent_id===user;
 const other=name(incoming?m.challenger_id:m.opponent_id);
 const ownTeam=incoming?m.opponent_team_name:m.challenger_team_name;
 const rivalTeam=incoming?m.challenger_team_name:m.opponent_team_name;
 return '<article class="rkbo-pvp-match"><div class="rkbo-pvp-entry-top"><small>'+
 esc(date(m.created_at))+' · '+(incoming?'받은 도전장':'보낸 도전장')+' · '+esc(other)+'</small>'+
 '<span>'+esc({pending:"⏳ 대기",completed:"경기 종료",declined:"거절",cancelled:"취소"}[m.status]||m.status)+'</span></div>'+
 '<div class="rkbo-pvp-versus"><strong>'+esc(ownTeam||"내 MY TEAM")+'</strong><b>VS</b>'+
 '<strong>'+esc(rivalTeam||"상대 MY TEAM")+'</strong></div>'+
 (m.status==="completed"?scoreboard(m):m.status!=="pending"?"":incoming?
 '<label>수락할 내 팀<select data-pvp-accept-team="'+esc(m.id)+'">'+teamsHTML()+'</select></label>'+
 '<div class="rkbo-pvp-actions"><button data-pvp-action="accept" data-id="'+esc(m.id)+'"'+
 (teams.length?'':' disabled')+'>⚾ 수락하고 경기 시작</button>'+
 '<button data-pvp-action="decline" data-id="'+esc(m.id)+'">거절</button></div>':
 '<div class="rkbo-pvp-actions"><p>상대가 수락하면 9이닝 경기가 진행돼.</p>'+
 '<button data-pvp-action="cancel" data-id="'+esc(m.id)+'">도전 취소</button></div>')+
 '</article>';
}
function render(){
 if(!panel)return;
 const others=members.filter(p=>p.user_id!==user);
 panel.innerHTML='<header class="rkbo-pvp-header"><div><small>RKBO ONLINE · COMMUNITY MATCH</small>'+
 '<h2>⚾ 회원 간 친선경기</h2><p>카페 회원의 MY TEAM에 도전해 봐!</p></div>'+
 '<button type="button" data-pvp-close aria-label="닫기">×</button></header>'+
 '<p class="rkbo-pvp-notice" data-pvp-notice>'+esc(notice)+'</p>'+
 '<div class="rkbo-pvp-body"><section class="rkbo-pvp-start"><h3>도전장 보내기</h3>'+
 '<p>상대가 자기 팀을 선택해 수락하면, 양쪽 선수 능력치를 반영해 서버에서 9이닝을 진행해.</p>'+
 '<label>상대 회원<select id="rkbo-pvp-opponent">'+others.map(p=>
 '<option value="'+esc(p.user_id)+'">'+esc(p.nickname)+'</option>').join("")+'</select></label>'+
 '<label>내 MY TEAM<select id="rkbo-pvp-team">'+teamsHTML()+'</select></label>'+
 '<div class="rkbo-pvp-actions"><button data-pvp-create'+(!others.length||!teams.length?' disabled':'')+'>⚾ 친선경기 신청</button>'+
 '<button data-pvp-myteam>MY TEAM 편성</button>'+
 '<button data-pvp-refresh>새로고침</button></div>'+
 (!teams.length?'<p>먼저 MY TEAM에서 선수 18명으로 팀을 저장해 줘.</p>':'')+
 '</section><section class="rkbo-pvp-list"><h3>도전장 · 경기 기록</h3>'+
 (matches.length?matches.map(entry).join(""):'<p class="rkbo-pvp-muted">아직 친선경기 기록이 없어.</p>')+
 '</section></div>';
}
function badge(){
 if(!button)return;
 let b=button.querySelector(".rkbo-pvp-badge");
 if(!b){b=document.createElement("span");b.className="rkbo-pvp-badge";button.append(b)}
 const pending=matches.filter(m=>m.opponent_id===user&&m.status==="pending").length;
 b.hidden=!pending;b.textContent=String(pending);
}
function say(value){notice=value;const e=find("[data-pvp-notice]");if(e)e.textContent=value}
async function refresh(){
 const c=await context();
 const [users,own,games]=await Promise.all([
 c.rpc("rkbo_community_members",{p_search:""}),
 c.from("rkbo_owned_teams").select("id,name,average_ovr")
  .eq("user_id",user).order("updated_at",{ascending:false}).limit(50),
 c.from("rkbo_community_friendlies")
  .select("id,challenger_id,opponent_id,challenger_team_name,opponent_team_name,status,challenger_runs,opponent_runs,innings,created_at")
  .or("challenger_id.eq."+user+",opponent_id.eq."+user)
  .order("created_at",{ascending:false}).limit(80)
 ]);
 if(users.error)throw Error(users.error.message);
 if(own.error)throw Error(own.error.message);
 if(games.error)throw Error(games.error.message);
 members=users.data||[];teams=own.data||[];matches=games.data||[];
 badge();if(active)render();
}
async function connect(){
 if(ready||!client)return;
 const c=client;
 channel=c.channel("rkbo-pvp-my-games").on("postgres_changes",{
  event:"*",schema:"public",table:"rkbo_community_friendlies"
 },()=>void refresh().catch(console.warn)).subscribe();
 ready=true;
}
async function open(){
 if(!overlay)init();
 overlay.hidden=false;active=true;notice="";render();
 try{await refresh();await connect()}
 catch(e){say(e.message)}
}
function close(){if(!overlay)return;overlay.hidden=true;active=false}
async function click(buttonEl){
 const d=buttonEl.dataset;
 if(d.pvpMyteam!==undefined){close();root.RKBOClub?.open?.();return}
 if(d.pvpRefresh!==undefined){await refresh();return}
 if(d.pvpCreate!==undefined){
  const target=find("#rkbo-pvp-opponent")?.value,team=find("#rkbo-pvp-team")?.value;
  if(!target||!team)throw Error("도전 상대와 내 MY TEAM을 선택해 줘.");
  if(!root.confirm("이 회원에게 친선경기 도전장을 보낼까?"))return;
  const request=root.crypto?.randomUUID?.();if(!request)throw Error("요청 ID 생성에 실패했어.");
  await rpc("create",{p_target:target,p_team:team,p_request:request});
  await refresh();say("⚾ 도전장을 보냈어! 상대가 수락하면 경기 결과를 확인할 수 있어.");return;
 }
 if(d.pvpAction){
  let team=null;
  if(d.pvpAction==="accept"){
   team=find('select[data-pvp-accept-team="'+d.id+'"]')?.value;
   if(!team)throw Error("수락할 내 MY TEAM을 선택해 줘.");
   if(!root.confirm("도전을 수락하고 9이닝 경기를 진행할까?"))return;
  }
  await rpc(d.pvpAction,{p_team:team,p_match:d.id});
  await refresh();say(d.pvpAction==="accept"?"⚾ 친선경기 결과가 나왔어!":"도전장 상태가 변경됐어.");return;
 }
}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 button=document.createElement("button");button.className="rkbo-pvp-nav";button.type="button";
 button.textContent="⚾ 친선경기";button.title="회원 MY TEAM 친선경기";
 nav?.prepend(button);button.addEventListener("click",open);
 overlay=document.createElement("div");overlay.hidden=true;overlay.className="rkbo-pvp-overlay";
 overlay.innerHTML='<section class="rkbo-pvp-panel" role="dialog" aria-modal="true" aria-label="회원 친선경기"></section>';
 document.body.append(overlay);panel=overlay.querySelector(".rkbo-pvp-panel");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 panel.addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;
  if(t.dataset.pvpClose!==undefined){close();return}
  if(busy)return;busy=true;t.disabled=true;
  try{await click(t)}catch(error){say(error.message);console.warn("[RKBO PVP]",error)}
  finally{busy=false;if(t.isConnected)t.disabled=false}
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
 root.addEventListener?.("focus",()=>void refresh().then(connect).catch(()=>{}));
 root.setInterval?.(()=>void refresh().then(connect).catch(()=>{}),30000);
 void refresh().then(connect).catch(()=>{});
}
root.RKBOFriendly={open,refresh};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})(window);
