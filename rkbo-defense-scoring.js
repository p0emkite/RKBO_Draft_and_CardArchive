/* RKBO season fielding scorer (final TXT authoritative; optional HHRecord corroboration).
 * Position-group scoring matches 60th season. No network, no invented player records.
 */
(function(root){"use strict";
const norm=s=>String(s??"").normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
const display=s=>{const m=String(s??"").match(/^(.*?)\s*,\s*(.+)$/);return m?(m[2]+" "+m[1]).trim():String(s??"").trim()};
const teamCode=s=>{
 const t=String(s??"").normalize("NFKC").toUpperCase().trim();
 const aliases={SK:"SSG",BEARS:"DOO",DOOSAN:"DOO",EAGLES:"HAN",HANWHA:"HAN",TIGERS:"KIA",TWINS:"LG",GIANTS:"LOT",LOTTE:"LOT",DINOS:"NC",LIONS:"SAM",SAMSUNG:"SAM",LANDERS:"SSG",WYVERNS:"SSG",WIZ:"KT",HEROES:"KIW",KIWOOM:"KIW",NEXEN:"KIW",두산:"DOO",한화:"HAN",기아:"KIA",롯데:"LOT",삼성:"SAM",키움:"KIW"};
 if(["DOO","HAN","KIA","KT","LG","LOT","NC","SAM","SSG","KIW"].includes(t))return t;
 if(aliases[t])return aliases[t];
 for(const [name,code] of Object.entries(aliases))if(t.includes(name))return code;
 return t;
};
const nickKeys=p=>[p.name,p.englishName,p.historicalEnglishName,p.rawName,p.seasonRecordedName].flatMap(s=>s?[norm(s),norm(display(s))]:[]).filter(Boolean);
const groupOf=pos=>["LF","CF","RF","OF"].includes(pos)?"OF":["2B","SS"].includes(pos)?"MI":pos;
const numeric=(s,label)=>{if(s===undefined||s===null||String(s).trim()==="")throw Error(label+" 값이 비어 있습니다.");const n=Number(String(s).replace(/,/g,""));if(!Number.isFinite(n)||n<0)throw Error(label+": 잘못된 숫자 "+s);return n};
const round=(x,d=0)=>Number(x.toFixed(d)),clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function cellsOf(line,sep){
 if(sep!=="csv")return line.split(sep).map(v=>v.trim());
 const values=[];let current="",quoted=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(c==='"'&&quoted&&line[i+1]==='"'){current+='"';i++;continue}
  if(c==='"'){quoted=!quoted;continue}
  if(c===","&&!quoted){values.push(current.trim());current="";continue}
  current+=c;
 }
 if(quoted)throw Error("CSV 따옴표가 닫히지 않았습니다.");
 values.push(current.trim());return values;
}
function parseFinal(text){
 const lines=String(text??"").replace(/^\uFEFF/,"").replace(/\r/g,"").split("\n").filter(v=>v.trim());
 if(lines.length<2)throw Error("최종 수비 TXT에 데이터 행이 없습니다.");
 const sep=lines[0].includes("\t")?"\t":lines[0].includes(",")?"csv":null;
 if(!sep)throw Error("최종 수비 TXT는 탭 구분(TSV) 또는 CSV 헤더 형식이어야 합니다.");
 const headers=cellsOf(lines[0],sep).map(x=>x.toUpperCase().replace(/\s+/g,""));
 const aliases={PLAYER:"PLAYER",NAME:"PLAYER",TEAM:"TEAM",CLUB:"TEAM",POS:"POS",POSITION:"POS",G:"G",PO:"PO",A:"A",E:"E",INN:"INN",INNINGS:"INN",IP:"INN",TC:"TC",CHANCES:"TC",FA:"FA",DP:"DP",PB:"PB",SB:"SB",CS:"CS","SB%":"SB%",RF:"RF",AGE:"AGE"};
 const indices={};headers.forEach((x,i)=>{if(aliases[x]){const key=aliases[x];if(indices[key]!==undefined)throw Error("중복 헤더 "+x);indices[key]=i}});
 for(const required of ["PLAYER","TEAM","POS","G","PO","A","E","INN"])if(indices[required]===undefined)throw Error("최종 수비 TXT 필수 열 누락: "+required);
 const numericColumns=["G","PO","A","E","INN","TC","FA","DP","PB","SB","CS","SB%","RF","AGE"];
 const rows=[],seen=new Set();
 for(let i=1;i<lines.length;i++){
  const cols=cellsOf(lines[i],sep);if(cols.length!==headers.length)throw Error("수비 TXT "+(i+1)+"행: 열 개수 불일치");
  const s=k=>indices[k]===undefined?undefined:cols[indices[k]];
  const p=String(s("PLAYER")||"").trim(),team=teamCode(s("TEAM")),pos=String(s("POS")||"").trim().toUpperCase();
  if(!p||!["DOO","HAN","KIA","KT","LG","LOT","NC","SAM","SSG","KIW"].includes(team))throw Error("수비 TXT "+(i+1)+"행: 선수 또는 팀 코드 오류");
  if(!["C","1B","2B","3B","SS","LF","CF","RF","OF","P","SP","RP","DH"].includes(pos))throw Error("수비 TXT "+(i+1)+"행: 포지션 오류 ("+pos+")");
  const obj={Player:p,Team:team,POS:pos};
  for(const k of numericColumns){const v=s(k);if(v!==undefined&&v!=="")obj[k]=numeric(v,p+"/"+k)}
  if(obj.TC===undefined)obj.TC=obj.PO+obj.A+obj.E;
  if(obj.TC!==obj.PO+obj.A+obj.E)throw Error(p+": 수비 기회(TC)와 PO+A+E가 일치하지 않습니다.");
  if(!Number.isInteger(obj.G))throw Error(p+": 수비 출장(G)은 정수여야 합니다.");
  if(obj.G===0&&(obj.INN!==0||obj.TC!==0))throw Error(p+": 수비 출장 0인데 수비 이닝·기회가 존재합니다.");
  const key=team+"|"+norm(p)+"|"+pos;
  if(seen.has(key))throw Error("최종 수비 중복 선수/포지션: "+p+" "+team+" "+pos);
  seen.add(key);rows.push(obj);
 }
 if(!rows.length)throw Error("수비 기록이 비어 있습니다.");
 return {rows,teams:[...new Set(rows.map(r=>r.Team))],columns:headers,sourceRows:rows.length};
}
function aggregateFinal(rows){
 const map=new Map();
 for(const r of rows){
  const key=r.Team+"|"+norm(r.Player);
  let entry=map.get(key);
  if(!entry){entry={...r,positions:[r],best:r.POS};map.set(key,entry);continue}
  if(r.INN>Math.max(...entry.positions.map(x=>x.INN)))entry.best=r.POS;
  entry.positions.push(r);
  for(const k of ["PO","A","E","INN","TC","DP","PB","SB","CS"])entry[k]=(entry[k]||0)+(r[k]||0);
  entry.G=Math.max(entry.G,r.G); // Position appearances can overlap.
  entry.POS=entry.best;
 }
 return [...map.values()];
}
function lowerBound(a,x){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m]<x)lo=m+1;else hi=m}return lo}
function upperBound(a,x){let lo=0,hi=a.length;while(lo<hi){const m=(lo+hi)>>1;if(a[m]<=x)lo=m+1;else hi=m}return lo}
const percentile=(a,x)=>(lowerBound(a,x)+upperBound(a,x))/(2*a.length);
function updateOVR(cards){
 const batters=cards.filter(p=>p.type==="타자"),pool=batters.filter(p=>Number(p.stats?.Ab)>=300);
 const peers=(pool.length>=8?pool:batters).map(p=>p.skillIndex).sort((a,b)=>a-b);
 const grade=x=>x>=91?"다이아몬드":x>=84?"코랄":x>=75?"골드":x>=65?"실버":"브론즈";
 for(const p of batters){
  const r=p.ratings;if(!r)throw Error("타자 능력치 누락: "+p.id);
  const defense=r.수비==null?72:r.수비;
  p.skillIndex=round(.32*r.정확+.31*r.파워+.23*r.선구+.08*r.주루+.06*defense,2);
 }
 // Benchmark MUST be formed after all indices are refreshed.
 const sorted=(pool.length>=8?pool:batters).map(p=>p.skillIndex).sort((a,b)=>a-b);
 for(const p of batters){
  const estimate=.38*p.skillIndex+.62*(56+43*percentile(sorted,p.skillIndex));
  const ab=Number(p.stats.Ab),w=Math.min(1,ab/440);
  const preCap=Math.round(51+(estimate-51)*(.22+.78*w));
  const cap=ab<100?64:ab<200?74:ab<300?83:ab<400?90:99;
  p.potentialOVR=round(estimate,1);p.ovrNoCap=preCap;p.gradeCap=cap;p.sampleRatio=round(w,3);
  p.ovr=clamp(preCap,40,cap);p.grade=grade(p.ovr);
  p.ovrLogic={"표본비율":p.sampleRatio,"등급상한OVR":cap,"상한전OVR":preCap,"기량지표":p.potentialOVR};
 }
 for(const p of cards)p.rank=1+cards.filter(q=>q.type===p.type&&q.ovr>p.ovr).length;
}
function rescore(cards,sourceRows,sourceLabel="최종 수비 기록"){
 if(!Array.isArray(cards)||!cards.length)throw Error("기존 시즌 카드 데이터가 없습니다.");
 const players=JSON.parse(JSON.stringify(cards)),batters=players.filter(p=>p.type==="타자");
 const original=new Map(cards.map(p=>[p.id,{def:p.ratings?.수비??null,ovr:p.ovr,grade:p.grade,team:p.team}]));
 const source=aggregateFinal(sourceRows);
 const lookup=new Map(),unmatched=[],ambiguous=[],used=new Set();
 for(const p of batters){
  const variants=new Set(nickKeys(p));
  const matches=source.filter(r=>teamCode(p.team)===r.Team&&(variants.has(norm(r.Player))||variants.has(norm(display(r.Player)))));
  if(matches.length===1){lookup.set(p.id,matches[0]);used.add(source.indexOf(matches[0]))}
  else if(matches.length>1)ambiguous.push(p.id+": 여러 수비 기록과 일치");
  else unmatched.push({id:p.id,team:p.team,name:p.name});
 }
 const fieldingMatches=[...lookup.values()];
 const groups=new Map();
 for(const r of fieldingMatches){
  if(r.G===0)continue;
  if(r.INN<=0||r.TC<=0){ambiguous.push(r.Player+": 수비 출장 기록은 있지만 이닝/수비기회 없음");continue}
  const group=groupOf(r.POS);
  if(!["OF","MI","C","1B","3B"].includes(group)){ambiguous.push(r.Player+": 평가 대상 포지션 아님 ("+r.POS+")");continue}
  if(!groups.has(group))groups.set(group,[]);
  groups.get(group).push(r);
 }
 const scored=new Map(),fallbackGroups=[];
 for(const [group,groupRows] of groups){
  if(groupRows.length<4){fallbackGroups.push(group+" "+groupRows.length+"명");continue}
  const poolErr=groupRows.reduce((a,r)=>a+r.E,0)/groupRows.reduce((a,r)=>a+r.TC,0);
  const err=r=>(r.E+140*poolErr)/(r.TC+140),range=r=>(r.PO+r.A)*9/r.INN;
  const errs=groupRows.map(err).sort((a,b)=>a-b);
  const ranges=groupRows.map(range).sort((a,b)=>a-b);
  for(const r of groupRows){
   const pe=1-percentile(errs,err(r)),pr=percentile(ranges,range(r));
   const reliability=Math.min(1,r.INN/600);
   const base=50+48*(.83*pe+.17*pr);
   const rating=clamp(Math.round(70+(base-70)*reliability),50,98);
   scored.set(r,{rating,peerGroup:group,adjustedErrorRate:round(err(r),5),rangePerNine:round(range(r),4),errorPercentile:round(pe,4),rangePercentile:round(pr,4),reliability:round(reliability,4)});
  }
 }
 let updated=0,zero=0;
 for(const p of batters){
  const r=lookup.get(p.id);
  if(!r)continue;
  const val=r.G===0?{rating:50,peerGroup:groupOf(r.POS),zeroFielding:true}:scored.get(r);
  if(!val)continue;
  const field={POS:r.POS,G:r.G,INN:r.INN,PO:r.PO,A:r.A,E:r.E,TC:r.TC,CHANCES:r.TC,DP:r.DP??null,FA:r.FA??null,PB:r.PB??null,SB:r.SB??null,CS:r.CS??null,SB_PCT:r["SB%"]??null,RF:r.RF??null};
  p.ratings.수비=val.rating;p.fieldRating=val.rating;p.fieldGames=r.G;
  p.fieldRaw=field;p.fieldPrimary=r.G>0?field:null;
  p.fieldPositions=r.positions.map(x=>({POS:x.POS,G:x.G,INN:x.INN,PO:x.PO,A:x.A,E:x.E,CHANCES:x.TC}));
  p.fieldSource=sourceLabel;
  p.fieldScoreSource=r.G===0?"수비 출장 0경기 · 최저값 50":"실책률 83% · 수비 처리량 17% · 수비 이닝 신뢰도 보정";
  p.fieldScoreDetails=val.zeroFielding?{zeroFielding:true,peerGroup:val.peerGroup}:{...val};
  p.unavailable=(p.unavailable||[]).filter(s=>!/수비 기록 없음|수비 출장 0경기|수비 능력치 미산정|HHRecord 수비 표/.test(String(s)));
  if(r.G===0){p.unavailable.unshift("수비 출장 0경기: 규정 최저 50점");zero++}
  updated++;
 }
 if(updated)updateOVR(players);
 const changes=batters.map(p=>({id:p.id,name:p.name,team:p.team,previousDefense:original.get(p.id).def,defense:p.ratings?.수비??null,
   previousOVR:original.get(p.id).ovr,ovr:p.ovr,previousGrade:original.get(p.id).grade,grade:p.grade,
   fieldingGames:p.fieldGames??null}));
 return {players,changes,report:{batters:batters.length,sourceRows:sourceRows.length,
  matched:lookup.size,updated,zeroFielding50:zero,unmatched,ambiguous,
  insufficientPeerGroups:fallbackGroups,sourceUnmatched:source.filter((_,i)=>!used.has(i)).map(x=>x.Team+" "+x.Player).slice(0,35),
  defenseChanged:changes.filter(c=>c.previousDefense!==c.defense).length,ovrChanged:changes.filter(c=>c.previousOVR!==c.ovr).length,
  gradeChanged:changes.filter(c=>c.previousGrade!==c.grade).length}};
}
async function inspectHH(file,finalRows=[]){
 if(!file)return null;
 if(typeof JSZip==="undefined")throw Error("ZIP 분석 라이브러리를 불러오지 못했습니다.");
 const zip=await JSZip.loadAsync(await file.arrayBuffer());
 const paths=Object.keys(zip.files).filter(x=>/\.html?$/i.test(x));
 const gg=paths.filter(x=>/\/Glove_Last(?:OF|C|1B|2B|3B|SS)\.htm$/i.test(x));
 const notes=[];
 if(!gg.length)notes.push("골든글러브 투표 수비 페이지 없음");
 if(!finalRows.length&&gg.length)notes.push("골든글러브 투표표는 수비 전원 기록이 아니므로 자동 수비 점수 산정에 사용하지 않음. 최종 수비 TXT가 필요합니다.");
 let corroborated=0,disagree=0;
 if(finalRows.length&&gg.length&&typeof DOMParser!=="undefined"){
  for(const path of gg){
   const dom=new DOMParser().parseFromString(await zip.file(path).async("string"),"text/html");
   const table=dom.querySelector("table");if(!table)continue;
   const lines=[...table.querySelectorAll("tr")].map(tr=>[...tr.querySelectorAll("td")].map(x=>x.textContent.trim()));
   const head=(lines.shift()||[]).map(x=>x.toUpperCase());
   const nameIndex=head.indexOf("PLAYER"),a=head.indexOf("A"),po=head.indexOf("PO"),er=head.indexOf("E");
   if(nameIndex<0||a<0||po<0||er<0)continue;
   for(const line of lines){const p=line[nameIndex],r=finalRows.find(x=>norm(x.Player)===norm(p));if(!r)continue;
    corroborated++;
    if([Number(line[a]),Number(line[po]),Number(line[er])].some((v,i)=>v!==[r.A,r.PO,r.E][i]))disagree++;
   }
  }
  if(disagree)notes.push("HHRecord 투표표와 최종 TXT의 일부 기록이 다름. 최신 최종 수비 TXT를 우선 적용함.");
 }
 return {htmlPages:paths.length,glovePages:gg.length,corroborated,disagree,notes};
}
root.RKBODefense={parseFinal,rescore,inspectHH,updateOVR,teamCode};
})(window);
