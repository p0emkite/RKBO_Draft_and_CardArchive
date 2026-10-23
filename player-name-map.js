/* Names: adapted from RKBO_CareerMaker/roster.js.
   data/player_db.csv: Season,Team,Name,KoreanName.
   Unmatched or ambiguous players retain the English spelling. */
(function(){
'use strict';
const normalize=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const key=v=>normalize(v).replace(/[^a-z0-9가-힣]+/g,'');
const englishVariants=name=>{
 const raw=String(name??'').trim(),variants=[key(raw)];
 const m=raw.match(/^(.*?)\s*,\s*(.*?)$/);
 if(m){variants.push(key(m[2]+' '+m[1]));variants.push(key(m[1]+' '+m[2]))}
 return [...new Set(variants.filter(Boolean))];
};
function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false;
 const s=String(text||'').replace(/^\uFEFF/,'');
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){if(c==='"'&&s[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}
  else if(c==='"'&&field==='')quoted=true;
  else if(c===','){row.push(field);field=''}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v.trim()!==''))rows.push(row);row=[]}
  else field+=c;
 }
 row.push(field);if(row.some(v=>v.trim()!==''))rows.push(row);
 if(!rows.length)return [];
 const header=rows.shift().map(v=>v.trim());
 return rows.map(row=>Object.fromEntries(header.map((name,i)=>[name,(row[i]??'').trim()])));
}
const teamAliases={
 DOO:['DOO','두산'],HAN:['HAN','한화'],KIA:['KIA','기아'],LG:['LG'],
 LOT:['LOT','롯데'],NC:['NC'],SAM:['SAM','삼성'],SSG:['SSG','SK'],
 KT:['KT'],KIW:['KIW','키움','넥센']
};
function selectName(p,byEnglish){
 const candidates=[];
 for(const original of [p.rawName,p.englishName,...(p.aliases||[])]){
  if(!original)continue;
  for(const r of byEnglish.get(key(original))||[])candidates.push(r);
 }
 if(!candidates.length)return null;
 const unique=new Set(candidates.map(r=>key(r.KoreanName)));
 if(unique.size===1)return candidates[0].KoreanName;
 const teams=(teamAliases[p.team]||[p.team]).map(key);
 const matching=candidates.filter(r=>Number(r.Season)===Number(p.season)
   && (!r.Team||teams.includes(key(r.Team))));
 const names=new Set(matching.map(r=>key(r.KoreanName)));
 return names.size===1?matching[0].KoreanName:null;
}
async function apply(players,dataElement){
 const report={total:players.length,matched:0,unmatched:[],source:'data/player_db.csv'};
 try{
  const response=await fetch('./data/player_db.csv',{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const records=parseCSV(await response.text()),byEnglish=new Map();
  for(const r of records){
   if(!r.Name||!r.KoreanName)continue;
   for(const alias of englishVariants(r.Name)){
    if(!byEnglish.has(alias))byEnglish.set(alias,[]);
    byEnglish.get(alias).push(r);
   }
  }
  for(const p of players){
   p.englishName=p.englishName||p.name;
   const korean=selectName(p,byEnglish);
   p.koreanName=korean||null;
   if(korean){p.name=korean;report.matched++}
   else report.unmatched.push({id:p.id,english:p.englishName,rawName:p.rawName,team:p.team});
  }
  if(dataElement)dataElement.textContent=JSON.stringify(players).replace(/</g,'\\u003c');
  console.info('[RKBO 한글 이름]',report.matched+'/'+report.total+'명',report.unmatched.length+'명 미등록');
 }catch(error){
  report.error=String(error);
  console.warn('[RKBO 한글 이름] CSV 읽기 실패: 원문 유지',error);
 }
 window.RKBONameMapReport=report;
 return report;
}
window.RKBONameMap={apply,parseCSV,englishVariants,key};
})();