/* RKBO 1~60 Historical Import Manager
 * Client-only ingestion of old XLS, 8-team HTML ZIP, HHRecord ZIP.
 * Publishes historic cards + original file archive in one atomic GitHub commit.
 */
(function(root){'use strict';
const q=id=>document.getElementById(id);
let evaluated=null, locked=false, historicalAudit=null, historicalBusy=false;
const toMB=size=>(size/1024/1024).toFixed(1)+'MB';
const enc=new TextEncoder();
const archiveTypes=['xls','team-html','hhrecord'];
const escape=s=>String(s??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\"':'&quot;',"'":'&#39;'}[v]));
function notify(msg){const el=q('rkbo-auto-status');if(el)el.textContent=msg;}
function setDisabled(value){locked=value;for(const id of ['rkbo-auto-analyze','rkbo-auto-publish']){const btn=q(id);if(btn)btn.disabled=value}}
async function readLocalFiles(){const xls=q('rkbo-master-xls')?.files[0],team=q('rkbo-team-html')?.files[0],hh=q('rkbo-hhrecord')?.files[0];
 if(!xls)throw Error('RKBO 통합 엑셀(.xls)을 먼저 선택해 주세요.');
 if(!/\.xls$/i.test(xls.name))throw Error('현재는 원본 RKBO 구형 .xls 파일을 지원합니다. .xlsx는 지원하지 않습니다.');
 for(const file of [xls,team,hh].filter(Boolean))if(file.size>85*1024*1024)throw Error(file.name+': 85MB를 초과합니다.');
 return {xls,team,hh};
}
async function analyze(){if(locked)return;setDisabled(true);evaluated=null;
 try{
  const files=await readLocalFiles();
  notify('엑셀의 시즌·선수 기록을 분석하는 중…');
  const work=RKBOXLS.parse(await files.xls.arrayBuffer());
  const seasons=RKBOSeasonEngine.fromWorkbook(work);
  const count=[...seasons.values()].reduce((a,x)=>a+x.length,0);
  const sixty=seasons.get(60)||[];
  if(sixty.length!==211)throw Error('60차 원본 선수는 211명이어야 합니다. 현재 '+sixty.length+'명이 확인되어 파일을 검증할 수 없습니다.');
  if(seasons.size<2)throw Error('통합 엑셀에서 다른 시즌 기록을 찾지 못했습니다.');
  const supplement={};
  if(files.team||files.hh){notify('개인 성적 TXT/HTML과 HHRecord ZIP 구조를 검사하는 중…');
   Object.assign(supplement,await RKBOSeasonEngine.verify(seasons,null,files.hh?await files.hh.arrayBuffer():null));
   if(files.team){
    const source=await RKBOSeasonIdentity.readTeamSource(files.team);
    const yearMatch=files.team.name.match(/([1-9]\d{0,2})차/);
    const year=yearMatch?Number(yearMatch[1]):60;
    const found=seasons.get(year);
    const audit=found?RKBOSeasonIdentity.compareSeason(found,source,year):null;
    supplement.teamHtml={files:source.teamCount,batters:source.rows.filter(p=>p.type==='타자').length,pitchers:source.rows.filter(p=>p.type==='투수').length,mismatch:audit?(audit.unmatched.length+audit.ambiguous.length+audit.duplicates.length):source.rows.length,season:year};
   }
  }
  if(files.team&&supplement.teamHtml?.files!==8)throw Error('8개 구단 개인 성적 ZIP에서 TXT/HTML 구단 파일 8개를 찾지 못했습니다.');
  if(files.hh&&!supplement.hhRecord?.pages)throw Error('HHRecord ZIP에서 상세 기록 HTML을 찾지 못했습니다.');
  evaluated={files,seasons,supplement,total:count};
  const extra=[...seasons.keys()].filter(s=>s!==60).sort((a,b)=>b-a);
  const counts=extra.reduce((r,s)=>(r.total+=seasons.get(s).length,r),{total:0});
  let summary=`분석 완료: ${seasons.size}개 시즌 · 기록 ${count.toLocaleString()}행\n`+
   `자동 등록 대상: ${extra.length}개 시즌(60차 제외) · 선수 카드 ${counts.total.toLocaleString()}장\n`+
   `60차 211장은 기존 검증 데이터 그대로 유지\n`+
   `엑셀: ${files.xls.name} (${toMB(files.xls.size)})\n`+
   (files.team?`8구단 개인 성적: ${supplement.teamHtml.files}개 파일 · 타자 ${supplement.teamHtml.batters}명 / 투수 ${supplement.teamHtml.pitchers}명 · 이름 불일치 ${supplement.teamHtml.mismatch}건\n`:'8구단 HTML: 미선택 (60차 교차검증 생략)\n')+
   (files.hh?`HHRecord: 상세 페이지 ${supplement.hhRecord.pages}개 · 포지션별 수비표 ${supplement.hhRecord.fieldingPages}개\n`:'HHRecord: 미선택 (원본 보관 생략)\n')+
   '과거 시즌의 수비 미확인 값은 —, 선발·구원 및 표본 보정은 시즌별로 적용합니다.';
  notify(summary);q('rkbo-auto-publish').hidden=false;
 }catch(error){console.error(error);notify('분석 실패: '+error.message);q('rkbo-auto-publish').hidden=true}
 finally{setDisabled(false)}
}
async function bufferBase64(bytes){ // source chunk is <= ~512KB. Avoid call stack exhaustion.
 const take=16384;let out='';for(let i=0;i<bytes.length;i+=take)out+=String.fromCharCode(...bytes.subarray(i,i+take));return btoa(out);
}
async function publish(){if(locked)return;if(!evaluated){notify('먼저 파일 분석을 완료해 주세요.');return}
 const bridge=window.RKBOAdminBridge;
 if(!bridge?.isAuthorized?.()){
  notify('GitHub 저장 권한이 필요합니다. 관리자 토큰을 먼저 연결해 주세요. 토큰을 다시 발급한다면 이 저장소에 Contents: Read and write 권한을 지정하세요.');return;
 }
 setDisabled(true);
 try{
  const {files,seasons,supplement}=evaluated;
  let manifestData,importsData;
  try{manifestData=(await bridge.readJson('data/seasons.json')).data||{version:1,seasons:[]}}
  catch{manifestData={version:1,seasons:[]}}
  try{importsData=(await bridge.readJson('data/imports.json')).data||{version:1,files:[]}}
  catch{importsData={version:1,files:[]}}
  // Previously verified identities must survive later XLS imports.
  const protectedSeasons=new Set((manifestData.seasons||[]).filter(v=>v.identityVerified).map(v=>Number(v.season)));
  const entries=[],past=[...seasons.entries()].filter(([k])=>k!==60&&!protectedSeasons.has(k)).sort((a,b)=>b[0]-a[0]);
  const metadata={source:'RKBO(1).xls',method:'RKBO historical season auto-import',generatedAt:new Date().toISOString(),defense:'not_available_without_per-season_fielding_data'};
  for(const [season,players] of past){entries.push({path:`data/seasons/${season}.json`,content:JSON.stringify({season,players:RKBOSeasonEngine.pack(players),metadata})})}
  const existing=Array.isArray(manifestData.seasons)?manifestData.seasons.slice():[];
  const registered=new Map(existing.map(x=>[Number(x.season),x]));
  if(!registered.has(60))registered.set(60,{season:60,file:null,label:'60차 시즌',count:211,source:'embedded'});
  for(const [season,players] of past)registered.set(season,{season,file:`data/seasons/${season}.json`,count:players.length,label:`${season}차 시즌`,source:'rkbo-xls'});
  const manifest={version:1,seasons:[...registered.values()].sort((a,b)=>b.season-a.season)};
  entries.push({path:'data/seasons.json',content:JSON.stringify(manifest,null,2)+'\n'});
  const archives=[['xls',files.xls],['team-html',files.team],['hhrecord',files.hh]].filter(([,file])=>Boolean(file));
  const archiveTime=new Date().toISOString(),id=Date.now().toString(36);
  const registeredFiles=Array.isArray(importsData.files)?importsData.files.slice():[];
  for(const [kind,file] of archives){
   notify(`원본 파일 준비: ${file.name} (${toMB(file.size)})`);
   const buf=new Uint8Array(await file.arrayBuffer());const CHUNK=512*1024;
   const paths=[];
   for(let at=0,idx=0;at<buf.length;at+=CHUNK,idx++){
    const path=`imports/${kind}/${id}-${kind}/${String(idx+1).padStart(3,'0')}.b64`;
    const data=await bufferBase64(buf.subarray(at,Math.min(buf.length,at+CHUNK)));
    entries.push({path,content:data});paths.push(path);
   }
   registeredFiles.push({id:id+'-'+kind,kind,name:file.name,originalName:file.name,size:file.size,mime:file.type||'application/octet-stream',chunks:paths,format:'base64-chunks',chunkBytes:CHUNK,uploadedAt:archiveTime,source:'automatic-season-import'});
  }
  importsData={...importsData,version:1,files:registeredFiles};
  entries.push({path:'data/imports.json',content:JSON.stringify(importsData,null,2)+'\n'});
  if(entries.length>240)throw Error('현재 선택한 자료의 업로드 조각이 240개를 초과합니다.');
  notify(`GitHub 원자적 등록 시작 · 시즌 ${past.length}개 (원본 대조·확인된 시즌 ${protectedSeasons.size}개 유지) · 소스 ${archives.length}개 · 총 ${entries.length}개 Git 파일\n잠시 시간이 걸릴 수 있어요. 탭을 닫지 마세요.`);
  const commit=await bridge.publishBatch(entries,'Register historic RKBO seasons (1~59) from statistics archives',({completed,total,message})=>{
   notify(`GitHub 처리 중 ${completed}/${total}\n${message}\n페이지를 새로고침하지 마세요.`);
  });
  await window.RKBOSeason?.reload?.();
  q('rkbo-auto-publish').hidden=true;
  q('rkbo-auto-success').hidden=false;
  const next=[...seasons.keys()].filter(x=>x!==60).sort((a,b)=>b-a)[0];
  notify(`✓ ${past.length}개 시즌의 선수 카드와 원본 기록 ${archives.length}개 파일을 GitHub에 저장했어.\n커밋: ${commit.slice(0,12)}\n상단 시즌 선택 목록을 새로고침했어. ${next}차 시즌을 선택해서 확인해 봐.`);
  window.dispatchEvent(new Event('rkbo-season-ready'));
 }catch(error){console.error(error);notify('GitHub 등록 실패: '+error.message+'\n토큰의 Contents: Read and write 권한, 저장소 선택 범위, GitHub API 할당량을 확인해 주세요. 원자적 커밋이 실패했다면 기존 시즌 목록은 변경되지 않습니다.')}
 finally{setDisabled(false)}
}

/* Season-specific identity audit works independently of the XLS importer.
 * The contemporary Excel card stays the authoritative STATS record.
 * The historical 1군 TXT/HTML is the authoritative TEAM and DISPLAY NAME record.
 */
function reportHistorical(message){const e=q('rkbo-history-status');if(e)e.textContent=message}
function toggleHistoricalBusy(value){historicalBusy=value;for(const id of ['rkbo-history-analyze','rkbo-history-save']){const button=q(id);if(button)button.disabled=value}}
async function analyzeHistorical(){
 if(historicalBusy)return;
 const season=Number(q('rkbo-history-season')?.value);
 const file=q('rkbo-history-file')?.files?.[0];
 if(!Number.isInteger(season)||season<1||season>59){reportHistorical('현재 이 기능은 1~59차 시즌의 개인 성적표를 지원합니다. 60차는 기존 검증 데이터를 유지합니다.');return}
 if(!file){reportHistorical('해당 시즌의 개인 성적 ZIP 또는 TXT/HTML을 선택하세요.');return}
 if(file.size>25*1024*1024){reportHistorical('파일이 25MB를 초과합니다. 개인 성적 ZIP을 분리해 주세요.');return}
 toggleHistoricalBusy(true);
 try{
  reportHistorical(season+'차의 개인 성적표(TXT/HTML)를 분석하고 있어요…');
  const original=await RKBOSeasonIdentity.readTeamSource(file);
  const path='data/seasons/'+season+'.json';
  const response=await fetch('./'+path+'?v='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error(season+'차 선수 카드를 불러올 수 없습니다 ('+response.status+').');
  const data=await response.json();
  const audit=RKBOSeasonIdentity.compareSeason(data.players,original,season);
  if(!audit.matched)throw Error('성적이 일치하는 1군 선수를 찾지 못했습니다. 차수나 파일을 확인하세요.');
  historicalAudit={season,file,original,audit};
  const teams=original.teamCount,unresolved=audit.unmatched.length+audit.ambiguous.length+audit.duplicates.length;
  const changed=[...audit.teamChanges.map(v=>'[소속팀] '+v.name+': '+v.from+' → '+v.to),
   ...audit.nameChanges.map(v=>'[당시 이름] '+v.current+' → '+v.historic)].join('\n')||'변경된 이름과 팀 없음';
  const report=[
   '분석 완료: '+season+'차 / 개인 성적 '+original.rows.length+'명 ('+teams+'개 구단, 파일 '+original.files.length+'개)',
   '엑셀 기반 카드와 정확히 매칭: '+audit.matched+'명',
   '당시 이름 변경: '+audit.nameChanges.length+'명 / 소속팀 정정: '+audit.teamChanges.length+'명',
   '미일치: '+audit.unmatched.length+' / 중복후보: '+audit.ambiguous.length+' / 중복행: '+audit.duplicates.length,
   unresolved?'⚠ 미해결 기록은 자동 변경하지 않습니다.':'✓ 모든 원본 행이 카드와 1:1로 일치합니다.',
   ...original.warnings.slice(0,8),
   '',
   changed
  ];
  reportHistorical(report.join('\n'));
  q('rkbo-history-save').hidden=false;
 }catch(error){console.error(error);historicalAudit=null;q('rkbo-history-save').hidden=true;reportHistorical('시즌 이름·팀 대조 실패: '+error.message)}
 finally{toggleHistoricalBusy(false)}
}
async function saveHistorical(){
 if(historicalBusy||!historicalAudit)return;
 const bridge=root.RKBOAdminBridge;
 if(!bridge?.isAuthorized?.()){reportHistorical('먼저 관리자 토큰으로 GitHub에 연결해 주세요.');return}
 const {season,file,original}=historicalAudit;
 toggleHistoricalBusy(true);
 try{
  reportHistorical('GitHub의 최신 '+season+'차 카드와 다시 대조 중…');
  const path='data/seasons/'+season+'.json';
  const snapshot=await bridge.readJson(path);
  if(!snapshot.data?.players)throw Error('GitHub에서 시즌 카드 JSON을 가져오지 못했습니다.');
  const audit=RKBOSeasonIdentity.compareSeason(snapshot.data.players,original,season);
  if(!audit.matched)throw Error('성적이 일치하는 선수가 없습니다.');
  const unresolved=audit.unmatched.length+audit.ambiguous.length+audit.duplicates.length;
  if(unresolved&&!window.confirm('성적이 일치하지 않는 행이 '+unresolved+'개 있습니다. 나머지 '+audit.matched+'명의 팀·닉네임만 수정할까요?'))return;
  if(original.teamCount<8&&!window.confirm('현재 '+original.teamCount+'개 구단 기록만 있어요. 확인된 선수만 갱신할까요?'))return;
  const existing=snapshot.data;
  const identityEvidence={
   primary:'seasonal-team-personal-stats',stats:'rkbo-xls',
   source:file.name,sourceRosterCount:original.rows.length,
   matchedPlayers:audit.matched,unresolved,
   seasonNamesCorrected:audit.nameChanges.length,
   teamsCorrected:audit.teamChanges.length,
   teamSourcePriority:'seasonal-personal-stats',
   cardIdsKeptStable:true,verifiedAt:new Date().toISOString()
  };
  const updated={...existing,season,players:audit.players,
    metadata:{...(existing.metadata||{}),identityEvidence}};
  const manifestFile=await bridge.readJson('data/seasons.json');
  const manifest=manifestFile.data;
  if(!Array.isArray(manifest?.seasons))throw Error('시즌 목록 JSON이 잘못되었습니다.');
  const seasonInfo=manifest.seasons.find(x=>Number(x.season)===season);
  if(!seasonInfo)throw Error(season+'차가 시즌 선택 목록에 없습니다.');
  const newManifest={...manifest,seasons:manifest.seasons.map(x=>Number(x.season)===season
    ?{...x,identityVerified:true,identitySource:'team-personal-stats',identityMatched:audit.matched}:x)};
  const importFile=await bridge.readJson('data/imports.json');
  const imports=importFile.data||{version:1,files:[]};
  const originalBytes=new Uint8Array(await file.arrayBuffer());
  const sourcePath='imports/season-team-stats/'+season+'/'+Date.now().toString(36)+'-'+String(file.name).replace(/[^a-zA-Z0-9._-]/g,'_')+'.b64';
  const sourceBlob=await bufferBase64(originalBytes);
  const savedImport={
   id:'season-team-stats-'+season+'-'+Date.now().toString(36),kind:'season-team-stats',
   season,name:file.name,originalName:file.name,size:file.size,
   format:'base64-file',chunks:[sourcePath],uploadedAt:new Date().toISOString(),
   source:'personal-stat-roster-authoritative-team-and-nickname',
   matched:audit.matched,unresolved};
  const newImports={...imports,version:1,files:[...(imports.files||[]),savedImport]};
  const items=[
   {path,content:JSON.stringify(updated,null,2)+'\n'},
   {path:'data/seasons.json',content:JSON.stringify(newManifest,null,2)+'\n'},
   {path:sourcePath,content:sourceBlob},
   {path:'data/imports.json',content:JSON.stringify(newImports,null,2)+'\n'}
  ];
  reportHistorical('개인 성적표 원본·시즌 카드·시즌 목록을 GitHub에 저장 중…');
  const hash=await bridge.publishBatch(items,'Verify '+season+'th-season historical teams and names from personal stat TXT/HTML ZIP',status=>{
   reportHistorical('GitHub 동기화 중 '+status.completed+'/'+status.total+'\n'+(status.message||''));
  });
  if(root.RKBOSeason?.refreshSeason)await root.RKBOSeason.refreshSeason(season);
  else await root.RKBOSeason?.reload?.();
  historicalAudit=null;q('rkbo-history-save').hidden=true;
  reportHistorical('✓ '+season+'차 '+audit.matched+'명 적용 완료 (팀 '+audit.teamChanges.length+'명, 이름 '+audit.nameChanges.length+'명). 원본 '+file.name+'까지 GitHub에 보관했습니다.\n커밋: '+hash.slice(0,12)+'\n카드 스탯·OVR·이미지·고유 ID는 변경하지 않았습니다.');
  root.dispatchEvent(new Event('rkbo-season-ready'));
 }catch(error){console.error(error);reportHistorical('GitHub 수정 실패: '+error.message+'\n원본 카드 변경 여부를 GitHub 커밋에서 확인하세요.')}
 finally{toggleHistoricalBusy(false)}
}

function init(){
 const controls=q('admin-controls');if(!controls||q('rkbo-auto-import'))return;
 const holder=document.createElement('section');holder.id='rkbo-auto-import';
 holder.innerHTML=`<hr><h2>원본 3종 자동 분석 · 시즌 카드 일괄 등록</h2><p>통합 엑셀(1~60차)을 기준으로 시즌별 선수 카드와 OVR을 계산하고, 8개 구단 개인성적·HHRecord ZIP을 검증 자료로 보관한 뒤 <b>GitHub와 시즌 선택 목록에 자동 반영</b>합니다.</p>
 <label for="rkbo-master-xls">① RKBO 통합 성적 엑셀 (.xls) <b>필수</b></label><input type="file" id="rkbo-master-xls" accept=".xls,application/vnd.ms-excel">
 <label for="rkbo-team-html">② 8개 구단 개인 성적 ZIP (TXT/HTML 지원)</label><input type="file" id="rkbo-team-html" accept=".zip,application/zip">
 <label for="rkbo-hhrecord">③ HHRecord ZIP (원본 및 수비 기록 자료)</label><input type="file" id="rkbo-hhrecord" accept=".zip,application/zip">
 <hr><h2>당시 개인 성적표로 닉네임·소속팀 정정</h2>
 <p>선수 스탯과 OVR은 기존 RKBO 엑셀을 유지합니다. 각 시즌의 <b>1군 개인 성적 TXT/HTML(또는 ZIP)</b>에서 경기 기록이 일치하는 선수를 찾고 <b>당시 이름·소속 구단을 우선</b> 적용합니다. HHRecord는 보조 검증 자료로 별도 보관할 수 있습니다.</p>
 <label for="rkbo-history-season">해당 시즌</label><input type="number" min="1" max="59" id="rkbo-history-season" value="54" inputmode="numeric">
 <label for="rkbo-history-file">시즌 개인 성적 TXT / HTML / ZIP</label><input type="file" id="rkbo-history-file" accept=".zip,.txt,.htm,.html,application/zip,text/plain,text/html">
 <div class="admin-actions"><button type="button" class="primary" id="rkbo-history-analyze">당시 닉네임·소속팀 비교</button><button type="button" id="rkbo-history-save" hidden>검증 결과 GitHub에 적용 · 원본 보관</button></div>
 <pre id="rkbo-history-status" class="rkbo-auto-report" aria-live="polite">54차처럼 HTML 대신 메모장에 복사한 TXT도 읽습니다. 원본과 엑셀 카드의 성적이 유일하게 일치하는 경우에만 팀·이름을 교정합니다.</pre>
 <div class="admin-actions"><button type="button" class="primary" id="rkbo-auto-analyze">세 파일 분석 · 시즌별 능력치 산출</button><button type="button" id="rkbo-auto-publish" hidden>분석한 시즌 전체 GitHub에 등록</button></div>
 <pre id="rkbo-auto-status" class="rkbo-auto-report" aria-live="polite">엑셀 파일을 선택하면 1~60차 전체 기록에서 시즌별 카드를 자동 계산할 수 있어요.</pre>
 <p id="rkbo-auto-success" hidden class="warning">새 시즌이 드롭다운에 등록되었습니다. 시즌 변경 시 카드 이미지, 이름 매칭 및 PNG 저장도 함께 전환됩니다.</p>
 <p class="warning"><b>보존 원칙:</b> 기존 검증된 60차 211장은 덮어쓰지 않습니다. 1~59차는 동일한 표본 신뢰도·출전량 상한 규칙을 사용하며, 시즌별 수비 근거가 없는 경우 수비는 미산정(—)합니다. 저장소에는 업로드한 파일 원본을 분할 보관합니다.</p>`;
 const anchor=controls.querySelector('h2'); // after action toolbar near start
 if(anchor)anchor.before(holder);else controls.prepend(holder);
 q('rkbo-auto-analyze').addEventListener('click',analyze);q('rkbo-auto-publish').addEventListener('click',publish);
 q('rkbo-history-analyze').addEventListener('click',analyzeHistorical);q('rkbo-history-save').addEventListener('click',saveHistorical);
 for(const id of ['rkbo-history-season','rkbo-history-file'])q(id).addEventListener('change',()=>{historicalAudit=null;q('rkbo-history-save').hidden=true;reportHistorical('원본이 변경되었습니다. 비교를 다시 실행해 주세요.');});
 for(const id of ['rkbo-master-xls','rkbo-team-html','rkbo-hhrecord'])q(id).addEventListener('change',()=>{evaluated=null;q('rkbo-auto-publish').hidden=true;notify('입력 파일이 변경되었어. 분석을 다시 실행해 주세요.')});
}
document.addEventListener('DOMContentLoaded',init);
root.RKBOAutoImport={analyze,publish,analyzeHistorical,saveHistorical};
})(window);
