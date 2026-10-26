/* RKBO Card Combination 1.0
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
let quoteIndex=0,pendingRequest=null;
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
 return '<div class="rkbo-combo-odds">'+grades.map(g=>{
  const rate=Number(odds[g]||0);
  return '<div class="rkbo-combo-odd"><div><span>'+esc(g)+'</span><strong>'+fmt(rate)+'%</strong></div>'+
   '<div class="rkbo-combo-meter"><i style="width:'+Math.max(0,Math.min(100,rate))+'%;background:'+hue[g]+'"></i></div></div>';
 }).join("")+'</div>'+
 '<p class="rkbo-combo-note">'+(quote.mode==="same"
 ?'🎯 '+esc(quote.season)+'차 시즌 카드만 나와.'
 :'🎲 서버에 등록된 '+(quote.eligibleSeasons||[]).map(n=>esc(n)+'차').join(" · ")+' 중 시즌이 균등 무작위로 결정돼.')+
 ' 확률은 실제 추첨 분포야. 투입 카드보다 낮은 등급도 나올 수 있어.</p>';
}
function resultMarkup(){
 if(!result)return "";
 const p=result.result||{};
 return '<section class="rkbo-combo-success">'+
 '<div class="rkbo-combo-award"><small>⚾ COMBINATION RESULT</small><h3>🎉 '+esc(p.grade)+' 획득!</h3>'+
 '<strong>'+esc(p.season)+'차 '+esc(p.name)+'</strong><p>OVR '+esc(p.ovr)+' · 조합 점수 '+esc(result.points)+'</p>'+
 '<div><button type="button" data-combo-detail="'+esc(p.cardId)+'">선수 카드 상세 보기</button>'+
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
 '<b>동일 차수는 그 차수 확정</b> · 혼합하면 등록된 시즌 랜덤 · 등급이 내려갈 수도 있어.'+
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
 const ingredients=selected.slice(),rated=quote;
 const seasonMsg=rated.mode==="same"?rated.season+"차 고정":"혼합 시즌 랜덤";
 if(!root.confirm("카드 "+ingredients.length+"장("+rated.points+"점)을 소모하고 새로운 카드 1장을 얻을까요?\n"+
 seasonMsg+" · 결과가 낮은 등급일 수도 있으며 조합 후 되돌릴 수 없습니다."))return;
 busy=true;quoteIndex++;render();
 const requestId=pendingRequest||root.crypto?.randomUUID?.();
 if(!requestId){busy=false;msg("보안 연결에서 요청 ID를 생성할 수 없습니다.");render();return}
 pendingRequest=requestId;
 try{
  const {c}=await context();
  const {data,error}=await c.rpc("rkbo_combine_cards",{p_card_ids:ingredients,p_request_id:requestId});
  if(error)throw Error(error.message);
  if(!data?.result?.cardId)throw Error("조합 결과를 확인할 수 없습니다.");
  result=data;pendingRequest=null;selected=[];quote=null;quoteLoading=false;
  msg(data.replayed?"저장된 조합 결과를 복구했어.":"✅ 조합 성공! 새 카드가 수집 도감에 지급됐어.");
  render();
  root.dispatchEvent(new Event("rkbo-collection-updated"));
  try{await loadData()}catch(e){console.warn("[RKBO combine] inventory refresh",e)}
 }catch(e){
  msg("조합 확인 실패: "+e.message+" · 동일 요청으로 다시 시도하면 중복 차감되지 않아.");
  // Keep selection/requestId until manually retried. Avoid misleading users
  // if a server commit succeeded but its HTTP response was lost.
  quote=rated;quoteLoading=false;render();
 }finally{busy=false;render()}
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
function close(){if(!overlay)return;overlay.hidden=true;document.body.classList.remove("rkbo-combo-open")}
function open(){
 if(!overlay)init();
 overlay.hidden=false;document.body.classList.add("rkbo-combo-open");
 selected=[];quote=null;result=null;quoteLoading=false;quoteError="";notice="";
 filterSeason="all";filterGrade="all";search="";
 render();loadData();
}
function init(){
 if(overlay)return;
 overlay=document.createElement("div");overlay.id="rkbo-combo-overlay";overlay.className="rkbo-combo-overlay";overlay.hidden=true;
 overlay.innerHTML='<div class="rkbo-combo-dialog" role="dialog" aria-modal="true" aria-label="RKBO 카드 조합"></div>';
 document.body.appendChild(overlay);dialog=overlay.querySelector(".rkbo-combo-dialog");
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
