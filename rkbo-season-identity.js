/* RKBO seasonal identity reconciliation.
 * Stats/OVR: unified RKBO Excel. Club and historic nickname: the SEASON'S 1군 personal-stat sheets.
 * Reads either HTML tables or tab-delimited TXT copies from a ZIP, including #UXXXX filenames.
 * Never joins solely by name and never changes ratings, original Excel stats, or stable card IDs.
 */
(function(root){'use strict';
const TEAM_NAMES={DOO:'두산 베어스',HAN:'한화 이글스',KIA:'KIA 타이거즈',LG:'LG 트윈스',LOT:'롯데 자이언츠',NC:'NC 다이노스',SAM:'삼성 라이온즈',SSG:'SSG 랜더스',KT:'KT 위즈',KIW:'키움 히어로즈'};
const tabHead=x=>String(x||'').trim().toUpperCase();
const key=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
const display=s=>{const m=String(s||'').match(/^(.*?)\s*,\s*(.+)$/);return m?(m[2]+' '+m[1]).trim():String(s||'').trim()};
const asNum=x=>{if(x===null||x===undefined||String(x).trim()==='')return NaN;return Number(x)};
function decodeFilename(filename){return String(filename).replace(/#U([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))}
function sourceTeam(filename){
 const stem=decodeFilename(String(filename).split('/').pop()).replace(/\.(?:txt|html?|htm)$/i,'').toUpperCase().trim();
 const names={두산:'DOO',롯데:'LOT',삼성:'SAM',한화:'HAN',기아:'KIA',키움:'KIW',넥센:'KIW'};
 if(TEAM_NAMES[stem])return stem;
 if(names[stem])return names[stem];
 for(const [name,team] of Object.entries(names))if(stem.includes(name.toUpperCase()))return team;
 for(const code of Object.keys(TEAM_NAMES))if(new RegExp('(?:^|[^A-Z])'+code+'(?:[^A-Z]|$)','i').test(stem))return code;
 return null;
}
function normalizedRow(headers,values,team,source){
 if(!headers.length||!values.length)return null;
 const record={};headers.forEach((field,i)=>{if(field)record[tabHead(field)]=String(values[i]??'').trim()});
 if(!record.NAME||!Number.isFinite(asNum(record.G)))return null;
 const type=headers.some(x=>tabHead(x)==='ERA')?'투수':'타자';
 return {team,type,rawName:record.NAME,record,source};
}
function readText(text,team,source){
 const rows=[];let major=false,headers=[];
 for(const original of String(text).replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=original.replace(/\r$/,'').trim();
  if(/major\s+league\s+roster/i.test(line)){major=true;headers=[];continue}
  if(major&&/^(?:AAA|AA|A)\s+roster\b/i.test(line))break;
  if(!major||!line)continue;
  const columns=(line.includes('\t')?line.split('\t'):line.split(/\s{2,}/)).map(x=>x.trim());
  if(tabHead(columns[0])==='NAME'&&columns.some(x=>tabHead(x)==='G')){
   headers=columns;continue;
  }
  if(!headers.length||columns.length!==headers.length)continue;
  const item=normalizedRow(headers,columns,team,source);if(item)rows.push(item);
 }
 return rows;
}
function readHTML(html,team,source){
 if(typeof DOMParser==='undefined')throw Error('HTML 분석에 DOMParser가 필요합니다.');
 const doc=new DOMParser().parseFromString(html,'text/html'),tables=[...doc.querySelectorAll('table')],rows=[];
 const rosters=[];
 for(const t of tables){
  const lines=[...t.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>td.textContent.trim()));
  if(!lines.length||tabHead(lines[0][0])!=='NAME'||!lines[0].some(x=>tabHead(x)==='G'))continue;
  rosters.push(lines);
  if(rosters.length===2)break; // Major League batter and pitcher; exclude AAA/AA/A tables.
 }
 for(const lines of rosters){
  const headers=lines[0];
  for(const cols of lines.slice(1)){
   const r=normalizedRow(headers,cols,team,source);if(r)rows.push(r);
  }
 }
 return rows;
}
function decode(bytes){
 let result=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
 if(result.includes('\uFFFD')&&typeof TextDecoder!=='undefined'){
  try{const kr=new TextDecoder('euc-kr').decode(bytes);if((kr.match(/\uFFFD/g)||[]).length<(result.match(/\uFFFD/g)||[]).length)result=kr}catch{}
 }
 return result;
}
async function readTeamSource(file){
 if(!file)throw Error('개인 성적 ZIP 또는 TXT/HTML 파일이 없습니다.');
 const name=file.name||'season.zip',ext=name.split('.').pop().toLowerCase(),documents=[];
 if(ext==='zip'){
  if(typeof JSZip==='undefined')throw Error('ZIP 라이브러리를 불러오지 못했습니다.');
  const zip=await JSZip.loadAsync(await file.arrayBuffer());
  for(const [path,entry] of Object.entries(zip.files)){
   if(entry.dir||!/\.(?:txt|html?|htm)$/i.test(path)||/__MACOSX|^\./i.test(path))continue;
   const team=sourceTeam(path);if(!team)continue;
   const bytes=await entry.async('uint8array');documents.push({path,team,text:decode(bytes)});
  }
 }else if(['txt','htm','html'].includes(ext)){
  const team=sourceTeam(name);if(!team)throw Error('파일 이름에서 구단을 찾지 못했습니다. 예: LG.txt, 삼성.txt');
  documents.push({path:name,team,text:decode(new Uint8Array(await file.arrayBuffer()))});
 }else throw Error('팀 성적 파일은 .zip, .txt, .htm 또는 .html 형식만 지원합니다.');
 if(!documents.length)throw Error('개인 성적 파일에서 구단별 TXT/HTML을 찾지 못했습니다. 파일 이름은 LG.txt, 삼성.txt 등으로 저장하세요.');
 const rows=[],warnings=[],seen=new Map();
 for(const doc of documents){
  const looksHTML=/<(?:html|table|tr)\b/i.test(doc.text);
  const parsed=looksHTML?readHTML(doc.text,doc.team,doc.path):readText(doc.text,doc.team,doc.path);
  if(!parsed.length)warnings.push(doc.path+': 1군 선수 행을 읽지 못했습니다.');
  for(const r of parsed){
   const finger=r.team+'|'+r.type+'|'+key(r.rawName)+'|'+r.record.G+'|'+(r.record.AB||r.record.IP);
   if(seen.has(finger)){warnings.push(doc.path+': 중복 기록 '+r.rawName);continue}
   seen.set(finger,true);rows.push(r);
  }
 }
 return {rows,teamCount:new Set(rows.map(r=>r.team)).size,files:documents.map(d=>d.path),warnings};
}
const BAT=['G','AB','H','HR','RBI','BB','K','SB','CS','2B','3B'], PIT=['G','GS','W','L','S','IP','K','BB','H','HR','ER','R','CG','SHO'];
const BAT_REQ=['G','AB','H','HR','RBI','BB','K'],PIT_REQ=['G','GS','W','L','IP','K','BB','H','ER'];
function cardStat(p,k){
 const mapped={
 AB:'Ab',RBI:'Rbi','2B':'2B','3B':'3B',
 HR:p.type==='타자'?'Hr':'HR',SB:p.type==='타자'?'Sb':'SB',CS:p.type==='타자'?'Cs':'CS'
 };
 return p.stats?.[mapped[k]||k];
}
function compare(p,r){
 const fields=p.type==='타자'?BAT:PIT;
 const equal=[];
 for(const k of fields){
  const a=asNum(cardStat(p,k)),b=asNum(r.record[k]);
  if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.011)equal.push(k);
 }
 return equal;
}
function compareSeason(cards,source,season){
 if(!Array.isArray(cards))throw Error('기존 선수 카드 JSON을 찾지 못했습니다.');
 const rows=source.rows||[],taken=new Set(),matches=[],unmatched=[],ambiguous=[];
 const duplicates=[];
 for(const r of rows){
  const candidates=cards.filter(p=>p.type===r.type && Number(p.season)===Number(season) && asNum(cardStat(p,'G'))===asNum(r.record.G));
  const essential=r.type==='타자'?BAT_REQ:PIT_REQ;
  const qualified=candidates.map(p=>({p,equal:compare(p,r)})).filter(x=>essential.every(k=>x.equal.includes(k)));
  if(qualified.length!==1){
   const info={team:r.team,type:r.type,originalName:r.rawName,source:r.source,reason:qualified.length?'여러 선수의 핵심 성적이 일치':'핵심 기록과 일치하는 카드 없음',candidates:qualified.map(x=>x.p.id)};
   (qualified.length?ambiguous:unmatched).push(info);continue;
  }
  const chosen=qualified[0];
  if(taken.has(chosen.p.id)){duplicates.push({name:r.rawName,id:chosen.p.id,source:r.source});continue}
  taken.add(chosen.p.id);matches.push({row:r,player:chosen.p,equal:chosen.equal});
 }
 const teamChanges=matches.filter(m=>m.row.team!==m.player.team);
 const nameChanges=matches.filter(m=>key(m.row.rawName)!==key(m.player.rawName));
 const next=cards.map(x=>({...x}));
 for(const {row,player,equal} of matches){
  const p=next.find(item=>item.id===player.id);
  p.sourceVerified=true;
  p.seasonRecordedName=row.rawName; // exact historic spelling, not modern Excel nickname
  p.seasonNameSource='team-personal-stats';
  p.sourceTeamVerified=true;
  p.recordMatchEvidence={season:Number(season),source:'team-personal-stats',document:row.source,fields:equal};
  if(p.team!==row.team){p.excelTeam=p.excelTeam||p.team;p.team=row.team;p.teamLabel=TEAM_NAMES[row.team]}
 }
 return {
  season:Number(season),rows:rows.length,matched:matches.length,teamCount:source.teamCount,
  teamChanges:teamChanges.map(({row,player})=>({id:player.id,name:player.rawName,from:player.team,to:row.team,sourceName:row.rawName})),
  nameChanges:nameChanges.map(({row,player})=>({id:player.id,team:row.team,current:player.rawName,historic:row.rawName})),
  unmatched,ambiguous,duplicates,
  unlistedCards:cards.filter(p=>!taken.has(p.id)).map(p=>({id:p.id,team:p.team,name:p.rawName})),
  players:next
 };
}
root.RKBOSeasonIdentity={sourceTeam,readText,readHTML,readTeamSource,compareSeason,display};
})(window);
