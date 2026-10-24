/* RKBO season data editor: uploads 8/10-team personal stats, HHRecord, final fielding TXT.
 * The integrated XLS is OPTIONAL. Save verified changes and original ZIPs to GitHub in one batch.
 */
(function(root){"use strict";
const q=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const bridge=()=>root.RKBOAdminBridge;
let prepared=null,working=false;
const INPUTS=["rkbo-supp-personal","rkbo-supp-hh","rkbo-supp-defense"];
const info=s=>{const el=q("rkbo-supp-status");if(el)el.textContent=s};
function fileAt(id){return q(id)?.files?.[0]||null}
function toggle(v){
 working=v;for(const id of ["rkbo-supp-analyze","rkbo-supp-save"]){const b=q(id);if(b)b.disabled=v}
}
function invalidate(){
 prepared=null;const b=q("rkbo-supp-save");if(b)b.hidden=true;
 info("입력이 변경됐습니다. 자료를 다시 분석해 주세요.");
}
async function fileText(file){
 const bytes=new Uint8Array(await file.arrayBuffer());
 let text=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
 if(text.includes("\uFFFD")){
  try{const other=new TextDecoder("euc-kr").decode(bytes);
   if((other.match(/\uFFFD/g)||[]).length<(text.match(/\uFFFD/g)||[]).length)text=other}catch{}
 }
 return text;
}
function personalToWorkbook(source,season){
 const named=["타자","투수"];
 const byType=named.map(name=>{
  const rows=source.rows.filter(r=>r.type===name);
  if(!rows.length)throw Error("개인 성적 ZIP에서 "+name+" 1군 기록을 찾지 못했습니다.");
  const base=["SS","TEAM","NAME","POS","G","AVG","OBP","SLG","AB","H","H2B","H3B","HR","R","RBI","BB","K","SB","CS",
   "ERA","W","L","S","BS","GS","CG","SHO","IP","ER","BK","WP"];
  const mapped=rows.map(r=>{
   const obj={...r.record,SS:season,TEAM:r.team,NAME:r.rawName};
   if(obj.H2B===undefined)obj.H2B=obj["2B"]??"0";
   if(obj.H3B===undefined)obj.H3B=obj["3B"]??"0";
   if(!obj.POS&&name==="타자")throw Error(r.rawName+": 타자 포지션 누락");
   return {cells:base.map(k=>obj[k]??"0")};
  });
  return {name,rows:[{cells:base},...mapped]};
 });
 return {sheets:byType};
}
async function readExisting(season){
 const api=bridge();
 if(!api?.isAuthorized())throw Error("먼저 관리자 토큰으로 GitHub에 연결해 주세요.");
 if(season===60){
  const remote=await api.readText("index.html");
  if(!remote?.content)throw Error("GitHub의 60차 내장 카드 파일을 읽을 수 없습니다.");
  const open='<script id="data" type="application/json">',close='</script>';
  const i=remote.content.indexOf(open),j=remote.content.indexOf(close,i+open.length);
  if(i<0||j<0)throw Error("60차 카드 데이터 위치를 찾지 못했습니다.");
  return {players:JSON.parse(remote.content.slice(i+open.length,j)),original:remote.content,open,close,i,j,source:"embedded"};
 }
 const file=await api.readJson("data/seasons/"+season+".json");
 if(!file?.data)return null;
 const source=file.data;
 if(!Array.isArray(source.players))throw Error(season+"차 시즌 데이터에서 players 배열을 찾을 수 없습니다.");
 return {players:source.players,original:source,source:"file"};
}
async function gatherInputs(){
 const season=Number(q("rkbo-supp-season")?.value);
 if(!Number.isInteger(season)||season<1||season>999)throw Error("시즌 번호를 선택해 주세요.");
 const personal=fileAt(INPUTS[0]),hh=fileAt(INPUTS[1]),defense=fileAt(INPUTS[2]);
 if(!personal&&!hh&&!defense)throw Error("개인 성적 ZIP · HHRecord ZIP · 최종 수비 TXT 중 최소 하나는 선택해야 합니다.");
 if(personal&&!/\.zip$/i.test(personal.name))throw Error("개인 성적은 ZIP으로 올려 주세요.");
 if(hh&&!/\.zip$/i.test(hh.name))throw Error("HHRecord는 ZIP으로 올려 주세요.");
 if(defense&&!/\.(?:txt|tsv|csv)$/i.test(defense.name))throw Error("수비 기록은 TXT, TSV 또는 CSV 파일이어야 합니다.");
 for(const f of [personal,hh,defense].filter(Boolean))if(f.size>85*1024*1024)throw Error(f.name+": 파일 용량은 최대 85MB입니다.");
 return {season,personal,hh,defense};
}
async function analyze(){
 if(working)return;
 toggle(true);prepared=null;q("rkbo-supp-save").hidden=true;
 try{
  const inputs=await gatherInputs(),{season,personal,hh,defense}=inputs;
  info(season+"차의 GitHub 카드 데이터를 확인 중…");
  let existing=await readExisting(season),personalSource=null,identity=null;
  let cards=existing?JSON.parse(JSON.stringify(existing.players)):null,created=false;
  if(personal){
   info("개인 성적 ZIP 분석 중 (1군만 사용, AA/AAA 제외)…");
   personalSource=await root.RKBOSeasonIdentity.readTeamSource(personal);
   if(![8,10].includes(personalSource.teamCount))throw Error("개인 성적 ZIP은 8개 또는 10개 구단의 1군 데이터가 필요합니다. 현재 "+personalSource.teamCount+"개 구단을 확인했습니다.");
   if(personalSource.rows.filter(x=>x.type==="타자").length<20||personalSource.rows.filter(x=>x.type==="투수").length<20)throw Error("개인 성적 ZIP에 타자/투수 1군 기록이 충분하지 않습니다.");
   if(cards){
    const pre=root.RKBOSeasonIdentity.compareSeason(cards,personalSource,season);
    if(pre.matched<Math.ceil(cards.length*.6))throw Error("기존 카드와 개인 성적의 핵심 기록이 "+pre.matched+"/"+cards.length+"명만 일치합니다. 잘못된 시즌 파일이 아닌지 확인해 주세요 (최소 60% 일치 필요).");
    identity={matched:pre.matched,unmatched:pre.unmatched,ambiguous:pre.ambiguous,duplicates:pre.duplicates,
      teamsChanged:pre.teamChanges,namesChanged:pre.nameChanges,unlisted:pre.unlistedCards};
    cards=pre.players;
   }else{
    info("기존 시즌 카드가 없어, 1군 개인 성적을 기반으로 시즌 카드를 생성 중…");
    const seasons=root.RKBOSeasonEngine.fromWorkbook(personalToWorkbook(personalSource,season));
    const generated=seasons.get(season);
    if(!generated?.length)throw Error("개인 성적으로 시즌 카드를 생성하지 못했습니다.");
    cards=root.RKBOSeasonEngine.pack(generated);
    created=true;
   }
  }
  if(!cards)throw Error(season+"차 기본 카드가 없습니다. 개인 성적 ZIP(8/10개 구단)을 첨부하면 통합 엑셀 없이 새 시즌을 생성할 수 있습니다.");
  const eligible=p=>Number(p?.stats?.G)>=(p?.type==="타자"?50:p?.type==="투수"?25:Infinity);
  cards=cards.filter(eligible);
  if(!cards.length)throw Error("출전 기준(타자 50 / 투수 25) 충족 카드가 없습니다.");
  let finalResult=null,fielding=null;
  if(defense){
   info("최종 수비 기록 TXT를 선수/구단별로 대조하고 수비·OVR을 재산정 중…");
   const text=await fileText(defense);fielding=root.RKBODefense.parseFinal(text);
   finalResult=root.RKBODefense.rescore(cards,fielding.rows,season+"차 최종 수비 기록");
   const minMatch=Math.ceil(cards.filter(x=>x.type==="타자").length*.8);
   if(finalResult.report.matched<minMatch)throw Error("수비 기록 일치 "+finalResult.report.matched+"명 / 카드 타자 "+cards.filter(x=>x.type==="타자").length+"명. 최소 80% 이상 일치해야 재산정할 수 있습니다. 선수명·소속팀을 확인해 주세요.");
   if(finalResult.report.ambiguous.length)throw Error("중복 또는 불완전한 수비 기록: "+finalResult.report.ambiguous.slice(0,5).join("; "));
   if(finalResult.report.insufficientPeerGroups.length)throw Error("포지션군 비교 선수가 4명 미만입니다: "+finalResult.report.insufficientPeerGroups.join(", ")+". 더 완전한 최종 수비 TXT가 필요합니다.");
   cards=finalResult.players;
  }
  let hhReport=null;
  if(hh){
   info("HHRecord ZIP 내부 기록 페이지 검증 중…");
   hhReport=await root.RKBODefense.inspectHH(hh,fielding?.rows||[]);
   if(!hhReport.htmlPages)throw Error("HHRecord ZIP에 읽을 수 있는 HTML 기록 페이지가 없습니다.");
  }
  const report=[
   "✓ "+season+"차 자료 분석 완료 · "+(created?"개인 성적에서 신규 카드 생성":"기존 GitHub 카드 활용")+" · 카드 "+cards.length+"장",
   "타자 "+cards.filter(x=>x.type==="타자").length+"명 / 투수 "+cards.filter(x=>x.type==="투수").length+"명",
   personalSource?"개인 성적: "+personalSource.teamCount+"개 구단 · 1군 기록 "+personalSource.rows.length+"행": "개인 성적: 미선택 (기존 시즌 타격/투구 기록 유지)",
   identity?"개인 기록 매칭 "+identity.matched+"명 · 당시 소속 변경 "+identity.teamsChanged.length+"명 · 이름 차이 "+identity.namesChanged.length+"명 · 미일치 "+identity.unmatched.length+"건":"개인 성적 소속팀 교정: 없음",
   fielding?"최종 수비: "+fielding.sourceRows+"행 · 카드 일치 "+finalResult.report.matched+"명 / 적용 "+finalResult.report.updated+"명":"최종 수비: 미선택 (수비 점수는 변경하지 않음)",
   finalResult?"수비 출장 0경기 최저 50점 "+finalResult.report.zeroFielding50+"명 · 수비 점수 변화 "+finalResult.report.defenseChanged+"명 · OVR 변화 "+finalResult.report.ovrChanged+"명 · 등급 변화 "+finalResult.report.gradeChanged+"명":"",
   finalResult?.report.unmatched.length?"최종 수비 미일치 카드 "+finalResult.report.unmatched.length+"명: "+finalResult.report.unmatched.slice(0,8).map(x=>x.name).join(", "):"",
   hhReport?"HHRecord: HTML "+hhReport.htmlPages+"개 · 투표표 "+hhReport.glovePages+"개 · 최종 TXT 대조 "+hhReport.corroborated+"건 / 차이 "+hhReport.disagree+"건":"HHRecord: 미선택",
   ...(hhReport?.notes||[]),
   "원본 파일은 GitHub에 보관하고, 수비가 재산정되면 타자 OVR·등급·순위까지 함께 갱신합니다.",
   "통합 엑셀은 필요하지 않습니다. 미확인 선수 기록이나 투수 원점수는 임의로 변경하지 않습니다.",
   finalResult?.changes?.length?"변경 예시: "+finalResult.changes.filter(x=>x.previousDefense!==x.defense||x.previousOVR!==x.ovr).slice(0,8).map(x=>x.name+" 수비 "+(x.previousDefense??"—")+"→"+(x.defense??"—")+" / OVR "+x.previousOVR+"→"+x.ovr).join(" · "):"",
   "미리보기를 확인한 뒤 [GitHub에 적용]을 눌러야 실제로 반영됩니다."
  ].filter(Boolean).join("\n");
  prepared={inputs,existing,created,cards,identity,fielding,finalResult,hhReport,personalSource};
  info(report);q("rkbo-supp-save").hidden=false;
 }catch(error){console.error("[RKBO season supplements]",error);info("분석 실패: "+error.message)}
 finally{toggle(false)}
}
function encodeChunk(bytes){
 let text="";for(let k=0;k<bytes.length;k+=12288)text+=String.fromCharCode(...bytes.subarray(k,k+12288));return btoa(text);
}
async function save(){
 if(working||!prepared)return;
 const b=bridge();
 if(!b?.isAuthorized()){info("GitHub 관리자 토큰을 연결해 주세요.");return}
 toggle(true);
 try{
  const work=prepared,now=new Date().toISOString(),{season,personal,hh,defense}=work.inputs;
  info(season+"차 최신 GitHub 시즌 데이터와 연결 상태를 검증 중…");
  const curr=await readExisting(season);
  if(Boolean(curr)!==Boolean(work.existing))throw Error("분석 이후 시즌 등록 상태가 달라졌습니다. 다시 분석해 주세요.");
  if(curr&&JSON.stringify(curr.players)!==JSON.stringify(work.existing.players))throw Error("다른 수정으로 시즌 카드가 변경됐습니다. 새로 분석해 주세요.");
  const manifestFile=await b.readJson("data/seasons.json"),importsFile=await b.readJson("data/imports.json");
  const manifest=manifestFile.data||{version:1,seasons:[]},imports=importsFile.data||{version:1,files:[]};
  if(!Array.isArray(manifest.seasons))manifest.seasons=[];
  if(!Array.isArray(imports.files))imports.files=[];
  const batch=[],files=[["season-team-stats",personal],["season-hhrecord",hh],["season-fielding-final",defense]].filter(([,f])=>f);
  const stamp=Date.now().toString(36);
  for(const [kind,file] of files){
   info("원본 자료 아카이브 생성: "+file.name);
   const bytes=new Uint8Array(await file.arrayBuffer()),paths=[],CHUNK=512*1024;
   for(let i=0;i<bytes.length;i+=CHUNK){
    const path="imports/season-supplements/"+season+"/"+stamp+"-"+kind+"/"+String(paths.length+1).padStart(3,"0")+".b64";
    batch.push({path,content:encodeChunk(bytes.subarray(i,i+CHUNK))});paths.push(path);
   }
   imports.files.push({id:stamp+"-"+season+"-"+kind,kind,season,name:file.name,originalName:file.name,size:file.size,
     chunks:paths,chunkBytes:CHUNK,format:"base64-chunks",uploadedAt:now,source:"season-supplement-evidence"});
  }
  if(work.fielding){
   // Preserve the source as UTF-8; raw uploaded bytes are archived separately.
   batch.push({path:"data/season-fielding/"+season+".tsv",content:await fileText(defense)});
   if(season===60)batch.push({path:"data/season60-fielding.tsv",content:await fileText(defense)});
  }
  const audit={
   version:1,season,generatedAt:now,sourceFiles:files.map(([kind,f])=>({kind,name:f.name,size:f.size})),
   created:work.created,cardCount:work.cards.length,
   personal:work.personalSource?{teamCount:work.personalSource.teamCount,rows:work.personalSource.rows.length,
     warnings:work.personalSource.warnings,identity:work.identity}:null,
   fielding:work.finalResult?.report||null,
   hhRecord:work.hhReport||null,
   ratingPolicy:"Fielding G=0 -> 50; defense = 83% adjusted errors + 17% range per 9; 140-chance / 600-inning correction; batter OVR reranked",
   warnings:work.finalResult?.report.unmatched||[]
  };
  batch.push({path:"data/season-supplements/"+season+"-audit.json",content:JSON.stringify(audit,null,2)+"\n"});
  if(season===60){
   if(!curr||curr.source!=="embedded")throw Error("60차 내장 데이터가 없습니다.");
   const embedded=JSON.stringify(work.cards);
   const changed=curr.original.slice(0,curr.i+curr.open.length)+embedded+curr.original.slice(curr.j);
   batch.push({path:"index.html",content:changed});
   if(work.finalResult){
    const d=work.finalResult;
    batch.push({path:"data/season60-defense-audit.json",content:JSON.stringify({version:3,summary:{
      season:60,source:"User-uploaded final fielding via RKBO season supplement",
      cardCount:work.cards.length,batters:d.report.batters,sourceRows:d.report.sourceRows,
      matched:d.report.matched,updated:d.report.updated,zeroFielding50:d.report.zeroFielding50,
      defenseChanged:d.report.defenseChanged,ovrChanged:d.report.ovrChanged,gradeChanged:d.report.gradeChanged,
      scorer:"83/17 fielding score; 140 chances; 600 innings; zero fielding G = 50"
    },players:d.changes},null,2)+"\n"});
    const csv=["id,name,team,old_defense,new_defense,old_OVR,new_OVR,old_grade,new_grade",
      ...d.changes.map(x=>[x.id,x.name,x.team,x.previousDefense??"",x.defense??"",x.previousOVR,x.ovr,x.previousGrade,x.grade].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(","))].join("\n")+"\n";
    batch.push({path:"data/season60-defense-changes.csv",content:csv});
   }
  }else{
   const previous=curr?.original||{};
   batch.push({path:"data/seasons/"+season+".json",content:JSON.stringify({...previous,season,players:work.cards,
     metadata:{...previous.metadata,supplementalUpdatedAt:now,supplementalSources:files.map(([kind])=>kind),
       ...(work.finalResult?{defenseModel:"fielding-83-17-v2"}:{})}},null,2)+"\n"});
  }
  const item={season,file:season===60?null:"data/seasons/"+season+".json",label:season+"차 시즌",count:work.cards.length,
    source:work.created?"season-team-personal-stats":(manifest.seasons.find(x=>Number(x.season)===season)?.source||"embedded"),
    ...(work.identity?.matched?{identityVerified:work.identity.matched>=Math.ceil(work.cards.length*.95)&&!work.identity.ambiguous.length&&!work.identity.duplicates.length,
      identitySource:"season-team-personal-stats",identityMatched:work.identity.matched}:{})};
  const k=manifest.seasons.findIndex(x=>Number(x.season)===season);
  if(k>=0)manifest.seasons[k]={...manifest.seasons[k],...item};
  else manifest.seasons.push(item);
  manifest.seasons.sort((a,b)=>Number(b.season)-Number(a.season));
  batch.push({path:"data/seasons.json",content:JSON.stringify(manifest,null,2)+"\n"});
  batch.push({path:"data/imports.json",content:JSON.stringify(imports,null,2)+"\n"});
  if(batch.length>240)throw Error("원본 파일이 너무 커서 GitHub 파일 조각이 240개를 넘었습니다. 파일을 나눠 올려 주세요.");
  const commit=await b.publishBatch(batch,"Process and publish RKBO season "+season+" supplements without a master XLS",
    status=>info("GitHub 동기화 "+status.completed+"/"+status.total+"\n"+(status.message||"")));
  prepared=null;q("rkbo-supp-save").hidden=true;
  try{await root.RKBOSeason?.reload?.();if(season!==60)await root.RKBOSeason?.refreshSeason?.(season)}catch(error){console.warn("Reload newly published season when Pages syncs",error)}
  info("✓ "+season+"차 자료 "+files.length+"종 · 선수 카드 "+work.cards.length+"장 · GitHub 저장 완료!\n"+
    (work.finalResult?"수비 "+work.finalResult.report.updated+"명 · OVR "+work.finalResult.report.ovrChanged+"명 변경\n":"기존 수비/OVR 유지 · 원본 자료 보관\n")+
    "커밋 "+commit.slice(0,12)+"\n"+season+"차 카드의 변경 내용은 새로고침 후 확인해 주세요. GitHub Pages 배포 직후에는 잠깐 이전 내용이 보일 수 있습니다.");
  root.dispatchEvent(new Event("rkbo-season-ready"));
 }catch(error){console.error("[RKBO supplement publishing]",error);info("GitHub 저장 실패: "+error.message+"\n원본 카드 변경 여부를 저장소에서 확인해 주세요.")}
 finally{toggle(false)}
}
function init(){
 const controls=q("admin-controls");if(!controls||q("rkbo-supp-panel"))return;
 const panel=document.createElement("section");panel.id="rkbo-supp-panel";
 panel.innerHTML='<hr><h2>시즌별 자료 업로드 · 수비/OVR 자동 산정</h2>'+
 '<p><b>통합 성적 엑셀 없이 사용 가능!</b> 시즌을 선택하고 개인 성적 ZIP(8개 또는 10개 구단), HHRecord ZIP, 최종 수비 TXT를 필요한 만큼 첨부하세요. 기존 카드가 없는 시즌도 개인 성적 ZIP이 있으면 1군 기록으로 생성할 수 있습니다.</p>'+
 '<label for="rkbo-supp-season">① 대상 시즌</label><select id="rkbo-supp-season"></select>'+
 '<label for="rkbo-supp-personal">② 개인 성적 ZIP (8개/10개 구단 · 선택)</label><input id="rkbo-supp-personal" type="file" accept=".zip,application/zip">'+
 '<label for="rkbo-supp-hh">③ HHRecord ZIP (선택 · 원본 및 순위표 대조)</label><input id="rkbo-supp-hh" type="file" accept=".zip,application/zip">'+
 '<label for="rkbo-supp-defense">④ 최종 수비 기록 TXT / TSV / CSV (선택 · 수비 및 OVR 산정)</label><input id="rkbo-supp-defense" type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv">'+
 '<div class="admin-actions"><button type="button" class="primary" id="rkbo-supp-analyze">시즌 자료 분석 · 능력치 미리보기</button>'+
 '<button type="button" id="rkbo-supp-save" hidden>검증 결과 GitHub에 적용 · 원본 보관</button></div>'+
 '<pre class="rkbo-auto-report" id="rkbo-supp-status" aria-live="polite">최종 수비 기록이 있는 선수는 새 점수와 OVR·등급·순위를 계산하고, 수비 출장 0경기는 50점으로 처리합니다. 최종 TXT가 없으면 확인할 수 없는 수비 기록을 추정하지 않습니다.</pre>'+
 '<p class="warning">개인 성적 ZIP은 1군만 반영하고 AA·AAA는 제외합니다. 최종 TXT와 HHRecord의 기록이 다르면 최종 TXT가 우선합니다. 저장 전 미리보기 결과를 확인하세요.</p>';
 const old=q("rkbo-auto-import");if(old)old.before(panel);else controls.prepend(panel);
 const select=q("rkbo-supp-season");const existing=root.RKBOSeason?.seasons?.()||[];
 const options=[...new Set([...existing.map(x=>Number(x.season)),...Array.from({length:60},(_,i)=>60-i)])].filter(x=>x>0).sort((a,b)=>b-a);
 select.innerHTML=options.map(x=>'<option value="'+x+'">'+x+'차 시즌</option>').join("");
 select.value=String(root.RKBOSeason?.current?.()||60);
 const newRow=document.createElement("p");
 newRow.style.cssText="font-size:11px;color:#a5c5dc;margin:6px 0 0";
 newRow.textContent="목록에 없는 신규 시즌은 아래 시즌 번호를 직접 입력하여 업로드할 수 있습니다.";
 const custom=document.createElement("input");custom.type="number";custom.min="1";custom.max="999";custom.placeholder="신규 시즌 번호 (선택)";custom.id="rkbo-supp-custom-season";
 panel.insertBefore(newRow,q("rkbo-supp-personal").previousElementSibling);
 panel.insertBefore(custom,q("rkbo-supp-personal").previousElementSibling);
 custom.addEventListener("change",()=>{const n=Number(custom.value);if(!custom.value)return;if(!Number.isInteger(n)||n<1||n>999){info("시즌 번호는 1~999로 입력해 주세요.");return}
   if(![...select.options].some(o=>Number(o.value)===n))select.add(new Option(n+"차 시즌 (신규)",String(n)));
   select.value=String(n);invalidate();
 });
 select.addEventListener("change",()=>{custom.value="";invalidate()});
 for(const id of INPUTS)q(id).addEventListener("change",invalidate);
 q("rkbo-supp-analyze").addEventListener("click",analyze);
 q("rkbo-supp-save").addEventListener("click",save);
}
document.addEventListener("DOMContentLoaded",init);
root.RKBOSeasonSupplement={analyze,save};
})(window);
