// RKBO MATCH 2.0 - season ladder. All opponent selection, scoring and progression are server-owned.
// Uses GitHub's officially published season cards; never trusts an opponent or score supplied by a browser.
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")||"";
let keys:Record<string,string>={};
try{keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")}catch{}
const SECRET=keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ORIGINS=new Set(["https://p0emkite.github.io","http://localhost:8080","http://127.0.0.1:8080"]);
const BASE="https://raw.githubusercontent.com/p0emkite/RKBO_Draft_and_CardArchive/main/";
const LABELS:Record<string,string>={DOO:"두산 베어스",HAN:"한화 이글스",KIA:"KIA 타이거즈",KT:"KT 위즈",LG:"LG 트윈스",LOT:"롯데 자이언츠",NC:"NC 다이노스",SAM:"삼성 라이온즈",SSG:"SSG 랜더스",KIW:"키움 히어로즈"};
type Player={id:string;name?:string;team:string;teamLabel?:string;type:string;pos:string;ovr:number;ratings?:Record<string,number|null>};
type Club={code:string;name:string;strength:number;rank:number;players:Player[]};
const cache=new Map<number,{expires:number;clubs:Club[]}>();
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const roll=()=>Math.random();
function fail(status:number,msg:string):never{const e=new Error(msg) as Error&{status:number};e.status=status;throw e}
function cors(req:Request){const origin=req.headers.get("origin")||"";return {
 "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://p0emkite.github.io",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info,x-retry-count,traceparent,tracestate,baggage",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"}}
function reply(req:Request,status:number,data:any){return new Response(JSON.stringify(data),{status,headers:{...cors(req),"Content-Type":"application/json"}})}
async function jsonFromGitHub(path:string){
 const res=await fetch(BASE+path,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(12000)});
 if(!res.ok)fail(503,"공식 시즌 카드 원본을 읽을 수 없습니다");
 if(path==="index.html"){
  const html=await res.text();
  const start='<script id="data" type="application/json">',end="</script>";
  const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
  if(a<0||b<a)fail(503,"60차 공식 카드 읽기 오류");
  return JSON.parse(html.slice(a+start.length,b));
 }
 return res.json();
}
async function seasonClubs(season:number):Promise<Club[]>{
 const hit=cache.get(season);if(hit&&hit.expires>Date.now())return hit.clubs;
 const manifest=await jsonFromGitHub("data/seasons.json");
 const meta=manifest?.seasons?.find((m:any)=>Number(m.season)===season);
 if(!meta)fail(400,"공개되지 않은 시즌입니다");
 const path=season===60?"index.html":"data/seasons/"+season+".json";
 if(season!==60&&meta.file!==path)fail(400,"공식 카드 목록 경로 오류");
 const doc=await jsonFromGitHub(path);
 const rows:Array<Player>=Array.isArray(doc)?doc:doc?.players;
 if(!Array.isArray(rows)||rows.length<10)fail(503,"해당 시즌 선수 카드가 부족합니다");
 const grouped=new Map<string,Player[]>();
 for(const raw of rows){
  if(!raw||!LABELS[raw.team]||!["타자","투수"].includes(raw.type)||!Number.isFinite(Number(raw.ovr)))continue;
  if(!grouped.has(raw.team))grouped.set(raw.team,[]);
  grouped.get(raw.team)!.push(raw);
 }
 const clubs=[...grouped.entries()].filter(([,players])=>players.some(p=>p.type==="타자")&&players.some(p=>p.type==="투수"))
  .map(([code,players])=>({code,name:LABELS[code],strength:Math.round(players.reduce((n,p)=>n+Number(p.ovr),0)/players.length*10)/10,players,rank:0}));
 if(clubs.length<2||clubs.length>10)fail(503,"시즌별 구단 데이터를 확인해 주세요");
 clubs.sort((a,b)=>a.strength-b.strength||a.code.localeCompare(b.code));
 clubs.forEach((club,i)=>club.rank=clubs.length-i);
 cache.set(season,{expires:Date.now()+120000,clubs});
 return clubs;
}
const rating=(p:any,key:string)=>clamp(Number(p?.ratings?.[key]??p?.ovr??75)||75,40,99);
const HIT_SLOTS=["C","1B","2B","3B","SS","LF","CF","RF","DH"];
const SP_SLOTS=["SP1","SP2","SP3","SP4","SP5"];
const RP_SLOTS=["RP1","RP2","RP3"];
// A pitcher is a finite game resource: stamina controls effective pitch budget,
// while baserunners, walks, homers and bad innings accelerate fatigue.
// Each manager independently decides when to use a fresh arm, including mid-inning.
function simulate(team:any,myCards:Map<string,Player>,opponent:Club,played:number){
 const slotMap=new Map<string,Player>();
 for(const item of team.slots)slotMap.set(item.slot,myCards.get(item.cardId)!);
 const battingOrder=team.lineup?.battingOrder,rotation=team.lineup?.rotation,bullpen=team.lineup?.bullpen;
 if(!Array.isArray(battingOrder)||battingOrder.length!==9||new Set(battingOrder).size!==9
  ||!Array.isArray(rotation)||rotation.length!==5||new Set(rotation).size!==5
  ||!Array.isArray(bullpen)||bullpen.length!==3||new Set(bullpen).size!==3
  ||[...HIT_SLOTS,...SP_SLOTS,...RP_SLOTS,"CP"].some(slot=>!slotMap.has(slot)))
  fail(400,"저장된 팀 구성에 문제가 있습니다");
 const hitters=battingOrder.map((slot:string)=>slotMap.get(slot)!);
 if(hitters.some(p=>!p||p.type!=="타자"))fail(400,"MY TEAM 타순이 잘못되었습니다");
 const myStarter=slotMap.get(rotation[played%5])!;
 const myBullpen=[...bullpen.map((s:string)=>slotMap.get(s)!),slotMap.get("CP")!];
 const cpuHitters=opponent.players.filter(p=>p.type==="타자").sort((a,b)=>b.ovr-a.ovr);
 const cpuPitchers=opponent.players.filter(p=>p.type==="투수").sort((a,b)=>b.ovr-a.ovr);
 if(!cpuHitters.length||!cpuPitchers.length)fail(503,"상대 구단 선수 데이터가 부족합니다");
 const cpuLineup=Array.from({length:9},(_,i)=>cpuHitters[i%cpuHitters.length]);
 const cpuStarters=cpuPitchers.filter(p=>p.pos==="SP");
 const cpuStarter=(cpuStarters.length?cpuStarters:cpuPitchers)[played%(cpuStarters.length||cpuPitchers.length)];
 // Relievers first, other starting pitchers can work long relief when a roster has too few bullpen arms.
 const cpuBullpen=cpuPitchers.filter(p=>p.id!==cpuStarter.id).sort((a,b)=>{
  const ar=a.pos==="CP"?2:a.pos==="RP"?0:1,br=b.pos==="CP"?2:b.pos==="RP"?0:1;
  return ar-br||b.ovr-a.ovr;
 });
 const myDefense=HIT_SLOTS.slice(0,8).reduce((sum,pos)=>{
  const slot=team.lineup?.defense?.[pos]||pos;return sum+rating(slotMap.get(slot),"수비");
 },0)/8;
 const cpuDefense=cpuLineup.reduce((sum,p)=>sum+rating(p,"수비"),0)/9;
 type PitchState={player:Player;remaining:number;budget:number;load:number;pitches:number;
  runs:number;hits:number;walks:number;inningRuns:number;inningHits:number;inningWalks:number;
  batters:number;startInning:number;relief:boolean;};
 const makeState=(p:Player,inning:number,relief:boolean):PitchState=>{
  const sta=rating(p,"체력");
  const budget=relief?clamp(20+(sta-50)*.75,20,60):clamp(104+(sta-50)*2.38,104,230);
  return {player:p,remaining:budget,budget,load:0,pitches:0,runs:0,hits:0,walks:0,
   inningRuns:0,inningHits:0,inningWalks:0,batters:0,startInning:inning,relief};
 };
 const myPitchers=new Map<string,any>(),cpuPitchStats=new Map<string,any>();
 const myHitStats=new Map<string,any>(),cpuHitStats=new Map<string,any>();
 const hitterLine=(p:Player,ours:boolean)=>{
  const map=ours?myHitStats:cpuHitStats;
  if(!map.has(p.id))map.set(p.id,{cardId:p.id,name:p.name||p.id,
   PA:0,AB:0,H:0,BB:0,K:0,HR:0,twob:0,threeb:0,R:0,RBI:0});
  return map.get(p.id);
 };
 const pitcherLine=(p:Player,ours:boolean)=>{
  const map=ours?myPitchers:cpuPitchStats;
  if(!map.has(p.id))map.set(p.id,{cardId:p.id,name:p.name||p.id,outs:0,
   H:0,BB:0,K:0,ER:0,pitches:0,batters:0,staminaStart:rating(p,"체력"),remaining:100});
  return map.get(p.id);
 };
 hitters.forEach(p=>hitterLine(p,true));
 cpuLineup.forEach(p=>hitterLine(p,false));
 const makeManager=(starter:Player,bench:Player[],ours:boolean)=>{
  const used=new Set([starter.id]);
  let active=makeState(starter,1,false);
  pitcherLine(starter,ours);
  return {
   current:()=>active,
   startInning:()=>{active.inningRuns=0;active.inningHits=0;active.inningWalks=0},
   maybeChange:(inning:number,outs:number)=>{
    const recent=active.inningRuns>=3||(active.inningHits>=4)
      ||(active.inningHits+active.inningWalks>=5);
    const struggling=(active.runs>=5&&active.batters>=5)||
      (active.runs>=3&&active.inningRuns>=2&&active.batters>=5);
    const exhausted=active.remaining<=0;
    const worn=active.remaining<active.budget*(active.relief?.12:.13);
    const pitchCap=active.pitches>active.budget*1.13;
    const emergency=recent||struggling||(exhausted&&active.batters>=2);
    const inGameLongEnough=active.batters>=(active.relief?3:5);
    if(!(emergency||(inGameLongEnough&&(pitchCap||worn))))return;
    const options=bench.filter(p=>!used.has(p.id));
    if(!options.length)return; // A team cannot summon pitchers it does not have.
    // Save the closer for a late lead or ninth; use otherwise only if no alternatives remain.
    const important=inning>=8&&((ours?ourRuns-cpuRuns:cpuRuns-ourRuns)>=-1);
    const closer=options.find(p=>p.pos==="CP");
    const ordinary=options.filter(p=>p.pos!=="CP");
    const next=(important&&closer)||ordinary[0]||closer;
    if(!next)return;
    used.add(next.id);
    active=makeState(next,inning,true);
    pitcherLine(next,ours);
    if(events.length<270)events.push({inning,half:ours?"초":"말",result:"투수 교체",pitcherCardId:next.id,
     pitcher:next.name||next.id,outs,team:ours?"ours":"cpu"});
   },
   account:(pitches:number,outcome:string,runs:number)=>{
    const extra=outcome==="홈런"?10:outcome==="3루타"?6:outcome==="2루타"?4:
      outcome==="안타"?3:outcome==="볼넷"?2:0;
    const charge=pitches+extra+runs*2;
    active.pitches+=pitches;active.load+=charge;
    active.remaining=active.budget-active.load;active.batters++;
    if(outcome==="볼넷"){active.walks++;active.inningWalks++}
    if(["안타","2루타","3루타","홈런"].includes(outcome)){active.hits++;active.inningHits++}
    active.runs+=runs;active.inningRuns+=runs;
    const ps=pitcherLine(active.player,ours);ps.pitches+=pitches;ps.batters++;
    ps.remaining=Math.round(clamp(active.remaining/active.budget*100,0,100));
   }
  };
 };
 let ourRuns=0,cpuRuns=0,ourOrder=0,cpuOrder=0;
 const events:any[]=[],lines:any[]=[];
 const managers=[makeManager(myStarter,myBullpen,true),makeManager(cpuStarter,cpuBullpen,false)];
 for(let inning=1;inning<=9;inning++){
  const scores=[0,0];
  for(let half=0;half<2;half++){
   const ourAtBat=half===1,batters=ourAtBat?hitters:cpuLineup;
   const manager=managers[ourAtBat?1:0],ourPitching=!ourAtBat;
   manager.startInning();
   let outs=0,pa=0;
   type Runner={player:Player;pitcherId:string};
   let bases:(Runner|null)[]=[null,null,null];
   while(outs<3&&pa<25){
    manager.maybeChange(inning,outs);
    const current=manager.current(),pitcher=current.player;
    pa++;
    const batter=batters[(ourAtBat?ourOrder++:cpuOrder++)%9];
    const batterStats=hitterLine(batter,ourAtBat),pitchStats=pitcherLine(pitcher,ourPitching);
    batterStats.PA++;
    const fatigue=clamp(1-current.remaining/current.budget,0,1.35);
    const quality=rating(pitcher,"구위")-fatigue*20;
    const control=rating(pitcher,"제구")-fatigue*16;
    const contact=rating(batter,"정확"),power=rating(batter,"파워"),eye=rating(batter,"선구");
    const field=ourAtBat?cpuDefense:myDefense;
    const walkChance=clamp(.075+(eye-control)*.0012,.035,.21);
    const hitChance=clamp(.225+(contact-quality)*.0029+(75-field)*.0008,.115,.43);
    const x=roll();
    let outcome="",rbi=0,scoredByBatter=0;
    // Runners carry pitcher responsibility through pitching changes.
    const scoreRunner=(runner:Runner|null)=>{
     if(!runner)return;
     rbi++;
     hitterLine(runner.player,ourAtBat).R++;
     const all=ourPitching?myPitchers:cpuPitchStats;
     const responsible=all.get(runner.pitcherId);
     if(responsible)responsible.ER++;
    };
    const batterRunner:Runner={player:batter,pitcherId:pitcher.id};
    if(x<walkChance){
     outcome="볼넷";batterStats.BB++;pitchStats.BB++;
     if(bases[0]&&bases[1]&&bases[2])scoreRunner(bases[2]);
     if(bases[0]&&bases[1])bases[2]=bases[1];
     if(bases[0])bases[1]=bases[0];
     bases[0]=batterRunner;
    }else if(x<walkChance+hitChance){
     const y=roll(),hr=clamp(.075+(power-78)*.0024,.015,.19);
     batterStats.AB++;batterStats.H++;pitchStats.H++;
     if(y<hr){
      outcome="홈런";batterStats.HR++;
      bases.forEach(scoreRunner);bases=[null,null,null];
      scoreRunner(batterRunner);scoredByBatter=1;
     }else if(y<hr+.022){
      outcome="3루타";batterStats.threeb++;
      bases.forEach(scoreRunner);bases=[null,null,batterRunner];
     }else if(y<hr+.23){
      outcome="2루타";batterStats.twob++;
      scoreRunner(bases[1]);scoreRunner(bases[2]);
      bases=[null,batterRunner,bases[0]];
     }else{
      outcome="안타";
      scoreRunner(bases[1]);scoreRunner(bases[2]);
      bases=[batterRunner,bases[0],null];
     }
    }else{
     const strikeout=roll()<clamp(.43+(quality-contact)*.002,.25,.67);
     outcome=strikeout?"삼진":"범타";outs++;pitchStats.outs++;batterStats.AB++;
     if(strikeout){pitchStats.K++;batterStats.K++}
    }
    batterStats.RBI+=rbi;
    const numPitches=2+Math.floor(roll()*5)+(outcome==="볼넷"?1:0);
    manager.account(numPitches,outcome,rbi);
    scores[half]+=rbi;
    if(events.length<270)events.push({inning,half:ourAtBat?"말":"초",team:ourAtBat?"ours":"cpu",
     batter:batter.name||batter.id,batterCardId:batter.id,pitcher:pitcher.name||pitcher.id,
     pitcherCardId:pitcher.id,result:outcome,rbi,outs,pitches:numPitches});
   }
  }
  cpuRuns+=scores[0];ourRuns+=scores[1];
  lines.push({inning,cpu:scores[0],ours:scores[1]});
 }
 // The award is selected for the winning MY TEAM, with pitching and batting contributions both eligible.
 let mvp:any=null;let best=-Infinity;
 if(ourRuns>cpuRuns){
  for(const s of myHitStats.values()){
   const value=s.H*2+s.twob*1.2+s.threeb*2.5+s.HR*3.5+s.RBI*1.6+s.R+ s.BB*.6;
   if(value>best){best=value;mvp={cardId:s.cardId,role:"타자",score:Math.round(value*10)/10}}
  }
  for(const s of myPitchers.values()){
   const value=s.outs/3*2.4+s.K*1.25-s.ER*2.7-s.BB*.55-s.H*.35;
   if(s.outs>0&&value>best){best=value;mvp={cardId:s.cardId,role:"투수",score:Math.round(value*10)/10}}
  }
 }
 return {ourRuns,cpuRuns,innings:lines,events,playerStats:{
  ours:{batters:[...myHitStats.values()],pitchers:[...myPitchers.values()]},
  cpu:{batters:[...cpuHitStats.values()],pitchers:[...cpuPitchStats.values()]},mvp,
  engineVersion:2
 }};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return reply(req,405,{error:"POST 전용"});
 if(!ORIGINS.has(req.headers.get("origin")||""))return reply(req,403,{error:"허용되지 않은 웹사이트"});
 if(!URL||!SECRET)return reply(req,503,{error:"서버 비밀키 설정 확인 필요"});
 try{
  const bearer=req.headers.get("authorization")||"";
  if(!bearer.startsWith("Bearer "))fail(401,"Google 로그인이 필요합니다");
  const db=createClient(URL,SECRET,{auth:{persistSession:false}});
  const {data:{user},error:authError}=await db.auth.getUser(bearer.slice(7).trim());
  if(authError||!user||user.is_anonymous)fail(401,"Google 로그인 후 이용해 주세요");
  const bodyText=await req.text();
  if(bodyText.length>1500)fail(413,"요청 데이터가 너무 큽니다");
  let body:any;try{body=JSON.parse(bodyText)}catch{fail(400,"요청 JSON 오류")}
  const season=Number(body?.season);
  if(!Number.isInteger(season)||season<1||season>60)fail(400,"1~60차 시즌을 선택해 주세요");
  const clubs=await seasonClubs(season);
  const {data:progress,error:pe}=await db.from("rkbo_ladder_progress").select("cleared_count").eq("user_id",user.id).eq("season",season).maybeSingle();
  if(pe)fail(503,"진행도 조회 실패");
  const cleared=Number(progress?.cleared_count||0);
  if(body?.action==="catalog")return reply(req,200,{season,clearedCount:cleared,total:clubs.length,
   teams:clubs.map(c=>({code:c.code,name:c.name,rank:c.rank,strength:c.strength}))});
  if(body?.action!=="play")fail(400,"알 수 없는 요청");
  if(cleared>=clubs.length)fail(400,"이미 모든 구단을 클리어했어요");
  const teamId=body?.teamId;
  if(typeof teamId!=="string"||!/^[0-9a-f-]{36}$/i.test(teamId))fail(400,"저장된 MY TEAM을 선택해 주세요");
  const {data:team,error:te}=await db.from("rkbo_owned_teams")
   .select("id,name,slots,lineup").eq("user_id",user.id).eq("id",teamId).maybeSingle();
  if(te||!team||!Array.isArray(team.slots)||team.slots.length!==18)fail(400,"본인 MY TEAM을 찾을 수 없습니다");
  const ids=team.slots.map((s:any)=>s.cardId);
  if(new Set(ids).size!==18)fail(400,"팀에 중복 카드가 있습니다");
  const [{data:cards,error:ce},{data:inventory,error:ie},{count,error:countErr}]=await Promise.all([
    db.from("rkbo_pack_cards").select("card_id,position,card_type,name,ovr,ratings").in("card_id",ids),
    db.from("rkbo_card_inventory").select("card_id,quantity,gold_border,prism").eq("user_id",user.id).in("card_id",ids),
    db.from("rkbo_ladder_matches").select("id",{head:true,count:"exact"}).eq("user_id",user.id).eq("season",season)
  ]);
  if(ce||ie||countErr||cards?.length!==18||inventory?.length!==18)fail(400,"보유 선수 확인 실패");
  const valid=new Set(inventory.filter((v:any)=>v.quantity>0||v.gold_border||v.prism).map((v:any)=>v.card_id));
  if(ids.some((id:string)=>!valid.has(id)))fail(400,"보유 중이지 않은 선수가 포함되어 있어요");
  const me=new Map(cards.map((p:any)=>[p.card_id,{id:p.card_id,name:p.name,type:p.card_type,pos:p.position,ovr:p.ovr,ratings:p.ratings}]));
  const opponent=clubs[cleared]; // ordered from weakest to strongest
  const sim=simulate(team,me,opponent,count||0);
  const {data:saved,error:se}=await db.rpc("rkbo_commit_ladder_match",{
   p_user:user.id,p_team:team.id,p_season:season,p_opponent:opponent.code,
   p_rank:opponent.rank,p_total:clubs.length,p_our_runs:sim.ourRuns,p_cpu_runs:sim.cpuRuns,
   p_innings:sim.innings,p_events:sim.events,p_stats:sim.playerStats
  });
  if(se)fail(409,se.message||"경기 결과 저장 실패");
  return reply(req,200,{...saved,opponentName:opponent.name});
 }catch(err){const e=err as Error&{status?:number};
  return reply(req,e.status||500,{error:e.status?e.message:"경기 서버 오류: "+e.message})}
});
