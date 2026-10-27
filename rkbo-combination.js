/* RKBO Card Combination 2.0 balance
 * Server is the only authority for eligibility, quote, randomness and inventory updates.
 * Client only displays server-returned rates and a player's eligible duplicate cards.
 */
(function(root){"use strict";
const $=s=>dialog?.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const grades=["브론즈","실버","골드","코랄","다이아몬드","특수"];
const weights={"브론즈":1,"실버":3,"골드":7,"코랄":15,"다이아몬드":30};
const hue={"브론즈":"#b8866d","실버":"#b9cbdd","골드":"#efc26b","코랄":"#e99a9f","다이아몬드":"#9fddf7","특수":"#f5d186"};
const fmt=n=>Number(n||0).toLocaleString("ko-KR",{maximumFractionDigits:2,minimumFractionDigits:2});
let overlay=null,dialog=null,inventory=[],history=[],selected=[],quote=null,result=null;
let busy=false,loading=false,quoteLoading=false,quoteError="",notice="",filterSeason="all",filterGrade="all",search="";
let quoteIndex=0,pendingRequest=null,resultArtwork="",resultDisplayName="",artworkCache=new Map();
const client=()=>root.RKBOOnline?.getClient?.();
async function context(){
 if(!client())throw Error("RKBO ONLINE Google 로그인이 필요합니다.");
 const c=await client();
 const {data,error}=await c.auth.getUser();
 if(error||!data?.user)throw Error("Google 로그인 후 카드 조합을 이용할 수 있습니다.");
 return {c,user:data.user};
}
function count(id){return selected.filter(x=>x===id).length}
function scorePreview(){return selected.reduce((sum,id)=>sum+(weights[inventory.find(v=>v.card_id===id)?.grade]||0),0)}
function msg(s){notice=s;const el=$("#rkbo-combo-status");if(el)el.textContent=s}
function selectionCard(id){
 const p=inventory.find(x=>x.card_id===id);
 return p||{card_id:id,name:id,grade:"브론즈",season:"?",ovr:"?"};
}
function activeCards(){
 return inventory.filter(p=>(filterSeason==="all"||String(p.season)===filterSeason)
  &&(filterGrade==="all"||p.grade===filterGrade)
  &&(!search||String(p.name+" "+p.card_id).toLowerCase().includes(search.toLowerCase())));
}
function wrapCard(p){
 const used=count(p.card_id),full=busy||selected.length>=5||used>=p.available;
 return '<button type="button" class="rkbo-combo-candidate rarity-'+esc(p.grade)+'" data-combo-add="'+esc(p.card_id)+'"'+(full?' disabled':'')+'>'+
 '<span class="rkbo-combo-grade">'+esc(p.grade)+' · '+esc(p.season)+'차</span>'+
 '<strong>'+esc(p.name)+'</strong><span>OVR '+esc(p.ovr)+' · 보너스 중복 '+esc(p.available)+'장</span>'+
 '<small>'+(used?'투입 '+used+' / '+p.available:'클릭하여 재료로 추가')+'</small></button>';
}
function options(){
 const unique=[...new Set(inventory.map(v=>Number(v.season)))].sort((a,b)=>b-a);
 return '<option value="all">전체 시즌</option>'+unique.map(n=>
 '<option value="'+n+'"'+(filterSeason===String(n)?' selected':'')+'>'+n+'차</option>').join("");
}
function gradeOptions(){
 return '<option value="all">전체 등급</option>'+grades.slice(0,5).map(g=>'<option value="'+g+'"'+(filterGrade===g?' selected':'')+'>'+g+'</option>').join("");
}
function percentMarkup(){
 if(selected.length<3)return '<div class="rkbo-combo-hint">3장 이상 선택하면 서버에서 정확한 결과 확률을 계산해 보여줘.</div>';
 if(quoteLoading)return '<div class="rkbo-combo-hint">서버에서 실제 조합 확률을 계산하는 중…</div>';
 if(quoteError)return '<div class="rkbo-combo-error">'+esc(quoteError)+'</div>';
 if(!quote)return '<div class="rkbo-combo-hint">재료를 선택하면 확률이 표시돼.</div>';
 const odds=quote.odds||{};
 const highest=Math.max(...(quote.materials||[]).map(p=>grades.indexOf(p.grade)));
 const base=grades[highest];
 const lower=grades.slice(0,highest).reduce((sum,g)=>sum+Number(odds[g]||0),0);
 const upper=grades.slice(highest+1).reduce((sum,g)=>sum+Number(odds[g]||0),0);
 return (base?'<div class="rkbo-combo-outlook" aria-label="'+esc(base)+' 기준 결과 확률">'+
  '<small>최고 재료 등급 '+esc(base)+' 기준</small><div><span>하락 <b>'+fmt(lower)+'%</b></span>'+
  '<span>보존 <b>'+fmt(odds[base])+'%</b></span><span>상위 <b>'+fmt(upper)+'%</b></span></div></div>':'')+
 '<div class="rkbo-combo-odds">'+grades.map(g=>{
  const rate=Number(odds[g]||0);
  return '<div class="rkbo-combo-odd"><div><span>'+esc(g)+'</span><strong>'+fmt(rate)+'%</strong></div>'+
   '<div class="rkbo-combo-meter"><i style="width:'+Math.max(0,Math.min(100,rate))+'%;background:'+hue[g]+'"></i></div></div>';
 }).join("")+'</div>'+
 '<p class="rkbo-combo-note">'+(quote.mode==="same"
 ?'🎯 '+esc(quote.season)+'차 시즌 카드만 나와.'
 :'🎲 서버에 등록된 '+(quote.eligibleSeasons||[]).map(n=>esc(n)+'차').join(" · ")+' 중 시즌이 균등 무작위로 결정돼.')+
 ' 등록되지 않은 등급의 확률은 가까운 하위 등급에 합산돼(하위가 없으면 최저 등록 등급). 특수카드가 없는 시즌은 다이아몬드에 합산돼.'+
 ' 보존은 같은 등급의 새 카드 1장 획득을 뜻해. 혼합 등급은 합산 점수로 계산하므로 최고 등급 보존율이 낮아질 수 있어.</p>';
}

/* Purely cosmetic 2.0 animations. The server response is the ONLY winner. */
const premiumGrades=new Set(["코랄","다이아몬드","특수","신인왕","드림","나눔","MVP","베스트릴리프"]);
const displayGrades=["브론즈","실버","골드","코랄","다이아몬드","신인왕","드림","나눔","MVP","베스트릴리프"];
let cinema=null,cinemaSkip=false,cinemaAdvance=null;
const reducedMotion=()=>Boolean(root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
function cinematicStop(){
 if(cinemaAdvance)cinemaAdvance();
 if(cinema){cinema.hidden=true;cinema.innerHTML="";cinema.className="rkbo-combo-cinema";}
 cinemaSkip=false;
}
function skipCinematic(){
 cinemaSkip=true;
 if(cinemaAdvance)cinemaAdvance();
}
function cinematicPause(ms){
 if(cinemaSkip||reducedMotion())return Promise.resolve();
 return new Promise(resolve=>{
  let doneOnce=false;
  const done=()=>{
   if(doneOnce)return;
   doneOnce=true;root.clearTimeout(timer);
   if(cinemaAdvance===done)cinemaAdvance=null;
   resolve();
  };
  const timer=root.setTimeout(done,ms);
  cinemaAdvance=done;
 });
}
function cinematicScreen(title,content,subtitle){
 if(!cinema)return;
 cinema.hidden=false;
 cinema.className="rkbo-combo-cinema";
 cinema.innerHTML='<div class="rkbo-combo-cinema-panel">'+
  '<header><small>RKBO ONLINE · CARD COMBINATION 2.0</small><h2>'+esc(title)+'</h2></header>'+
  '<div class="rkbo-combo-cinema-scene">'+content+'</div>'+
  '<p class="rkbo-combo-cinema-caption">'+esc(subtitle||"")+'</p>'+
  '<button type="button" class="rkbo-combo-cinema-skip" data-combo-fx-skip>연출 건너뛰기</button>'+
  '</div>';
}
async function gatherCinematic(cards){
 const merge=cards.map((p,i)=>{
  const shift=Math.round((i-(cards.length-1)/2)*143);
  return '<div class="rkbo-combo-merge-tile" style="--merge-x:'+shift+'px;--merge-r:'+((i%2?1:-1)*9)+'deg;--merge-accent:'+(hue[p.grade]||"#f5d186")+'">'+
   '<small>'+esc(p.grade)+' · '+esc(p.season)+'차</small><strong>'+esc(p.name)+'</strong>'+
   '<span>OVR '+esc(p.ovr)+'</span></div>';
 }).join("");
 cinematicScreen("선수 카드 조합 중",'<div class="rkbo-combo-merge-stage">'+merge+
  '<span class="rkbo-combo-merge-core" aria-hidden="true">✦</span></div>',"카드가 하나로 합쳐집니다.");
 if(!reducedMotion()&&!cinemaSkip){
  root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>{
   if(cinema?.querySelector(".rkbo-combo-merge-stage"))cinema.classList.add("is-fusing");
  }));
 }
 await cinematicPause(920);
 cinematicScreen("결과 확인 중",'<div class="rkbo-combo-loader" aria-hidden="true"></div>',
  "서버에서 확정한 카드 결과를 안전하게 불러오는 중입니다.");
}
function rouletteTile(p,isWinner){
 const tier=p.grade==="코랄"?"coral":p.grade==="다이아몬드"?"diamond":
   premiumGrades.has(p.grade)?"special":"regular";
 return '<div class="rkbo-combo-roulette-tile tier-'+tier+(isWinner?' is-winner':'')+'">'+
  '<small>'+esc(p.grade||"선수")+'</small>'+
  '<strong>'+esc(p.name||"선수 카드")+'</strong>'+
  '<span>'+esc(p.season||"?")+'차 · OVR '+esc(p.ovr??"?")+'</span></div>';
}
async function rouletteCinematic(winner){
 const season=Number(winner.season);
 const roster=(artworkCache.get(season)||[]).filter(p=>p&&p.grade&&p.name);
 const pools=new Map(displayGrades.map(g=>[g,roster.filter(p=>p.grade===g)]));
 const items=[];
 const targetIndex=60,total=65;
 for(let i=0;i<total;i++){
  if(i===targetIndex){items.push(rouletteTile({...winner,name:resultDisplayName||winner.name},true));continue}
  // Display real catalog cards when available; these tiles do not represent further draws.
  const wanted=displayGrades[(i*7+Math.floor(i/3))%displayGrades.length];
  const group=pools.get(wanted)||[];
  const p=group.length?group[i%group.length]:(roster.length?roster[(i*23+Math.floor(i/4)*7)%roster.length]:
   {grade:wanted,name:"선수 카드",season:winner.season,ovr:"?"});
  items.push(rouletteTile(p,false));
 }
 cinematicScreen("HIGH GRADE · 카드 룰렛",
  '<div class="rkbo-combo-roulette"><div class="rkbo-combo-roulette-window">'+
  '<div class="rkbo-combo-roulette-track">'+items.join("")+'</div>'+
  '<span class="rkbo-combo-roulette-marker" aria-hidden="true"></span></div></div>',
  "가로로 달리던 카드가 서서히 느려져 서버에서 확정된 결과에 멈춥니다. (연출 전용)");
 const windowEl=cinema?.querySelector(".rkbo-combo-roulette-window");
 const track=cinema?.querySelector(".rkbo-combo-roulette-track");
 const winnerEl=cinema?.querySelector(".rkbo-combo-roulette-tile.is-winner");
 if(!windowEl||!track||!winnerEl||cinemaSkip||reducedMotion())return;
 const destination=Math.round(windowEl.clientWidth/2-winnerEl.offsetLeft-winnerEl.offsetWidth/2);
 // No random stopping position: the exact server-awarded card is always centered.
 track.style.transition="none";
 track.style.transform="translate3d(0,0,0)";
 void track.offsetWidth;
 root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>{
  if(!cinema?.hidden&&cinema.querySelector(".rkbo-combo-roulette-track")===track){
   track.style.transition="transform 4900ms cubic-bezier(.08,.64,.12,1)";
   track.style.transform="translate3d("+destination+"px,0,0)";
  }
 }));
 await cinematicPause(5080);
 if(cinemaSkip)return;
 cinema.classList.add("is-landed");
 await cinematicPause(850);
}
async function standardCinematic(winner){
 const tier=winner.grade==="골드"?"gold":"ordinary";
 cinematicScreen("조합 결과 공개",'<div class="rkbo-combo-flip-scene tier-'+tier+'">'+
  '<div class="rkbo-combo-flip-card"><span>RKBO</span><strong>✦</strong>'+
  '<small>'+esc(winner.grade)+'</small></div></div>',
  esc(winner.season)+"차 "+esc(winner.grade)+" 카드 등장!");
 if(!cinemaSkip&&!reducedMotion()){
  root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>{
   if(cinema?.querySelector(".rkbo-combo-flip-scene"))cinema.classList.add("is-revealing");
  }));
 }
 await cinematicPause(1050);
}

