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
function simulate(team:any,myCards:Map<string,Player>,opponent:Club,played:number){
 const slotMap=new Map<string,Player>();
 for(const item of team.slots)slotMap.set(item.slot,myCards.get(item.cardId)!);
 const battingOrder=team.lineup?.battingOrder;
 const rotation=team.lineup?.rotation;
 const bullpen=team.lineup?.bullpen;
 if(!Array.isArray(battingOrder)||battingOrder.length!==9||!Array.isArray(rotation)||rotation.length!==5||!Array.isArray(bullpen)||bullpen.length!==3
    ||[...HIT_SLOTS,...SP_SLOTS,...RP_SLOTS,"CP"].some(slot=>!slotMap.has(slot)))fail(400,"저장된 팀 구성에 문제가 있습니다");
 const hitters=battingOrder.map((s:string)=>slotMap.get(s)!);
 if(hitters.some(p=>!p))fail(400,"타순이 잘못되었습니다");
 const pitchers=[slotMap.get(rotation[played%5])!,...bullpen.map((s:string)=>slotMap.get(s)!),slotMap.get("CP")!];
 if(pitchers.some(p=>!p))fail(400,"투수 로테이션이 잘못되었습니다");
 const cpuHitters=opponent.players.filter(p=>p.type==="타자").sort((a,b)=>b.ovr-a.ovr);
 const cpuPitchers=opponent.players.filter(p=>p.type==="투수").sort((a,b)=>b.ovr-a.ovr);
 if(!cpuHitters.length||!cpuPitchers.length)fail(503,"상대 구단 선수 데이터가 부족합니다");
 const cpuLineup=Array.from({length:9},(_,i)=>cpuHitters[i%cpuHitters.length]);
 const cpuStarter=cpuPitchers.find(p=>p.pos==="SP")||cpuPitchers[0];
 const cpuRelievers=cpuPitchers.filter(p=>p.id!==cpuStarter.id&&p.pos!=="SP");
 const cpuPitchAt=(inning:number)=>inning<=5?cpuStarter:cpuRelievers.length?cpuRelievers[(inning-6)%cpuRelievers.length]:cpuStarter;
 const myPitchAt=(inning:number)=>inning<=5?pitchers[0]:inning<=8?pitchers[inning-5]:pitchers[4];
 const myFielding=HIT_SLOTS.slice(0,8).reduce((sum,s)=>sum+rating(slotMap.get(team.lineup?.defense?.[s]||s),"수비"),0)/8;
 const hitStats:Record<string,any>={},pitchStats:Record<string,any>={};
 const batterLine=(p:Player)=>hitStats[p.id]||(hitStats[p.id]={cardId:p.id,name:p.name,PA:0,AB:0,H:0,BB:0,K:0,HR:0,twob:0,threeb:0,R:0,RBI:0});
 const pitcherLine=(p:Player)=>pitchStats[p.id]||(pitchStats[p.id]={cardId:p.id,name:p.name,outs:0,H:0,BB:0,K:0,ER:0});
 hitters.forEach(batterLine);pitchers.forEach(pitcherLine);
 const lines:any[]=[],events:any[]=[];
 let cpuOrder=0,ourOrder=0,ourRuns=0,cpuRuns=0;
 for(let inning=1;inning<=9;inning++){
  const scores=[0,0];
  for(let half=0;half<2;half++){
   const ourAtBat=half===1,batters=ourAtBat?hitters:cpuLineup,pitcher=ourAtBat?cpuPitchAt(inning):myPitchAt(inning);
   let outs=0,pa=0,bases:(Player|null)[]=[null,null,null];
   while(outs<3&&pa<20){
    pa++;
    const b=batters[((ourAtBat?ourOrder++:cpuOrder++)%9)];
    const st=ourAtBat?batterLine(b):null;
    const ps=!ourAtBat?pitcherLine(pitcher):null;
    if(st)st.PA++;
    const contact=rating(b,"정확"),power=rating(b,"파워"),eye=rating(b,"선구");
    const quality=rating(pitcher,"구위"),control=rating(pitcher,"제구");
    const defense=ourAtBat?75:myFielding;
    const walk=clamp(.075+(eye-control)*.0012,.03,.14);
    const hit=clamp(.24+(contact-quality)*.003+(75-defense)*.001,.11,.39);
    const x=roll();
    let outcome="",rbi=0;
    const scoreRunner=(runner:Player|null)=>{
     if(!runner)return;
     rbi++;if(ourAtBat){batterLine(runner).R++}
    };
    if(x<walk){
     outcome="볼넷";if(st)st.BB++;if(ps)ps.BB++;
     if(bases[0]&&bases[1]&&bases[2])scoreRunner(bases[2]);
     if(bases[0]&&bases[1])bases[2]=bases[1];
     if(bases[0])bases[1]=bases[0];
     bases[0]=b;
    }else if(x<walk+hit){
     const y=roll(),hr=clamp(.10+(power-78)*.0025,.025,.22);
     if(st){st.AB++;st.H++}if(ps)ps.H++;
     if(y<hr){
      outcome="홈런";if(st)st.HR++;
      bases.forEach(scoreRunner);bases=[null,null,null];scoreRunner(b);
     }else if(y<hr+.025){
      outcome="3루타";if(st)st.threeb++;
      bases.forEach(scoreRunner);bases=[null,null,b];
     }else if(y<hr+.24){
      outcome="2루타";if(st)st.twob++;
      scoreRunner(bases[1]);scoreRunner(bases[2]);
      bases=[null,b,bases[0]];
     }else{
      outcome="안타";scoreRunner(bases[1]);scoreRunner(bases[2]);
      bases=[b,bases[0],null];
     }
    }else{
     const strikeout=roll()<clamp(.43+(quality-contact)*.002,.25,.62);
     outcome=strikeout?"삼진":"범타";outs++;
     if(st){st.AB++;if(strikeout)st.K++}
     if(ps){ps.outs++;if(strikeout)ps.K++}
    }
    if(st)st.RBI+=rbi;
    if(ps)ps.ER+=rbi;
    scores[half]+=rbi;
    if(events.length<270)events.push({inning,half:ourAtBat?"말":"초",batter:b.name||b.id,result:outcome,rbi,outs});
   }
  }
  cpuRuns+=scores[0];ourRuns+=scores[1];
  lines.push({inning,cpu:scores[0],ours:scores[1]});
 }
 return {ourRuns,cpuRuns,innings:lines,events,playerStats:{batters:Object.values(hitStats),pitchers:Object.values(pitchStats)}};
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
