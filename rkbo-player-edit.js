/* Admin-only direct player name / position editor. */
(function(root){"use strict";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const positions={타자:[["C","포수"],["1B","1루수"],["2B","2루수"],["3B","3루수"],["SS","유격수"],["LF","좌익수"],["CF","중견수"],["RF","우익수"]],투수:[["SP","선발"],["RP","중계"],["CP","마무리"]]};
let saving=false;
function mount(p){
 if(p?.specialKind)return; // Award variants inherit the canonical player's original name/position.
 if(!root.RKBOAdminBridge?.isAuthorized?.())return;
 const el=document.querySelector("#modal-body .detail-stats");if(!el||el.querySelector("#rkbo-meta-editor"))return;
 const form=document.createElement("section");form.id="rkbo-meta-editor";form.className="rkbo-meta-editor";
 const opts=positions[p.type]||[];const current=opts.some(x=>x[0]===p.pos)?opts:[...opts,[p.pos,p.pos+" (기존)"]];
 form.innerHTML='<div class="mini-title">PLAYER EDIT · 제작자 전용</div><p>표시 이름과 포지션을 GitHub에 저장합니다. 선수 ID·원본 이름·스탯·OVR·사진은 유지됩니다.</p>'+
 '<div class="rkbo-meta-fields"><label>이름<input id="rkbo-meta-name" maxlength="48" type="text" value="'+esc(p.name)+'"></label>'+
 '<label>포지션<select id="rkbo-meta-pos">'+current.map(([pos,label])=>'<option value="'+esc(pos)+'"'+(pos===p.pos?' selected':'')+'>'+esc(pos+" · "+label)+'</option>').join("")+'</select></label></div>'+
 '<div class="rkbo-meta-footer"><button type="button" id="rkbo-meta-save">GitHub에 이름·포지션 저장</button><span id="rkbo-meta-status" role="status" aria-live="polite"></span></div>';
 el.append(form);
 const snapshot={id:p.id,season:p.season,team:p.team,type:p.type,name:p.name,pos:p.pos,manualName:p.manualName||""};
 form.querySelector("button").addEventListener("click",()=>save(snapshot,form));
}
function embeddedData(html){
 const prefix='<script id="data" type="application/json">',suffix='</script>';
 const i=html.indexOf(prefix),j=html.indexOf(suffix,i+prefix.length);
 if(i<0||j<i)throw Error("60차 내장 카드 JSON을 찾지 못했습니다.");
 return {players:JSON.parse(html.slice(i+prefix.length,j)),i,j,prefix};
}
async function save(view,form){
 if(saving)return;
 const api=root.RKBOAdminBridge;
 const status=form.querySelector("#rkbo-meta-status"),button=form.querySelector("button");
 if(!api?.isAuthorized?.()){status.textContent="GitHub 제작자 로그인이 필요합니다.";return}
 const name=form.querySelector("#rkbo-meta-name").value.trim().replace(/\s+/g," ");
 const pos=form.querySelector("#rkbo-meta-pos").value;
 if(!name||name.length>48){status.textContent="이름은 1~48자여야 합니다.";return}
 if(!(positions[view.type]||[]).some(x=>x[0]===pos)){status.textContent="지원하지 않는 포지션입니다.";return}
 const editName=name!==view.name,editPos=pos!==view.pos;
 if(!editName&&!editPos){status.textContent="변경된 내용이 없습니다.";return}
 saving=true;button.disabled=true;status.textContent="최신 GitHub 데이터 확인 중…";
 try{
  const path=view.season===60?"index.html":"data/seasons/"+view.season+".json";
  const response=view.season===60?await api.readText(path):await api.readJson(path);
  if(!response)throw Error("시즌 데이터를 불러올 수 없습니다.");
  const embedded=view.season===60?embeddedData(response.content):null;
  const original=view.season===60?null:response.data;
  const players=embedded?.players||original?.players;
  if(!Array.isArray(players))throw Error("시즌 카드 데이터가 없습니다.");
  const target=players.find(p=>p.id===view.id);
  if(!target||target.team!==view.team||target.type!==view.type)throw Error("선수 ID/구단/유형이 일치하지 않습니다.");
  if(target.pos!==view.pos||String(target.manualName||"")!==view.manualName)throw Error("다른 변경이 저장되었습니다. 카드를 다시 열어 주세요.");
  const stamp=new Date().toISOString();
  if(editName){target.manualName=name;target.name=name;target.manualNameUpdatedAt=stamp}
  if(editPos){target.pos=pos;target.positionManual=true;target.positionUpdatedAt=stamp}
  root.RKBORoles?.apply(players,view.season);
  const content=embedded
   ?response.content.slice(0,embedded.i+embedded.prefix.length)+JSON.stringify(players).replace(/</g,"\\u003c")+response.content.slice(embedded.j)
   :JSON.stringify({...original,players},null,2)+"\n";
  status.textContent="GitHub main 브랜치에 저장 중…";
  const commit=await api.publishBatch([{path,content}],"Update player name and position: "+view.id);
  const local=new Map((root.RKBOSeason?.players?.()||[]).map(p=>[p.id,p]));
  const patches=players.filter(p=>local.has(p.id)&&(p.pos!==local.get(p.id).pos||String(p.manualName||"")!==String(local.get(p.id).manualName||""))).map(p=>({
   id:p.id,pos:p.pos,positionManual:p.positionManual===true,manualName:p.manualName||null
  }));
  root.RKBOSeason?.applyMetadata?.(patches,view.id);
  const current=document.querySelector("#rkbo-meta-status");if(current)current.textContent="✓ GitHub 저장 완료 · "+commit.slice(0,12);
 }catch(e){console.error(e);status.textContent="저장 실패: "+e.message}
 finally{saving=false;button.disabled=false}
}
root.addEventListener("rkbo-admin-connected",()=>{
 const card=document.querySelector("#modal:not([hidden]) .detail-card[data-id]");
 if(card){const p=root.RKBOSeason?.players?.().find(x=>x.id===card.dataset.id);if(p)mount(p)}
});
root.RKBOPlayerMeta={mount};
})(window);