function resultMarkup(){
 if(!result)return "";
 const p=result.result||{};
 return '<section class="rkbo-combo-success tier-'+(p.grade==="코랄"?"coral":p.grade==="다이아몬드"?"diamond":premiumGrades.has(p.grade)?"special":"regular")+'">'+
 '<div class="rkbo-combo-award"><small>⚾ COMBINATION RESULT</small><h3>🎉 '+esc(p.grade)+' 획득!</h3>'+
 '<strong>'+esc(p.season)+'차 '+esc(resultDisplayName||p.name)+'</strong><p>OVR '+esc(p.ovr)+' · 조합 점수 '+esc(result.points)+'</p>'+
 '<div class="rkbo-combo-winning-art">'+(resultArtwork||'<span>선수 카드 이미지 불러오는 중…</span>')+'</div>'+
 '<div class="rkbo-combo-actions"><button type="button" data-combo-detail="'+esc(p.cardId)+'">선수 카드 상세 보기</button>'+
 '<button type="button" data-combo-again>다시 조합하기</button></div></div></section>';
}
function historyMarkup(){
 return '<section class="rkbo-combo-history"><h3>📜 최근 카드 조합 기록</h3>'+
 (history.length?history.map(x=>'<div><span>'+
 new Date(x.created_at).toLocaleString("ko-KR")+' · '+esc(x.points)+'점</span>'+
 '<strong>'+esc(x.result_season)+'차 · '+esc(x.result_grade)+'</strong>'+
 '<button type="button" data-combo-history-detail="'+esc(x.result_card_id)+'">카드 보기</button></div>').join(""):
 '<p>아직 조합 기록이 없어.</p>')+'</section>';
}
function render(){
 if(!dialog)return;
 const prevScroll=dialog.scrollTop;
 const listScroll=dialog.querySelector(".rkbo-combo-candidates")?.scrollTop||0;
 dialog.innerHTML='<header class="rkbo-combo-header"><div><small>RKBO · CARD COLLECTION</small>'+
 '<h2>🧬 카드 조합</h2><p>중복 카드 3~5장 → 새로운 선수 카드 1장</p></div>'+
 '<button type="button" data-combo-close aria-label="닫기">×</button></header>'+
 '<div class="rkbo-combo-content"><div class="rkbo-combo-rules">'+
 '<b>동일 차수는 그 차수 확정</b> · 혼합하면 등록된 시즌 랜덤 · 재료 점수가 높을수록 상위 등급 기대 상승.'+
 '<br>마지막 1장·MY TEAM 편성 카드·금테/프리즘·특수 등급 카드는 재료에서 제외해.</div>'+
 resultMarkup()+
 '<div class="rkbo-combo-layout"><section class="rkbo-combo-list"><h3>내 중복 선수 카드 <small>'+inventory.length+'종</small></h3>'+
 '<div class="rkbo-combo-filters"><select data-combo-filter-season>'+options()+'</select>'+
 '<select data-combo-filter-grade>'+gradeOptions()+'</select></div>'+
 '<input type="search" id="rkbo-combo-search" placeholder="선수 이름 검색" value="'+esc(search)+'" autocomplete="off">'+
 '<div class="rkbo-combo-candidates">'+(activeCards().length?activeCards().map(wrapCard).join(""):
 '<p class="rkbo-combo-hint">조건에 맞는 중복 카드가 없어. 카드팩에서 중복 카드를 모아 봐!</p>')+'</div></section>'+
 '<section class="rkbo-combo-config"><h3>조합할 카드 <small>'+selected.length+' / 5</small></h3>'+
 '<div class="rkbo-combo-slots">'+Array.from({length:5},(_,i)=>{
 const id=selected[i],p=id?selectionCard(id):null;
 return '<button type="button" data-combo-remove="'+i+'" class="'+(p?'filled':'empty')+'"'+(!p||busy?' disabled':'')+'>'+
 (p?'<small>'+esc(p.grade)+' · '+esc(p.season)+'차</small><strong>'+esc(p.name)+'</strong><span>× 제거</span>':
 '<span class="rkbo-combo-plus">+</span><small>재료 '+(i+1)+'</small>')+'</button>';
 }).join("")+'</div>'+
 '<div class="rkbo-combo-points"><span>조합 점수</span><strong>'+esc(quote?.points??scorePreview())+'</strong></div>'+
 '<h3>🎲 결과 등급 확률 <small>공개</small></h3>'+percentMarkup()+
 '<button type="button" class="rkbo-combo-submit" data-combo-submit'+(busy||quoteLoading||!quote||selected.length<3||selected.length>5?' disabled':'')+'>'+
 (busy?'서버에서 조합 중…':'⚾ 카드 '+selected.length+'장 조합하기')+'</button>'+
 '<p class="rkbo-combo-note">확인 후 카드가 즉시 차감되고 결과 카드 1장이 지급돼. 이 작업은 되돌릴 수 없어.</p>'+
 '<p class="rkbo-combo-status" id="rkbo-combo-status" role="status">'+esc(notice)+'</p></section></div>'+
 historyMarkup()+'</div>';
 dialog.scrollTop=prevScroll;
 const list=dialog.querySelector(".rkbo-combo-candidates");if(list)list.scrollTop=listScroll;
}
async function loadData(){
 loading=true;msg("내 중복 카드와 조합 기록을 읽는 중…");
 try{
  const {c,user}=await context();
  const [inventoryResult,hist]=await Promise.all([
   c.rpc("rkbo_combo_inventory"),
   c.from("rkbo_combo_history").select("id,result_card_id,result_grade,result_season,points,created_at")
    .eq("user_id",user.id).order("created_at",{ascending:false}).limit(15)
  ]);
  if(inventoryResult.error)throw Error(inventoryResult.error.message);
  if(hist.error)throw Error(hist.error.message);
  inventory=inventoryResult.data||[];history=hist.data||[];
  // Reuse the same official Korean-name resolver used by the player archive.
  if(inventory.length&&root.RKBONameMap?.apply){
   const names=inventory.map(p=>({id:p.card_id,season:p.season,team:String(p.card_id).split("-")[1],
    name:p.name,rawName:p.name,englishName:p.name}));
   try{
    await root.RKBONameMap.apply(names,null);
    names.forEach((p,i)=>{inventory[i].name=p.name});
   }catch(e){console.warn("[RKBO combo] Name lookup failed; original names retained",e)}
  }
  msg("수집한 중복 카드만 재료 목록에 표시돼.");
 }catch(error){msg("카드 조합 불러오기 실패: "+error.message)}
 finally{loading=false;render()}
}
async function updateQuote(){
 const id=++quoteIndex;
 if(selected.length<3){quote=null;quoteError="";quoteLoading=false;render();return}
 quoteLoading=true;quote=null;quoteError="";render();
 try{
  const {c}=await context();
  const {data,error}=await c.rpc("rkbo_combo_quote",{p_card_ids:selected.slice()});
  if(error)throw Error(error.message);
  if(id!==quoteIndex)return;
  quote=data;quoteError="";
 }catch(error){if(id!==quoteIndex)return;quote=null;quoteError=error.message}
 finally{if(id===quoteIndex){quoteLoading=false;render()}}
}
function mutate(action,idOrIndex){
 if(busy)return;
 if(action==="add"){
  const p=selectionCard(idOrIndex);
  if(!inventory.some(v=>v.card_id===idOrIndex)||count(idOrIndex)>=p.available||selected.length>=5)return;
  selected.push(idOrIndex);
 }else if(action==="remove"){
  const index=Number(idOrIndex);
  if(!Number.isInteger(index)||index<0||index>=selected.length)return;
  selected.splice(index,1);
 }
 result=null;pendingRequest=null;notice="";
 updateQuote();
}
async function combine(){
 if(busy||selected.length<3||selected.length>5||!quote||quoteLoading)return;
 const ingredients=selected.slice(),materials=ingredients.map(selectionCard),rated=quote;
 const seasonMsg=rated.mode==="same"?rated.season+"차 고정":"혼합 시즌 랜덤";
 if(!root.confirm("카드 "+ingredients.length+"장("+rated.points+"점)을 소모하고 새로운 카드 1장을 얻을까요?\n"+
 seasonMsg+" · 결과가 낮은 등급일 수도 있으며 조합 후 되돌릴 수 없습니다."))return;
 busy=true;quoteIndex++;render();
 const requestId=pendingRequest||root.crypto?.randomUUID?.();
 if(!requestId){busy=false;msg("보안 연결에서 요청 ID를 생성할 수 없습니다.");render();return}
 pendingRequest=requestId;cinemaSkip=reducedMotion();
 let awarded=null;
 try{
  // Start the RPC at once, while the material cards visually converge.
  // Suppress early promise rejections until the merge animation ends.
  const rpcTask=context().then(({c})=>c.rpc("rkbo_combine_cards",
   {p_card_ids:ingredients,p_request_id:requestId}))
   .then(value=>({value}),error=>({error}));
  await gatherCinematic(materials);
  const response=await rpcTask;
  if(response.error)throw response.error;
  if(response.value.error)throw Error(response.value.error.message);
  const data=response.value.data;
  if(!data?.result?.cardId)throw Error("조합 결과를 확인할 수 없습니다.");
  awarded=data;resultArtwork="";resultDisplayName="";
  // This only loads existing local card assets; it never performs another draw.
  await loadWinningArt(data.result.cardId);
  try{
   if(premiumGrades.has(data.result.grade))await rouletteCinematic(data.result);
   else await standardCinematic(data.result);
  }catch(animationError){
   console.warn("[RKBO combination] Cosmetic effect failed",animationError);
  }
  result=data;selected=[];quote=null;quoteLoading=false;pendingRequest=null;
  msg(data.replayed?"저장된 조합 결과를 복구했어.":"✅ 조합 성공! 새 카드가 수집 도감에 지급됐어.");
 }catch(e){
  if(awarded){
   result=awarded;selected=[];quote=null;pendingRequest=null;
   msg("✅ 조합은 정상 지급됐어. 연출 중 문제가 발생했지만 카드는 수집 도감에서 확인할 수 있어.");
  }else{
   // Preserve the same UUID so that a lost response cannot double-spend inventory.
   quote=rated;quoteLoading=false;
   msg("조합 확인 실패: "+e.message+" · 동일 요청으로 다시 시도하면 중복 차감되지 않아.");
  }
 }finally{
  cinematicStop();busy=false;render();
 }
 if(awarded){
  root.dispatchEvent(new Event("rkbo-collection-updated"));
  await loadData();
 }
}
async function loadWinningArt(cardId){
 try{
  const season=Number(String(cardId||"").split("-")[0]);
  if(!Number.isInteger(season)||season<1||season>60)return;
  let cards=artworkCache.get(season);
  if(!cards){
   if(season===60)cards=(root.RKBOSeason?.builtin?.()||[]).map(p=>({...p}));
   else{
    const response=await fetch("./data/seasons/"+season+".json",{cache:"force-cache"});
    if(!response.ok)throw Error("경기 시즌 카드 데이터를 불러올 수 없습니다");
    const data=await response.json();
    cards=(Array.isArray(data)?data:data.players||[]).map(p=>({...p}));
   }
   await root.RKBONameMap?.apply?.(cards,null);
   root.RKBOTeamBrand?.decorate?.(cards);
   cards=root.RKBOCardSpecials?.addTo?.(cards,season)||cards;
   artworkCache.set(season,cards);
  }
  const player=cards.find(p=>p.id===cardId);
  if(!player)return;
  resultDisplayName=player.name||"";
  resultArtwork=root.RKBOCardView?.render?.(player,true)||"";
  if(result?.result?.cardId===cardId)render();
 }catch(e){console.warn("[RKBO combo] Award card art",e);
  resultArtwork='<span>선수 카드 이미지는 상세보기에서 확인해 줘.</span>';
  if(result?.result?.cardId===cardId)render();
 }
}
async function detail(cardId){
 const n=Number(String(cardId||"").split("-")[0]);
 if(!(n>=1&&n<=60))return;
 try{
  if(!root.RKBOSeason?.select||!root.RKBOSeason?.showPlayer)throw Error("선수 도감이 준비되지 않았습니다");
  if(root.RKBOSeason.current?.()!==n)await root.RKBOSeason.select(n);
  root.RKBOSeason.showPlayer(cardId);
 }catch(e){msg("상세 카드 열기 실패: "+e.message)}
}
function close(){if(!overlay)return;if(busy){skipCinematic();return}cinematicStop();overlay.hidden=true;document.body.classList.remove("rkbo-combo-open")}
function open(){
 if(busy){if(overlay)overlay.hidden=false;return}
 if(!overlay)init();
 overlay.hidden=false;document.body.classList.add("rkbo-combo-open");
 selected=[];quote=null;result=null;resultArtwork="";resultDisplayName="";quoteLoading=false;quoteError="";notice="";
 filterSeason="all";filterGrade="all";search="";
 render();loadData();
}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const button=document.createElement("button");button.id="rkbo-combo-open";button.type="button";
 button.className="rkbo-combo-nav";button.textContent="🧬 카드 조합";button.addEventListener("click",open);
 const packButton=document.getElementById("rkbo-pack-open");
 if(packButton)packButton.after(button);else nav?.prepend(button);
 overlay=document.createElement("div");overlay.id="rkbo-combo-overlay";overlay.className="rkbo-combo-overlay";overlay.hidden=true;
 overlay.innerHTML='<div class="rkbo-combo-dialog" role="dialog" aria-modal="true" aria-label="RKBO 카드 조합"></div>';
 document.body.appendChild(overlay);dialog=overlay.querySelector(".rkbo-combo-dialog");
 cinema=document.createElement("div");cinema.className="rkbo-combo-cinema";cinema.hidden=true;
 cinema.setAttribute("role","region");cinema.setAttribute("aria-label","카드 조합 연출");overlay.appendChild(cinema);
 cinema.addEventListener("click",e=>{if(e.target.closest("[data-combo-fx-skip]"))skipCinematic()});
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 dialog.addEventListener("click",async e=>{
  const add=e.target.closest("[data-combo-add]");if(add){mutate("add",add.dataset.comboAdd);return}
  const remove=e.target.closest("[data-combo-remove]");if(remove){mutate("remove",remove.dataset.comboRemove);return}
  if(e.target.closest("[data-combo-submit]")){await combine();return}
  if(e.target.closest("[data-combo-close]")){close();return}
  if(e.target.closest("[data-combo-again]")){result=null;render();return}
  const card=e.target.closest("[data-combo-detail],[data-combo-history-detail]");
  if(card){await detail(card.dataset.comboDetail||card.dataset.comboHistoryDetail);return}
 });
 dialog.addEventListener("change",e=>{
  if(e.target.matches("[data-combo-filter-season]")){filterSeason=e.target.value;render()}
  if(e.target.matches("[data-combo-filter-grade]")){filterGrade=e.target.value;render()}
 });
 dialog.addEventListener("input",e=>{
  if(e.target.id==="rkbo-combo-search"){
   search=e.target.value;
   const pos=e.target.selectionStart;render();
   const input=$("#rkbo-combo-search");if(input){input.focus();input.setSelectionRange(pos,pos)}
  }
 });
 root.document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.RKBOCombination={open,close};
root.document.addEventListener("DOMContentLoaded",init);
})(window);

