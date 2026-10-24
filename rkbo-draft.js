/* RKBO 18-player draft: current season or cross-season all-time.
   Randomized position roulette, three visible card choices, 3 shared rerolls
   (max one per slot), and stadium-based team result.
 */
(function(root){"use strict";
const SLOTS=[
 {id:"C",pos:"C",title:"포수",role:"타자"},
 {id:"1B",pos:"1B",title:"1루수",role:"타자"},
 {id:"2B",pos:"2B",title:"2루수",role:"타자"},
 {id:"3B",pos:"3B",title:"3루수",role:"타자"},
 {id:"SS",pos:"SS",title:"유격수",role:"타자"},
 {id:"LF",pos:"LF",title:"좌익수",role:"타자"},
 {id:"CF",pos:"CF",title:"중견수",role:"타자"},
 {id:"RF",pos:"RF",title:"우익수",role:"타자"},
 {id:"DH",pos:"DH",title:"지명타자",role:"타자"},
 ...Array.from({length:5},(_,i)=>({id:"SP"+(i+1),pos:"SP",title:(i+1)+"선발",role:"선발"})),
 ...Array.from({length:3},(_,i)=>({id:"RP"+(i+1),pos:"RP",title:"중계 "+(i+1),role:"중계"})),
 {id:"CP",pos:"CP",title:"마무리",role:"마무리"}
];
const byId=new Map(SLOTS.map(s=>[s.id,s]));
const batSlots=["C","1B","2B","3B","SS","LF","CF","RF","DH"];
const fieldCoords={C:[50,89],"1B":[78,68],"2B":[63,50],"3B":[22,68],SS:[37,50],LF:[20,27],CF:[50,15],RF:[80,27],DH:[15,88],SP1:[50,70]};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle=a=>{const b=a.slice();for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b};
const identity=p=>String(p.rawName||p.englishName||p.name||p.id).normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
let shell=null,stage=null,mode="season",state=null,interval=null,timeout=null,token=0,loading=false,previousOverflow="";
function stopTimers(){if(interval!==null)clearInterval(interval);if(timeout!==null)clearTimeout(timeout);interval=null;timeout=null}
function header(subtitle){
 return '<div class="rkbo-draft-header"><div><span class="rkbo-draft-kicker">RKBO · DRAFT ROOM</span><h2>RKBO 드래프트 <span>2026</span></h2>'+
 '<p>'+esc(subtitle)+'</p></div><button class="rkbo-draft-close" type="button" data-draft-action="close" aria-label="드래프트 닫기">×</button></div>';
}
function render(body,subtitle){
 if(!shell)return;
 shell.innerHTML=header(subtitle)+'<main class="rkbo-draft-main">'+body+'</main>';
 stage=shell.querySelector(".rkbo-draft-main");
}
function init(){
 if(document.getElementById("rkbo-draft-open"))return;
 const btn=document.createElement("button");btn.id="rkbo-draft-open";btn.className="rkbo-draft-open";btn.type="button";btn.textContent="⚾ 드래프트";
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");nav?.prepend(btn);
 btn.addEventListener("click",open);
 const overlay=document.createElement("div");overlay.id="rkbo-draft-overlay";overlay.className="rkbo-draft-overlay";overlay.hidden=true;
 overlay.innerHTML='<div class="rkbo-draft-shell" role="dialog" aria-label="RKBO 18인 드래프트" aria-modal="true"></div>';
 document.body.append(overlay);shell=overlay.querySelector(".rkbo-draft-shell");
 shell.addEventListener("click",clicked);
 shell.addEventListener("keydown",e=>{const el=e.target.closest("[data-draft-pick]");if(el&&(e.key==="Enter"||e.key===" ")){e.preventDefault();pick(el.dataset.draftPick)}});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
}
function open(){
 const el=document.getElementById("rkbo-draft-overlay");if(!el)return;
 previousOverflow=document.body.style.overflow;el.hidden=false;document.body.style.overflow="hidden";
 state=null;mode="season";setup();
}
function close(){
 if(loading){token++;loading=false;stopTimers();state=null;document.getElementById("rkbo-draft-overlay").hidden=true;document.body.style.overflow=previousOverflow;return}
 if(state&&state.phase!=="result"&&state.picks.size&&state.picks.size<18&&!confirm("진행 중인 드래프트를 종료할까요? 선택한 팀은 초기화됩니다."))return;
 token++;stopTimers();state=null;document.getElementById("rkbo-draft-overlay").hidden=true;document.body.style.overflow=previousOverflow;
}
function setup(){
 stopTimers();state=null;
 const season=root.RKBOSeason?.current?.()||60;
 render('<div class="rkbo-draft-intro"><div class="rkbo-draft-big">18<span> PICKS</span></div>'+
  '<div class="rkbo-draft-copy"><h3>18번의 선택, 단 하나의 최강 팀.</h3><p>포지션을 무작위로 추첨하고, 나타나는 선수 카드 3장 중 한 장을 고르세요. 선발 5명·중계 3명·마무리 1명까지 모두 뽑으면 그라운드에 나만의 라인업이 완성됩니다.</p>'+
  '<div class="rkbo-draft-mode-picker"><button type="button" data-draft-action="mode-season" class="rkbo-draft-mode active"><strong>'+season+'차 시즌</strong><small>현재 선택한 시즌의 카드만</small></button>'+
  '<button type="button" data-draft-action="mode-all" class="rkbo-draft-mode"><strong>올타임 드래프트</strong><small>등록된 모든 시즌을 섞어서</small></button></div>'+
  '<div class="rkbo-draft-rules"><span>포지션 랜덤 추첨</span><span>매번 카드 3장</span><span>다시 뽑기 총 3회</span><span>한 포지션에 1회만</span></div>'+
  '<button class="rkbo-draft-primary" type="button" data-draft-action="start">드래프트 시작하기 →</button></div></div>',
  "시즌 선택 · 18인 로스터 구성");
}
function selectedCount(){return state?.picks?.size||0}
function progress(){
 return '<div class="rkbo-draft-progress"><span><b>'+selectedCount()+'</b> / 18 PICKS</span>'+
 '<div class="rkbo-draft-progress-track"><i style="width:'+(selectedCount()/18*100)+'%"></i></div>'+
 '<span>다시 뽑기 <b>'+state.rerolls+'/3</b></span></div>';
}
async function allTime(){
 await root.RKBOSeason?.reload?.();
 const manifest=root.RKBOSeason?.seasons?.()||[];
 if(manifest.length<2)throw Error("전체 시즌 목록을 불러오지 못했습니다.");
 const pool=[...(root.RKBOSeason?.players?.()||[])];
 const current=root.RKBOSeason?.current?.();
 const tasks=manifest.filter(x=>Number(x.season)!==Number(current));
 const result=new Array(tasks.length);let next=0,done=0;const runToken=token;
 async function worker(){
  while(next<tasks.length){
   if(runToken!==token)throw Error("취소된 드래프트입니다.");
   const j=next++,s=tasks[j],n=Number(s.season);
   if(n===60){
    const built=root.RKBOSeason?.builtin?.();
    if(!Array.isArray(built))throw Error("60차 기본 카드 데이터가 없습니다.");
    result[j]=built;done++;
    const p=stage?.querySelector("#rkbo-draft-load-status");
    if(p)p.textContent=done+" / "+tasks.length+"개 시즌 불러오는 중…";
    continue;
   }
   const path=s.file||("data/seasons/"+n+".json");
   const response=await fetch("./"+path+"?draft="+Date.now(),{cache:"no-store"});
   if(!response.ok)throw Error(n+"차 카드 로딩 실패 (HTTP "+response.status+")");
   const data=await response.json();
   const list=Array.isArray(data)?data:data.players;
   if(!Array.isArray(list))throw Error(n+"차 선수 목록 오류");
   result[j]=list;done++;
   const progressEl=stage?.querySelector("#rkbo-draft-load-status");
   if(progressEl)progressEl.textContent=done+" / "+tasks.length+"개 시즌 불러오는 중…";
  }
 }
 await Promise.all(Array.from({length:Math.min(5,tasks.length)},worker));
 for(const list of result)pool.push(...list);
 // Apply currently configured Korean display names, without losing manual labels.
 if(root.RKBONameMap?.apply)await root.RKBONameMap.apply(pool,null);
 root.RKBOTeamBrand?.decorate?.(pool);
 return pool;
}
async function start(){
 if(loading)return;
 loading=true;
 const t=++token;const useAll=mode==="all";
 render('<div class="rkbo-draft-loading"><div class="rkbo-draft-loading-ball">⚾</div><h3>드래프트 후보 준비 중</h3><p id="rkbo-draft-load-status">'+(useAll?"전체 시즌 카드 불러오는 중…":"이번 시즌 선수 확인 중…")+'</p></div>',"선수 풀 준비");
 try{
  let pool=useAll?await allTime():[...(root.RKBOSeason?.players?.()||[])];
  if(t!==token)return;
  pool=pool.filter(p=>Number(p.ovr)>0&&p.ratings&&(p.type==="타자"||p.type==="투수"));
  const stock={};
  for(const s of SLOTS){
   const candidates=new Set(pool.filter(p=>eligibleFor(p,s)).map(identity));
   stock[s.id]=candidates.size;
  }
  const scarce=Object.entries(stock).filter(([,count])=>count<3);
  if(scarce.length)throw Error("드래프트 후보가 부족한 포지션: "+scarce.map(([id,count])=>id+" ("+count+"명)").join(", "));
  state={phase:"roulette",mode,pool,picks:new Map(),offered:[],slot:null,usedRerollSlots:new Set(),rerolls:3,round:0};
  loading=false;roulette();
 }catch(err){loading=false;console.error("[RKBO draft]",err);
  if(t===token)render('<div class="rkbo-draft-error"><h3>드래프트를 시작하지 못했습니다</h3><p>'+esc(err.message)+'</p><button data-draft-action="setup" type="button">방식 선택으로 돌아가기</button></div>',"선수 데이터 오류");
 }
}
function eligibleFor(p,s){
 if(s.pos==="DH")return p.type==="타자";
 return p.type===(s.role==="타자"?"타자":"투수")&&p.pos===s.pos;
}
function candidatePool(slot,excludeOffer=false){
 const chosenIds=new Set([...state.picks.values()].map(x=>identity(x)));
 const previous=excludeOffer?new Set(state.offered.map(p=>p.id)):new Set();
 const unique=new Map();
 for(const p of shuffle(state.pool)){
  const key=identity(p);
  if(chosenIds.has(key)||previous.has(p.id)||!eligibleFor(p,slot)||unique.has(key))continue;
  unique.set(key,p);
 }
 return [...unique.values()];
}
function roulette(){
 stopTimers();if(!state||state.picks.size>=18){result();return}
 state.phase="roulette";
 const remainder=SLOTS.filter(s=>!state.picks.has(s.id));
 const slot=remainder[Math.floor(Math.random()*remainder.length)];
 state.slot=slot;state.round++;
 render(progress()+'<section class="rkbo-draft-roulette"><p>ROUND '+state.round+' / 18 · NEXT POSITION</p>'+
  '<div id="rkbo-draft-wheel" class="rkbo-draft-wheel">⚾</div>'+
  '<small>다음 드래프트 포지션을 추첨하고 있습니다…</small></section>',"포지션 랜덤 추첨");
 const wheel=stage.querySelector("#rkbo-draft-wheel");let ticks=0;
 interval=setInterval(()=>{
  const random=remainder[Math.floor(Math.random()*remainder.length)];
  if(wheel)wheel.textContent=random.id.startsWith("SP")?"SP":random.id.startsWith("RP")?"RP":random.id;
  if(++ticks>=19){
   stopTimers();
   if(wheel){wheel.textContent=slot.pos==="DH"?"DH":slot.pos;wheel.classList.add("is-picked")}
   const note=stage.querySelector(".rkbo-draft-roulette small");
   if(note)note.textContent="선정된 포지션 · "+slot.title;
   timeout=setTimeout(()=>{timeout=null;offers(false)},480);
  }
 },62);
}
function offers(isReroll){
 if(!state||!state.slot)return;
 const candidates=candidatePool(state.slot,isReroll);
 if(candidates.length<3){render('<div class="rkbo-draft-error"><h3>선수 후보가 3명 미만입니다</h3><p>다른 시즌을 선택하거나 드래프트를 다시 시작해 주세요.</p><button data-draft-action="setup" type="button">돌아가기</button></div>',"후보 부족");return}
 state.offered=shuffle(candidates).slice(0,3);state.phase="offer";drawOffers();
}
function drawOffers(){
 const slot=state.slot,canReroll=state.rerolls>0&&!state.usedRerollSlots.has(slot.id);
 render(progress()+
  '<div class="rkbo-draft-round-title"><div><span class="rkbo-draft-kicker">ROUND '+state.round+' / 18</span><h3>'+esc(slot.title)+' <em>'+esc(slot.pos)+'</em></h3><p>3명의 후보 중 한 명을 지명해 주세요. 등급과 OVR은 공개됩니다.</p></div>'+
  '<button type="button" data-draft-action="reroll" class="rkbo-draft-reroll"'+(canReroll?"":" disabled")+'>'+
  '↻ 다시 뽑기 <strong>'+state.rerolls+'/3</strong></button></div>'+
  '<div class="rkbo-draft-choices">'+state.offered.map((p,i)=>
   '<div class="rkbo-draft-choice" role="button" tabindex="0" data-draft-pick="'+esc(p.id)+'" aria-label="'+esc(p.name)+' '+p.ovr+' 선택">'+
   '<div class="rkbo-draft-choice-number">CARD 0'+(i+1)+' <span>OVR '+p.ovr+'</span></div>'+
   '<div class="rkbo-draft-card-wrap">'+root.RKBOCardView.render(p,true)+'</div>'+
   '<button type="button" class="rkbo-draft-pick-btn" data-draft-pick="'+esc(p.id)+'">'+esc(p.name)+' 지명하기 →</button></div>'
  ).join("")+'</div>'+
  '<p class="rkbo-draft-hint">※ 다시 뽑기는 전체 3회만 제공되며, 같은 포지션에서 두 번 사용할 수 없습니다.</p>',
  state.mode==="all"?"1~60차 통합 올타임 드래프트":"현재 선택된 시즌 드래프트");
}
function pick(id){
 if(!state||state.phase!=="offer")return;
 const p=state.offered.find(x=>x.id===id);if(!p)return;
 state.picks.set(state.slot.id,p);state.offered=[];
 if(state.picks.size===18)result();else roulette();
}
function reroll(){
 if(!state||state.phase!=="offer"||state.rerolls<=0||state.usedRerollSlots.has(state.slot.id))return;
 // Cannot use the single reroll here if three entirely fresh candidates are unavailable.
 if(candidatePool(state.slot,true).length<3){
  const tip=stage.querySelector(".rkbo-draft-hint");if(tip)tip.textContent="이 포지션에는 다른 선수 후보 3명이 남아 있지 않습니다.";
  return;
 }
 state.usedRerollSlots.add(state.slot.id);state.rerolls--;offers(true);
}
function strength(players){
 const nums=players.map(p=>Number(p.ovr)).sort((a,b)=>b-a);
 const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
 const avg=mean(nums),top=mean(nums.slice(0,6)),bottom=mean(nums.slice(-6));
 return {avg:avg.toFixed(1),power:Math.round((.7*avg+.2*top+.1*bottom)*10)};
}
function result(){
 stopTimers();if(!state||state.picks.size!==18)return;
 state.phase="result";
 const pairs=[...state.picks],players=pairs.map(([,p])=>p),score=strength(players);
 const spot=(id)=>{
  const p=state.picks.get(id),xy=fieldCoords[id],s=byId.get(id);
  return '<div class="rkbo-draft-field-player" style="left:'+xy[0]+'%;top:'+xy[1]+'%" title="'+esc(s.title+" "+p.name+" OVR "+p.ovr)+'">'+
   '<small>'+esc(id)+'</small><strong>'+esc(p.name)+'</strong><span>OVR '+p.ovr+'</span></div>';
 };
 const benchIds=["SP2","SP3","SP4","SP5","RP1","RP2","RP3","CP"];
 const groups=[["STARTING ROTATION · 2~5선발",benchIds.slice(0,4)],["BULLPEN · 중계 3인",benchIds.slice(4,7)],["CLOSER · 마무리",["CP"]]];
 render('<div class="rkbo-draft-result-title"><span class="rkbo-draft-kicker">COMPLETE · 18 / 18</span><h3>MY DREAM TEAM</h3><p>18명의 최종 드래프트가 완성됐습니다.</p></div>'+
  '<div class="rkbo-draft-scoreboard"><div><small>팀 평균 OVR</small><strong>'+score.avg+'</strong></div>'+
  '<div><small>팀 전력지수 · TPI</small><strong>'+score.power+'<span> / 1000</span></strong></div>'+
  '<div><small>지명 완료</small><strong>18<span> / 18</span></strong></div></div>'+
  '<div class="rkbo-draft-result-layout"><section class="rkbo-draft-field-panel"><div class="rkbo-draft-panel-label">FIELD LINEUP · 주전 타자 9명 + 1선발</div>'+
   '<div class="rkbo-draft-field"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+
   '<path d="M 3 73 Q 50 -12 97 73 L 50 99 Z" fill="#1f6044" stroke="#a9d4a4" stroke-width=".35"/>'+
   '<path d="M 50 91 L 75 69 L 50 46 L 25 69 Z" fill="#347b4c" stroke="#e8e4c6" stroke-width=".48"/>'+
   '<path d="M 50 91 L 75 69 M 50 91 L 25 69" stroke="#d8e2cb" stroke-width=".5"/>'+
   '<path d="M 50 70 Q 50 65 51 70" stroke="#bdba99" stroke-width=".8" fill="none"/></svg>'+
    [...batSlots,"SP1"].map(spot).join("")+'</div></section>'+
   '<aside class="rkbo-draft-bench"><div class="rkbo-draft-panel-label">PITCHING STAFF · 선발·불펜</div>'+
   groups.map(([label,ids])=>'<div class="rkbo-draft-bench-group"><h4>'+label+'</h4>'+
   ids.map(id=>{const p=state.picks.get(id);return '<div class="rkbo-draft-bench-row"><span>'+id+'</span><b>'+esc(p.name)+'</b><small>OVR '+p.ovr+'</small></div>'}).join("")+'</div>').join("")+'</aside></div>'+
   '<p class="rkbo-draft-score-note">TPI(팀 전력지수) = 전체 18명 평균 OVR 70% + 상위 6명 평균 20% + 하위 6명 평균 10%, 합계에 ×10. 정식 경기 승률이 아닌 카드 전력 비교용 지표입니다.</p>'+
   '<div class="rkbo-draft-end-actions"><button type="button" class="rkbo-draft-primary" data-draft-action="again">↻ 같은 모드로 다시 드래프트</button>'+
   '<button type="button" data-draft-action="setup">시즌·모드 다시 선택</button><button type="button" data-draft-action="close">도감으로 돌아가기</button></div>',
  "드래프트 완료 · 최종 라인업");
}
function clicked(e){
 const choice=e.target.closest("[data-draft-pick]");if(choice){pick(choice.dataset.draftPick);return}
 const action=e.target.closest("[data-draft-action]");if(!action)return;
 switch(action.dataset.draftAction){
  case "close":close();break;
  case "setup":token++;setup();break;
  case "mode-season":case "mode-all":
   mode=action.dataset.draftAction==="mode-all"?"all":"season";
   shell.querySelectorAll(".rkbo-draft-mode").forEach(x=>x.classList.toggle("active",x===action));break;
  case "start":start();break;
  case "reroll":reroll();break;
  case "again":state=null;start();break;
 }
}
document.addEventListener("DOMContentLoaded",init);
root.RKBODraft={open,getState:()=>state?{phase:state.phase,picks:state.picks.size,rerolls:state.rerolls,slot:state.slot?.id}:null};
})(window);
