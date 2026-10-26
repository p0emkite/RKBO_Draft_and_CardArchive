/* RKBO archive: original-size collectible card PNG export, 750 × 1050 */
(function(){
'use strict';
const WIDTH=750, HEIGHT=1050, SCALE=2.5;
const grades={
 '브론즈':{metal:'#d39a73',dark:'#684335'},
 '실버':{metal:'#c9d7df',dark:'#617b8d'},
 '골드':{metal:'#f4cf74',dark:'#a57532'},
 '코랄':{metal:'#F6909D',dark:'#ab5e67'},
 '플래티넘':{metal:'#F6909D',dark:'#ab5e67'},
 '다이아몬드':{metal:'#90ecff',dark:'#417baa'}
};
const teams={DOO:'#202f6c',HAN:'#d97521',KIA:'#bd3445',KT:'#222222',LG:'#aa3053',LOT:'#659cbb',NC:'#b79c64',SAM:'#407acb',SSG:'#ffb81c',SK:'#cf292f',KIW:'#6a1e3f'};
const ratingColor=v=>v==null||!Number.isFinite(Number(v))?'#fff':Number(v)>=90?grades['다이아몬드'].metal:Number(v)>=85?grades['코랄'].metal:Number(v)>=80?grades['골드'].metal:Number(v)>=70?grades['실버'].metal:'#fff';
const clamp=(v,l,h)=>Math.min(h,Math.max(l,v));
function rgb(hex,alpha){const raw=hex.replace('#','');const nums=[0,2,4].map(i=>parseInt(raw.slice(i,i+2),16));return 'rgba('+nums.join(',')+','+alpha+')'}
function round(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function label(ctx,s,x,y,font,color,align='left',maxW=undefined){
 ctx.font=font;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';
 if(maxW)ctx.fillText(String(s),x,y,maxW);else ctx.fillText(String(s),x,y);
}
function load(src){return new Promise(resolve=>{if(!src)return resolve(null);const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=src})}
function badge(ctx,value,y,accent){
 round(ctx,230,y,55,20,5);ctx.fillStyle='rgba(5,14,27,.70)';ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=1;ctx.stroke();
 label(ctx,value,257.5,y+13,'900 9px system-ui, sans-serif',accent,'center');
}
// PNG exports are hand-drawn, so CSS card upgrades must also be painted on Canvas.
async function loadSavedEffects(player){
 const none={gold_border:false,prism:false};
 if(!window.RKBOOnline?.isConfigured?.())return none;
 const client=await window.RKBOOnline.getClient();
 const {data:auth,error:authError}=await client.auth.getUser();
 if(authError||!auth?.user)return none;
 const {data,error}=await client.from('rkbo_card_inventory')
  .select('gold_border,prism')
  .eq('user_id',auth.user.id).eq('card_id',player.id).maybeSingle();
 if(error)throw new Error('강화 정보 조회에 실패했습니다: '+error.message);
 return {gold_border:data?.gold_border===true,prism:data?.prism===true};
}
function drawSavedEffects(ctx,effects){
 if(!effects?.gold_border&&!effects?.prism)return;
 if(effects.prism){
  // A static holographic spectrum, readable over the artwork and ratings.
  ctx.save();
  round(ctx,7,7,286,406,12);ctx.clip();
  ctx.globalCompositeOperation='screen';
  const spectrum=ctx.createLinearGradient(0,5,300,405);
  [
   [0,'rgba(255,77,137,.035)'],
   [.13,'rgba(255,96,163,.18)'],
   [.28,'rgba(255,207,95,.17)'],
   [.43,'rgba(87,240,205,.16)'],
   [.58,'rgba(111,168,255,.18)'],
   [.74,'rgba(209,123,255,.18)'],
   [.89,'rgba(245,139,208,.15)'],
   [1,'rgba(135,242,255,.04)']
  ].forEach(([stop,color])=>spectrum.addColorStop(stop,color));
  ctx.fillStyle=spectrum;ctx.fillRect(7,7,286,406);
  ctx.translate(150,210);ctx.rotate(-Math.PI/5);
  const sparkle=ctx.createLinearGradient(-55,0,75,0);
  sparkle.addColorStop(0,'rgba(255,255,255,0)');
  sparkle.addColorStop(.44,'rgba(250,252,255,.02)');
  sparkle.addColorStop(.50,'rgba(253,254,255,.13)');
  sparkle.addColorStop(.56,'rgba(250,252,255,.02)');
  sparkle.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sparkle;ctx.fillRect(-75,-270,150,540);
  ctx.restore();
 }
 if(effects.gold_border){
  // Original rarity rim is at x=1. This extra frame sits inside it.
  ctx.save();
  ctx.shadowColor='rgba(245,193,75,.80)';
  ctx.shadowBlur=12;
  ctx.lineWidth=3.2;
  ctx.strokeStyle='#f6cf6b';
  round(ctx,4.2,4.2,291.6,411.6,15.2);ctx.stroke();
  ctx.shadowBlur=0;
  ctx.lineWidth=.9;
  ctx.strokeStyle='rgba(255,246,191,.9)';
  round(ctx,7.2,7.2,285.6,405.6,12.8);ctx.stroke();
  ctx.restore();
 }
}
async function make(player,effects){
 const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
 const ctx=canvas.getContext('2d');ctx.scale(SCALE,SCALE);
 const grade=grades[player.grade]||grades.실버,brand=window.RKBOTeamBrand?.code(player)||player.team,team=teams[brand]||'#243e61';
 const photo=window.RKBOArt?.imageState?.(player)||{};
 const teamBg=window.RKBOTeamBackground?.imageState?.(player)||{};
 const photoSrc=photo.url||'';
 const [image,logo,silhouette,background]=await Promise.all([
  load(photoSrc),
  load(window.RKBOTeamBrand?.logo(player)||('assets/teams/'+player.team+(player.team==='NC'?'.png':'.svg'))),
  photoSrc?Promise.resolve(null):load('assets/default-'+(player.type==='투수'?'pitcher':'batter')+'.png'),
  load(teamBg.url||'')
 ]);
 // Fixed 300 × 420 logical card, rasterized 2.5×; layout always keeps a 5:7 ratio.
 round(ctx,1,1,298,418,17);ctx.fillStyle='#0d1827';ctx.fill();ctx.strokeStyle=grade.metal;ctx.lineWidth=1.6;ctx.stroke();
 ctx.save();round(ctx,6,6,288,408,13);ctx.clip();
 ctx.fillStyle='#0d1827';ctx.fillRect(6,6,288,408);
 ctx.save();ctx.beginPath();ctx.rect(6,6,288,243);ctx.clip();
 // This is the same 288 × 243 artwork viewport used in the live card.
 // Show the WHOLE photograph by default (contain); cropping is opt-in (cover).
 const bg=ctx.createRadialGradient(120,8,0,140,135,250);
 bg.addColorStop(0,rgb(team,.65));bg.addColorStop(.55,'#1a2b40');bg.addColorStop(1,'#0c1625');
 ctx.fillStyle=bg;ctx.fillRect(6,6,288,243);
 // Club-wide photo is behind individual athlete artwork, not a replacement.
 if(background&&background.naturalWidth&&background.naturalHeight){
  const ratio=Math.max(288/background.naturalWidth,243/background.naturalHeight);
  const zoom=clamp(Number(teamBg.zoom)||1,.35,3.5);
  const tx=clamp(Number(teamBg.x)||0,-100,100)*288/100;
  const ty=clamp(Number(teamBg.y)||0,-100,100)*243/100;
  const w=background.naturalWidth*ratio*zoom,h=background.naturalHeight*ratio*zoom;
  ctx.drawImage(background,150+tx-w/2,127.5+ty-h/2,w,h);
   // Shade the stadium only, beneath player art and team logo.
   const shade=clamp(Number(teamBg.overlay)||0,0,100)/100;
   if(shade){ctx.fillStyle='rgba(0,0,0,'+shade+')';ctx.fillRect(6,6,288,243)}
 }
 label(ctx,brand,150,163,'1000 90px system-ui, sans-serif','rgba(255,255,255,.07)','center');
 ctx.beginPath();ctx.arc(150,150,94,0,2*Math.PI);ctx.lineWidth=.8;ctx.strokeStyle=grade.metal;ctx.stroke();
 if(image){
  const zx=clamp(Number(photo.zoom)||1,.3,5), x=clamp(Number(photo.x)||0,-150,150)*288/100, y=clamp(Number(photo.y)||0,-150,150)*243/100;
  const mode=photo.fit==='cover'?'cover':'contain';
  const fit=mode==='cover'?Math.max(288/image.naturalWidth,243/image.naturalHeight):Math.min(288/image.naturalWidth,243/image.naturalHeight);
  const w=image.naturalWidth*fit*zx,h=image.naturalHeight*fit*zx;
  // Two-pass alpha-aware soft outer glow, plus the original sharp photo.
   ctx.save();ctx.shadowColor='rgba(255,255,255,.115)';ctx.shadowBlur=23*SCALE;
   ctx.drawImage(image,150+x-w/2,127.5+y-h/2,w,h);
   ctx.shadowColor='rgba(255,255,255,.17)';ctx.shadowBlur=11*SCALE;
   ctx.drawImage(image,150+x-w/2,127.5+y-h/2,w,h);
   ctx.restore();ctx.drawImage(image,150+x-w/2,127.5+y-h/2,w,h);
 }else if(silhouette){
  ctx.drawImage(silhouette,20,player.type==='투수'?45:38,260,260);
 }
 ctx.restore();
 // Club symbol remains; the interactive favorite button is excluded from exported PNGs.
 if(logo){
  const width=logo.naturalWidth,height=logo.naturalHeight;
  if(width>0&&height>0){const f=Math.min(56/width,43/height);ctx.drawImage(logo,13,11,width*f,height*f)}
 }else label(ctx,brand,15,39,'italic 900 27px system-ui, sans-serif',grade.metal);
 ctx.fillStyle='#0c1828';ctx.fillRect(6,249,288,64);
 const shade=ctx.createLinearGradient(0,228,0,253);shade.addColorStop(0,'rgba(9,19,33,0)');shade.addColorStop(1,'rgba(9,19,33,.9)');ctx.fillStyle=shade;ctx.fillRect(6,228,288,25);
 label(ctx,player.ovr,21,302,'1000 57px system-ui, sans-serif',grade.metal);
 badge(ctx,player.season+'차',258,'#a8dfbc');
 badge(ctx,player.grade==='플래티넘'?'코랄':player.grade,283,grade.metal);
 ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(6,313);ctx.lineTo(294,313);ctx.stroke();
 const ng=ctx.createLinearGradient(0,314,0,370);ng.addColorStop(0,'#0e1a2c');ng.addColorStop(1,'#091421');ctx.fillStyle=ng;ctx.fillRect(6,314,288,56);
 // One-line name + position layout, matching the gallery card.
 label(ctx,player.name,20,351,'950 21px system-ui, sans-serif','#eef3fa','left',212);
 label(ctx,player.pos,280,351,'950 20px system-ui, sans-serif','#cddff0','right',56);
 ctx.fillStyle='#091320';ctx.fillRect(6,370,288,44);
 const metrics=player.type==='타자'?['정확','파워','선구','주루','수비']:['구위','제구','피안타 억제','피홈런 억제','체력'];
 const short={'피안타 억제':'피안','피홈런 억제':'피홈'};
 metrics.forEach((stat,i)=>{
  const x=6+i*57.6,n=player.ratings?.[stat];
  if(i){ctx.beginPath();ctx.moveTo(x,378);ctx.lineTo(x,409);ctx.strokeStyle='#344355';ctx.lineWidth=.6;ctx.stroke()}
  label(ctx,n??'—',x+28.8,389,'850 16px system-ui, sans-serif',ratingColor(n),'center');
  label(ctx,short[stat]||stat,x+28.8,403,'800 9px system-ui, sans-serif','#91a9be','center');
 });
 ctx.restore();round(ctx,6,6,288,408,13);ctx.strokeStyle='rgba(255,255,255,.15)';ctx.lineWidth=.8;ctx.stroke();
 if(effects===undefined)effects=await loadSavedEffects(player);
 drawSavedEffects(ctx,effects);
 return canvas;
}
async function save(player,button){
 if(button.disabled)return;
 const before=button.textContent;button.disabled=true;button.textContent='이미지 생성 중…';
 try{
  if(document.fonts?.ready)await document.fonts.ready;
  const effects=await loadSavedEffects(player);
  const canvas=await make(player,effects);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw Error('PNG 생성에 실패했습니다.');
  const objectURL=URL.createObjectURL(blob),a=document.createElement('a');
  const filename=(player.season+'차_'+player.team+'_'+player.name+'_OVR'+player.ovr).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,'_');
  a.href=objectURL;a.download=filename+'.png';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),15000);
 }catch(error){console.error(error);alert('카드 저장 실패: '+error.message)}
 finally{button.disabled=false;button.textContent=before}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-export-player]');if(!button)return;
 event.preventDefault();event.stopPropagation();
 const all=window.RKBOSeason?.players?.()||JSON.parse(document.getElementById('data')?.textContent||'[]');
 const player=all.find(p=>p.id===button.dataset.exportPlayer);
 if(player)save(player,button);
});
window.RKBOCardExport={make,save,width:WIDTH,height:HEIGHT};
})();
