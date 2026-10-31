/* RKBO ONLINE v1 — public leaderboard with Google OAuth.
 * Authentication and player profiles are stored in Supabase.
 * User identity + leaderboard only; client never gets a server-side secret. */
(function(root){"use strict";
const esc=s=>String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const cfg=()=>root.RKBOOnlineConfig||{};
const isConfigured=()=>Boolean(cfg().enabled&&/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg().url||"")&&String(cfg().publishableKey||"").length>10);
const CATS=[
 {id:"season",mode:"season",hidden:false,label:"시즌별"},
 {id:"all",mode:"all",hidden:false,label:"올타임"},
 {id:"season-hidden",mode:"season",hidden:true,label:"시즌별 (숨기기)"},
 {id:"all-hidden",mode:"all",hidden:true,label:"올타임 (숨기기)"}
];
let client=null,clientPromise=null,overlay=null,panel=null,screen="leaderboard",category="season",records=[],selected=null,authUser=null,profile=null,busy=false,editingNickname=false;
const DUPLICATE_NICKNAME="이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.";
let nicknameTimer=null,nicknameCheckId=0;
const q=s=>overlay?.querySelector(s);
const koreanCache=new Map();
let leaderboardSeason=60;
const season=()=>leaderboardSeason;
const seasonOptions=()=>Array.from({length:60},(_,i)=>60-i).map(n=>
 '<option value="'+n+'"'+(n===leaderboardSeason?' selected':'')+'>'+n+'차 시즌</option>').join("");
async function getClient(){
 if(!isConfigured())throw Error("아직 Supabase 프로젝트가 연결되지 않았습니다.");
 if(client)return client;
 if(!clientPromise)clientPromise=import("https://esm.sh/@supabase/supabase-js@2").then(({createClient})=>{
  client=createClient(cfg().url.replace(/\/$/,""),cfg().publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return client;
 }).catch(e=>{clientPromise=null;throw Error("로그인 라이브러리를 불러오지 못했습니다: "+e.message)});
 return clientPromise;
}
async function loadUser(){
 if(!isConfigured()){authUser=null;profile=null;return null}
 const c=await getClient(),{data,error}=await c.auth.getUser();
 if(error){authUser=null;profile=null;return null}
 authUser=data?.user||null;profile=null;
 if(authUser){
  const p=await c.from("rkbo_profiles").select("user_id,nickname").eq("user_id",authUser.id).maybeSingle();
  if(p.error)throw Error("프로필 불러오기 실패: "+p.error.message);
  profile=p.data||null;
  if(!profile){
   const nickname="RKBO_"+authUser.id.slice(0,8);
   const added=await c.from("rkbo_profiles").insert({user_id:authUser.id,nickname}).select("user_id,nickname").single();
   if(added.error)throw Error("기본 닉네임 만들기 실패: "+added.error.message);
   profile=added.data;
  }
 }
 return authUser;
}
function buildHeader(){
 return '<header class="rkbo-online-head"><div><span class="rkbo-draft-kicker">RKBO · CONNECTED WORLD</span><h2>🌐 RTM | RKBO THE MOMENT <small>v1</small></h2><p>온라인 공동 랭킹 · Google 로그인 · 사용자별 기록</p></div><button type="button" class="rkbo-online-close" data-online="close" aria-label="닫기">×</button></header>';
}
function shell(inner){if(!panel)return;panel.innerHTML=buildHeader()+'<div class="rkbo-online-inner">'+inner+'</div>'}
function notice(text){const el=q("#rkbo-online-message");if(el)el.textContent=text}
function headerTabs(){return '<nav class="rkbo-online-tabs"><button data-online="tab-board" class="'+(screen==="leaderboard"?"active":"")+'">🏆 랭킹</button><button data-online="tab-account" class="'+(screen==="account"?"active":"")+'">👤 내 계정</button></nav>'}
function disabledView(){
 shell(headerTabs()+'<section class="rkbo-online-empty"><div class="rkbo-online-big">🌐</div><h3>RTM 서버 연결 준비 중</h3>'+
 '<p>드래프트는 지금처럼 바로 플레이할 수 있어요. 전체 접속자 랭킹과 로그인은 제작자가 Supabase 프로젝트를 연결하면 활성화됩니다.</p>'+
 '<p>관리자: <code>supabase/schema.sql</code> 실행 → Edge Function 배포 → <code>rkbo-online-config.js</code>에 공개 URL/키 입력</p>'+
 '<div class="rkbo-online-hint">기존 드래프트의 기기별 스코어보드는 계속 이용할 수 있습니다.</div></section>');
}
function formatDate(d){try{return new Date(d).toLocaleString("ko-KR")}catch{return String(d)}}
function scoreboardView(){
 if(!isConfigured()){disabledView();return}
 const tabs=CATS.map(cat=>'<button type="button" data-online-board="'+cat.id+'" class="'+(cat.id===category?"active":"")+'">'+esc(cat.label)+'</button>').join("");
 shell(headerTabs()+'<div class="rkbo-online-section-head"><h3>전체 접속자 드래프트 랭킹</h3><small>기록은 서버에서 공식 카드/OVR을 검증한 뒤 등록됩니다.</small></div>'+
 '<div class="rkbo-online-categories">'+tabs+'</div>'+
 ((CATS.find(c=>c.id===category)?.mode==="season")?
  '<label class="rkbo-online-season-label">랭킹 시즌 선택<select id="rkbo-online-season-select">'+seasonOptions()+'</select></label>':'')+
 '<div class="rkbo-online-board" id="rkbo-online-board"><p class="rkbo-online-wait">온라인 랭킹을 불러오는 중…</p></div>'+
 '<div class="rkbo-online-hint">※ 시즌 랭킹은 현재 선택한 '+season()+'차 기준. 동률이면 평균 OVR, 등록 시각 순으로 정렬합니다. 랜덤 후보 추첨의 서버 검증은 차후 업데이트 예정입니다.</div>'+
 '<p class="rkbo-online-message" id="rkbo-online-message" role="status"></p>');
 loadBoard();
}
async function loadBoard(){
 const cat=CATS.find(c=>c.id===category)||CATS[0],elem=q("#rkbo-online-board"),requestKey=category+"|"+season();
 if(!elem)return;
 try{
  const c=await getClient();
  let query=c.from("rkbo_draft_results")
   .select("id,user_id,mode,hidden,season,average_ovr,tpi,picks,lineup,created_at,rkbo_profiles(nickname)")
   .eq("mode",cat.mode).eq("hidden",cat.hidden);
  if(cat.mode==="season")query=query.eq("season",season());
  const {data,error}=await query.order("tpi",{ascending:false}).order("average_ovr",{ascending:false}).order("created_at",{ascending:true}).limit(30);
  if(error)throw Error(error.message);
  if(category+"|"+season()!==requestKey||!elem.isConnected)return;
  records=data||[];selected=null;
  elem.innerHTML=records.length?'<div class="rkbo-online-table-head"><span>순위</span><span>플레이어 / 시즌</span><span>TPI</span><span>평균 OVR</span></div>'+
   records.map((r,i)=>'<button class="rkbo-online-entry" type="button" data-online-detail="'+esc(r.id)+'"><span class="rkbo-online-rank">'+(i+1)+'</span><span class="rkbo-online-player"><strong>'+esc(r.rkbo_profiles?.nickname||"익명 선수")+'</strong><small>'+(r.mode==="season"?r.season+"차":"올타임")+' · '+formatDate(r.created_at)+'</small></span><b>'+r.tpi+'</b><span>'+Number(r.average_ovr).toFixed(1)+'</span></button>').join("")+
   '<div id="rkbo-online-detail"></div>':'<p class="rkbo-online-none">아직 등록된 팀이 없습니다. 18인 드래프트를 완성하여 첫 번째 기록을 남겨 주시기 바랍니다.</p>';
 }catch(err){if(elem.isConnected)elem.innerHTML='<p class="rkbo-online-none">랭킹을 불러오지 못했습니다. '+esc(err.message)+'</p>'}
}

function onlineSlotTitle(r,slot){
 const l=r.lineup;
 if(l?.defense&&typeof l.defense==="object"){
  const assigned=Object.keys(l.defense).find(pos=>l.defense[pos]===slot);
  if(assigned)return assigned;
 }
 if(/^SP[1-5]$/.test(slot)&&Array.isArray(l?.rotation)){
  const n=l.rotation.indexOf(slot);if(n>=0)return (n+1)+"선발";
 }
 if(/^RP[1-3]$/.test(slot)&&Array.isArray(l?.bullpen)){
  const n=l.bullpen.indexOf(slot);if(n>=0)return (n+1)+"중계";
 }
 return slot;
}
function detailHtml(r){
 const order=["C","1B","2B","3B","SS","LF","CF","RF","DH","SP1","SP2","SP3","SP4","SP5","RP1","RP2","RP3","CP"];
 const picks=Array.isArray(r.picks)?r.picks.slice().sort((a,b)=>order.indexOf(a.slot)-order.indexOf(b.slot)):[];
 const name=p=>esc(koreanCache.get(p.cardId)||p.name||p.cardId||"선수");
 const batting=Array.isArray(r.lineup?.battingOrder)?r.lineup.battingOrder:[...order.slice(0,9)];
 const line='<div class="rkbo-online-roster-lineup"><h4>⚾ 타순 1~9번</h4><div>'+
  batting.map((slot,i)=>{const p=picks.find(x=>x.slot===slot);return p?'<span><b>'+(i+1)+'번</b> '+name(p)+'</span>':''}).join("")+'</div></div>';
 return '<div class="rkbo-online-detail-title">⚾ '+esc(r.rkbo_profiles?.nickname||"익명 선수")+'의 18인 드래프트 · TPI '+r.tpi+'</div>'+
 line+'<div class="rkbo-online-roster">'+picks.map(p=>'<div><span>'+esc(onlineSlotTitle(r,p.slot))+'</span><strong>'+name(p)+'</strong><small>'+esc(p.team||"")+' · '+esc(String(p.season||""))+'차</small><b>'+Number(p.ovr)+'</b></div>').join("")+'</div>';
}
async function resolveNames(picks){
 const ids=picks.filter(p=>p?.cardId&&!koreanCache.has(p.cardId)),seasonIds=[...new Set(ids.map(p=>Number(p.season)))];
 if(!seasonIds.length||!root.RKBONameMap?.apply)return;
 const chosen=new Set(ids.map(p=>p.cardId));let roster=[];
 for(const n of seasonIds){
  try{
   let list;
   const current=root.RKBOSeason?.players?.()||[];
   if(current.length&&Number(current[0]?.season)===n)list=current;
   else if(n===60)list=root.RKBOSeason?.builtin?.()||[];
   else{
    const response=await fetch("./data/seasons/"+n+".json",{cache:"force-cache"});
    if(!response.ok)continue;
    const d=await response.json();list=Array.isArray(d)?d:d.players||[];
   }
   roster.push(...list.filter(p=>chosen.has(p.id)).map(p=>({...p})));
  }catch(e){console.warn("[RKBO online] Failed to resolve names for season",n,e)}
 }
 if(!roster.length)return;
 try{await root.RKBONameMap.apply(roster,null)}catch(e){console.warn("[RKBO online] Name translation unavailable",e)}
 for(const p of roster)if(p.name)koreanCache.set(p.id,p.name);
}
function showDetails(id){
 const e=q("#rkbo-online-detail");if(!e)return;
 if(selected===id){selected=null;e.innerHTML="";return}
 const r=records.find(x=>x.id===id);if(!r)return;
 selected=id;e.innerHTML=detailHtml(r);
 e.scrollIntoView({behavior:"smooth",block:"nearest"});
 resolveNames(r.picks||[]).then(()=>{
  if(selected!==id||!e.isConnected)return;
  e.innerHTML=detailHtml(r);
 }).catch(error=>console.warn("[RKBO online] roster names",error));
}

async function accountView(){
 if(!isConfigured()){disabledView();return}
 shell(headerTabs()+'<div class="rkbo-online-section-head"><h3>온라인 플레이어 계정</h3><small>Google 계정으로 로그인하고 다른 기기에서도 기록을 확인하시기 바랍니다.</small></div>'+
 '<div id="rkbo-online-account"><p class="rkbo-online-wait">로그인 상태 확인 중…</p></div>'+
 '<p class="rkbo-online-message" id="rkbo-online-message" role="status"></p>');
 try{await loadUser();drawAccount()}catch(e){notice(e.message)}
}
function drawAccount(){
 const el=q("#rkbo-online-account");if(!el)return;
 if(!authUser){
  el.innerHTML='<div class="rkbo-online-login">'+
   '<button type="button" class="rkbo-online-social rkbo-online-social-google" data-online="google-signin"><span aria-hidden="true">G</span> Google 계정으로 로그인</button>'+
   '<p>별도의 RKBO 비밀번호 없이 Google 계정으로 연결할 수 있어요.</p>'+ 
   '<p class="rkbo-online-guest-warning"><strong>로그인하지 않고 이용하면?</strong> 드래프트는 플레이할 수 있지만 기록은 현재 브라우저에만 남아 계정·온라인 랭킹·MY RKBO에 저장되지 않아요. 카드팩은 Google 로그인 전에는 개봉하거나 수집할 수 없습니다.</p></div>';
  return;
 }
 const nickname=profile?.nickname||"",defaultNickname="RKBO_"+authUser.id.slice(0,8);
 const needsNickname=!nickname||nickname===defaultNickname;
 const isEditing=editingNickname||needsNickname;
 el.innerHTML='<div class="rkbo-online-profile"><p><strong>로그인 완료</strong> · '+esc(authUser.email||authUser.user_metadata?.full_name||"Google 계정")+'</p>'+
 (isEditing?'<label for="rkbo-online-nickname">'+(needsNickname?"공개 닉네임 최초 설정 (2~20자)":"공개 닉네임 변경 (2~20자)")+'</label>'+
 '<div class="rkbo-online-rename"><input id="rkbo-online-nickname" maxlength="20" value="'+esc(needsNickname?"":nickname)+'" autocomplete="off" placeholder="공개 닉네임 입력">'+
 '<button data-online="save-nickname" type="button">닉네임 저장</button>'+
 (!needsNickname?'<button data-online="cancel-nickname" type="button">취소</button>':'')+'</div>'+ 
 '<p class="rkbo-online-nickname-hint" id="rkbo-online-nickname-hint" role="status" aria-live="polite">닉네임은 다른 이용자와 중복될 수 없어요.</p>':
 '<div class="rkbo-online-current-nickname"><div><small>내 공개 닉네임</small><strong>'+esc(nickname)+'</strong></div>'+
 '<button type="button" data-online="change-nickname">닉네임 변경</button></div>')+
 '<p>온라인 랭킹에는 이메일이 아닌 공개 닉네임이 표시됩니다.</p>'+
 '<button type="button" class="rkbo-online-signout" data-online="signout">로그아웃</button></div>';
}
async function signInGoogle(){
 if(busy)return;
 busy=true;notice("Google 로그인 페이지로 이동하는 중…");
 try{
  const c=await getClient();
  const redirect=location.origin+location.pathname;
  try{sessionStorage.setItem("rkbo-online-google-return","1")}catch{}
  const {error}=await c.auth.signInWithOAuth({provider:"google",options:{redirectTo:redirect}});
  if(error)throw Error(error.message);
 }catch(err){
  try{sessionStorage.removeItem("rkbo-online-google-return")}catch{}
  notice("Google 로그인 실패: "+err.message);
 }finally{busy=false}
}
async function nicknameAvailable(value){
 const c=await getClient();
 const {data,error}=await c.rpc("rkbo_nickname_available",{p_nickname:value});
 if(error)throw Error("닉네임 중복 확인 실패: "+error.message);
 return data===true;
}
function nicknameTyping(){
 const field=q("#rkbo-online-nickname"),hint=q("#rkbo-online-nickname-hint");
 if(!field||!hint)return;
 const value=field.value.trim(),id=++nicknameCheckId;
 if(nicknameTimer!==null){clearTimeout(nicknameTimer);nicknameTimer=null}
 if(value.length<2||value.length>20||/[<>"\\]/.test(value)){
  hint.textContent="닉네임은 2~20자의 일반 문자로 입력해 주세요.";
  hint.classList.remove("taken");return;
 }
 hint.textContent="닉네임 중복 확인 중…";hint.classList.remove("taken");
 nicknameTimer=setTimeout(async()=>{
  try{
   const ok=await nicknameAvailable(value);
   if(id!==nicknameCheckId||q("#rkbo-online-nickname")?.value.trim()!==value)return;
   hint.textContent=ok?"사용할 수 있는 닉네임입니다.":DUPLICATE_NICKNAME;
   hint.classList.toggle("taken",!ok);
  }catch(err){
   if(id!==nicknameCheckId)return;
   hint.textContent="중복 확인에 실패했습니다. 저장 시 다시 확인하겠습니다.";
  }
 },400);
}
async function saveNickname(){
 if(busy)return;
 const value=q("#rkbo-online-nickname")?.value.trim()||"";
 if(value.length<2||value.length>20||/[<>"\\]/.test(value)){notice("닉네임은 2~20자의 일반 문자로 입력해 주세요.");return}
 busy=true;
 try{
  const c=await getClient();
  if(!authUser)throw Error("로그인 후 변경할 수 있습니다.");
  if(!await nicknameAvailable(value))throw Error(DUPLICATE_NICKNAME);
  const {data,error}=await c.from("rkbo_profiles").update({nickname:value}).eq("user_id",authUser.id).select("user_id,nickname").single();
  if(error){
   if(error.code==="23505"||/duplicate key|unique constraint/i.test(error.message))throw Error(DUPLICATE_NICKNAME);
   throw Error("닉네임 저장 실패: "+error.message);
  }
  if(!data||data.nickname!==value)throw Error("서버에서 닉네임 저장을 확인하지 못했습니다.");
  profile=data;editingNickname=false;drawAccount();notice("✓ 공개 닉네임이 저장됐습니다.");
 }catch(err){
  notice(err.message);
  const hint=q("#rkbo-online-nickname-hint");
  if(hint&&err.message===DUPLICATE_NICKNAME){hint.textContent=DUPLICATE_NICKNAME;hint.classList.add("taken")}
 }
 finally{busy=false}
}
async function submitDraft(payload){
 if(!payload||!isConfigured())throw Error("RKBO ONLINE 서버를 연결해야 합니다.");
 const c=await getClient(),{data:{user},error:authErr}=await c.auth.getUser();
 if(authErr||!user){open("account");throw Error("Google 계정으로 로그인한 후 다시 랭킹 등록 버튼을 눌러 주세요.")}
 const {data,error}=await c.functions.invoke("draft-submit",{body:payload});
 if(error){
  let reason=error.message;
  try{const b=await error.context?.json?.();reason=b?.error||reason}catch{}
  throw Error(reason);
 }
 if(!data?.ok)throw Error(data?.error||"온라인 등록에 실패했습니다.");
 open("leaderboard");
 return data;
}
function open(view="leaderboard",options={}){
 if(options&&typeof options==="object"){
  const n=Number(options.season);
  if(Number.isInteger(n)&&n>=1&&n<=60)leaderboardSeason=n;
  if(CATS.some(x=>x.id===options.category))category=options.category;
 }
 if(!overlay)init();
 if(!overlay)return;
 screen=view==="account"?"account":"leaderboard";
 overlay.hidden=false;document.body.classList.add("rkbo-online-is-open");
 if(screen==="account")accountView();else scoreboardView();
}
function close(){
 if(!overlay)return;
 overlay.hidden=true;document.body.classList.remove("rkbo-online-is-open");
}
function init(){
 if(overlay||document.getElementById("rkbo-online-open"))return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const btn=document.createElement("button");btn.id="rkbo-online-open";btn.type="button";btn.className="rkbo-online-open";btn.textContent="🌐 ONLINE";
 nav?.prepend(btn);btn.addEventListener("click",()=>open("leaderboard"));
 overlay=document.createElement("div");overlay.id="rkbo-online-overlay";overlay.className="rkbo-online-overlay";overlay.hidden=true;
 overlay.innerHTML='<div class="rkbo-online-panel" role="dialog" aria-modal="true" aria-label="RKBO THE MOMENT 온라인"></div>';
 document.body.append(overlay);panel=overlay.querySelector(".rkbo-online-panel");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 panel.addEventListener("input",e=>{if(e.target?.id==="rkbo-online-nickname")nicknameTyping()});
 panel.addEventListener("change",e=>{
  if(e.target?.id==="rkbo-online-season-select"){
   const n=Number(e.target.value);
   if(Number.isInteger(n)&&n>=1&&n<=60){leaderboardSeason=n;scoreboardView()}
  }
 });
 panel.addEventListener("click",async e=>{
  const board=e.target.closest("[data-online-board]");
  if(board){category=board.dataset.onlineBoard;scoreboardView();return}
  const detail=e.target.closest("[data-online-detail]");
  if(detail){showDetails(detail.dataset.onlineDetail);return}
  const button=e.target.closest("[data-online]");if(!button)return;
  switch(button.dataset.online){
   case "close":close();break;
   case "tab-board":screen="leaderboard";scoreboardView();break;
   case "tab-account":screen="account";accountView();break;
   case "google-signin":signInGoogle();break;
   case "save-nickname":saveNickname();break;
   case "change-nickname":editingNickname=true;drawAccount();q("#rkbo-online-nickname")?.focus();break;
   case "cancel-nickname":editingNickname=false;drawAccount();break;
   case "signout":if(busy)return;busy=true;try{await (await getClient()).auth.signOut();authUser=null;profile=null;editingNickname=false;drawAccount();notice("로그아웃했습니다.")}catch(err){notice(err.message)}finally{busy=false}break;
  }
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.RKBOOnline={isConfigured,open,submitDraft,getClient};
document.addEventListener("DOMContentLoaded",()=>{
 init();
 // Restore account screen on return from Google OAuth.
 let returned=false;
 try{returned=sessionStorage.getItem("rkbo-online-google-return")==="1";if(returned)sessionStorage.removeItem("rkbo-online-google-return")}catch{}
 if(returned&&isConfigured()){open("account");return}
 if(!isConfigured())return;
 // Show the existing account/Google sign-in dialog on a fresh, logged-out visit.
 // Don't redirect to Google without a user gesture; OAuth starts when they press the button.
 // Do not interrupt an already logged-in visitor or another game dialog.
 const promptGuest=()=>{
  if(!overlay?.hidden)return;
  if(document.querySelector('#rkbo-draft-overlay:not([hidden]),#rkbo-pack-overlay:not([hidden]),#rkbo-combo-overlay:not([hidden]),#rkbo-club-overlay:not([hidden]),#rkbo-my-overlay:not([hidden])'))return;
  open("account");
 };
 getClient().then(c=>c.auth.getUser())
  .then(({data,error})=>{if(error||!data?.user)promptGuest()})
  .catch(err=>{console.warn("[RKBO ONLINE] Initial auth status unavailable",err);promptGuest()});
});
})(window);

