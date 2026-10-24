/* RKBO pitcher roles · one CP per team, save-based selection.
   Manual position overrides survive reclassification and season reloads. */
(function(root){'use strict';
const special60={
 DOO:'60-DOO-투-010',HAN:'60-HAN-투-004',KIA:'60-KIA-투-009',
 LOT:'60-LOT-투-014',NC:'60-NC-투-007',LG:'60-LG-투-008',
 SSG:'60-SSG-투-006',SAM:'60-SAM-투-012'
};
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const IP=p=>n(p.stats?.IP_real||p.stats?.IP);
function apply(players,season,options={}){
 if(!Array.isArray(players))throw Error('선수 목록을 읽을 수 없습니다.');
 const manual=options.respectManual!==false;
 let promoted=[],relegated=[];
 const teams=[...new Set(players.filter(p=>p.type==='투수').map(p=>p.team))];
 for(const team of teams){
  const pitchers=players.filter(p=>p.type==='투수'&&p.team===team);
  const locked=manual?pitchers.filter(p=>p.positionManual===true):[];
  const manualCloser=locked.some(p=>p.pos==='CP');
  const pool=pitchers.filter(p=>['RP','CP'].includes(p.pos)&&(!manual||p.positionManual!==true));
  const top=pool.filter(p=>n(p.stats?.S)>0).sort((a,b)=>n(b.stats.S)-n(a.stats.S)||IP(b)-IP(a)||n(b.stats?.G)-n(a.stats?.G)||a.id.localeCompare(b.id))[0]||null;
  // 60th-season explicit user selections override a save-count tie.
  const pinned=Number(season)===60&&special60[team]&&!manualCloser
   ?pool.find(p=>p.id===special60[team]):null;
  const choice=manualCloser?null:(pinned||top);
  for(const p of pool){
   const next=p===choice?'CP':'RP';
   if(p.pos===next)continue;
   if(next==='CP')promoted.push(p.id);else relegated.push(p.id);
   p.pos=next;
  }
 }
 return {promoted,relegated,teams:teams.length};
}
root.RKBORoles={apply,special60,positions:{타자:['C','1B','2B','3B','SS','LF','CF','RF'],투수:['SP','RP','CP']}};
})(window);
