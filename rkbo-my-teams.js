/* MY RKBO — private account-linked draft team locker.
 * PostgREST accesses only owner rows under Supabase RLS.
 * These personal snapshots are never used for competitive rankings.
 */
(function(root){"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let overlay=null,panel=null,teams=[],chosen=null,working=false;
const $=q=>panel?.querySelector(q);
const client=()=>root.RKBOOnline?.getClient?.();
async function account(){
 if(!client())throw Error("RKBO ONLINE 연결 상태를 확인해 주세요.");
 const c=await client(),{data,error}=await c.auth.getUser();
 if(error||!data?.user)throw Error("Google 계정으로 로그인해야 팀을 저장하거나 불러올 수 있어요.");
 return {c,user:data.user};
}
const checkName=value=>{
 const name=String(value??"").trim();
 if(name.length<2||name.length>40)throw Error("팀 이름은 2~40자로 입력해 주세요.");
 return name;
};
async function saveTeam(payload,name,existingId=null){
 if(!payload||!Array.isArray(payload.slots)||payload.slots.length!==18||!payload.lineup)throw Error("완성된 드래프트 팀만 저장할 수 있어요.");
 const {c,user}=await account();
 const values={name:checkName(name),mode:payload.mode,hidden:!!payload.hidden,season:payload.season,average_ovr:payload.averageOVR,tpi:payload.power,slots:payload.slots,lineup:payload.lineup,updated_at:new Date().toISOString()};
 const response=existingId
  ?await c.from("rkbo_saved_teams").update(values).eq("id",existingId).eq("user_id",user.id).select("id,name").single()
  :await c.from("rkbo_saved_teams").insert({...values,user_id:user.id}).select("id,name").single();
 if(response.error)throw Error("팀 저장 실패: "+response.error.message);
 return response.data;
}
function render(){
 if(!panel)return;
 panel.innerHTML='<div class="rkbo-my-head"><div><small>RKBO · MY CLUBHOUSE</small><h2>💾 MY RKBO</h2><p>내 계정에 저장한 드래프트 팀 · 다른 기기에서도 불러오기</p></div><button type="button" data-my="close" aria-label="닫기">×</button></div>'+
 '<main class="rkbo-my-body"><div class="rkbo-my-actions"><button type="button" data-my="new-draft">⚾ 새 드래프트</button>'+
 '<button type="button" data-my="refresh">↻ 새로고침</button><button type="button" data-my="leaderboard">🌐 공용 랭킹</button></div>'+
 '<div id="rkbo-my-content"><p>팀 목록을 불러오는 중…</p></div><p id="rkbo-my-status" role="status"></p></main>';
}
const message=t=>{const el=$("#rkbo-my-status");if(el)el.textContent=t};
async function refresh(){
 const content=$("#rkbo-my-content");if(!content)return;
 try{
  const {c,user}=await account();
  const {data,error}=await c.from("rkbo_saved_teams").select("id,name,mode,hidden,season,average_ovr,tpi,slots,lineup,created_at,updated_at")
   .eq("user_id",user.id).order("updated_at",{ascending:false}).limit(100);
  if(error)throw Error(error.message);
  if(!content.isConnected)return;
  teams=data||[];
  content.innerHTML=teams.length?'<div class="rkbo-my-list">'+teams.map(t=>'<article class="rkbo-my-team">'+
   '<div class="rkbo-my-title"><div><h3>'+esc(t.name)+'</h3><small>'+(t.mode==="all"?"올타임":esc(t.season)+"차 시즌")+(t.hidden?" · 숨기기":"")+' · '+new Date(t.updated_at).toLocaleString("ko-KR")+'</small></div>'+
   '<strong>TPI '+t.tpi+'</strong></div>'+
   '<p>18명 · 평균 OVR '+Number(t.average_ovr).toFixed(1)+'</p>'+
   '<div class="rkbo-my-buttons"><button type="button" data-my="load" data-team-id="'+esc(t.id)+'">⚾ 팀 불러오기</button>'+
   '<button type="button" data-my="detail" data-team-id="'+esc(t.id)+'">명단 보기</button>'+
   '<button type="button" data-my="rename" data-team-id="'+esc(t.id)+'">이름 변경</button>'+
   '<button type="button" data-my="delete" data-team-id="'+esc(t.id)+'">삭제</button></div>'+
   '<div id="rkbo-my-detail-'+esc(t.id)+'"></div></article>').join("")+'</div>':
   '<div class="rkbo-my-empty">아직 저장한 팀이 없습니다. 드래프트를 마친 뒤 <b>💾 내 팀에 저장</b>을 눌러 주시기 바랍니다.</div>';
 }catch(err){
  teams=[];content.innerHTML='<div class="rkbo-my-empty">'+esc(err.message)+'<p><button type="button" data-my="login">Google 로그인</button></p></div>';
 }
}
async function namesFor(slots){
 const current=root.RKBOSeason?.players?.()||[],wanted=new Set(slots.map(p=>p.cardId));
 const seasons=[...new Set(slots.map(p=>Number(String(p.cardId).split("-")[0])))];
 const players=[];
 for(const n of seasons){
  try{
   let list;
   if(Number(current[0]?.season)===n)list=current;
   else if(n===60)list=root.RKBOSeason?.builtin?.()||[];
   else{
    const response=await fetch("./data/seasons/"+n+".json",{cache:"force-cache"});
    if(!response.ok)continue;
    const raw=await response.json();list=Array.isArray(raw)?raw:raw.players||[];
   }
   players.push(...list.filter(p=>wanted.has(p.id)).map(p=>({...p})));
  }catch(err){console.warn("[MY RKBO] name lookup",err)}
 }
 try{await root.RKBONameMap?.apply?.(players,null)}catch(err){console.warn("[MY RKBO] Korean name mapping",err)}
 return new Map(players.map(p=>[p.id,p.name]));
}
async function detail(t){
 const target=$("#rkbo-my-detail-"+t.id);if(!target)return;
 if(chosen===t.id){chosen=null;target.innerHTML="";return}
 chosen=t.id;target.innerHTML='<p class="rkbo-my-wait">선수 이름 불러오는 중…</p>';
 const names=await namesFor(t.slots||[]);
 if(chosen!==t.id||!target.isConnected)return;
 const slotsOrder=["C","1B","2B","3B","SS","LF","CF","RF","DH","SP1","SP2","SP3","SP4","SP5","RP1","RP2","RP3","CP"];
 const rows=(t.slots||[]).slice().sort((a,b)=>slotsOrder.indexOf(a.slot)-slotsOrder.indexOf(b.slot));
 target.innerHTML='<div class="rkbo-my-roster">'+rows.map(x=>'<div><b>'+esc(x.slot)+'</b><strong>'+esc(names.get(x.cardId)||x.cardId)+'</strong><span>OVR '+Number(x.ovr)+'</span></div>').join("")+'</div>';
}
async function modify(action,id){
 const t=teams.find(v=>v.id===id);if(!t)return;
 const {c,user}=await account();
 if(action==="load"){
  if(!root.RKBODraft?.loadSavedTeam)throw Error("드래프트 로딩 기능이 없습니다. 페이지를 새로고침해 주세요.");
  await root.RKBODraft.loadSavedTeam(t);
  close();return;
 }
 if(action==="detail"){await detail(t);return}
 if(action==="rename"){
  const value=prompt("새 팀 이름 (2~40자)",t.name);
  if(value===null)return;
  const name=checkName(value);
  const {data,error}=await c.from("rkbo_saved_teams").update({name,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id).select("id").single();
  if(error||!data)throw Error("팀 이름 변경 실패: "+(error?.message||"변경되지 않았어요."));
  await refresh();message("✓ 팀 이름을 변경했습니다.");return;
 }
 if(action==="delete"){
  if(!confirm('"'+t.name+'" 팀을 삭제할까요? 복구할 수 없어요.'))return;
  const {data,error}=await c.from("rkbo_saved_teams").delete().eq("id",id).eq("user_id",user.id).select("id").single();
  if(error||!data)throw Error("팀 삭제 실패: "+(error?.message||"삭제되지 않았어요."));
  await refresh();message("✓ 팀을 삭제했습니다.");
 }
}
function close(){
 if(!overlay)return;
 overlay.hidden=true;document.body.classList.remove("rkbo-my-open");
}
function open(){
 if(!overlay)init();
 if(!overlay)return;
 chosen=null;overlay.hidden=false;document.body.classList.add("rkbo-my-open");render();refresh();
}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const btn=document.createElement("button");btn.type="button";btn.id="rkbo-my-open";btn.className="rkbo-my-open-btn";btn.textContent="💾 MY RKBO";
 nav?.prepend(btn);btn.addEventListener("click",open);
 overlay=document.createElement("div");overlay.id="rkbo-my-overlay";overlay.className="rkbo-my-overlay";overlay.hidden=true;
 overlay.innerHTML='<div class="rkbo-my-panel" role="dialog" aria-modal="true" aria-label="MY RKBO 팀 보관함"></div>';
 document.body.append(overlay);panel=overlay.querySelector(".rkbo-my-panel");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 panel.addEventListener("click",async e=>{
  const b=e.target.closest("[data-my]");if(!b||working)return;
  const action=b.dataset.my;
  if(action==="close"){close();return}
  if(action==="refresh"){refresh();return}
  if(action==="leaderboard"){close();root.RKBOOnline?.open?.("leaderboard");return}
  if(action==="login"){close();root.RKBOOnline?.open?.("account");return}
  if(action==="new-draft"){close();root.RKBODraft?.open?.();return}
  if(!["load","detail","rename","delete"].includes(action))return;
  working=true;try{await modify(action,b.dataset.teamId)}catch(err){message(err.message)}finally{working=false}
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.RKBOMyTeams={open,saveTeam};
document.addEventListener("DOMContentLoaded",init);
})(window);
