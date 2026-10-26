/**
 * Optional server-side maintenance script (Node 20+), NOT for GitHub Pages.
 * Reload GitHub's original 1–59 season card data into Supabase's combination
 * prize catalog. Never overwrites existing card records or changes active packs.
 *
 * Supply SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as private environment
 * variables. Never commit actual credentials or run this in browser code.
 */
const url=process.env.SUPABASE_URL?.replace(/\/+$/,"");
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY securely.");
const grades=new Set(["브론즈","실버","골드","코랄","다이아몬드"]);
const sourceBase="https://raw.githubusercontent.com/p0emkite/RKBO_Draft_and_CardArchive/main/data/seasons";
let sum=0;
for(let season=1;season<=59;season++){
 const response=await fetch(sourceBase+"/"+season+".json");
 if(!response.ok)throw Error("Season "+season+" unavailable (HTTP "+response.status+")");
 const data=await response.json(),list=Array.isArray(data)?data:data.players;
 if(!Array.isArray(list)||!list.length)throw Error("Season "+season+" has no players");
 const ids=new Set(),rows=list.map(player=>{
  if(player.season!==season||!String(player.id).startsWith(season+"-")||ids.has(player.id)||
   !grades.has(player.grade)||!["타자","투수"].includes(player.type)||
   !Number.isInteger(player.ovr)||player.ovr<1||player.ovr>99)throw Error("Invalid player in "+season);
  ids.add(player.id);
  return {card_id:player.id,season,grade:player.grade,name:player.name,team:player.team,
   position:player.pos,card_type:player.type,ovr:player.ovr,ratings:player.ratings??{}};
 });
 for(let i=0;i<rows.length;i+=150){
  const out=await fetch(url+"/rest/v1/rkbo_pack_cards?on_conflict=card_id",{
   method:"POST",headers:{"apikey":secret,"Authorization":"Bearer "+secret,
    "Content-Type":"application/json","Prefer":"resolution=ignore-duplicates,return=minimal"},
   body:JSON.stringify(rows.slice(i,i+150))
  });
  if(!out.ok)throw Error("Season "+season+" failed: HTTP "+out.status+" "+(await out.text()).slice(0,200));
 }
 sum+=rows.length;console.log("Season "+season+": "+rows.length+" cards");
}
console.log("Complete: "+sum+" historical combinations candidates, existing cards preserved");
