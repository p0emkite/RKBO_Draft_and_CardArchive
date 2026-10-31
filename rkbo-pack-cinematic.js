/* RKBO CINEMATIC v2 — visual-only, does not influence Supabase draws, card grants or pity. */
(function(root){"use strict";
 const WAIT=[1200,1450,1350,1900];
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
 const safe=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const sceneName=["gate","run","board","ball"];
 function stadiumWorld(tier,phase,w,h){
  const text=phase>=2?'<div class="rkbo-cine-board-content"><strong>'+safe(tier[0])+'</strong><span>✦ ✦ ✦</span></div>':'';
  return '<div class="rkbo-cine-world" style="--world-w:'+w+'px;--world-h:'+h+'px">'+
   '<div class="rkbo-cine-photo" aria-hidden="true"></div>'+
   '<div class="rkbo-cine-grass" aria-hidden="true"></div>'+
   '<div class="rkbo-cine-led" aria-label="'+safe(tier[0])+' 등급 전광판">'+text+'</div>'+
   '</div>';
 }
 function doors(){
  // The door panels stay entirely opaque. Their original photographic material is
  // split and slid outward; only the space between them exposes the stadium.
  return '<div class="rkbo-cine-photo-door left" aria-hidden="true"></div>'+
         '<div class="rkbo-cine-photo-door right" aria-hidden="true"></div>'+
         '<div class="rkbo-cine-door-seam" aria-hidden="true"></div>';
 }
 function baseball(){
  return '<div class="rkbo-cine-energy" aria-hidden="true"></div>'+
   '<div class="rkbo-cine-ball-flight" aria-hidden="true">'+
   '<img class="rkbo-cine-ball-photo" src="'+ASSETS+'baseball.webp" alt="" draggable="false">'+
   '<img class="rkbo-cine-ball-logo" src="./assets/rkbo-archive-logo.webp" alt="" draggable="false">'+
   '</div>';
 }
 // Always render the same scene and screen coordinates. The camera alone changes
 // during the next cut; the scoreboard is anchored to the real photograph.
 function frame(phase,tier,w,h){
  return '<div class="rkbo-cine-scene rkbo-cine-phase-'+sceneName[phase]+' rkbo-cine-tone-'+tier[2]+'" style="--cine-tone:'+tier[1]+'">'+
   stadiumWorld(tier,phase,w,h)+
   '<div class="rkbo-cine-vignette"></div>'+
   '<div class="rkbo-cine-atmosphere" aria-hidden="true"></div>'+
   (phase===0?doors():phase===3?baseball():'')+
   '</div>';
 }
 async function play(stage,grade,shouldContinue){
  if(!stage)return false;
  const tier=TYPES[grade]||TYPES["코랄"];
  const rect=stage.getBoundingClientRect(),width=Math.max(200,rect.width),height=Math.max(220,rect.height);
  const ratio=830/335;
  const w=Math.ceil(Math.max(width,height*ratio));
  const h=Math.ceil(Math.max(height,width/ratio));
  const reduced=root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  for(let phase=0;phase<4;phase++){
   if(!stage.isConnected||shouldContinue?.()===false)return false;
   stage.innerHTML=frame(phase,tier,w,h);
   await delay(reduced?Math.min(320,WAIT[phase]):WAIT[phase]);
  }
  return stage.isConnected&&shouldContinue?.()!==false;
 }
 function loadAssets(){
  if(!document.querySelector("link[data-rkbo-cine]")){
   const link=document.createElement("link");
   link.rel="stylesheet";
   link.href="./rkbo-pack-cinematic.css?v=20261031-photoreal-v2";
   link.dataset.rkboCine="1";
   document.head.appendChild(link);
  }
  ["atlas.webp","baseball.webp"].forEach(f=>{
   const image=new Image();image.decoding="async";image.src=ASSETS+f;
  });
  const crest=new Image();crest.src="./assets/rkbo-archive-logo.webp";
 }
 loadAssets();
 root.RKBOPackCinematic={play,supportedGrade:g=>!!TYPES[g]};
})(window);