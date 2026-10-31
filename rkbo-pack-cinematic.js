/* RKBO cinematic rarity reveal. Presentation only: never rolls or stores cards. */
(function(root){"use strict";
 const WAIT=[1200,1450,1350,1900];
 const RARITIES={
  "코랄":{label:"CORAL",color:"#ff8aa6",tone:"coral"},
  "다이아몬드":{label:"DIAMOND",color:"#7ddaff",tone:"diamond"},
  "신인왕":{label:"SPECIAL · ROOKIE OF THE YEAR",color:"#d69aff",tone:"special"},
  "드림":{label:"SPECIAL · DREAM ALL STAR",color:"#d69aff",tone:"special"},
  "나눔":{label:"SPECIAL · NANUM ALL STAR",color:"#d69aff",tone:"special"},
  "MVP":{label:"SPECIAL · MVP",color:"#d69aff",tone:"special"},
  "베스트릴리프":{label:"SPECIAL · BEST RELIEF",color:"#d69aff",tone:"special"}
 };
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
 const photo='<div class="rkbo-cine-stadium" aria-hidden="true"></div><div class="rkbo-cine-color-track" aria-hidden="true"></div><div class="rkbo-cine-sparks" aria-hidden="true"></div>';
 const logo='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="RKBO emblem">'+
 '<defs><path id="rkbo-cine-outer-top" d="M 28,124 A 92,92 0 0,1 212,124"/>'+
 '<path id="rkbo-cine-outer-bottom" d="M 28,129 A 92,92 0 0,0 212,129"/></defs>'+
 '<circle cx="120" cy="120" r="116" fill="#075b35" stroke="#052b1b" stroke-width="4"/>'+
 '<circle cx="120" cy="120" r="105" fill="none" stroke="#fafff8" stroke-width="5"/>'+
 '<circle cx="120" cy="120" r="67" fill="#fff" stroke="#10251b" stroke-width="4"/>'+
 '<text fill="#fff" font-size="30" font-weight="1000" letter-spacing="2" text-anchor="middle">'+
 '<textPath href="#rkbo-cine-outer-top" startOffset="50%">REALKBO</textPath></text>'+
 '<text fill="#fff" font-size="33" font-weight="1000" letter-spacing="5" text-anchor="middle">'+
 '<textPath href="#rkbo-cine-outer-bottom" startOffset="50%">RKBO</textPath></text>'+
 '<path d="M88 69 Q46 118 88 171 M152 69 Q194 118 152 171" stroke="#080d0b" stroke-width="7" fill="none" stroke-linecap="round"/>'+
 '<g stroke="#080d0b" stroke-width="4" stroke-linecap="round">'+
 Array.from({length:8},(_,i)=>{const y=83+i*11,dx=Math.sin(i/7*Math.PI)*15;return '<path d="M'+(79-dx/3)+' '+y+' l18 -6 M'+(143+dx/3)+' '+y+' l18 6"/>';}).join("")+
 '</g><g fill="#fff"><path d="m33 143 5 13 14 0 -11 9 4 14 -12 -8 -12 8 4 -14 -11 -9 14 0z"/>'+
 '<path d="m207 143 5 13 14 0 -11 9 4 14 -12 -8 -12 8 4 -14 -11 -9 14 0z"/></g></svg>';
 const arms='<svg class="rkbo-cine-hands" viewBox="0 0 800 470" preserveAspectRatio="none" aria-hidden="true">'+
 '<defs><linearGradient id="rkbo-hand-skin" x1="0" y1="0" x2="1" y2=".4"><stop stop-color="#97645a"/><stop offset=".38" stop-color="#f0c5aa"/><stop offset=".73" stop-color="#d6a38e"/><stop offset="1" stop-color="#82574e"/></linearGradient></defs>'+
 '<path d="M-55 470 Q48 404 120 329 Q130 305 153 298 L186 258 Q197 250 206 257 L196 294 L236 250 Q251 242 259 252 L226 305 L270 275 Q286 268 292 281 L254 329 Q289 312 302 325 L260 358 Q237 378 209 388 L117 470 Z" fill="url(#rkbo-hand-skin)" stroke="#80594d" stroke-width="3"/>'+
 '<path d="M855 470 Q752 404 680 329 Q670 305 647 298 L614 258 Q603 250 594 257 L604 294 L564 250 Q549 242 541 252 L574 305 L530 275 Q514 268 508 281 L546 329 Q511 312 498 325 L540 358 Q563 378 591 388 L683 470 Z" fill="url(#rkbo-hand-skin)" stroke="#80594d" stroke-width="3"/></svg>';
 function content(phase,tier){
  if(phase===0)return photo+'<div class="rkbo-cine-door rkbo-cine-left"><i></i></div><div class="rkbo-cine-door rkbo-cine-right"><i></i></div>'+
   '<div class="rkbo-cine-door-glow"></div>'+arms+'<div class="rkbo-cine-caption">THE GATE OPENS</div>';
  if(phase===1)return photo+'<div class="rkbo-cine-track-light"></div><div class="rkbo-cine-caption">ENTER THE BALLPARK</div>';
  if(phase===2)return photo+'<div class="rkbo-cine-scoreboard"><small>TRT · Tsuki’s RKBO Together</small><strong>'+esc(tier.label)+'</strong><span>✦ ✦ ✦ ✦ ✦</span></div>'+
   '<div class="rkbo-cine-caption">GRADE REVEALED</div>';
  return photo+'<div class="rkbo-cine-rays" aria-hidden="true"></div><div class="rkbo-cine-ball-travel"><div class="rkbo-cine-baseball">'+
   '<div class="rkbo-cine-ball-stitch a"></div><div class="rkbo-cine-ball-stitch b"></div><div class="rkbo-cine-crest">'+logo+'</div></div></div>'+
   '<div class="rkbo-cine-caption">RKBO · THE MOMENT</div>';
 }
 async function play(stage,grade,shouldContinue){
  const tier=RARITIES[grade]||RARITIES["코랄"];
  if(!stage)return false;
  for(let i=0;i<4;i++){
   if(!stage.isConnected||shouldContinue?.()===false)return false;
   stage.innerHTML='<div class="rkbo-cine-scene rkbo-cine-'+(i+1)+' rkbo-cine-'+tier.tone+'" style="--cine-tone:'+tier.color+'">'+
    content(i,tier)+'</div>';
   await wait(root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?Math.min(500,WAIT[i]):WAIT[i]);
  }
  return stage.isConnected && shouldContinue?.()!==false;
 }
 function loadStyle(){
  if(document.querySelector('link[data-rkbo-cine]'))return;
  const css=document.createElement("link");css.rel="stylesheet";css.href="./rkbo-pack-cinematic.css?v=20261031-1";
  css.dataset.rkboCine="1";document.head.appendChild(css);
 }
 loadStyle();
 root.RKBOPackCinematic={play,supportedGrade:grade=>!!RARITIES[grade]};
})(window);