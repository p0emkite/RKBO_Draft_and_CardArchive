/* RKBO main-screen chat dock: always visible, expandable, realtime.
 * Server owns authentication and the 240-character validation.
 */
(function(root){"use strict";
const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,char=>({
 "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[char]));
const fmt=value=>{
 try{return new Date(value).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}
 catch{return ""}
};
let dock=null,expanded=false,client=null,userId=null,channel=null,connecting=null;

let messages=[],names=new Map(),unread=0,knownLastId=0,sending=false,requestSeq=0;
let refreshTimer=null;
const find=selector=>dock?.querySelector(selector);
function feedback(value,isError=false){
 const node=find("[data-chat-status]");
 if(node){node.textContent=value||"";node.classList.toggle("is-error",isError)}
}
function updateUnread(){
 const indicator=find("[data-chat-unread]");
 if(!indicator)return;
 indicator.hidden=unread===0;
 indicator.textContent=unread>99?"99+":String(unread);
 const header=find("[data-chat-toggle]");
 header?.setAttribute("aria-label",unread?"RKBO 채팅 열기, 새 메시지 "+unread+"개":"RKBO 채팅 열기 또는 접기");
}
function renderMessages(){
 const stream=find("[data-chat-messages]");
 if(!stream)return;
 const sticky=stream.scrollHeight-stream.scrollTop-stream.clientHeight<75;
 stream.innerHTML=messages.map(m=>'<article class="rkbo-chat-entry'+(m.user_id===userId?' is-mine':'')+'">'+
  '<div class="rkbo-chat-entry-meta"><strong>'+escapeHTML(names.get(m.user_id)||"회원")+'</strong><time>'+
  fmt(m.created_at)+'</time></div><p>'+escapeHTML(m.body)+'</p>'+
  (m.deleted?'':m.user_id===userId?
   '<button type="button" data-chat-delete="'+m.id+'">삭제</button>':
   '<button type="button" data-chat-report="'+m.id+'">신고</button>')+
  '</article>').join("")||'<p class="rkbo-chat-empty">아직 메시지가 없습니다. 먼저 인사를 남겨 주시기 바랍니다. ⚾</p>';
 if(sticky||expanded&&requestSeq===0)stream.scrollTop=stream.scrollHeight;
}
function showLogin(error){
 const form=find("[data-chat-form]");
 const hint=find("[data-chat-auth]");
 if(form)form.hidden=true;
 if(hint){
  hint.hidden=false;
  hint.innerHTML='<p>Google 로그인 후 커뮤니티 채팅을 이용할 수 있습니다.</p>'+
  '<button type="button" data-chat-login>Google 로그인</button>'+
  '<button type="button" data-chat-retry>연결 다시 시도</button>';
 }
 feedback(error||"");
}
function showComposer(){
 const form=find("[data-chat-form]"),hint=find("[data-chat-auth]");
 if(form)form.hidden=false;
 if(hint)hint.hidden=true;
}
async function getAccount(){
 const c=await root.RKBOOnline?.getClient?.();
 if(!c)throw Error("RKBO ONLINE 연결 상태를 확인해 주세요.");
 const {data,error}=await c.auth.getUser();
 if(error||!data?.user||data.user.is_anonymous)throw Error("Google 로그인이 필요합니다.");
 client=c;userId=data.user.id;
 return c;
}
async function syncMessages(){
 if(!client||!userId)return;
 const sequence=++requestSeq;
 const {data,error}=await client.from("rkbo_community_chat_messages")
  .select("id,user_id,body,created_at,deleted").order("created_at",{ascending:false}).limit(80);
 if(error)throw Error(error.message);
 if(sequence!==requestSeq)return;
 const rows=(data||[]).reverse();
 const authorIds=[...new Set(rows.map(row=>row.user_id))];
 if(authorIds.length){
  const missing=authorIds.filter(id=>!names.has(id));
  if(missing.length){
   const authors=await client.from("rkbo_profiles").select("user_id,nickname").in("user_id",missing);
   if(!authors.error)for(const profile of authors.data||[])names.set(profile.user_id,profile.nickname);
  }
 }
 if(sequence!==requestSeq)return;
 messages=rows;knownLastId=Math.max(knownLastId,...rows.map(m=>Number(m.id)||0),0);
 renderMessages();
}
function handleIncoming(payload){
 const row=payload?.new||{};
 if(payload?.eventType==="INSERT"){
  const id=Number(row.id)||0;
  if(id>knownLastId){knownLastId=id;if(!expanded&&row.user_id!==userId){unread++;updateUnread()}}
 }
 if(expanded)void syncMessages().catch(e=>feedback(e.message,true));
}
async function connect(){
 if(client&&channel&&userId){
  await syncMessages();showComposer();feedback("");return;
 }
 if(connecting)return connecting;
 connecting=(async()=>{
  feedback("채팅 연결 중…");
  const c=await getAccount();
  showComposer();
  await syncMessages();
  if(!channel){
   channel=c.channel("rkbo-chat-dock").on("postgres_changes",
    {event:"*",schema:"public",table:"rkbo_community_chat_messages"},handleIncoming)
    .subscribe(status=>{
     if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")feedback("실시간 연결이 불안정합니다. 새로고침으로 동기화하고 있습니다.",true);
    });
  }
  if(!refreshTimer){
   refreshTimer=root.setInterval(()=>{
    if(expanded&&client)void syncMessages().catch(e=>feedback(e.message,true));
   },20000);
  }
  feedback("");
 })().catch(error=>{
  showLogin(error.message);
  throw error;
 }).finally(()=>{connecting=null});
 return connecting;
}
async function expand(shouldOpen=true){
 if(!dock)init();
 expanded=Boolean(shouldOpen);
 dock.classList.toggle("is-expanded",expanded);
 const panel=find("[data-chat-panel]"),toggle=find("[data-chat-toggle]");
 if(panel)panel.hidden=!expanded;
 toggle?.setAttribute("aria-expanded",String(expanded));
 const chevron=find("[data-chat-chevron]");
 if(chevron)chevron.textContent=expanded?"⌄":"⌃";
 if(!expanded)return;
 unread=0;updateUnread();
 try{
  await connect();
  const textarea=find("[data-chat-input]");
  textarea?.focus({preventScroll:true});
 }catch(error){console.warn("[RKBO chat dock] connection",error)}
}
async function send(){
 if(sending)return;
 const input=find("[data-chat-input]"),body=input?.value.trim();
 if(!body)return;
 const button=find("[data-chat-send]");
 sending=true;if(button)button.disabled=true;
 try{
  await getAccount();
  const {error}=await client.rpc("rkbo_community_chat_send",{p_body:body});
  if(error)throw Error(error.message);
  if(input?.value.trim()===body)input.value="";
  feedback("");await syncMessages();
 }catch(error){feedback("전송 실패: "+error.message,true)}
 finally{sending=false;if(button)button.disabled=false}
}
async function messageAction(button){
 const deleteId=button.dataset.chatDelete,reportId=button.dataset.chatReport;
 if(deleteId){
  if(!root.confirm("메시지를 삭제하시겠습니까?"))return;
  const {error}=await client.rpc("rkbo_community_chat_delete",{p_id:Number(deleteId)});
  if(error)throw Error(error.message);
  feedback("메시지를 삭제했습니다.");
 }else if(reportId){
  if(!root.confirm("이 메시지를 신고하시겠습니까?"))return;
  const {error}=await client.rpc("rkbo_community_chat_report",{p_id:Number(reportId)});
  if(error)throw Error(error.message);
  feedback("신고가 접수되었습니다.");
 }
 await syncMessages();
}
function init(){
 if(dock||!document.body)return;
 dock=document.createElement("aside");
 dock.id="rkbo-chat-dock";dock.className="rkbo-chat-dock";
 dock.setAttribute("aria-label","RKBO 커뮤니티 채팅");
 dock.innerHTML=
 '<button type="button" class="rkbo-chat-header" data-chat-toggle aria-expanded="false" aria-controls="rkbo-chat-panel">'+
  '<span class="rkbo-chat-header-title"><span aria-hidden="true">💬</span> RKBO 채팅</span>'+
  '<span class="rkbo-chat-header-actions"><span class="rkbo-chat-unread" data-chat-unread hidden></span>'+
  '<span data-chat-chevron aria-hidden="true">⌃</span></span>'+
 '</button>'+
 '<section id="rkbo-chat-panel" class="rkbo-chat-panel" data-chat-panel hidden>'+
  '<div class="rkbo-chat-stream" role="log" aria-live="polite" aria-relevant="additions" data-chat-messages>'+
   '<p class="rkbo-chat-empty">채팅창을 연결하고 있어…</p></div>'+
  '<div class="rkbo-chat-status" data-chat-status role="status"></div>'+
  '<div class="rkbo-chat-auth" data-chat-auth hidden></div>'+
  '<form class="rkbo-chat-compose" data-chat-form hidden>'+
   '<textarea data-chat-input aria-label="채팅 메시지" maxlength="240" rows="2" placeholder="회원들과 자유롭게 대화해 주시기 바랍니다."></textarea>'+
   '<button type="submit" data-chat-send>전송</button>'+
  '</form>'+
 '</section>';
 document.body.append(dock);
 dock.addEventListener("click",async event=>{
  if(event.target.closest("[data-chat-toggle]")){await expand(!expanded);return}
  const login=event.target.closest("[data-chat-login]");
  if(login){root.RKBOOnline?.open?.("account");return}
  if(event.target.closest("[data-chat-retry]")){await expand(true);return}
  const action=event.target.closest("[data-chat-delete],[data-chat-report]");
  if(action){
   action.disabled=true;
   try{if(!client)await getAccount();await messageAction(action)}
   catch(error){feedback(error.message,true)}
   finally{if(action.isConnected)action.disabled=false}
  }
 });
 const form=find("[data-chat-form]");
 form?.addEventListener("submit",event=>{event.preventDefault();void send()});
 find("[data-chat-input]")?.addEventListener("keydown",event=>{
  if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){
   event.preventDefault();void send();
  }
 });
 root.addEventListener?.("focus",()=>{
  if(expanded&&client)void syncMessages().catch(()=>{});
 });
}
root.RKBOChatDock={open:()=>expand(true),close:()=>expand(false),toggle:()=>expand(!expanded)};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
})(window);
