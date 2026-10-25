// RKBO ONLINE v1 Edge Function. Supabase CLI: supabase functions deploy draft-submit --no-verify-jwt
// Server-only Supabase secret key is read from the Edge runtime, never sent to browsers.
// LIMITATION: card identities and scores are verified; browser-generated random offers
// are not independently verifiable until future server-side draft sessions.
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")||"";
const SECRET=(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}") as Record<string,string>).default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ORIGINS=new Set(["https://p0emkite.github.io","http://localhost:8080","http://127.0.0.1:8080"]);
const BASE="https://raw.githubusercontent.com/p0emkite/RKBO_Draft_and_CardArchive/main/";
const slots=new Set(["C","1B","2B","3B","SS","LF","CF","RF","DH","SP1","SP2","SP3","SP4","SP5","RP1","RP2","RP3","CP"]);
const cache=new Map<string,{expires:number,data:any}>();
const cors=(req:Request)=>({
 "Access-Control-Allow-Origin":ORIGINS.has(req.headers.get("origin")||"")?req.headers.get("origin")!:"https://p0emkite.github.io",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info,x-retry-count,traceparent,tracestate,baggage",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"
});
const output=(req:Request,status:number,obj:unknown)=>new Response(JSON.stringify(obj),{status,headers:{...cors(req),"Content-Type":"application/json"}});
const fail=(status:number,message:string)=>{const e=new Error(message) as Error&{status:number};e.status=status;throw e};
const normal=(x:unknown)=>String(x??"").normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
async function published(path:string):Promise<any>{
 const x=cache.get(path);if(x&&x.expires>Date.now())return x.data;
 const response=await fetch(BASE+path,{headers:{"Accept":"application/json"}});
 if(!response.ok)fail(503,"GitHub 공식 카드 원본 접근 실패: "+path);
 let data:any;
 if(path==="index.html"){
  const html=await response.text(),start='<script id="data" type="application/json">',end="</script>";
  const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
  if(a<0||b<a)fail(503,"공식 60차 카드 데이터 읽기 실패");
  data=JSON.parse(html.slice(a+start.length,b));
 }else data=await response.json();
 cache.set(path,{data,expires:Date.now()+120000});return data;
}
function legal(p:any,slot:string):boolean{
 if(slot==="DH")return p.type==="타자";
 if(/^SP[1-5]$/.test(slot))return p.type==="투수"&&p.pos==="SP";
 if(/^RP[1-3]$/.test(slot))return p.type==="투수"&&p.pos==="RP";
 if(slot==="CP")return p.type==="투수"&&p.pos==="CP";
 return p.type==="타자"&&p.pos===slot;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
 if(req.method!=="POST")return output(req,405,{error:"POST 전용 API"});
 if(!ORIGINS.has(req.headers.get("origin")||""))return output(req,403,{error:"허용되지 않은 웹사이트"});
 if(!URL||!SECRET)return output(req,503,{error:"Supabase 서버 환경 설정 누락"});
 try{
  const auth=req.headers.get("authorization")||"";
  if(!auth.startsWith("Bearer "))fail(401,"온라인 랭킹은 로그인 후 등록할 수 있습니다.");
  const db=createClient(URL,SECRET,{auth:{persistSession:false}});
  const {data:{user},error:authErr}=await db.auth.getUser(auth.slice(7).trim());
  if(authErr||!user||user.is_anonymous)fail(401,"이메일 인증 계정으로 로그인해야 합니다.");
  const bodyText=await req.text();if(bodyText.length>14000)fail(413,"드래프트 데이터가 너무 큽니다.");
  const body=JSON.parse(bodyText);
  const mode=body?.mode,hidden=body?.hidden,season=Number(body?.season),picks=body?.slots;
  if(!["season","all"].includes(mode)||typeof hidden!=="boolean"||!Number.isInteger(season)||season<1||season>999)
   fail(400,"드래프트 모드나 시즌이 올바르지 않습니다.");
  if(!Array.isArray(picks)||picks.length!==18||new Set(picks.map((x:any)=>x?.slot)).size!==18)
   fail(400,"18명의 서로 다른 포지션이 필요합니다.");
  const manifest=await published("data/seasons.json");
  if(!Array.isArray(manifest?.seasons))fail(503,"공개 시즌 목록이 잘못되었습니다.");
  const available=new Map<number,any>(manifest.seasons.map((x:any)=>[Number(x.season),x]));
  if(!available.has(season))fail(400,"기준 시즌이 등록되어 있지 않습니다.");
  const needed=new Set<number>();
  for(const x of picks){
   if(!x||!slots.has(x.slot)||typeof x.cardId!=="string")fail(400,"드래프트 슬롯 형식 오류");
   const m=x.cardId.match(/^([1-9]\d{0,2})-[A-Z]{2,4}-(?:타|투)-\d{3}$/);
   if(!m)fail(400,"공식 카드 ID 형식 오류");
   const n=Number(m[1]);
   if(!available.has(n)||(mode==="season"&&n!==season))fail(400,"드래프트 시즌 규칙 위반");
   needed.add(n);
  }
  const cards=new Map<string,any>();
  await Promise.all([...needed].map(async n=>{
   const meta=available.get(n),path=n===60?"index.html":meta?.file;
   if(n!==60&&path!=="data/seasons/"+n+".json")fail(400,"공식 카드 파일 경로 오류");
   const res=await published(path),rows=Array.isArray(res)?res:res?.players;
   if(!Array.isArray(rows))fail(503,"공식 선수 카드 데이터 누락");
   rows.forEach((p:any)=>cards.set(p.id,p));
  }));
  const players:any[]=[],athletes=new Set<string>();
  for(const x of picks){
   const p=cards.get(x.cardId);
   if(!p||!legal(p,x.slot)||!Number.isFinite(Number(p.ovr))||p.ovr<1||p.ovr>99)
    fail(400,"실제 선수/포지션이 선택 기록과 다릅니다: "+x.slot);
   if(Number(x.ovr)!==Number(p.ovr))fail(400,"제출 OVR이 공식 카드와 일치하지 않습니다.");
   const unique=normal(p.rawName||p.englishName||p.name||p.id);
   if(athletes.has(unique))fail(400,"같은 선수를 중복 지명할 수 없습니다.");
   athletes.add(unique);
   players.push({slot:x.slot,cardId:p.id,ovr:p.ovr,name:p.name,team:p.team,season:Number(p.season),pos:p.pos});
  }
  const sorted=players.map(p=>Number(p.ovr)).sort((a,b)=>b-a),mean=(a:number[])=>a.reduce((v,w)=>v+w,0)/a.length;
  const avg=Number(mean(sorted).toFixed(1)),tpi=Math.round((.7*mean(sorted)+.2*mean(sorted.slice(0,6))+.1*mean(sorted.slice(-6)))*10);
  if(Number(body.power)!==tpi||Number(body.averageOVR)!==avg)fail(400,"서버에서 계산한 OVR/TPI와 일치하지 않습니다.");
  const {count,error:countErr}=await db.from("rkbo_draft_results").select("id",{head:true,count:"exact"})
   .eq("user_id",user.id).gte("created_at",new Date(Date.now()-3600000).toISOString());
  if(countErr)fail(503,"랭킹 등록 제한 확인에 실패했습니다.");
  if((count||0)>=30)fail(429,"1시간 동안 최대 30팀까지만 랭킹에 등록할 수 있습니다.");
  const {data:profile,error:profileErr}=await db.from("rkbo_profiles").select("user_id").eq("user_id",user.id).maybeSingle();
  if(profileErr)fail(503,"닉네임 계정을 확인할 수 없습니다.");
  if(!profile){
   const created=await db.from("rkbo_profiles").insert({user_id:user.id,nickname:"RKBO_"+user.id.slice(0,8)});
   if(created.error)fail(503,"사용자 닉네임 생성에 실패했습니다.");
  }
  const saved=await db.from("rkbo_draft_results").insert({
   user_id:user.id,mode,hidden,season,average_ovr:avg,tpi,picks:players
  }).select("id,created_at").single();
  if(saved.error)fail(503,"랭킹 기록 저장 실패: "+saved.error.message);
  return output(req,200,{ok:true,id:saved.data.id,createdAt:saved.data.created_at,averageOVR:avg,power:tpi});
 }catch(e){
  const status=typeof (e as any)?.status==="number"?(e as any).status:500;
  console.error("[RKBO Online server]",e);
  return output(req,status,{error:status===500?"서버 검증 중 오류가 발생했습니다.":String((e as Error)?.message||"알 수 없는 오류")});
 }
});
