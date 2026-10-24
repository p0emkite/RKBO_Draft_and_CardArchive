// Reproducible 60th-season defense and batter OVR scoring.
// Run: node scripts/recalculate-season60-defense.mjs --check
//      node scripts/recalculate-season60-defense.mjs --apply
// Uses the user-supplied data/season60-fielding.tsv. No network access needed.
import {readFileSync,writeFileSync} from "node:fs";
const cardPath=new URL("../index.html",import.meta.url);
const sourcePath=new URL("../data/season60-fielding.tsv",import.meta.url);
const auditPath=new URL("../data/season60-defense-audit.json",import.meta.url);
function recalculateSeason60(players,source){
 const header=["Player","Team","Age","POS","G","PO","A","DP","E","FA","PB","SB","CS","SB%","TC","Inn","RF"];
 const lines=source.replace(/\r/g,"").trim().split("\n");
 if(lines[0].split("\t").join("|")!==header.join("|"))throw Error("Unexpected fielding header");
 const seen=new Map(),rows=[];
 for(const line of lines.slice(1)){
  if(!line.trim())continue;
  const cells=line.split("\t");if(cells.length!==header.length)throw Error("Bad fielding line: "+line);
  const r={};header.forEach((h,i)=>r[h]=cells[i]);
  for(const k of header.slice(2).filter(k=>!["POS"].includes(k))){
   const val=Number(r[k]);if(!Number.isFinite(val))throw Error("Non-numeric record "+r.Player+" "+k);
   r[k]=val;
  }
  if(r.TC!==r.PO+r.A+r.E)throw Error("Fielding chances mismatch "+r.Player);
  if(r.G<0||r.Inn<0||r.TC<0)throw Error("Negative fielding record "+r.Player);
  const key=r.Team.toUpperCase()+"|"+r.Player.toLowerCase().trim();
  if(seen.has(key))throw Error("Duplicate fielding row "+key);
  seen.set(key,r);rows.push(r);
 }
 if(rows.length!==200)throw Error("Unexpected source size "+rows.length);
 const batters=players.filter(p=>p.type==="타자");
 const pitchers=players.filter(p=>p.type==="투수");
 if(players.length!==181||batters.length!==87||pitchers.length!==94)throw Error("Unexpected card roster; refuse to overwrite");
 const original=new Map(players.map(p=>[p.id,{rating:p.ratings?.수비??null,ovr:p.ovr,grade:p.grade,skill:p.skillIndex}]));
 const groupOf=pos=>["CF","LF","RF","OF"].includes(pos)?"OF":["2B","SS"].includes(pos)?"MI":pos;
 const groups=new Map([["OF",[]],["MI",[]],["1B",[]],["3B",[]],["C",[]]]);
 const matched=new Map();
 for(const p of batters){
  const key=p.team.toUpperCase()+"|"+p.name.toLowerCase().trim();
  const row=seen.get(key);
  if(!row)throw Error("Missing final fielding entry for "+p.id+" "+key);
  if(!groups.has(groupOf(row.POS)))throw Error("Unknown fielding position "+row.POS);
  matched.set(p.id,row);
  if(row.Inn>0&&row.TC>0&&row.G>0)groups.get(groupOf(row.POS)).push(row);
  else if(row.Inn!==0||row.TC!==0||row.G!==0)throw Error("Partial fielding data for "+p.id);
 }
 const perPlayer=new Map();
 const prior=140;
 const lowerBound=(vals,x)=>{let lo=0,hi=vals.length;while(lo<hi){const m=(lo+hi)>>1;if(vals[m]<x)lo=m+1;else hi=m;}return lo};
 const upperBound=(vals,x)=>{let lo=0,hi=vals.length;while(lo<hi){const m=(lo+hi)>>1;if(vals[m]<=x)lo=m+1;else hi=m;}return lo};
 const percentile=(vals,x)=>(lowerBound(vals,x)+upperBound(vals,x))/(2*vals.length);
 for(const [group,rs] of groups){
  if(rs.length<4)throw Error("Insufficient peer group "+group);
  const errRate=rs.reduce((a,r)=>a+r.E,0)/rs.reduce((a,r)=>a+r.TC,0);
  const adjustedErr=r=>(r.E+prior*errRate)/(r.TC+prior);
  const range=r=>(r.PO+r.A)*9/r.Inn;
  const distErr=rs.map(adjustedErr).sort((a,b)=>a-b);
  const distRange=rs.map(range).sort((a,b)=>a-b);
  for(const r of rs){
   const errorPercentile=1-percentile(distErr,adjustedErr(r));
   const rangePercentile=percentile(distRange,range(r));
   const base=50+48*(0.83*errorPercentile+0.17*rangePercentile);
   const reliability=Math.min(1,r.Inn/600);
   const score=Math.max(50,Math.min(98,Math.round(70+(base-70)*reliability)));
   perPlayer.set(r.Team.toUpperCase()+"|"+r.Player.toLowerCase().trim(),
      {rating:score,peerGroup:group,adjustedErrorRate:adjustedErr(r),rangePerNine:range(r),
       errorPercentile,rangePercentile,reliability});
  }
 }
 const round=(x,d=0)=>Number(x.toFixed(d)),clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
 for(const p of batters){
  const r=matched.get(p.id),calc=perPlayer.get(p.team.toUpperCase()+"|"+p.name.toLowerCase().trim());
  const field={POS:r.POS,G:r.G,INN:r.Inn,PO:r.PO,A:r.A,DP:r.DP,E:r.E,
    FA:r.FA,PB:r.PB,SB:r.SB,CS:r.CS,SB_PCT:r["SB%"],TC:r.TC,CHANCES:r.TC,RF:r.RF};
  p.ratings.수비=calc?.rating??null;
  p.fieldRating=calc?.rating??null;
  p.fieldPrimary=calc?field:null;
  p.fieldPositions=calc?[field]:[];
  p.fieldSource="60차 최종 수비 기록 (data/season60-fielding.tsv)";
  p.fieldScoreSource=calc?"60차 최종 수비 v1 · 포지션군 실책률 83% / 수비 처리량 17%":"수비 출장 0경기 · 능력 평가 불가";
  p.fieldGames=r.G;p.fieldRaw=field;
  p.fieldScoreDetails=calc?{peerGroup:calc.peerGroup,adjustedErrorRate:round(calc.adjustedErrorRate,5),
    rangePerNine:round(calc.rangePerNine,4),errorPercentile:round(calc.errorPercentile,4),
    rangePercentile:round(calc.rangePercentile,4),reliability:round(calc.reliability,4)}:null;
  delete p.defenseRestoration;
  p.unavailable=(p.unavailable||[]).filter(s=>!String(s).includes("수비 기록 없음")&&!String(s).includes("HHRecord 수비 표"));
  if(!calc)p.unavailable.unshift("최종 기록상 수비 출장 0경기·0이닝: 수비 능력치 미산정");
  const v=p.ratings;
  p.skillIndex=round(.32*v.정확+.31*v.파워+.23*v.선구+.08*v.주루+.06*(v.수비??72),2);
 }
 const basis=batters.filter(p=>p.stats.Ab>=300);
 const pool=basis.length>=8?basis:batters;
 const indices=pool.map(p=>p.skillIndex).sort((a,b)=>a-b);
 const grade=ovr=>ovr>=91?"다이아몬드":ovr>=84?"코랄":ovr>=75?"골드":ovr>=65?"실버":"브론즈";
 for(const p of batters){
  const inferred=.38*p.skillIndex+.62*(56+43*percentile(indices,p.skillIndex));
  const w=Math.min(1,p.stats.Ab/440);
  const preCap=Math.round(51+(inferred-51)*(.22+.78*w));
  const ab=p.stats.Ab,cap=ab<100?64:ab<200?74:ab<300?83:ab<400?90:99;
  p.potentialOVR=round(inferred,1);p.ovrNoCap=preCap;p.gradeCap=cap;p.sampleRatio=round(w,3);
  p.ovr=clamp(preCap,40,cap);p.grade=grade(p.ovr);
  p.ovrLogic={"표본비율":p.sampleRatio,"등급상한OVR":cap,"상한전OVR":preCap,"기량지표":p.potentialOVR};
 }
 for(const p of players)p.rank=1+players.filter(other=>other.type===p.type&&other.ovr>p.ovr).length;
 const changes=batters.map(p=>({id:p.id,team:p.team,name:p.name,position:p.pos,
  battingGames:p.stats.G,fieldingGames:p.fieldGames,fieldingInnings:p.fieldRaw.INN,
  previousDefense:original.get(p.id).rating,defense:p.ratings.수비,
  previousOVR:original.get(p.id).ovr,ovr:p.ovr,
  previousGrade:original.get(p.id).grade,grade:p.grade,
  skillIndex:p.skillIndex,scoreDetails:p.fieldScoreDetails}));
 const summary={
  source:"User-supplied final 60th season fielding records",
  sourceRows:rows.length,cardCount:players.length,batters:batters.length,pitchers:pitchers.length,
  exactMatchedBatters:matched.size,fieldingRated:batters.filter(p=>p.ratings.수비!==null).length,
  noFieldingEvidence:batters.filter(p=>p.ratings.수비===null).map(p=>({id:p.id,name:p.name,battingGames:p.stats.G,fieldingGames:p.fieldGames})),
  peerGroupSizes:Object.fromEntries([...groups].map(([g,rs])=>[g,rs.length])),
  abBenchmarkCount:pool.length,
  defenseChanged:changes.filter(p=>p.previousDefense!==p.defense).length,
  ovrChanged:changes.filter(p=>p.previousOVR!==p.ovr).length,
  gradeChanged:changes.filter(p=>p.previousGrade!==p.grade).length,
  maxOVRIncrease:Math.max(...changes.map(p=>p.ovr-p.previousOVR)),
  maxOVRDecrease:Math.min(...changes.map(p=>p.ovr-p.previousOVR)),
  scorer:"83% adjusted fielding error percentile + 17% range per nine percentile; 140 chances shrink to position-group error average; 600 innings shrink to 70; 50-98; no fielding innings => null; batter OVR recalculated using RKBO v0.2 season formula and 72 internal neutral for unknown defense"
 };
 return {players,summary,changes};
}
const html=readFileSync(cardPath,"utf8");
const opening='<script id="data" type="application/json">';
const closing='</script>';
const begin=html.indexOf(opening);
const finish=html.indexOf(closing,begin+opening.length);
if(begin<0||finish<0)throw Error("Embedded season 60 data missing");
const players=JSON.parse(html.slice(begin+opening.length,finish));
const out=recalculateSeason60(players,readFileSync(sourcePath,"utf8"));
console.log(JSON.stringify(out.summary,null,2));
if(process.argv.includes("--apply")){
 writeFileSync(cardPath,html.slice(0,begin+opening.length)+JSON.stringify(out.players)+html.slice(finish));
 writeFileSync(auditPath,JSON.stringify({version:1,summary:out.summary,players:out.changes},null,2)+String.fromCharCode(10));
 console.log("Updated 60th season cards and audit");
}
