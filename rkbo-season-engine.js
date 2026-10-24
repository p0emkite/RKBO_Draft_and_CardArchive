/* RKBO Historical Season Card Engine — offline, deterministic, no guessed missing defense.
 * Input: RKBOXLS.parse(.xls) workbook; optional team HTML ZIP and HHRecord ZIP.
 * Output: independent per-season card arrays suitable for existing 60th-season UI.
 */
(function(root){'use strict';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const round=(v,d=0)=>Number(n(v).toFixed(d));
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const norm=x=>String(x||'').normalize('NFKC').trim().replace(/\s+/g,' ');
const display=x=>{let m=norm(x).match(/^(.*?)\s*,\s*(.*)$/);return m?(m[2]+' '+m[1]).trim():norm(x)};
const teamNames={DOO:'두산 베어스',HAN:'한화 이글스',KIA:'KIA 타이거즈',KT:'KT 위즈',LG:'LG 트윈스',LOT:'롯데 자이언츠',NC:'NC 다이노스',SAM:'삼성 라이온즈',SSG:'SSG 랜더스',KIW:'키움 히어로즈'};
const headerKey=x=>String(x||'').trim().toUpperCase();
const eligibleCard=p=>Number.isInteger(Number(p?.stats?.G))&&Number(p.stats.G)>=(p.type==='타자'?50:p.type==='투수'?25:Infinity);
function workbookRows(book){
 const x=book?.sheets;if(!Array.isArray(x))throw Error('엑셀 워크북에서 시트를 읽지 못했습니다.');
 const byType={타자:[],투수:[]};
 for(const sh of x){if(!['타자','투수'].includes(sh.name))continue;
  const first=sh.rows[0]?.cells||[];const header=first.map(headerKey);
  if(!header.includes('SS')||!header.includes('TEAM')||!header.includes('NAME'))throw Error(sh.name+' 시트에 Ss, Team, Name 열이 없습니다.');
  for(const row of sh.rows.slice(1)){
   const record={};header.forEach((key,i)=>{if(key)record[key]=row.cells[i]??null});
   const season=n(record.SS),team=String(record.TEAM||'').trim().toUpperCase();
   if(!Number.isInteger(season)||season<1||season>999||!teamNames[team]||!record.NAME)continue;
   byType[sh.name].push({season,team,rawName:norm(record.NAME),type:sh.name,record});
  }
 }
 if(!byType.타자.length||!byType.투수.length)throw Error('타자·투수 시트가 모두 들어 있는 RKBO 엑셀 파일이 필요합니다.');
 return byType;
}
function ip(raw){ // HH source writes third-of-an-inning as .3/.7; use integer outs.
 const value=n(raw),whole=Math.floor(value),frac=round(value-whole,2);
 const outs=frac<0.15?0:frac<0.5?1:frac<0.85?2:Math.min(2,Math.round(frac*3));
 return (whole*3+outs)/3;
}
function rowToPlayer(row,index){
 const raw=row.record,t=row.type,season=row.season,team=row.team,teamLabel=teamNames[team];
 let stats,pos,indicators,sample;
 if(t==='타자'){
  stats={G:n(raw.G),Avg:n(raw.AVG),Obp:n(raw.OBP),Slg:n(raw.SLG),Ab:n(raw.AB),H:n(raw.H),'2B':n(raw.H2B),'3B':n(raw.H3B),Hr:n(raw.HR),R:n(raw.R),Rbi:n(raw.RBI),BB:n(raw.BB),K:n(raw.K),Sb:n(raw.SB),Cs:n(raw.CS)};
  pos=String(raw.POS||'UT').trim().toUpperCase();sample=stats.Ab;
  const divisor=Math.max(1,sample+stats.BB),attempt=stats.Sb+stats.Cs;
  indicators={AVG:stats.Avg,ISO:Math.max(0,stats.Slg-stats.Avg),HR_AB:stats.Hr/Math.max(1,sample),BB_ABBB:stats.BB/divisor,K_ABBB:stats.K/divisor,ATT_AB:attempt/Math.max(1,sample),TRI_AB:stats['3B']/Math.max(1,sample),SB_PCT:attempt?stats.Sb/attempt:null,SB_ATT:attempt};
 }else{
  pos=n(raw.GS)>=n(raw.G)*.5&&n(raw.GS)>0?'SP':'RP';
  stats={ERA:n(raw.ERA),W:n(raw.W),L:n(raw.L),S:n(raw.S),BS:n(raw.BS),G:n(raw.G),GS:n(raw.GS),CG:n(raw.CG),SHO:n(raw.SHO),IP:n(raw.IP),K:n(raw.K),BB:n(raw.BB),H:n(raw.H),'2B':n(raw.H2B),'3B':n(raw.H3B),HR:n(raw.HR),SB:n(raw.SB),CS:n(raw.CS),BK:n(raw.BK),WP:n(raw.WP),R:n(raw.R),ER:n(raw.ER),Avg:n(raw.AVG),Obp:n(raw.OBP),Slg:n(raw.SLG)};
  stats.IP_real=ip(stats.IP);stats.IP_outs=Math.round(stats.IP_real*3);sample=stats.IP_real;
  const mul=9/Math.max(stats.IP_real,.3333);indicators={K9:stats.K*mul,BB9:stats.BB*mul,H9:stats.H*mul,HR9:stats.HR*mul,IP_PER_GS:stats.IP_real/Math.max(1,stats.GS),IP_PER_G:stats.IP_real/Math.max(1,stats.G)};
 }
 return {id:`${season}-${team}-${t==='타자'?'타':'투'}-${String(index+1).padStart(3,'0')}`,season,team,teamLabel,name:display(row.rawName),rawName:row.rawName,englishName:display(row.rawName),type:t,pos,stats,sample,indicators};
}
function weighted(samples,keys){const ret={};for(const key of keys){let values=samples.map(p=>p.indicators[key]).filter(v=>Number.isFinite(v));ret[key]=values.length?values.reduce((a,b)=>a+b,0)/values.length:0}return ret}
function percentile(values,x){if(!values.length)return .5;
 let lo=0,hi=values.length;while(lo<hi){let mid=(lo+hi)>>1;if(values[mid]<x)lo=mid+1;else hi=mid}const first=lo;
 hi=values.length;while(lo<hi){let mid=(lo+hi)>>1;if(values[mid]<=x)lo=mid+1;else hi=mid}return (first+lo)/(2*values.length)
}
const sortNum=a=>a.slice().sort((a,b)=>a-b);
function grade(ovr){return ovr>=91?'다이아몬드':ovr>=84?'코랄':ovr>=75?'골드':ovr>=65?'실버':'브론즈'}
function scoreSeason(players){
 const batters=players.filter(p=>p.type==='타자'),pitchers=players.filter(p=>p.type==='투수');
 const setting={
  타자:[{key:'AVG',sample:'AB',prior:180},{key:'ISO',sample:'AB',prior:180},{key:'HR_AB',sample:'AB',prior:180},{key:'BB_ABBB',sample:'AB',prior:180},{key:'K_ABBB',sample:'AB',prior:180},{key:'ATT_AB',sample:'AB',prior:250},{key:'TRI_AB',sample:'AB',prior:250},{key:'SB_PCT',sample:'ATT',prior:8}],
  투수:[{key:'K9',prior:35},{key:'BB9',prior:35},{key:'H9',prior:35},{key:'HR9',prior:35},{key:'ERA',prior:35},{key:'IP_PER_GS',prior:35},{key:'IP_PER_G',prior:35}]
 };
 for(const [type,group] of [['타자',batters],['투수',pitchers]]){
  const basis=group.filter(p=>type==='타자'?p.stats.Ab>=300:p.stats.IP_real>=50);
  const pool=basis.length>=8?basis:group;
  const keys=setting[type].map(e=>e.key);
  for(const p of group){if(type==='투수')p.indicators.ERA=p.stats.ERA}
  const mu=weighted(pool,keys);
  for(const p of group){p.adjusted={};for(const {key,prior} of setting[type]){
   const observed=p.indicators[key];const sample=type==='타자'?(key==='SB_PCT'?p.indicators.SB_ATT:p.stats.Ab):p.stats.IP_real;
   const value=Number.isFinite(observed)?observed:mu[key];
   p.adjusted[key]=(value*sample+mu[key]*prior)/(sample+prior);
  }}
  const dists={};for(const key of keys)dists[key]=sortNum(pool.map(p=>p.adjusted[key]));
  const score=(p,key,reverse=false)=>clamp(Math.round(50+48*(reverse?1-percentile(dists[key],p.adjusted[key]):percentile(dists[key],p.adjusted[key]))),50,98);
  for(const p of group){let r;
   if(type==='타자'){
    const contact=Math.round(.78*score(p,'AVG')+.22*score(p,'K_ABBB',true));
    const power=Math.round(.62*score(p,'ISO')+.38*score(p,'HR_AB'));
    const eye=Math.round(.68*score(p,'BB_ABBB')+.32*score(p,'K_ABBB',true));
    const speed=Math.round(.62*score(p,'ATT_AB')+.22*score(p,'TRI_AB')+.16*score(p,'SB_PCT'));
    r={'정확':contact,'파워':power,'선구':eye,'주루':speed,'수비':null};
    p.unavailable=['해당 시즌 수비 기록 없음','실제 달리기 속도 없음'];
    p.derived={'OPS':round(p.stats.Obp+p.stats.Slg,3),'ISO':round(p.indicators.ISO,3),'HR/AB':round(p.indicators.HR_AB,4),'BB/(AB+BB)':round(p.indicators.BB_ABBB,4),'K/(AB+BB)':round(p.indicators.K_ABBB,4),'도루성공률':p.indicators.SB_PCT===null?null:round(p.indicators.SB_PCT,3)};
   }else{
    const staminaKey=p.pos==='SP'?'IP_PER_GS':'IP_PER_G';
    const comparable=pool.filter(o=>o.pos===p.pos).map(o=>o.adjusted[staminaKey]);
    const stamina=comparable.length>=4?clamp(Math.round(50+48*percentile(sortNum(comparable),p.adjusted[staminaKey])),50,98):score(p,staminaKey);
    r={'구위':score(p,'K9'),'제구':score(p,'BB9',true),'피안타 억제':score(p,'H9',true),'피홈런 억제':score(p,'HR9',true),'체력':stamina};
    p.eraRating=score(p,'ERA',true);
    p.unavailable=['구속','변화구','실제 구위'];
    p.derived={'K/9':round(p.indicators.K9,2),'BB/9':round(p.indicators.BB9,2),'H/9':round(p.indicators.H9,2),'HR/9':round(p.indicators.HR9,2),'IP/GS':round(p.indicators.IP_PER_GS,2),'IP/G':round(p.indicators.IP_PER_G,2)};
   }
   p.ratings=r;
   p.skillIndex=type==='타자'?round(.32*r['정확']+.31*r['파워']+.23*r['선구']+.08*r['주루']+.06*72,2):round(.18*r['구위']+.14*r['제구']+.17*r['피안타 억제']+.10*r['피홈런 억제']+.12*r['체력']+.29*p.eraRating,2);
  }
  const indexDist=sortNum(pool.map(p=>p.skillIndex));
  for(const p of group){
   const estimated=.38*p.skillIndex+.62*(56+43*percentile(indexDist,p.skillIndex));
   const W=type==='타자'?Math.min(1,p.stats.Ab/440):p.pos==='SP'?Math.min(1,p.stats.IP_real/150):Math.min(1,p.stats.IP_real/45);
   let ovr=Math.round(51+(estimated-51)*(.22+.78*W));
   if(type==='투수'&&p.pos==='SP')ovr+=Math.round(4*clamp((p.stats.IP_real-140)/80,0,1));
   let cap;
   if(type==='타자')cap=p.stats.Ab<100?64:p.stats.Ab<200?74:p.stats.Ab<300?83:p.stats.Ab<400?90:99;
   else cap=p.pos==='SP'?(p.stats.IP_real<20?64:p.stats.IP_real<50?74:p.stats.IP_real<100?83:p.stats.IP_real<140?90:99):(p.stats.IP_real<10?64:p.stats.IP_real<20?74:p.stats.IP_real<30?83:p.stats.IP_real<40?90:99);
   p.potentialOVR=round(estimated,1);p.ovrNoCap=ovr;p.gradeCap=cap;p.sampleRatio=round(W,3);p.ovr=clamp(ovr,40,cap);p.grade=grade(p.ovr);p.ovrLogic={'표본비율':p.sampleRatio,'등급상한OVR':cap,'상한전OVR':ovr,'기량지표':p.potentialOVR};
  }
  group.sort((a,b)=>b.ovr-a.ovr||a.name.localeCompare(b.name));
  group.forEach((p,i)=>p.rank=1+group.filter(x=>x.ovr>p.ovr).length);
 }
 return players;
}
function engine(book){
 const parsed=workbookRows(book),groups=new Map();
 for(const type of ['타자','투수']){
  const counters=new Map();
  for(const row of parsed[type]){
   const group=`${row.season}-${row.team}-${type}`,index=counters.get(group)||0;counters.set(group,index+1);
   if(!groups.has(row.season))groups.set(row.season,[]);
   groups.get(row.season).push(rowToPlayer(row,index));
  }
 }
 const out=new Map();for(const [season,players] of groups){out.set(season,scoreSeason(players).filter(eligibleCard))}
 return out;
}
function htmlPlayers(html,team){
 const doc=new DOMParser().parseFromString(html,'text/html'),tables=[...doc.querySelectorAll('table')];
 const selected=tables.filter(t=>t.querySelector('tr')&&/Name/i.test(t.querySelector('tr').textContent||''));
 const rows=[];
 for(const t of selected.slice(0,2)){
  const lines=[...t.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>td.textContent.trim()));
  const header=lines.shift()||[];
  for(const cols of lines){if(!cols[0])continue;const r={};header.forEach((h,i)=>r[headerKey(h)]=cols[i]||'');rows.push({team,rawName:cols[0],type:header.some(h=>/ERA/i.test(h))?'투수':'타자',record:r});}
 }
 return rows;
}
async function checkSupplemental(master,teamZip,recordZip){
 const report={teamHtml:{files:0,batters:0,pitchers:0,mismatch:0},hhRecord:{pages:0,fieldingPages:0,notes:[]}};
 if(teamZip){const zip=await JSZip.loadAsync(teamZip),list=Object.keys(zip.files).filter(x=>/^(?:DOO|HAN|KIA|LG|LOT|NC|SAM|SSG)\.html$/i.test(x));
  for(const path of list){const team=path.replace(/\.html$/i,'').toUpperCase(),s=await zip.file(path).async('string');const rows=htmlPlayers(s,team);report.teamHtml.files++;report.teamHtml.batters+=rows.filter(p=>p.type==='타자').length;report.teamHtml.pitchers+=rows.filter(p=>p.type==='투수').length;
   const sample=master.get(60)||[];for(const row of rows){let found=sample.find(x=>x.team===team&&x.type===row.type&&norm(x.rawName).toLowerCase()===norm(row.rawName).toLowerCase());if(!found)report.teamHtml.mismatch++}
  }
 }
 if(recordZip){const zip=await JSZip.loadAsync(recordZip);const keys=Object.keys(zip.files);report.hhRecord.pages=keys.filter(x=>/\.html?$/i.test(x)).length;report.hhRecord.fieldingPages=keys.filter(x=>/Results\/Records_ML_1(?:1[7-9]|2[0-5])\.htm$/i.test(x)).length;report.hhRecord.notes=['HHRecord의 구종·구속 원자료는 기본 누적 성적에 없어 새 카드에 임의 산출하지 않습니다.','60차 수비는 이미 검증된 기존 카드를 유지합니다.'];
 }
 return report;
}
function packSeason(players){
 // Keep only fields used by the public card viewer, editor, and PNG renderer.
 // Derived data is kept for the player detail stats, but calculation scratchpad is omitted.
 return players.map(p=>({id:p.id,season:p.season,team:p.team,teamLabel:p.teamLabel,name:p.name,rawName:p.rawName,englishName:p.englishName,type:p.type,pos:p.pos,stats:p.stats,ratings:p.ratings,derived:p.derived,skillIndex:p.skillIndex,ovr:p.ovr,grade:p.grade,rank:p.rank,fieldPrimary:null}));
}
root.RKBOSeasonEngine={fromWorkbook:engine,parseRows:workbookRows,parseHTML:htmlPlayers,verify:checkSupplemental,pack:packSeason};
})(typeof window==='undefined'?globalThis:window);
