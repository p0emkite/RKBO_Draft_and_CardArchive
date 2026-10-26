/* RKBO MY TEAM + MATCH. Separate from randomized DRAFT and public rankings.
 * Team writes and match outcomes are verified and computed by Supabase RPCs. */
(function(root){"use strict";
const SLOTS=[
 ["C","포수","C"],["1B","1루수","1B"],["2B","2루수","2B"],["3B","3루수","3B"],["SS","유격수","SS"],
 ["LF","좌익수","LF"],["CF","중견수","CF"],["RF","우익수","RF"],["DH","지명타자","DH"],
 ["SP1","선발 1","SP"],["SP2","선발 2","SP"],["SP3","선발 3","SP"],["SP4","선발 4","SP"],["SP5","선발 5","SP"],
 ["RP1","중계 1","RP"],["RP2","중계 2","RP"],["RP3","중계 3","RP"],["CP","마무리","CP"]];
const HITS=SLOTS.slice(0,9).map(s=>s[0]),SP=SLOTS.slice(9,14).map(s=>s[0]),RP=SLOTS.slice(14,17).map(s=>s[0]);
const E=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initialLineup=()=>({battingOrder:HITS.slice(),defense:Object.fromEntries(HITS.map(s=>[s,s])),rotation:SP.slice(),bullpen:RP.slice()});
const statColor=n=>n>=90?"#90ecff":n>=85?"#F6909D":n>=80?"#f4cf74":n>=70?"#c9d7df":"#fff";
const statLabels=p=>p?.card_type==="타자"?["정확","파워","선구","주루","수비"]:["구위","제구","피안타 억제","피홈런 억제","체력"];
let overlay=null,panel=null,screen="editor",busy=false,loaded=false,teamId=null,matchTeamId=null,teamName="나의 RKBO 팀";
let picks={},lineup=initialLineup(),owned=new Map(),official=new Map(),teams=[],matches=[],match=null,focusedSwap=null;
let ladderSeason=60,ladderData=null,ladderTeamId=null,ladderGame=null,ladderHistory=[];
let navButton=null;
const $=q=>panel?.querySelector(q);
function context(){
 if(!root.RKBOOnline?.getClient)throw Error("RKBO ONLINE 연결을 확인해 주세요.");
 return root.RKBOOnline.getClient().then(async c=>{
  const {data,error}=await c.auth.getUser();
  if(error||!data?.user)throw Error("Google 로그인 후 MY TEAM을 이용할 수 있어요.");
  return {c,user:data.user};
 });
}
async function playerNames(seasons){
 for(const n of seasons){
  try{
   let list;
   if(n===60)list=(root.RKBOSeason?.builtin?.()||[]).map(p=>({...p}));
   else{
    const r=await fetch("./data/seasons/"+n+".json",{cache:"force-cache"});
    if(!r.ok)continue;
    const d=await r.json();list=(Array.isArray(d)?d:d.players||[]).map(p=>({...p}));
   }
   await root.RKBONameMap?.apply?.(list,null);
   for(const p of list)official.set(p.id,p.name);
  }catch(e){console.warn("[RKBO MY TEAM] Korean names",n,e)}
 }
}
const display=p=>official.get(p?.card_id)||p?.name||p?.card_id||"선수";
function score(){
 const cards=Object.values(picks).map(id=>owned.get(id)).filter(Boolean);
 if(cards.length!==18)return null;
 const nums=cards.map(c=>Number(c.ovr)).sort((a,b)=>b-a),avg=arr=>arr.reduce((s,x)=>s+x,0)/arr.length;
 return {average:avg(nums).toFixed(1),tpi:Math.round((avg(nums)*.7+avg(nums.slice(0,6))*.2+avg(nums.slice(-6))*.1)*10)};
}
function candidate(slot){
 const role=SLOTS.find(s=>s[0]===slot)?.[2];
 return [...owned.values()].filter(p=>role==="DH"?p.card_type==="타자":p.position===role)
 .sort((a,b)=>b.ovr-a.ovr||display(a).localeCompare(display(b),"ko"));
}
function missingCount(){return SLOTS.filter(s=>!picks[s[0]]).length}
function reset(){picks={};lineup=initialLineup();teamId=null;teamName="나의 RKBO 팀";focusedSwap=null}
function auto(){
 reset();
 const selected=new Set();
 for(const [slot,,role] of SLOTS.filter(s=>s[0]!=="DH")){
  const p=candidate(slot).find(p=>!selected.has(p.card_id));
  if(p){picks[slot]=p.card_id;selected.add(p.card_id)}
 }
 const dh=candidate("DH").find(p=>!selected.has(p.card_id));
 if(dh)picks.DH=dh.card_id;
}
function stats(p){
 const x=p?.ratings||{};
 return statLabels(p).map(k=>'<span class="rkbo-club-stat">'+E(k.replace("피안타 억제","피안").replace("피홈런 억제","피홈"))+
 '<b style="color:'+statColor(Number(x[k]))+'">'+(x[k]??"–")+'</b></span>').join("");
}
function renderHeader(){
 panel.innerHTML='<div class="rkbo-club-head"><div><small>RKBO · COLLECTED CARD CLUBHOUSE</small><h2>⚾ MY TEAM & MATCH</h2>'+
 '<p>보유 카드 선수단으로 CPU 친선 경기와 시즌별 구단 도장깨기에 도전해 봐!</p></div>'+
 '<button type="button" data-club="close" aria-label="닫기">×</button></div>'+
 '<nav class="rkbo-club-tabs"><button data-club="screen-editor" class="'+(screen==="editor"?"active":"")+'">👕 선수단 편성</button>'+
 '<button data-club="screen-teams" class="'+(screen==="teams"?"active":"")+'">💾 저장한 팀</button>'+
 '<button data-club="screen-match" class="'+(screen==="match"?"active":"")+'">⚾ 친선 경기</button>'+
 '<button data-club="screen-ladder" class="'+(screen==="ladder"?"active":"")+'">🏆 시즌 도장깨기</button></nav>'+
 '<main id="rkbo-club-content" class="rkbo-club-body"></main><p id="rkbo-club-status" role="status"></p>';
}
function message(s){const el=$("#rkbo-club-status");if(el)el.textContent=s}
function rowHtml(slot,label,role){
 const assigned=picks[slot],p=owned.get(assigned),used=new Set(Object.entries(picks).filter(([k])=>k!==slot).map(([,id])=>id));
 const candidates=candidate(slot);
 return '<div class="rkbo-club-position"><label for="rkbo-club-'+slot+'">'+E(label)+' <small>'+E(slot)+'</small></label>'+
 '<select id="rkbo-club-'+slot+'" data-club-slot="'+E(slot)+'"><option value="">— 보유 선수 선택 —</option>'+
 candidates.map(c=>'<option value="'+E(c.card_id)+'" '+(c.card_id===assigned?'selected':used.has(c.card_id)?'disabled':'')+'>'+
 E(display(c))+' · '+E(c.team)+' '+E(c.season)+'차 · OVR '+c.ovr+'</option>').join("")+'</select>'+
 (p?'<div class="rkbo-club-player"><strong>'+E(display(p))+'</strong><span>OVR '+p.ovr+'</span></div>'+
 '<div class="rkbo-club-stats">'+stats(p)+'</div>':
 '<p class="rkbo-club-empty-slot">선수 미배치</p>')+'</div>';
}
function orderedRow(group,slot,label){
 const p=owned.get(picks[slot]),active=focusedSwap?.group===group&&focusedSwap.slot===slot;
 return '<button type="button" draggable="true" class="rkbo-club-order-row'+(active?' selected':'')+'" data-club-group="'+group+'" data-club-order-slot="'+slot+'">'+
 '<span class="rkbo-club-order-handle" aria-hidden="true">⠿</span><b class="rkbo-club-order-position">'+E(label)+'</b>'+
 '<span class="rkbo-club-order-person"><strong>'+ (p?E(display(p)):'미배치')+'</strong>'+
 (p?'<span class="rkbo-club-order-metrics">'+stats(p)+'</span>':'')+'</span>'+
 (p?'<small class="rkbo-club-order-overall">OVR <b style="color:'+statColor(Number(p.ovr))+'">'+p.ovr+'</b></small>':'')+'</button>';
}
function editor(){
 const el=$("#rkbo-club-content");if(!el)return;
 const sc=score(),remain=missingCount();
 el.innerHTML='<section class="rkbo-club-summary"><div><small>편성</small><strong>'+(18-remain)+'/18</strong></div>'+
 '<div><small>평균 OVR</small><strong>'+(sc?.average||"—")+'</strong></div>'+
 '<div><small>팀 전력 TPI</small><strong>'+(sc?.tpi||"—")+'</strong></div></section>'+
 '<div class="rkbo-club-tools"><label>팀 이름 <input id="rkbo-club-name" maxlength="40" value="'+E(teamName)+'"></label>'+
 '<button data-club="auto">✨ 보유 카드 자동 편성</button><button data-club="reset">초기화</button>'+
 '<button data-club="save" class="primary" '+(remain?'disabled':'')+'>💾 '+(teamId?'팀 수정 저장':'새 팀 저장')+'</button></div>'+
 '<p class="rkbo-club-instructions">선수는 실제 획득한 카드만 선택할 수 있어. 각 포지션은 본래 수비 위치를 적용하고 DH에는 아무 타자나 배치할 수 있어. 카드 한 장은 한 자리에만 배치 가능!</p>'+
 '<h3>타자 9명</h3><div class="rkbo-club-slot-grid">'+SLOTS.slice(0,9).map(([id,label,role])=>rowHtml(id,label,role)).join("")+'</div>'+
 '<h3>선발 5명 · 중계 3명 · 마무리 1명</h3><div class="rkbo-club-slot-grid">'+SLOTS.slice(9).map(([id,label,role])=>rowHtml(id,label,role)).join("")+'</div>'+
 '<h3>✎ 라인업 세부 편집</h3><p class="rkbo-club-instructions">선수 이름 아래 주요 스탯 5개를 확인할 수 있어. PC에서는 드래그, 모바일에서는 두 선수를 차례로 눌러 교체해. 수비 포지션은 본래 카드 위치와 DH만 허용해.</p>'+
 '<div class="rkbo-club-order-grid">'+
 orderSection("타순 · 1~9번","batting",lineup.battingOrder,(s,i)=>(i+1)+"번")+
 orderSection("수비 포지션 · DH","defense",HITS.map(pos=>lineup.defense[pos]),(s,i)=>HITS[i])+
 orderSection("선발 로테이션","rotation",lineup.rotation,(s,i)=>(i+1)+"선발")+
 orderSection("중계 순서","bullpen",lineup.bullpen,(s,i)=>(i+1)+"중계")+'</div>'+
 '<div class="rkbo-club-footer-buttons"><button data-club="save" class="primary" '+(remain?'disabled':'')+'>💾 팀 저장</button>'+
 (teamId?'<button data-club="play" class="primary">⚾ 이 팀으로 경기</button>':'')+
 '<button data-club="pack">🎫 카드팩에서 선수 모으기</button></div>';
}
function orderSection(title,group,list,label){
 return '<section class="rkbo-club-order-section"><h4>'+E(title)+'</h4>'+
 list.map((s,i)=>orderedRow(group,s,label(s,i))).join("")+'</section>';
}
function swap(group,from,to){
 if(!group||from===to)return;
 if(group==="defense"){
  const a=HITS.find(p=>lineup.defense[p]===from),b=HITS.find(p=>lineup.defense[p]===to);
  if(!a||!b)return;
  const allowed=(slot,pos)=>pos==="DH"||owned.get(picks[slot])?.position===pos;
  if(!allowed(from,b)||!allowed(to,a)){message("수비 위치는 본래 포지션과 DH 사이에서만 변경할 수 있어.");focusedSwap=null;editor();return}
  [lineup.defense[a],lineup.defense[b]]=[lineup.defense[b],lineup.defense[a]];
 }else{
  const list=group==="batting"?lineup.battingOrder:group==="rotation"?lineup.rotation:group==="bullpen"?lineup.bullpen:null;
  if(!list)return;
  const a=list.indexOf(from),b=list.indexOf(to);if(a<0||b<0)return;
  [list[a],list[b]]=[list[b],list[a]];
 }
 focusedSwap=null;editor();
}
function saveTeam(){
 return context().then(async({c})=>{
  const name=String($("#rkbo-club-name")?.value||teamName).trim();
  if(name.length<2||name.length>40)throw Error("팀 이름은 2~40자로 입력해야 해.");
  if(missingCount())throw Error("18개 포지션에 선수를 모두 배치해 줘.");
  const slots=SLOTS.map(([slot])=>({slot,cardId:picks[slot]}));
  const {data,error}=await c.rpc("rkbo_save_owned_team",{p_name:name,p_slots:slots,p_lineup:lineup,p_id:teamId});
  if(error)throw Error("팀 저장 실패: "+error.message);
  teamId=data.id;teamName=name;
  await loadTeams();
  editor();message("✓ MY TEAM 저장 완료! 경기 버튼을 누르면 9이닝 시뮬레이션이 시작돼.");
  return data;
 });
}
async function loadTeams(){
 const {c,user}=await context();
 const {data,error}=await c.from("rkbo_owned_teams").select("id,name,slots,lineup,average_ovr,tpi,created_at,updated_at")
 .eq("user_id",user.id).order("updated_at",{ascending:false}).limit(50);
 if(error)throw Error(error.message);
 teams=data||[];
}
function useTeam(t){picks=Object.fromEntries((t.slots||[]).map(p=>[p.slot,p.cardId]));lineup=JSON.parse(JSON.stringify(t.lineup||initialLineup()));teamId=t.id;teamName=t.name;screen="editor";show()}
function listTeams(){
 const el=$("#rkbo-club-content");if(!el)return;
 el.innerHTML='<h3>💾 내 보유 카드 팀</h3><p class="rkbo-club-instructions">내 카드로 만든 로스터만 저장돼. 기존 랜덤 DRAFT 결과·랭킹과는 별개야.</p>'+
 (teams.length?'<div class="rkbo-club-team-list">'+teams.map(t=>
 '<article class="rkbo-club-team"><div><h4>'+E(t.name)+'</h4><small>18명 · 평균 OVR '+Number(t.average_ovr).toFixed(1)+'</small></div>'+
 '<strong>TPI '+t.tpi+'</strong><div class="rkbo-club-team-actions">'+
 '<button data-club-team="load" data-id="'+E(t.id)+'">✎ 편집</button>'+
 '<button data-club-team="play" data-id="'+E(t.id)+'">⚾ 친선</button>'+
 '<button data-club-team="ladder" data-id="'+E(t.id)+'">🏆 도장깨기</button>'+
 '<button data-club-team="delete" data-id="'+E(t.id)+'">삭제</button></div></article>').join("")+'</div>':
 '<p class="rkbo-club-instructions">저장된 팀이 아직 없어. 먼저 보유 카드로 18명을 편성해 줘!</p>')+
 '<button data-club="screen-editor">← 팀 편성으로 돌아가기</button>';
}
async function play(id){
 if(busy)return;
 busy=true;matchTeamId=id;screen="match";show();
 const el=$("#rkbo-club-content");el.innerHTML='<div class="rkbo-club-loading"><h3>⚾ 9이닝 경기 중…</h3><p>선수 능력치로 타격과 투구 결과를 계산하고 있어.</p></div>';
 try{
  const {c}=await context();
  const {data,error}=await c.rpc("rkbo_play_owned_match",{p_team_id:id});
  if(error)throw Error("경기 진행 실패: "+error.message);
  match=data;await loadMatches();renderMatch();
 }catch(e){el.innerHTML='<p class="rkbo-club-error">'+E(e.message)+'</p><button data-club="screen-teams">팀 목록으로</button>'}
 finally{busy=false}
}
function resultBadge(v){return v==="WIN"?"승리":v==="LOSS"?"패배":"무승부"}
function renderMatch(){
 const el=$("#rkbo-club-content");if(!el)return;
 if(!match){
  el.innerHTML='<h3>⚾ MATCH · CPU와 9이닝 경기</h3><p class="rkbo-club-instructions">완성한 내 팀을 선택하면 서버에서 타격·투수 능력치로 9이닝 경기를 시뮬레이션해.</p>'+
  (teams.length?teams.map(t=>'<button class="rkbo-club-play-row" data-club-team="play" data-id="'+E(t.id)+'">⚾ '+E(t.name)+' · TPI '+t.tpi+' → CPU 도전</button>').join(""):
  '<p class="rkbo-club-instructions">먼저 18인 MY TEAM을 저장해 줘.</p>');
 }else{
  el.innerHTML='<section class="rkbo-club-match-score"><small>CPU EXHIBITION · 9 INNINGS</small><h3>'+resultBadge(match.result)+'</h3>'+
   '<div><strong>CPU '+match.cpuRuns+'</strong><span>:</span><strong>'+match.ourRuns+' '+E(match.teamName)+'</strong></div></section>'+
   '<div class="rkbo-club-inning-scroll"><table class="rkbo-club-innings"><thead><tr><th>팀</th>'+match.innings.map(x=>'<th>'+x.inning+'</th>').join("")+'<th>R</th></tr></thead>'+
   '<tbody><tr><th>CPU</th>'+match.innings.map(x=>'<td>'+x.cpu+'</td>').join("")+'<td>'+match.cpuRuns+'</td></tr>'+
   '<tr><th>'+E(match.teamName)+'</th>'+match.innings.map(x=>'<td>'+x.ours+'</td>').join("")+'<td>'+match.ourRuns+'</td></tr></tbody></table></div>'+
   '<div class="rkbo-club-match-actions"><button data-club="rematch" class="primary">↻ 다시 경기</button><button data-club="screen-teams">다른 팀 선택</button></div>'+
   '<h3>주요 플레이 기록</h3><div class="rkbo-club-events">'+(match.events||[]).filter(e=>e.rbi||e.result==="홈런").slice(-40).reverse().map(e=>
    '<div><b>'+e.inning+'회'+e.half+'</b><strong>'+E(e.batter)+'</strong><span>'+E(e.result)+(e.rbi?" · "+e.rbi+"득점":"")+'</span></div>').join("")+'</div>';
 }
 el.innerHTML+='<h3>최근 경기</h3><div class="rkbo-club-match-history">'+matches.slice(0,8).map(m=>
 '<div><strong>'+E(m.team_name)+'</strong><span>CPU '+m.cpu_runs+' : '+m.our_runs+' MY TEAM</span><small>'+new Date(m.created_at).toLocaleString("ko-KR")+'</small></div>').join("")+'</div>'+
 '<p class="rkbo-club-instructions">현재 MATCH는 AI 대전이 아닌 CPU 확률 기반 전시 경기야. OVR과 능력치는 반영하지만 정교한 야구 엔진이나 보상 시스템은 아직 없어.</p>';
}

function ladderSeasonOptions(){
 return Array.from({length:60},(_,i)=>60-i).map(n=>
  '<option value="'+n+'"'+(ladderSeason===n?' selected':'')+'>'+n+'차 시즌</option>').join("");
}
function ladderPlayerName(p){
 return official.get(p?.cardId||p?.batterCardId||p?.pitcherCardId)||p?.name||p?.batter||p?.pitcher||p?.cardId||"선수";
}
function ladderTeamName(code){return root.RKBOTeamBrand?.name?.({team:code,season:ladderSeason})||code}
function ladderTeamLogo(code){return root.RKBOTeamBrand?.logo?.({team:code,season:ladderSeason})||"assets/teams/"+String(code)+".svg"}
function ladderStatsMarkup(obj){
 if(!obj)return "";
 const our=obj.ours||obj,cpu=obj.cpu;
 const rows=(columns,items,keys)=>'<div class="rkbo-club-inning-scroll"><table class="rkbo-club-innings rkbo-ladder-stats"><thead><tr>'+
 columns.map(k=>'<th>'+E(k)+'</th>').join("")+'</tr></thead><tbody>'+
 (items.length?items.map(p=>'<tr>'+keys.map(k=>'<td>'+E(k==="name"?ladderPlayerName(p):p[k]??"—")+'</td>').join("")+'</tr>').join("") :
 '<tr><td colspan="'+columns.length+'">기록 없음</td></tr>')+'</tbody></table></div>';
 const box=(title,side)=>{
  const pit=(side?.pitchers||[]).map(p=>({...p,IP:Math.floor(Number(p.outs||0)/3)+'.'+Number(p.outs||0)%3,
   rem:p.remaining==null?"—":p.remaining+"%"}));
  return '<h3>📊 '+E(title)+' 타자 기록</h3>'+
  rows(['선수','타석','타수','안타','2루타','3루타','홈런','볼넷','삼진','득점','타점'],side?.batters||[],
   ['name','PA','AB','H','twob','threeb','HR','BB','K','R','RBI'])+
  '<h3>⚾ '+E(title)+' 투수 기록</h3>'+
  rows(['선수','이닝','투구 수','피안타','볼넷','삼진','실점','잔여 체력'],pit,
   ['name','IP','pitches','H','BB','K','ER','rem']);
 };
 return '<div class="rkbo-ladder-both-stats">'+box("MY TEAM",our)+
  (cpu?box("상대팀",cpu):'<p class="rkbo-club-instructions">예전 경기 기록에는 상대팀 선수별 기록이 없어.</p>')+'</div>';
}
function ladderMvpMarkup(g){
 const m=g.playerStats?.mvp;if(g.result!=="WIN"||!m?.cardId)return "";
 const card=owned.get(m.cardId),name=ladderPlayerName({cardId:m.cardId,name:card?.name});
 if(!card)return '<section class="rkbo-ladder-mvp"><h3>🏅 MATCH MVP · '+E(name)+'</h3></section>';
 const p={...card,id:card.card_id,name,type:card.card_type,pos:card.position};
 root.RKBOTeamBrand?.decorate?.([p]);
 let html="";
 try{html=root.RKBOCardView?.render?.(p,true)||""}catch(err){console.warn("[RKBO MATCH] MVP card",err)}
 return '<section class="rkbo-ladder-mvp"><div class="rkbo-ladder-mvp-text"><small>🏆 MATCH MVP</small>'+
 '<h3>'+E(name)+'</h3><p>'+E(m.role)+' · 활약도 '+E(m.score)+'</p>'+
 '<p>승리를 이끈 오늘의 선수!</p></div><div class="rkbo-ladder-mvp-card">'+
 (html||'<div class="rkbo-ladder-mvp-fallback">'+E(name)+' · OVR '+E(card.ovr)+'</div>')+'</div></section>';
}
function renderLadder(){
 const el=$("#rkbo-club-content");if(!el)return;
 const d=ladderData,all=d?.teams||[],cleared=Number(d?.clearedCount||0),total=Number(d?.total||0);
 const next=all[cleared],complete=d&&cleared>=total;
 if(!teams.some(t=>t.id===ladderTeamId))ladderTeamId=teams[0]?.id||null;
 el.innerHTML='<div class="rkbo-ladder-top"><h3>🏆 시즌별 구단 도장깨기</h3>'+
 '<label>도전할 시즌<select data-club-ladder-season>'+ladderSeasonOptions()+'</select></label></div>'+
 '<p class="rkbo-club-instructions">시즌별 공식 선수 카드의 평균 OVR을 기준으로 만든 전력 순위야. 실제 리그 최종 순위는 아니야. 낮은 순위부터 이기고 올라가!</p>'+
 (!d?'<div class="rkbo-club-loading">시즌별 구단 전력을 불러오는 중…</div>':
 '<section class="rkbo-ladder-summary"><strong>'+cleared+' / '+total+' 구단 격파</strong>'+
 '<span>'+ (complete?'🏆 '+ladderSeason+'차 시즌 완전 제패!':next?'다음 상대: '+next.rank+'위 '+E(next.name):'시즌 정보 확인 중')+'</span>'+
 '<div class="rkbo-ladder-meter"><i style="width:'+(total?100*cleared/total:0)+'%"></i></div></section>'+
 '<div class="rkbo-ladder-rivals">'+all.map((t,i)=>{
  const won=i<cleared,active=i===cleared;
  return '<article class="rkbo-ladder-rival '+(won?'clear':active?'current':'locked')+'">'+
  '<b>'+t.rank+'위</b><strong>'+E(ladderTeamName(t.code))+'</strong>'+
  '<small>평균 OVR '+E(Number(t.strength).toFixed(1))+'</small>'+ 
  '<img class="rkbo-ladder-teamlogo" src="'+E(ladderTeamLogo(t.code))+'" alt="'+E(ladderTeamName(t.code))+' 로고" loading="lazy">'+
  '<span>'+(won?'✓ 클리어':active?'⚔️ 도전 가능':'🔒 잠김')+'</span></article>';
 }).join("")+'</div>'+
 (complete?'<p class="rkbo-ladder-finish">🎉 이 시즌의 모든 구단을 제패했어! 다른 시즌도 도전해 봐.</p>':
  '<div class="rkbo-ladder-challenge"><label>출전할 MY TEAM<select data-club-ladder-team>'+
  (teams.length?teams.map(t=>'<option value="'+E(t.id)+'"'+(t.id===ladderTeamId?' selected':'')+'>'+
   E(t.name)+' · TPI '+t.tpi+'</option>').join(""):'<option value="">저장한 팀이 없습니다</option>')+
  '</select></label><button type="button" class="primary" data-club="ladder-play"'+(!ladderTeamId||busy?' disabled':'')+'>'+
  '⚾ '+(next?next.rank+'위 '+E(next.name):'다음 상대')+' 도전</button></div>'));
 if(ladderGame){
  const g=ladderGame;
  el.innerHTML+='<section class="rkbo-club-match-score rkbo-ladder-result"><small>'+
   E(g.season)+'차 · '+E(g.opponentRank)+'위 '+E(g.opponentName||g.opponentCode)+'</small>'+
   '<h3>'+resultBadge(g.result)+'</h3>'+
   '<div><strong>'+E(g.opponentName||g.opponentCode)+' '+g.cpuRuns+'</strong><span>:</span>'+
   '<strong>'+g.ourRuns+' '+E(g.teamName)+'</strong></div>'+
   '<p>'+ (g.result==="WIN"?'승리! 다음 구단이 해금됐어.':'다음 순위에 가려면 승리해야 해.')+'</p></section>'+
   '<div class="rkbo-club-inning-scroll"><table class="rkbo-club-innings"><thead><tr><th>팀</th>'+
   g.innings.map(x=>'<th>'+x.inning+'</th>').join("")+'<th>R</th></tr></thead><tbody>'+
   '<tr><th>'+E(g.opponentName||g.opponentCode)+'</th>'+g.innings.map(x=>'<td>'+x.cpu+'</td>').join("")+'<td>'+g.cpuRuns+'</td></tr>'+
   '<tr><th>'+E(g.teamName)+'</th>'+g.innings.map(x=>'<td>'+x.ours+'</td>').join("")+'<td>'+g.ourRuns+'</td></tr></tbody></table></div>'+
   ladderMvpMarkup(g)+ladderStatsMarkup(g.playerStats)+
   '<h3>📋 주요 플레이 · 투수 교체</h3><div class="rkbo-club-events">'+(g.events||[])
   .filter(x=>x.rbi>0||x.result==="홈런"||x.result==="투수 교체").slice(-45).reverse().map(x=>
    '<div><b>'+x.inning+'회'+x.half+'</b><strong>'+
    E(x.result==="투수 교체"?(official.get(x.pitcherCardId)||x.pitcher||"투수"):(official.get(x.batterCardId)||x.batter||"선수"))+
    '</strong><span>'+E(x.result)+(x.rbi?' · '+x.rbi+'타점':'')+'</span></div>').join("")+'</div>';
 }
 if(d){
  el.innerHTML+='<h3>🗂 '+ladderSeason+'차 도전 기록</h3><div class="rkbo-club-match-history">'+
   (ladderHistory.length?ladderHistory.map(m=>
    '<div><strong>'+E(m.opponent_rank)+'위 '+E(ladderTeamName(m.opponent_code))+'</strong>'+
    '<span>'+resultBadge(m.result)+' · '+m.our_runs+' : '+m.cpu_runs+'</span>'+
    '<small>'+new Date(m.created_at).toLocaleString("ko-KR")+'</small>'+    '<button type="button" class="rkbo-ladder-history-view" data-club-ladder-history="'+E(m.id)+'">경기 기록 보기</button></div>').join(""):
    '<p class="rkbo-club-instructions">아직 이 시즌의 도전 기록이 없어.</p>')+'</div>';
 }
}
async function loadLadder(){
 const s=ladderSeason,{c,user}=await context();
 const [catalog,history]=await Promise.all([
  c.functions.invoke("season-ladder",{body:{action:"catalog",season:s}}),
  c.from("rkbo_ladder_matches").select("id,opponent_code,opponent_rank,result,our_runs,cpu_runs,created_at")
   .eq("user_id",user.id).eq("season",s).order("created_at",{ascending:false}).limit(10)
 ]);
 if(catalog.error)throw Error("시즌 조회 실패: "+catalog.error.message);
 if(history.error)throw Error("도전 기록 조회 실패: "+history.error.message);
 if(s!==ladderSeason)return;
 await playerNames([s]);
 if(s!==ladderSeason)return;
 ladderData=catalog.data;ladderHistory=history.data||[];
 if(screen==="ladder")renderLadder();
}
async function openLadder(){
 screen="ladder";ladderGame=null;ladderData=null;show();
 try{await loadLadder()}catch(e){const el=$("#rkbo-club-content");if(el)el.innerHTML='<p class="rkbo-club-error">'+E(e.message)+'</p><button data-club="screen-teams">팀 목록으로</button>';}
}
async function playLadder(){
 if(busy||!ladderTeamId||!ladderData)return;
 busy=true;const id=ladderTeamId,s=ladderSeason;
 const el=$("#rkbo-club-content");if(!el)return;
 el.innerHTML='<div class="rkbo-club-loading"><h3>⚾ 시즌 도장깨기 경기 진행 중…</h3><p>서버에서 공식 카드 능력치로 9이닝을 계산하고 있어.</p></div>';
 try{
  const {c}=await context(),{data,error}=await c.functions.invoke("season-ladder",{body:{action:"play",season:s,teamId:id}});
  if(error)throw Error("경기 진행 실패: "+error.message);
  if(s!==ladderSeason)return;
  ladderGame=data;await loadLadder();
 }catch(e){el.innerHTML='<p class="rkbo-club-error">'+E(e.message)+'</p><button data-club="screen-ladder">다시 도전하기</button>'}
 finally{busy=false;if(screen==="ladder"&&ladderData&&ladderGame)renderLadder()}
}

async function loadLadderHistory(id){
 if(busy)return;
 try{
  const {c,user}=await context();
  const {data,error}=await c.from("rkbo_ladder_matches")
   .select("id,team_name,season,opponent_code,opponent_rank,our_runs,cpu_runs,result,innings,events,player_stats")
   .eq("user_id",user.id).eq("season",ladderSeason).eq("id",id).maybeSingle();
  if(error||!data)throw Error(error?.message||"경기 기록을 찾을 수 없습니다");
  ladderGame={id:data.id,teamName:data.team_name,season:data.season,opponentCode:data.opponent_code,
   opponentName:ladderTeamName(data.opponent_code),opponentRank:data.opponent_rank,
   ourRuns:data.our_runs,cpuRuns:data.cpu_runs,result:data.result,innings:data.innings,
   events:data.events,playerStats:data.player_stats};
  renderLadder();
  $("#rkbo-club-content")?.querySelector(".rkbo-ladder-result")?.scrollIntoView?.({block:"start",behavior:"smooth"});
 }catch(e){message("기록 불러오기 실패: "+e.message)}
}
async function loadMatches(){
 const {c,user}=await context();
 const {data,error}=await c.from("rkbo_owned_matches").select("id,team_name,our_runs,cpu_runs,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20);
 if(error)throw Error(error.message);
 matches=data||[];
}
function show(){renderHeader();if(screen==="editor")editor();else if(screen==="teams")listTeams();else if(screen==="ladder")renderLadder();else renderMatch()}
async function load(){
 const {c,user}=await context();
 const {data:inv,error:ie}=await c.from("rkbo_card_inventory").select("card_id,quantity,gold_border,prism")
 .eq("user_id",user.id).limit(2000);
 if(ie)throw Error(ie.message);
 const ids=(inv||[]).filter(x=>x.quantity>0||x.gold_border||x.prism).map(x=>x.card_id);
 owned.clear();
 if(ids.length){
  for(let offset=0;offset<ids.length;offset+=200){
   const {data,error}=await c.from("rkbo_pack_cards").select("card_id,season,team,name,position,card_type,grade,ovr,ratings").in("card_id",ids.slice(offset,offset+200));
   if(error)throw Error(error.message);
   for(const p of data||[])owned.set(p.card_id,p);
  }
 }
 await Promise.all([loadTeams(),loadMatches(),playerNames([...new Set([...owned.values()].map(p=>Number(p.season)))] )]);
 loaded=true;
}
async function open(){
 if(!overlay)init();overlay.hidden=false;document.body.classList.add("rkbo-club-open");
 screen="editor";renderHeader();$("#rkbo-club-content").innerHTML='<p class="rkbo-club-loading">내 카드와 팀을 불러오는 중…</p>';
 try{await load();if(!overlay.hidden)show()}
 catch(e){if(!overlay.hidden){$("#rkbo-club-content").innerHTML='<p class="rkbo-club-error">'+E(e.message)+'</p><button data-club="login">Google 로그인</button>';}}
}
function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove("rkbo-club-open")}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 navButton=document.createElement("button");navButton.type="button";navButton.className="rkbo-club-nav";navButton.textContent="⚾ MY TEAM";nav?.prepend(navButton);navButton.addEventListener("click",open);
 overlay=document.createElement("div");overlay.hidden=true;overlay.id="rkbo-club-overlay";overlay.className="rkbo-club-overlay";
 overlay.innerHTML='<div class="rkbo-club-panel" role="dialog" aria-modal="true" aria-label="MY TEAM & MATCH"></div>';
 document.body.append(overlay);panel=overlay.firstChild;
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 panel.addEventListener("change",e=>{
  const seasonSelect=e.target.closest("[data-club-ladder-season]");
  if(seasonSelect){ladderSeason=Number(seasonSelect.value);openLadder();return}
  const ladderTeamSelect=e.target.closest("[data-club-ladder-team]");
  if(ladderTeamSelect){ladderTeamId=ladderTeamSelect.value;renderLadder();return}
  const select=e.target.closest("[data-club-slot]");if(!select)return;
  const slot=select.dataset.clubSlot,val=select.value;
  if(val&&Object.values(picks).some((id)=>id===val&&picks[slot]!==id)){message("한 카드로 두 포지션을 동시에 채울 수 없어.");editor();return}
  if(val)picks[slot]=val;else delete picks[slot];
  editor();
 });
 panel.addEventListener("click",async e=>{
  const ord=e.target.closest("[data-club-group]");
  if(ord){
   if(!focusedSwap||focusedSwap.group!==ord.dataset.clubGroup){focusedSwap={group:ord.dataset.clubGroup,slot:ord.dataset.clubOrderSlot};editor()}
   else if(focusedSwap.slot===ord.dataset.clubOrderSlot){focusedSwap=null;editor()}
   else swap(focusedSwap.group,focusedSwap.slot,ord.dataset.clubOrderSlot);
   return;
  }
  const historyButton=e.target.closest("[data-club-ladder-history]");
  if(historyButton){await loadLadderHistory(historyButton.dataset.clubLadderHistory);return}
  const t=e.target.closest("[data-club-team]");
  if(t){
   const item=teams.find(ti=>ti.id===t.dataset.id);if(!item)return;
   if(t.dataset.clubTeam==="load")useTeam(item);
   if(t.dataset.clubTeam==="play")await play(item.id);
   if(t.dataset.clubTeam==="ladder"){ladderTeamId=item.id;await openLadder()}
   if(t.dataset.clubTeam==="delete"){
    if(!confirm('"'+item.name+'" MY TEAM을 삭제할까? 경기 기록은 같이 삭제돼.'))return;
    const {c}=await context(),{data,error}=await c.rpc("rkbo_delete_owned_team",{p_id:item.id});
    if(error||!data){message("삭제 실패: "+(error?.message||"본인 팀만 삭제 가능"));return}
    if(teamId===item.id)reset();await loadTeams();listTeams();
   }
   return;
  }
  const action=e.target.closest("[data-club]")?.dataset.club;if(!action)return;
  if(action==="close"){close();return}
  if(action==="login"){close();root.RKBOOnline?.open?.("account");return}
  if(action==="pack"){close();root.RKBOCardPacks?.open?.();return}
  if(action==="screen-editor"){screen="editor";show();return}
  if(action==="screen-teams"){await loadTeams();screen="teams";show();return}
  if(action==="screen-match"){await Promise.all([loadTeams(),loadMatches()]);screen="match";show();return}
  if(action==="screen-ladder"){await loadTeams();await openLadder();return}
  if(action==="ladder-play"){await playLadder();return}
  if(action==="reset"){reset();editor();return}
  if(action==="auto"){auto();editor();message(missingCount()?"보유 카드만으로 완성되지 않은 포지션이 있어. 카드팩에서 선수를 더 모아줘.":"가장 OVR이 높은 보유 카드를 자동 배치했어.");return}
  if(action==="save"){if(busy)return;busy=true;try{await saveTeam()}catch(e){message(e.message)}finally{busy=false}return}
  if(action==="play"){if(!teamId){message("먼저 팀을 저장해야 경기를 시작할 수 있어.");return}await play(teamId);return}
  if(action==="rematch"){if(matchTeamId)await play(matchTeamId);else message("저장한 팀을 다시 선택해 줘.");return}
 });
 panel.addEventListener("dragstart",e=>{
  const item=e.target.closest("[data-club-group]");if(!item)return;
  e.dataTransfer.effectAllowed="move";
  e.dataTransfer.setData("text/plain",JSON.stringify({group:item.dataset.clubGroup,slot:item.dataset.clubOrderSlot}));
 });
 panel.addEventListener("dragover",e=>{if(e.target.closest("[data-club-group]"))e.preventDefault()});
 panel.addEventListener("drop",e=>{
  const item=e.target.closest("[data-club-group]");if(!item)return;
  e.preventDefault();try{const from=JSON.parse(e.dataTransfer.getData("text/plain"));
   if(from.group===item.dataset.clubGroup)swap(from.group,from.slot,item.dataset.clubOrderSlot)}catch{}
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.RKBOClub={open};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})(window);