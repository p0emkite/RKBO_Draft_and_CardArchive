/* RKBO 1~60 Historical Import Manager
 * Client-only ingestion of old XLS, 8-team HTML ZIP, HHRecord ZIP.
 * Publishes historic cards + original file archive in one atomic GitHub commit.
 */
(function(root){'use strict';
const q=id=>document.getElementById(id);
let evaluated=null, locked=false;
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
  if(files.team||files.hh){notify('팀별 HTML과 HHRecord ZIP 구조를 검사하는 중…');
   Object.assign(supplement,await RKBOSeasonEngine.verify(seasons,files.team?await files.team.arrayBuffer():null,files.hh?await files.hh.arrayBuffer():null));
  }
  if(files.team&&supplement.teamHtml?.files!==8)throw Error('8개 구단 개인 성적 ZIP에서 HTML 파일 8개를 찾지 못했습니다.');
  if(files.hh&&!supplement.hhRecord?.pages)throw Error('HHRecord ZIP에서 상세 기록 HTML을 찾지 못했습니다.');
  evaluated={files,seasons,supplement,total:count};
  const extra=[...seasons.keys()].filter(s=>s!==60).sort((a,b)=>b-a);
  const counts=extra.reduce((r,s)=>(r.total+=seasons.get(s).length,r),{total:0});
  let summary=`분석 완료: ${seasons.size}개 시즌 · 기록 ${count.toLocaleString()}행\n`+
   `자동 등록 대상: ${extra.length}개 시즌(60차 제외) · 선수 카드 ${counts.total.toLocaleString()}장\n`+
   `60차 211장은 기존 검증 데이터 그대로 유지\n`+
   `엑셀: ${files.xls.name} (${toMB(files.xls.size)})\n`+
   (files.team?`8구단 HTML: ${supplement.teamHtml.files}개 파일 · 타자 ${supplement.teamHtml.batters}명 / 투수 ${supplement.teamHtml.pitchers}명 · 이름 불일치 ${supplement.teamHtml.mismatch}건\n`:'8구단 HTML: 미선택 (60차 교차검증 생략)\n')+
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
  const entries=[],past=[...seasons.entries()].filter(([k])=>k!==60).sort((a,b)=>b[0]-a[0]);
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
  notify(`GitHub 원자적 등록 시작 · 시즌 ${past.length}개 · 소스 ${archives.length}개 · 총 ${entries.length}개 Git 파일\n잠시 시간이 걸릴 수 있어요. 탭을 닫지 마세요.`);
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
function init(){
 const controls=q('admin-controls');if(!controls||q('rkbo-auto-import'))return;
 const holder=document.createElement('section');holder.id='rkbo-auto-import';
 holder.innerHTML=`<hr><h2>원본 3종 자동 분석 · 시즌 카드 일괄 등록</h2><p>통합 엑셀(1~60차)을 기준으로 시즌별 선수 카드와 OVR을 계산하고, 8개 구단 개인성적·HHRecord ZIP을 검증 자료로 보관한 뒤 <b>GitHub와 시즌 선택 목록에 자동 반영</b>합니다.</p>
 <label for="rkbo-master-xls">① RKBO 통합 성적 엑셀 (.xls) <b>필수</b></label><input type="file" id="rkbo-master-xls" accept=".xls,application/vnd.ms-excel">
 <label for="rkbo-team-html">② 8개 구단 개인 성적 ZIP (60차 검증)</label><input type="file" id="rkbo-team-html" accept=".zip,application/zip">
 <label for="rkbo-hhrecord">③ HHRecord ZIP (원본 및 수비 기록 자료)</label><input type="file" id="rkbo-hhrecord" accept=".zip,application/zip">
 <div class="admin-actions"><button type="button" class="primary" id="rkbo-auto-analyze">세 파일 분석 · 시즌별 능력치 산출</button><button type="button" id="rkbo-auto-publish" hidden>분석한 시즌 전체 GitHub에 등록</button></div>
 <pre id="rkbo-auto-status" class="rkbo-auto-report" aria-live="polite">엑셀 파일을 선택하면 1~60차 전체 기록에서 시즌별 카드를 자동 계산할 수 있어요.</pre>
 <p id="rkbo-auto-success" hidden class="warning">새 시즌이 드롭다운에 등록되었습니다. 시즌 변경 시 카드 이미지, 이름 매칭 및 PNG 저장도 함께 전환됩니다.</p>
 <p class="warning"><b>보존 원칙:</b> 기존 검증된 60차 211장은 덮어쓰지 않습니다. 1~59차는 동일한 표본 신뢰도·출전량 상한 규칙을 사용하며, 시즌별 수비 근거가 없는 경우 수비는 미산정(—)합니다. 저장소에는 업로드한 파일 원본을 분할 보관합니다.</p>`;
 const anchor=controls.querySelector('h2'); // after action toolbar near start
 if(anchor)anchor.before(holder);else controls.prepend(holder);
 q('rkbo-auto-analyze').addEventListener('click',analyze);q('rkbo-auto-publish').addEventListener('click',publish);
 for(const id of ['rkbo-master-xls','rkbo-team-html','rkbo-hhrecord'])q(id).addEventListener('change',()=>{evaluated=null;q('rkbo-auto-publish').hidden=true;notify('입력 파일이 변경되었어. 분석을 다시 실행해 주세요.')});
}
document.addEventListener('DOMContentLoaded',init);
root.RKBOAutoImport={analyze,publish};
})(window);
