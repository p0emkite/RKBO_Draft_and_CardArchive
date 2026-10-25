/* RKBO ONLINE v1 — public leaderboard with Google + Kakao OAuth.
 * Kakao may be disabled in config pending provider policy review.
 * User identity + leaderboard only; client never gets a server-side secret. */
(function(root){"use strict";
const esc=s=>String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const cfg=()=>root.RKBOOnlineConfig||{};
const isConfigured=()=>Boolean(cfg().enabled&&/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg().url||"")&&String(cfg().publishableKey||"").length>10);
const CATS=[
 {id:"season",mode:"season",hidden:false,label:"현재 시즌"},
 {id:"all",mode:"all",hidden:false,label:"올타임"},
 {id:"season-hidden",mode:"season",hidden:true,label:"현재 시즌 (숨기기)"},
 {id:"all-hidden",mode:"all",hidden:true,label:"올타임 (숨기기)"}
];
let client=null,clientPromise=null,overlay=null,panel=null,screen="leaderboard",category="season",records=[],selected=null,authUser=null,profile=null,busy=false;
const q=s=>overlay?.querySelector(s);
const season=()=>Number(root.RKBOSeason?.current?.()||60);
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
 return '<header class="rkbo-online-head"><div><span class="rkbo-draft-kicker">RKBO · CONNECTED WORLD</span><h2>🌐 RKBO ONLINE <small>v1</small></h2><p>온라인 공동 랭킹 · Google·카카오 로그인 · 사용자별 기록</p></div><button type="button" class="rkbo-online-close" data-online="close" aria-label="닫기">×</button></header>';
}
function shell(inner){if(!panel)return;panel.innerHTML=buildHeader()+'<div class="rkbo-online-inner">'+inner+'</div>'}
function notice(text){const el=q("#rkbo-online-message");if(el)el.textContent=text}
function headerTabs(){return '<nav class="rkbo-online-tabs"><button data-online="tab-board" class="'+(screen==="leaderboard"?"active":"")+'">🏆 랭킹</button><button data-online="tab-account" class="'+(screen==="account"?"active":"")+'">👤 내 계정</button></nav>'}
function disabledView(){
 shell(headerTabs()+'<section class="rkbo-online-empty"><div class="rkbo-online-big">🌐</div><h3>RKBO ONLINE 서버 연결 준비 중</h3>'+
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
   .select("id,user_id,mode,hidden,season,average_ovr,tpi,picks,created_at,rkbo_profiles(nickname)")
   .eq("mode",cat.mode).eq("hidden",cat.hidden);
  if(cat.mode==="season")query=query.eq("season",season());
  const {data,error}=await query.order("tpi",{ascending:false}).order("average_ovr",{ascending:false}).order("created_at",{ascending:true}).limit(30);
  if(error)throw Error(error.message);
  if(category+"|"+season()!==requestKey||!elem.isConnected)return;
  records=data||[];selected=null;
  elem.innerHTML=records.length?'<div class="rkbo-online-table-head"><span>순위</span><span>플레이어 / 시즌</span><span>TPI</span><span>평균 OVR</span></div>'+
   records.map((r,i)=>'<button class="rkbo-online-entry" type="button" data-online-detail="'+esc(r.id)+'"><span class="rkbo-online-rank">'+(i+1)+'</span><span class="rkbo-online-player"><strong>'+esc(r.rkbo_profiles?.nickname||"익명 선수")+'</strong><small>'+(r.mode==="season"?r.season+"차":"올타임")+' · '+formatDate(r.created_at)+'</small></span><b>'+r.tpi+'</b><span>'+Number(r.average_ovr).toFixed(1)+'</span></button>').join("")+
   '<div id="rkbo-online-detail"></div>':'<p class="rkbo-online-none">아직 등록된 팀이 없어! 18인 드래프트를 완성해서 첫 번째 기록을 남겨봐.</p>';
 }catch(err){if(elem.isConnected)elem.innerHTML='<p class="rkbo-online-none">랭킹을 불러오지 못했어. '+esc(err.message)+'</p>'}
}
function showDetails(id){
 const e=q("#rkbo-online-detail");if(!e)return;
 if(selected===id){selected=null;e.innerHTML="";return}
 const r=records.find(x=>x.id===id);if(!r)return;
 selected=id;
 const order=["C","1B","2B","3B","SS","LF","CF","RF","DH","SP1","SP2","SP3","SP4","SP5","RP1","RP2","RP3","CP"];
 const picks=Array.isArray(r.picks)?r.picks.slice().sort((a,b)=>order.indexOf(a.slot)-order.indexOf(b.slot)):[];
 e.innerHTML='<div class="rkbo-online-detail-title">⚾ '+esc(r.rkbo_profiles?.nickname||"익명 선수")+'의 18인 드래프트 · TPI '+r.tpi+'</div>'+
 '<div class="rkbo-online-roster">'+picks.map(p=>'<div><span>'+esc(p.slot)+'</span><strong>'+esc(p.name||p.cardId||"선수")+'</strong><small>'+esc(p.team||"")+' · '+esc(String(p.season||""))+'차</small><b>'+Number(p.ovr)+'</b></div>').join("")+'</div>';
 e.scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function accountView(){
 if(!isConfigured()){disabledView();return}
 shell(headerTabs()+'<div class="rkbo-online-section-head"><h3>온라인 플레이어 계정</h3><small>Google 또는 카카오 계정으로 로그인하고 다른 기기에서도 기록을 확인하세요.</small></div>'+
 '<div id="rkbo-online-account"><p class="rkbo-online-wait">로그인 상태 확인 중…</p></div>'+
 '<p class="rkbo-online-message" id="rkbo-online-message" role="status"></p>');
 try{await loadUser();drawAccount()}catch(e){notice(e.message)}
}
function drawAccount(){
 const el=q("#rkbo-online-account");if(!el)return;
 el.innerHTML=authUser?'<div class="rkbo-online-profile"><p><strong>로그인 완료</strong> · '+esc(authUser.email||authUser.user_metadata?.full_name||"소셜 로그인 계정")+'</p>'+
 '<label>공개 닉네임 (2~20자)</label><div class="rkbo-online-rename"><input id="rkbo-online-nickname" maxlength="20" value="'+esc(profile?.nickname||"")+'" autocomplete="off"><button data-online="save-nickname" type="button">닉네임 저장</button></div>'+
 '<p>온라인 랭킹에는 이메일이 아닌 공개 닉네임이 표시됩니다.</p><button type="button" class="rkbo-online-signout" data-online="signout">로그아웃</button></div>':
 '<div class="rkbo-online-login">'+
 (cfg().kakaoEnabled?'<button type="button" class="rkbo-online-social rkbo-online-social-kakao" data-online="kakao-signin"><span aria-hidden="true">●</span> 카카오로 시작하기</button>':'')+
 '<button type="button" class="rkbo-online-social rkbo-online-social-google" data-online="google-signin"><span aria-hidden="true">G</span> Google 계정으로 로그인</button>'+
 '<p>별도의 인증 메일이나 RKBO 비밀번호는 필요하지 않아요. 로그인 없이도 드래프트는 플레이할 수 있어요.</p></div>';
}
async function signInSocial(provider){
 if(busy)return;
 if(!["google","kakao"].includes(provider)||provider==="kakao"&&!cfg().kakaoEnabled)return;
 const label=provider==="kakao"?"카카오":"Google";
 busy=true;notice(label+" 로그인 페이지로 이동하는 중…");
 try{
  const c=await getClient();
  const redirect=location.origin+location.pathname;
  try{sessionStorage.setItem("rkbo-online-oauth-return","1")}catch{}
  const {error}=await c.auth.signInWithOAuth({provider,options:{redirectTo:redirect}});
  if(error)throw Error(error.message);
 }catch(err){
  try{sessionStorage.removeItem("rkbo-online-oauth-return")}catch{}
  notice(label+" 로그인 실패: "+err.message);
 }finally{busy=false}
}
async function saveNickname(){
 if(busy)return;
 const value=q("#rkbo-online-nickname")?.value.trim()||"";
 if(value.length<2||value.length>20||/[<>"\\]/.test(value)){notice("닉네임은 2~20자의 일반 문자로 입력해 주세요.");return}
 busy=true;
 try{
  const c=await getClient();
  if(!authUser)throw Error("로그인 후 변경할 수 있습니다.");
  const {error}=await c.from("rkbo_profiles").update({nickname:value}).eq("user_id",authUser.id);
  if(error)throw Error(error.message);
  profile={user_id:authUser.id,nickname:value};notice("✓ 공개 닉네임이 저장됐습니다.");
 }catch(err){notice(err.message)}
 finally{busy=false}
}
async function submitDraft(payload){
 if(!payload||!isConfigured())throw Error("RKBO ONLINE 서버를 연결해야 합니다.");
 const c=await getClient(),{data:{user},error:authErr}=await c.auth.getUser();
 if(authErr||!user){open("account");throw Error("Google 또는 카카오 계정으로 로그인한 후 다시 랭킹 등록 버튼을 눌러 주세요.")}
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
function open(view="leaderboard"){
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
 overlay.innerHTML='<div class="rkbo-online-panel" role="dialog" aria-modal="true" aria-label="RKBO ONLINE"></div>';
 document.body.append(overlay);panel=overlay.querySelector(".rkbo-online-panel");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
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
   case "google-signin":signInSocial("google");break;
   case "kakao-signin":signInSocial("kakao");break;
   case "save-nickname":saveNickname();break;
   case "signout":if(busy)return;busy=true;try{await (await getClient()).auth.signOut();authUser=null;profile=null;drawAccount();notice("로그아웃했습니다.")}catch(err){notice(err.message)}finally{busy=false}break;
  }
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.RKBOOnline={isConfigured,open,submitDraft};
document.addEventListener("DOMContentLoaded",()=>{
 init();
 // Restore account screen on return from Google or Kakao OAuth.
 let returned=false;
 try{returned=sessionStorage.getItem("rkbo-online-oauth-return")==="1"||sessionStorage.getItem("rkbo-online-google-return")==="1";if(returned){sessionStorage.removeItem("rkbo-online-oauth-return");sessionStorage.removeItem("rkbo-online-google-return")}}catch{}
 if(returned&&isConfigured())open("account");
});
})(window);
