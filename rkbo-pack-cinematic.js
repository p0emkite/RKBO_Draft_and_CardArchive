/* RKBO CINEMATIC v4 — presentation only; never affects draw odds, pity or inventory. */
(function(root){"use strict";
 const DURATIONS=[1200,1450,1450,1900];
 const ASSETS="./assets/cinematic/";
 const TYPES={
  "코랄":["CORAL","#f6909d","coral"],
  "다이아몬드":["DIAMOND","#91e6ff","diamond"],
  "신인왕":["SPECIAL","#c998fa","special"],
  "드림":["SPECIAL","#c998fa","special"],
  "나눔":["SPECIAL","#c998fa","special"],
  "MVP":["SPECIAL","#c998fa","special"],
  "베스트릴리프":["SPECIAL","#c998fa","special"]
 };
 const SPECIAL={신인왕:"ROY",드림:"DREAM",나눔:"NANUM",MVP:"MVP",베스트릴리프:"RELIEF"};
 const TEAM_CODES=["DOO","HAN","KIA","KIW","KT","LG","LOT","NC","SAM","SSG"];
 const h=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const sceneName=["gate","run","board","ball"];
 function teamCode(p){
  let code=String(p?.displayTeamCode||p?.team||"").toUpperCase();
  if(code==="SK")code="SSG";
  return TEAM_CODES.includes(code)?code:"";
 }
 function assetFor(grade,player){
  const kind=player?.specialKind || SPECIAL[grade];
  if(kind&&["ROY","DREAM","NANUM","MVP","RELIEF"].includes(kind)){
   return {kind:"special",url:"./assets/special-emblems/"+kind+".webp",alt:grade+" 특수 엠블럼"};
  }
  const code=teamCode(player);
  if(code){
   const idx=TEAM_CODES.indexOf(code);
   return {kind:"team",index:idx,team:code,url:"./assets/teams/"+(code==="NC"?"NC.png":code+".svg"),alt:code+" 팀 로고"};
  }
  return {kind:"none",alt:""};
 }
 function stadiumWorld(tier,phase,w,height){
  const board=phase>=2?'<div class="rkbo-cine-board-content"><strong>'+h(tier[0])+'</strong></div>':'';
  return '<div class="rkbo-cine-world" style="--world-w:'+w+'px;--world-h:'+height+'px">'+
    '<div class="rkbo-cine-photo" aria-hidden="true"></div>'+
    '<div class="rkbo-cine-grass" aria-hidden="true"></div>'+
    '<div class="rkbo-cine-grass-pulse" aria-hidden="true"></div>'+
    '<div class="rkbo-cine-led" aria-label="'+h(tier[0])+' 등급 전광판">'+board+'</div></div>';
 }
 function doors(){
  return '<div class="rkbo-cine-photo-door left" aria-hidden="true"></div>'+
         '<div class="rkbo-cine-photo-door right" aria-hidden="true"></div>'+
         '<div class="rkbo-cine-door-seam" aria-hidden="true"></div>';
 }
 function baseball(grade,player){
  const emblem=assetFor(grade,player);
  let logo="";
  if(emblem.kind==="special"){
   logo='<img class="rkbo-cine-ball-mark rkbo-cine-special-mark" src="'+h(emblem.url)+'" alt="" draggable="false">';
  }else if(emblem.kind==="team"){
   const x=emblem.index%5,y=Math.floor(emblem.index/5);
   // Uploaded team-specific artwork sprite; fallback only for browsers missing WebP.
   logo='<span class="rkbo-cine-ball-mark rkbo-cine-team-mark" style="--team-x:'+x+';--team-y:'+y+'">'+
        '<img class="rkbo-cine-team-fallback" src="'+h(emblem.url)+'" alt="" draggable="false"></span>';
  }
  return '<div class="rkbo-cine-energy" aria-hidden="true"></div>'+
   '<div class="rkbo-cine-ball-flight" aria-hidden="true">'+
   '<img class="rkbo-cine-ball-photo" src="'+ASSETS+'baseball.webp" alt="" draggable="false">'+
   logo+'</div>';
 }
 function frame(phase,tier,w,height,grade,player){
  return '<div class="rkbo-cine-scene rkbo-cine-phase-'+sceneName[phase]+' rkbo-cine-tone-'+tier[2]+'"'+
    ' style="--cine-tone:'+tier[1]+';--backdrop-w:'+w+'px;--backdrop-h:'+height+'px">'+
    stadiumWorld(tier,phase,w,height)+
    '<div class="rkbo-cine-vignette"></div><div class="rkbo-cine-atmosphere" aria-hidden="true"></div>'+
    (phase===0?doors():phase===3?baseball(grade,player):"")+
    '</div>';
 }
 async function play(stage,grade,shouldContinue,player){
  if(!stage)return false;
  const tier=TYPES[grade]||TYPES["코랄"];
  const rect=stage.getBoundingClientRect(),width=Math.max(200,rect.width),height=Math.max(220,rect.height);
  const ratio=830/335;
  const w=Math.ceil(Math.max(width,height*ratio)),sh=Math.ceil(Math.max(height,width/ratio));
  const reduced=root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  for(let phase=0;phase<4;phase++){
   if(!stage.isConnected||shouldContinue?.()===false)return false;
   stage.innerHTML=frame(phase,tier,w,sh,grade,player);
   await wait(reduced?Math.min(320,DURATIONS[phase]):DURATIONS[phase]);
  }
  return stage.isConnected&&shouldContinue?.()!==false;
 }
 function init(){
  if(!document.querySelector("link[data-rkbo-cine]")){
   const link=document.createElement("link");link.rel="stylesheet";
   link.href="./rkbo-pack-cinematic.css?v=20261031-sharp-v4";
   link.dataset.rkboCine="1";document.head.appendChild(link);
  }
  ["atlas.avif","atlas.webp","baseball.webp","club-logos.webp"].forEach(f=>{
   const image=new Image();image.decoding="async";image.src=ASSETS+f;
  });
 }
 init();
 root.RKBOPackCinematic={play,supportedGrade:g=>!!TYPES[g]};
})(window);