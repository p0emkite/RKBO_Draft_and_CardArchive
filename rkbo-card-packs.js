/* RKBO CARD PACKS v1. Server-backed draws and private collection.
 * The browser never chooses cards, determines drops or writes inventory. */
(function(root){"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const BASE_RARITIES=["브론즈","실버","골드","코랄","다이아몬드"];
const SPECIAL_RARITIES=["신인왕","드림","나눔","MVP","베스트릴리프"];
const RARITIES=[...BASE_RARITIES,...SPECIAL_RARITIES];
const PRIORITIES={"브론즈":0,"실버":1,"골드":2,"코랄":3,"다이아몬드":4,"신인왕":5,"드림":5,"나눔":5,"MVP":5,"베스트릴리프":5};
const displayGrade=g=>g;
let overlay=null,dialog=null,tab="pack",season=60,opening=false,draws=[],cursor=0,packResult=null,revealToken=0;
let owned=new Map(),catalog=[],packsState=null,history=[],cache=new Map(),collectionFilter="all",collectionGrade="all",collectionLimit=36;
let packChoices=[],adminAuthorized=false,adminSeason=60,adminBusy=false;
const PACK_COOLDOWN_MS=5500;
let cooldownUntil=0,cooldownTimer=null;
function remainingCooldownMs(){return Math.max(0,cooldownUntil-Date.now())}
function beginCooldown(ms=PACK_COOLDOWN_MS){cooldownUntil=Math.max(cooldownUntil,Date.now()+ms)}
function absorbServerCooldown(lastOpened){
 const timestamp=Date.parse(lastOpened||"");
 if(!Number.isFinite(timestamp))return;
 const remaining=timestamp+PACK_COOLDOWN_MS-Date.now();
 if(remaining>0&&remaining<=10000)cooldownUntil=Math.max(cooldownUntil,Date.now()+remaining);
}
function cooldownLabel(ms){return (Math.ceil(ms/100)/10).toFixed(1)+"초"}
function updateCooldownUi(){
 if(!overlay||overlay.hidden||tab!=="pack"||draws.length)return;
 const remaining=remainingCooldownMs(),ready=remaining<=0;
 const cover=$(".rkbo-pack-cover"),primary=$(".rkbo-pack-primary");
 for(const button of [cover,primary])if(button)button.disabled=opening||!ready;
 if(!opening){
  if(primary)primary.textContent=ready?"⚾ 카드팩 5장 개봉":"⏳ "+cooldownLabel(remaining)+" 후 개봉 가능";
  const caption=cover?.querySelector("span");
  if(caption)caption.textContent=ready?"터치해서 카드팩 개봉":"다음 카드팩까지 "+cooldownLabel(remaining);
 }
 const note=$("#rkbo-pack-cooldown-note");
 if(note)note.textContent=ready?"✅ 다음 카드팩 개봉 가능":
  ("⏳ "+cooldownLabel(remaining)+" 후 다시 개봉할 수 있어요. 버튼은 자동으로 활성화됩니다.");
}
function startCooldownClock(){
 if(cooldownTimer!==null)return;
 cooldownTimer=setInterval(()=>{
  if(!overlay||overlay.hidden){stopCooldownClock();return}
  updateCooldownUi();
 },100);
}
function stopCooldownClock(){if(cooldownTimer!==null){clearInterval(cooldownTimer);cooldownTimer=null}}

const defaultPackArt="https://raw.githubusercontent.com/p0emkite/RKBO-/main/pack.webp";
const packFor=n=>packChoices.find(p=>p.season===n);
const packArt=()=>packFor(season)?.image_url||defaultPackArt;
const $=selector=>dialog?.querySelector(selector);
const client=()=>root.RKBOOnline?.getClient?.();
async function context(){
 if(!root.RKBOOnline?.getClient)throw Error("RKBO ONLINE 연결이 필요합니다.");
 const c=await client(),{data,error}=await c.auth.getUser();
 if(error||!data?.user)throw Error("Google 계정으로 로그인하면 카드팩과 수집 도감을 이용할 수 있습니다.");
 return {c,user:data.user};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function message(s){const el=$("#rkbo-pack-status");if(el)el.textContent=s}
async function playersFor(n){
 if(cache.has(n))return cache.get(n);
 let list;
 if(n===60)list=(root.RKBOSeason?.builtin?.()||[]).map(p=>({...p}));
 else {
  const response=await fetch("./data/seasons/"+n+".json",{cache:"force-cache"});
  if(!response.ok)throw Error(n+"차 시즌 선수 카드를 불러오지 못했어요.");
  const data=await response.json();list=(Array.isArray(data)?data:data.players||[]).map(p=>({...p}));
 }
 if(!list.length)throw Error(n+"차 시즌 카드 데이터가 비어 있어요.");
 try{await root.RKBONameMap?.apply?.(list,null)}catch(e){console.warn("[RKBO packs] name map",e)}
 try{root.RKBOTeamBrand?.decorate?.(list)}catch(e){console.warn("[RKBO packs] team metadata",e)}
 list=root.RKBOCardSpecials?.addTo?.(list,n)||list;
 const map=new Map(list.map(p=>[p.id,p]));cache.set(n,map);return map;
}
async function playerFor(cardId){
 const n=Number(String(cardId||"").split("-")[0]);
 const map=await playersFor(n);
 return map.get(cardId)||null;
}
function renderPlayer(p){
 if(!p)return '<div class="rkbo-pack-card-missing">공식 카드 데이터를 불러오지 못했어요.</div>';
 try{return root.RKBOCardView?.render?.(p,true)||'<b>'+esc(p.name)+'</b>'}
 catch(e){console.warn("[RKBO packs] render",e);return '<div class="rkbo-pack-card-missing">'+esc(p.name)+'</div>'}
}
function loginView(error){
 return '<div class="rkbo-pack-login"><div class="rkbo-pack-lock-icon">🔐</div><h3>이 브라우저에서 Google 로그인이 필요합니다</h3><p>'+esc(error||"Google 로그인 후 카드팩을 이용할 수 있습니다.")+'</p>'+ 
 '<p class="rkbo-pack-guest-warning">로그인하지 않으면 카드팩을 개봉할 수 없으며, 카드 획득·수집 기록도 저장되지 않습니다.</p>'+ 
 '<button type="button" data-pack="login">Google 로그인</button></div>';
}
function frame(){
 dialog.innerHTML='<header class="rkbo-pack-header"><div><small>TRT | Tsuki&#39;s RKBO Together</small><h2>🎫 RKBO CARD PACK</h2><p>5장 개봉 · 50팩 천장</p></div><button type="button" data-pack="close" aria-label="닫기">×</button></header>'+
 '<nav class="rkbo-pack-tabs"><button data-pack-tab="pack">🎁 카드팩</button><button data-pack-tab="collection">📚 내 수집 도감</button><button data-pack-tab="history">📜 개봉 기록</button>'+ (adminAuthorized?'<button data-pack-tab="admin">⚙️ 제작자 팩 관리</button>':'')+'</nav>'+
 '<div class="rkbo-pack-body" id="rkbo-pack-body"></div><p class="rkbo-pack-status" id="rkbo-pack-status" role="status"></p>';
 dialog.querySelectorAll("[data-pack-tab]").forEach(b=>b.classList.toggle("active",b.dataset.packTab===tab));
}
function renderPack(){
 const body=$("#rkbo-pack-body");
 if(!body)return;
 if(!packChoices.some(p=>p.active&&p.season===season)){
  body.innerHTML='<p class="rkbo-pack-loading">현재 공개된 카드팩이 없어요. 제작자가 팩을 활성화하면 개봉할 수 있어요.</p>';
  return;
 }
 body.innerHTML='<section class="rkbo-pack-summary" id="rkbo-pack-summary"><div><small>총 개봉 팩</small><strong>'+(packsState?.total_packs||0)+'</strong></div>'+
 '<div><small>연속 다이아·특수 미획득</small><strong>'+(packsState?.no_diamond_streak||0)+'/49</strong></div>'+
 '<div><small>보유 종류</small><strong>'+owned.size+'종</strong></div></section>'+
 '<div class="rkbo-pack-odds"><b>'+esc(packFor(season)?.label||season+'차 카드팩')+'</b><span>브론즈 50% · 실버 32% · 골드 16% · 코랄 1% · 다이아몬드 0.5% · 특수등급 0.5%</span>'+
 '</div>'+
 '<div class="rkbo-pack-season-toggle"><label for="rkbo-pack-season">카드팩 선택</label><select id="rkbo-pack-season" data-pack-season>'+
 packChoices.filter(p=>p.active).map(p=>'<option value="'+p.season+'"'+(p.season===season?' selected':'')+'>'+esc(p.label)+'</option>').join("")+'</select></div>'+ 
 '<div class="rkbo-pack-stage" id="rkbo-pack-stage" '+(draws.length?'data-pack="next" title="터치해서 다음 카드 공개"':'')+'><div class="rkbo-pack-aura"></div>'+
 (draws.length?'<div id="rkbo-pack-reveal"></div>':
  '<button type="button" class="rkbo-pack-cover" data-pack="open"><img src="'+esc(packArt())+'" alt="RKBO 카드팩 포장" onerror="this.onerror=null;this.src=\'https://raw.githubusercontent.com/p0emkite/RKBO-/main/pack.webp\'">'+
  '<span>터치해서 카드팩 개봉</span></button>')+'</div>'+
 '<div class="rkbo-pack-controls"><button type="button" data-pack="'+(draws.length?"next":"open")+'" class="rkbo-pack-primary" '+(opening||!draws.length&&remainingCooldownMs()>0?'disabled':'')+'>'+
 (draws.length?(cursor<draws.length?"다음 카드 공개 ("+(cursor+1)+"/5)":"결과 확인"):"⚾ 카드팩 5장 개봉")+'</button>'+
 '<p class="rkbo-pack-cooldown-note" id="rkbo-pack-cooldown-note" role="status" aria-live="off"></p></div>'+
 '';
 if(draws.length)showCurrentReveal();
 else updateCooldownUi();
}

async function savePackSharePNG(btn){
 const old=btn.textContent;btn.disabled=true;btn.textContent="PNG 제작 중…";
 try{
  if(!packResult?.draws||packResult.draws.length!==5)throw Error("먼저 5장을 모두 공개해 주세요.");
  if(!root.RKBOCardExport?.make)throw Error("카드 이미지 생성기를 찾을 수 없어요.");
  if(document.fonts?.ready)await document.fonts.ready;
  const roster=await playersFor(packResult.season||season);
  const out=document.createElement("canvas");out.width=1600;out.height=1540;
  const x=out.getContext("2d");if(!x)throw Error("이미지 캔버스를 사용할 수 없어요.");
  const bg=x.createLinearGradient(0,0,1600,1540);
  bg.addColorStop(0,"#203c60");bg.addColorStop(.6,"#101d32");bg.addColorStop(1,"#15152d");
  x.fillStyle=bg;x.fillRect(0,0,1600,1540);
  x.strokeStyle="#a7b4ce80";x.lineWidth=3;x.strokeRect(24,24,1552,1492);
  x.textAlign="center";x.fillStyle="#f4d391";x.font="900 26px system-ui,sans-serif";
  x.fillText("RKBO ONLINE · CARD PACK RESULT",800,76);
  x.fillStyle="#fff5e2";x.font="900 60px system-ui,sans-serif";
  x.fillText("카드팩 개봉 결과",800,152);
  x.fillStyle="#adbed5";x.font="700 27px system-ui,sans-serif";
  x.fillText((packResult.season||season)+"차 · "+packResult.packNumber+"번째 팩 · 5장",800,198);
  const w=377,h=528,gap=37,coords=[
   [(1600-3*w-2*gap)/2,232],[(1600-3*w-2*gap)/2+w+gap,232],[(1600-3*w-2*gap)/2+2*(w+gap),232],
   [(1600-2*w-gap)/2,795],[(1600-2*w-gap)/2+w+gap,795]
  ];
  for(let i=0;i<5;i++){
   const v=packResult.draws[i],player=roster.get(v.cardId);
   if(!player)throw Error("선수 카드 정보를 찾지 못했어요: "+v.cardId);
   const card=await root.RKBOCardExport.make(player),[left,top]=coords[i];
   x.save();x.shadowColor="#000b";x.shadowBlur=22;x.shadowOffsetY=10;
   x.drawImage(card,left,top,w,h);x.restore();
   if(v.isNew){
    x.fillStyle="#ffdb8c";x.fillRect(left+w-91,top+9,81,30);
    x.fillStyle="#102035";x.font="900 18px system-ui,sans-serif";x.fillText("NEW!",left+w-50,top+30);
   }
  }
  x.fillStyle="#9db4ce";x.font="800 26px system-ui,sans-serif";
  x.fillText("RKBO ONLINE · MY CARD PACK",800,1460);
  const png=await new Promise(done=>out.toBlob(done,"image/png"));
  if(!png)throw Error("PNG를 만들지 못했어요.");
  const url=URL.createObjectURL(png),a=document.createElement("a");
  a.href=url;a.download="RKBO_"+(packResult.season||season)+"차_"+packResult.packNumber+"팩.png";
  document.body.append(a);a.click();a.remove();
  root.setTimeout(()=>URL.revokeObjectURL(url),12000);
  message("📸 결과 이미지 저장이 완료되었습니다!");
 }catch(e){message("이미지 저장 실패: "+e.message);console.warn("[RKBO share]",e)}
 finally{btn.disabled=false;btn.textContent=old}
}

function renderResult(){
 const body=$("#rkbo-pack-body");if(!body||!packResult)return;
 const vals=packResult.draws||[];
 body.innerHTML='<div class="rkbo-pack-results"><h3>🎉 '+packResult.packNumber+'번째 카드팩 개봉 완료!</h3>'+
 '<p>'+(packResult.hitDiamond?'💎 다이아몬드 카드를 획득했습니다!':vals.some(v=>SPECIAL_RARITIES.includes(v.grade))?'🏆 특수등급 카드를 획득했습니다!':'다음 팩에는 더 좋은 카드가 나올 수 있습니다.')+'</p>'+
 '<div class="rkbo-pack-result-grid">'+vals.map((v,i)=>'<button type="button" class="rkbo-pack-result-tile rarity-'+esc(v.grade)+'" data-pack-detail="'+esc(v.cardId)+'" title="선수 상세정보 보기"><span>'+esc(displayGrade(v.grade))+'</span>'+
 '<strong>'+esc(cache.get(Number(v.cardId.split("-")[0]))?.get(v.cardId)?.name||v.name)+'</strong>'+
 '<small>OVR '+v.ovr+' · '+(v.isNew?"NEW!":"중복 ×"+v.quantity)+'</small><em class="rkbo-pack-detail-hint">선수 카드 자세히 보기</em></button>').join("")+'</div>'+
 '<div class="rkbo-pack-result-buttons"><button type="button" data-pack="share">📸 5장 결과 PNG 저장</button><button type="button" data-pack="reset">🎁 다음 카드팩</button><button type="button" data-pack="collection">📚 내 도감 보기</button></div></div>';
}
function showCurrentReveal(){
 const target=$("#rkbo-pack-reveal");if(!target)return;
 const draw=draws[cursor-1];
 if(!draw){target.innerHTML='<div class="rkbo-pack-ready">팩 개봉 완료! 결과를 확인해줘.</div>';return}
 const p=cache.get(Number(draw.cardId.split("-")[0]))?.get(draw.cardId);
 const special=PRIORITIES[draw.grade]>=3;
 const card=renderPlayer(p),front=special?'<div class="rkbo-pack-flip">'+
  '<div class="rkbo-pack-flip-inner"><div class="rkbo-pack-flip-back"><span>RKBO</span><strong>LEGENDARY CARD</strong><small>✨ CLICK TO REVEAL ✨</small></div>'+
  '<div class="rkbo-pack-flip-front">'+card+'</div></div></div>':card;
 target.innerHTML='<div class="rkbo-pack-reveal-heading rarity-'+esc(draw.grade)+'"><span>'+(cursor)+'/5</span><strong>'+esc(displayGrade(draw.grade))+'</strong>'+
 '<span>'+(draw.isNew?'✨ NEW':'중복 카드 ×'+draw.quantity)+'</span></div>'+
 '<div class="rkbo-pack-hover-shell '+(special?'is-floating':'')+'"><div class="rkbo-pack-revealed-card '+(special?'is-'+(SPECIAL_RARITIES.includes(draw.grade)?"special":draw.grade==="코랄"?"coral":"diamond"):'')+'">'+front+'</div></div>';
}
async function showNext(){
 if(opening)return;
 if(cursor>=draws.length){draws=[];cursor=0;renderResult();return}
 opening=true;
 const nextButton=$(".rkbo-pack-controls button");if(nextButton)nextButton.disabled=true;
 const token=++revealToken;
 const value=draws[cursor],player=cache.get(Number(value.cardId.split("-")[0]))?.get(value.cardId);
 const stage=$("#rkbo-pack-stage"),special=PRIORITIES[value.grade]>=3;
 if(special&&stage){
  let logo="";
  try{logo=player?root.RKBOTeamBrand?.logo?.(player)||"":""}catch{}
  const steps=[
   {html:'<img src="'+esc(logo)+'" alt="팀 심볼" onerror="this.style.display=\'none\'">',duration:950},
   {html:'<div>'+esc(player?.pos||value.pos)+'</div>',duration:900},
   {html:'<strong>'+esc(displayGrade(value.grade))+'</strong>',duration:1050}
  ];
  for(const step of steps){
   if(token!==revealToken||overlay.hidden){opening=false;return}
   stage.innerHTML='<div class="rkbo-pack-prelude rarity-'+esc(value.grade)+'">'+step.html+'</div>';
   await wait(step.duration);
  }
 }
 if(token!==revealToken||overlay.hidden){opening=false;return}
 cursor++;
 const body=$("#rkbo-pack-body");
 const target=body?.querySelector("#rkbo-pack-stage");
 if(target)target.innerHTML='<div id="rkbo-pack-reveal"></div>';
 showCurrentReveal();
 if(special){
  await wait(1650); // Complete the 3D back-to-front animation before accepting taps.
  if(token!==revealToken||overlay.hidden){opening=false;return}
 }
 const btn=body?.querySelector(".rkbo-pack-controls button");
 if(btn){btn.disabled=false;btn.textContent=cursor<5?"다음 카드 공개 ("+(cursor+1)+"/5)":"5장 결과 확인"}
 opening=false;
}
async function openPack(){
 if(opening||draws.length)return;
 if(remainingCooldownMs()>0){updateCooldownUi();return}
 opening=true;message("서버에서 카드 5장을 추첨하는 중…");
 const button=$('[data-pack="open"]');if(button)button.disabled=true;
 const priorCount=packsState?.total_packs??null;
 const requestedSeason=season;
 try{
  const {c}=await context();
  const {data,error}=await c.rpc("rkbo_open_card_pack",{p_season:requestedSeason});
  if(error)throw Error(error.message);
  if(!data||!Array.isArray(data.draws)||data.draws.length!==5)throw Error("서버 개봉 응답을 확인하지 못했습니다.");
  beginCooldown();
  // Treat the committed draw as successful even if rendering or inventory refresh fails.
  packResult=data;draws=data.draws;cursor=0;
  message("카드팩 개봉에 성공했습니다. 카드를 차례로 공개합니다.");
  try{await Promise.all([playersFor(requestedSeason),refreshStats()])}
  catch(e){console.warn("[RKBO packs] post-open display refresh",e)}
  try{root.dispatchEvent(new CustomEvent("rkbo-pack-opened",{detail:{season:data.season,draws:data.draws}}))}
  catch(e){console.warn("[RKBO packs] post-open event",e)}
  renderPack();opening=false;
  await showNext();
 }catch(e){
  opening=false;
  if(draws.length){message("✅ 카드 5장 개봉이 완료되었습니다. 결과를 확인해 주세요.");renderPack();return}
  if(/5초 간격|다음 카드팩은 잠시 후/.test(String(e.message))){
   try{await refreshStats()}catch(refreshError){console.warn("[RKBO packs] cooldown refresh",refreshError)}
   if(remainingCooldownMs()<=0)beginCooldown(PACK_COOLDOWN_MS);
   renderPack();
   message("⏳ 아직 개봉 간격이 남아 있습니다. 카운트다운이 끝나면 다시 개봉할 수 있습니다.");
   return;
  }
  // A timed-out response can still represent a committed draw. Recover the
  // already-earned five cards from history rather than making another draw.
  try{
   const {c,user}=await context();
   const {data:state}=await c.from("rkbo_pack_state")
    .select("total_packs,last_open_at").eq("user_id",user.id).maybeSingle();
   if(state&&priorCount!==null&&Number(state.total_packs)>Number(priorCount)){
    const {data:record}=await c.from("rkbo_pack_history")
     .select("pack_number,season,draws").eq("user_id",user.id)
     .eq("pack_number",Number(state.total_packs)).maybeSingle();
    if(record&&Array.isArray(record.draws)&&record.draws.length===5){
     packResult={packNumber:record.pack_number,season:record.season,draws:record.draws,
      hitDiamond:record.draws.some(v=>v.grade==="다이아몬드"),recovered:true};
     draws=record.draws;cursor=0;beginCooldown();
     try{await Promise.all([playersFor(record.season),refreshStats()])}
     catch(refreshError){console.warn("[RKBO packs] recovery refresh",refreshError)}
     message("✅ 서버에서 이미 개봉된 카드 5장을 복구했습니다. 추가 개봉은 하지 않았습니다.");
     renderPack();await showNext();return;
    }
   }
  }catch(recoveryError){console.warn("[RKBO packs] ambiguous RPC recovery",recoveryError)}
  message("카드팩 개봉을 확인하지 못했습니다: "+e.message+" · 개봉 기록도 함께 확인해 주세요.");
  if(!draws.length){
   if(/로그인|JWT|Auth session missing|session.*missing/i.test(e.message))$("#rkbo-pack-body").innerHTML=loginView("휴대폰과 PC는 Google 로그인을 각각 진행해야 합니다. 계정은 동일하게 연결됩니다.");
   else renderPack();
  }
 }
}
async function openCardDetails(id){
 if(!packResult||!packResult.draws?.some(p=>p.cardId===id))return;
 const n=Number(String(id).split("-")[0]);
 if(!Number.isInteger(n)||n<1||n>60)return;
 const trigger=$('[data-pack-detail="'+id+'"]');
 if(trigger)trigger.disabled=true;
 try{
  const archive=root.RKBOSeason;
  if(!archive?.showPlayer||!archive?.select)throw Error("선수 도감 상세정보가 아직 준비되지 않았어요.");
  if(archive.current?.()!==n)await archive.select(n);
  archive.showPlayer(id);
 }catch(err){message("카드 상세정보를 열지 못했어요: "+err.message)}
 finally{if(trigger?.isConnected)trigger.disabled=false}
}
async function loadPackChoices(){
 const c=await root.RKBOOnline.getClient();
 const [result,administrator]=await Promise.all([
  c.from("rkbo_pack_settings").select("season,label,image_url,active").order("season",{ascending:false}),
  new URLSearchParams(location.search).get("admin")==="1"?
   c.rpc("rkbo_is_pack_admin"):Promise.resolve({data:false,error:null})
 ]);
 if(result.error)throw Error("카드팩 설정을 불러오지 못했습니다: "+result.error.message);
 packChoices=result.data||[];
 adminAuthorized=administrator.error?false:administrator.data===true;
 const active=packChoices.filter(p=>p.active);
 if(!active.some(p=>p.season===season))season=active[0]?.season||60;
}
async function refreshStats(){
 const {c,user}=await context();
 const [inventory,state]=await Promise.all([
  c.from("rkbo_card_inventory").select("card_id,quantity,gold_border,prism").eq("user_id",user.id),
  c.from("rkbo_pack_state").select("total_packs,no_diamond_streak,last_open_at").eq("user_id",user.id).maybeSingle()
 ]);
 if(inventory.error)throw Error(inventory.error.message);
 if(state.error)throw Error(state.error.message);
 owned=new Map((inventory.data||[]).map(v=>[v.card_id,v]));
 packsState=state.data||null;
 absorbServerCooldown(packsState?.last_open_at);
}
async function loadCollection(){
 const body=$("#rkbo-pack-body");if(!body)return;
 body.innerHTML='<p class="rkbo-pack-loading">도감 불러오는 중…</p>';
 try{
  const {c}=await context();
  const {data,error}=await c.from("rkbo_pack_cards").select("card_id,season,grade,name,team,position,ovr").eq("season",season).order("season",{ascending:false}).order("ovr",{ascending:false}).limit(1000);
  if(error)throw Error(error.message);
  catalog=data||[];
  await Promise.all([playersFor(season),refreshStats()]);
  renderCollection();
 }catch(e){body.innerHTML=loginView(e.message)}
}
function renderCollection(){
 const body=$("#rkbo-pack-body");if(!body)return;
 const filtered=catalog.filter(c=>(collectionFilter==="all"||collectionFilter==="owned"&&owned.has(c.card_id)||collectionFilter==="missing"&&!owned.has(c.card_id))
  &&(collectionGrade==="all"||c.grade===collectionGrade));
 const ownedTotal=catalog.filter(c=>owned.has(c.card_id)).length,all=catalog.length;
 body.innerHTML='<section class="rkbo-pack-collect-head"><h3>📚 '+season+'차 나의 카드 수집 도감</h3>'+
 '<strong>'+ownedTotal+' / '+all+'종 · '+(all?Math.round(ownedTotal/all*100):0)+'%</strong>'+
 '<p>미보유 카드는 잠금 표시됩니다. 기존 전체 선수 도감은 누구나 볼 수 있습니다.</p></section>'+
 '<div class="rkbo-pack-collect-controls">'+
 '<select data-pack-season aria-label="카드팩 시즌">'+packChoices.filter(p=>p.active).map(p=>'<option value="'+p.season+'"'+(p.season===season?' selected':'')+'>'+esc(p.label)+'</option>').join("")+'</select>'+
 '<select data-pack-filter aria-label="보유 여부"><option value="all" '+(collectionFilter==="all"?"selected":"")+'>전체 카드</option>'+
 '<option value="owned" '+(collectionFilter==="owned"?"selected":"")+'>보유 카드</option><option value="missing" '+(collectionFilter==="missing"?"selected":"")+'>미보유 카드</option></select>'+
 '<select data-pack-grade aria-label="등급"><option value="all">모든 등급</option>'+RARITIES.map(g=>'<option value="'+esc(g)+'" '+(collectionGrade===g?"selected":"")+'>'+esc(displayGrade(g))+'</option>').join("")+'</select></div>'+
 '<div class="rkbo-pack-collection-grid">'+filtered.slice(0,collectionLimit).map(c=>{
 const inv=owned.get(c.card_id),count=inv?.quantity||0,p=cache.get(c.season)?.get(c.card_id);
 return '<div class="rkbo-pack-collection-item '+(inv?"is-owned":"is-locked")+'">'+
  (inv?'<div class="rkbo-pack-collection-card '+(inv.gold_border?'rkbo-gold-border ':'')+(inv.prism?'rkbo-prism ':'')+'">'+renderPlayer(p)+'</div>'+
   '<span class="rkbo-pack-owned-label">잔여 ×'+count+(inv.gold_border?' · ✨ 금테':'')+(inv.prism?' · 🌈 프리즘':'')+'</span>'+
   '<div class="rkbo-pack-upgrade-actions">'+
   (!inv.gold_border?'<button data-pack-upgrade="gold" data-pack-card="'+esc(c.card_id)+'" '+(count<5?'disabled':'')+'>✨ 금테 (5장)</button>':'')+
   (!inv.prism?'<button data-pack-upgrade="prism" data-pack-card="'+esc(c.card_id)+'" '+(count<10?'disabled':'')+'>🌈 프리즘 (10장)</button>':'')+
   '</div>':
  '<div class="rkbo-pack-silhouette"><span>🔒</span><strong>???</strong><small>'+esc(c.season)+'차 · 미보유</small></div>')+
 '</div>';
 }).join("")+'</div>'+
 (filtered.length>collectionLimit?'<button type="button" data-pack="more" class="rkbo-pack-more">더 보기 ('+collectionLimit+' / '+filtered.length+')</button>':'')+
 (!filtered.length?'<p class="rkbo-pack-loading">조건에 해당하는 카드가 없습니다.</p>':'');
}
async function loadHistory(){
 const body=$("#rkbo-pack-body");if(!body)return;
 body.innerHTML='<p class="rkbo-pack-loading">개봉 기록 불러오는 중…</p>';
 try{
  const {c,user}=await context();
  const {data,error}=await c.from("rkbo_pack_history").select("id,pack_number,season,draws,opened_at").eq("user_id",user.id).order("opened_at",{ascending:false}).limit(30);
  if(error)throw Error(error.message);
  history=data||[];await Promise.all([...new Set(history.map(h=>h.season))].map(n=>playersFor(n).catch(e=>console.warn("[RKBO pack history]",n,e))));
  body.innerHTML=history.length?'<div class="rkbo-pack-history">'+history.map(h=>
   '<section class="rkbo-pack-history-entry"><h3>📦 '+h.pack_number+'번째 개봉 · '+h.season+'차 <small>'+new Date(h.opened_at).toLocaleString("ko-KR")+'</small></h3>'+
    '<div>'+h.draws.map(v=>'<span class="rarity-'+esc(v.grade)+'">'+esc(cache.get(h.season)?.get(v.cardId)?.name||v.name||v.cardId)+' · '+esc(displayGrade(v.grade))+'</span>').join("")+'</div></section>'
  ).join("")+'</div>':'<p class="rkbo-pack-loading">아직 개봉한 카드팩이 없습니다.</p>';
 }catch(e){body.innerHTML=loginView(e.message)}
}
function renderAdmin(){
 const body=$("#rkbo-pack-body");if(!body||!adminAuthorized)return;
 const selected=packFor(adminSeason),img=selected?.image_url||defaultPackArt;
 body.innerHTML='<div class="rkbo-pack-admin"><h3>⚙️ 제작자 · 카드팩 관리</h3>'+
  '<p>실제 Supabase 관리자 계정으로 인증된 경우에만 저장 가능. 삭제는 기록 보존을 위해 비활성화로 처리돼요.</p>'+
  '<div class="rkbo-pack-admin-form"><label>차수 선택<select id="rkbo-admin-season" data-admin-season>'+
   Array.from({length:60},(_,i)=>i+1).reverse().map(n=>'<option value="'+n+'"'+(n===adminSeason?' selected':'')+'>'+n+'차</option>').join("")+'</select></label>'+
  '<label>팩 이름<input id="rkbo-admin-label" maxlength="70" value="'+esc(selected?.label||adminSeason+'차 시즌 카드팩')+'"></label>'+
  '<label class="rkbo-pack-admin-active">팩 공개 및 개봉 허용 <input id="rkbo-admin-active" type="checkbox" '+(selected?.active?'checked':'')+'></label>'+
  '<div class="rkbo-pack-admin-art"><img src="'+esc(img)+'" alt="현재 카드팩 이미지"><label>팩 이미지 파일 선택 (PNG/JPEG/WebP, 최대 3MB)<input id="rkbo-admin-image" type="file" accept="image/png,image/jpeg,image/webp"></label></div>'+
  '<div class="rkbo-pack-admin-actions"><button data-pack-admin-action="save">등록 / 수정 / 적용</button>'+
   '<button data-pack-admin-action="remove">팩 삭제(비활성)</button></div></div>'+
  '<h4>등록한 팩</h4><div class="rkbo-pack-admin-list">'+
  (packChoices.length?packChoices.map(p=>'<div><span>'+esc(p.label)+'</span><small>'+(p.active?'🟢 공개':'⚪ 비활성')+'</small><button type="button" data-admin-select="'+p.season+'">수정</button></div>').join(""):'<p>등록된 팩 없음</p>')+
  '</div></div>';
}
async function saveAdmin(remove=false){
 if(adminBusy||!adminAuthorized)return;
 const form=$("#rkbo-admin-season");if(!form)return;
 const seasonNo=Number(form.value),label=$("#rkbo-admin-label")?.value?.trim()||"",
  active=remove?false:!!$("#rkbo-admin-active")?.checked,
  file=remove?null:$("#rkbo-admin-image")?.files?.[0];
 if(label.length<2||label.length>70)throw Error("팩 이름은 2~70자여야 합니다.");
 if(file&&(file.size>3145728||!["image/png","image/jpeg","image/webp"].includes(file.type)))
  throw Error("3MB 이하 PNG/JPEG/WebP 파일만 사용할 수 있어요.");
 adminBusy=true;const controls=dialog.querySelectorAll("[data-pack-admin-action]");
 controls.forEach(b=>b.disabled=true);
 try{
  const {c}=await context();
  let url=packFor(seasonNo)?.image_url||defaultPackArt;
  if(file){
   const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file.type];
   const key="season-"+seasonNo+"/"+Date.now()+"-"+crypto.randomUUID()+"."+ext;
   const uploaded=await c.storage.from("rkbo-pack-art").upload(key,file,{contentType:file.type,upsert:false});
   if(uploaded.error)throw Error("팩 이미지 업로드 실패: "+uploaded.error.message);
   url=c.storage.from("rkbo-pack-art").getPublicUrl(key).data.publicUrl;
  }
  let cards=null;
  if(active){
   const roster=await playersFor(seasonNo);
   cards=[...roster.values()].filter(p=>BASE_RARITIES.includes(p.grade)).map(p=>({
    id:p.id,grade:p.grade,name:p.name,team:p.team,pos:p.pos,type:p.type,ovr:Number(p.ovr)
   }));
   if(!cards.length)throw Error("공식 시즌 카드 데이터가 없어요.");
  }
  const {error}=await c.rpc("rkbo_manage_pack",{p_season:seasonNo,p_label:label,
   p_image_url:url,p_active:active,p_cards:cards});
  if(error)throw Error("팩 등록 실패: "+error.message);
  await loadPackChoices();
  if(tab==="admin")renderAdmin();
  message(remove?"카드팩이 비활성화되었습니다. 기존 개봉 기록과 수집 카드는 유지됩니다.":"✓ "+seasonNo+"차 카드팩 설정이 저장되었습니다!");
 }finally{adminBusy=false;controls.forEach(b=>b.disabled=false)}
}

async function showTab(next){
 if(!["pack","collection","history","admin"].includes(next))return;
 if(next==="admin"&&!adminAuthorized)return;
 if(opening)return;
 tab=next;draws=[];cursor=0;revealToken++;frame();
 try{
  if(tab==="pack"){await Promise.all([refreshStats(),loadPackChoices()]);if(overlay.hidden||tab!=="pack")return;frame();renderPack();startCooldownClock()}
  if(tab==="collection"){await loadPackChoices();frame();await loadCollection()}
  if(tab==="history")await loadHistory();
  if(tab==="admin")renderAdmin();
 }catch(e){$("#rkbo-pack-body").innerHTML=loginView(e.message)}
}
function close(){if(!overlay)return;overlay.hidden=true;revealToken++;stopCooldownClock();document.body.classList.remove("rkbo-pack-open")}
function open(){if(!overlay)init();if(!overlay)return;overlay.hidden=false;tab="pack";draws=[];cursor=0;document.body.classList.add("rkbo-pack-open");frame();showTab("pack")}
function init(){
 if(overlay)return;
 const nav=document.querySelector(".nav-right")||document.querySelector(".nav");
 const button=document.createElement("button");button.id="rkbo-pack-open";button.type="button";button.className="rkbo-pack-nav";button.textContent="🎫 카드팩";
 nav?.prepend(button);button.addEventListener("click",open);
 overlay=document.createElement("div");overlay.className="rkbo-pack-overlay";overlay.hidden=true;overlay.id="rkbo-pack-overlay";
 overlay.innerHTML='<section class="rkbo-pack-dialog" role="dialog" aria-modal="true" aria-label="RKBO 카드팩"></section>';
 document.body.append(overlay);dialog=overlay.querySelector(".rkbo-pack-dialog");
 overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
 dialog.addEventListener("click",async e=>{
  const card=e.target.closest("[data-pack-detail]");
  if(card){await openCardDetails(card.dataset.packDetail);return}
  const target=e.target.closest("[data-pack-tab],[data-pack]");if(!target)return;
  if(target.dataset.packTab){showTab(target.dataset.packTab);return}

  const action=target.dataset.pack;
  if(action==="close"){close();return}
  if(action==="login"){close();root.RKBOOnline?.open?.("account");return}
  if(action==="open"){await openPack();return}
  if(action==="next"){await showNext();return}
  if(action==="share"){await savePackSharePNG(target);return}
  if(action==="reset"){draws=[];cursor=0;packResult=null;await showTab("pack");return}
  if(action==="collection"){await showTab("collection");return}
  if(action==="more"){collectionLimit+=36;renderCollection()}
 });
 dialog.addEventListener("click",async e=>{
  const btn=e.target.closest("[data-pack-upgrade]");if(!btn||opening)return;
  const kind=btn.dataset.packUpgrade,id=btn.dataset.packCard,cost=kind==="gold"?5:10;
  if(!confirm("이 선수 카드 "+cost+"장을 소모해 "+(kind==="gold"?"금색 외곽 테두리":"프리즘 표면 효과")+"를 영구 적용할까요?"))return;
  btn.disabled=true;
  try{
   const {c}=await context();
   const {error}=await c.rpc("rkbo_upgrade_card",{p_card_id:id,p_kind:kind});
   if(error)throw Error(error.message);
   await refreshStats();renderCollection();
   root.dispatchEvent(new Event("rkbo-collection-updated"));
   message("강화 성공! 카드 "+cost+"장을 소모했어요.");
  }catch(err){btn.disabled=false;message("강화 실패: "+err.message)}
 });
 dialog.addEventListener("click",async e=>{
  const pick=e.target.closest("[data-admin-select]");
  if(pick&&adminAuthorized){adminSeason=Number(pick.dataset.adminSelect);renderAdmin();return}
  const btn=e.target.closest("[data-pack-admin-action]");
  if(!btn||!adminAuthorized)return;
  try{await saveAdmin(btn.dataset.packAdminAction==="remove")}
  catch(err){message(err.message);alert("팩 설정 실패: "+err.message)}
 });
 dialog.addEventListener("change",e=>{
  if(e.target.matches("[data-pack-filter]")){collectionFilter=e.target.value;collectionLimit=36;renderCollection()}
  if(e.target.matches("[data-admin-season]")){adminSeason=Number(e.target.value);renderAdmin()}
  if(e.target.matches("#rkbo-admin-image")){
   const file=e.target.files?.[0],img=$("#rkbo-pack-body .rkbo-pack-admin-art img");
   if(file&&img){
    const url=URL.createObjectURL(file);
    img.onload=()=>URL.revokeObjectURL(url);
    img.src=url;
   }
  }
  if(e.target.matches("[data-pack-season]")){if(opening||draws.length){e.target.value=String(season);return}season=Number(e.target.value);if(tab==="collection")loadCollection();else renderPack()}
  if(e.target.matches("[data-pack-grade]")){collectionGrade=e.target.value;collectionLimit=36;renderCollection()}
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close()});
}
root.addEventListener("rkbo-collection-updated",async event=>{
 if(event.detail?.origin!=="main-archive"||!overlay||overlay.hidden||tab!=="collection")return;
 try{await refreshStats();if(tab==="collection"&&!overlay.hidden)renderCollection()}
 catch(error){console.warn("[RKBO packs] inventory sync",error)}
});
root.RKBOCardPacks={open};
root.addEventListener("rkbo-special-updated",()=>cache.clear());
document.addEventListener("DOMContentLoaded",init);
})(window);

