/* TRT creator credential vault.
   Stores only AES-GCM ciphertext and a non-extractable CryptoKey in IndexedDB.
   Google OAuth account ID must match before any stored token is decrypted.
   Same-origin XSS can still access browser-held credentials: do not use on shared devices. */
(function(root){"use strict";
 const DB="rkbo-trt-admin-vault-v1",STORE="entries";
 let connectedUid=null,restoring=false;
 function openDB(){
  return new Promise((resolve,reject)=>{
   if(!root.indexedDB){reject(Error("이 브라우저는 인증 정보 저장을 지원하지 않습니다."));return}
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>req.result.createObjectStore(STORE);
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error("보안 저장소를 열 수 없습니다."));
  });
 }
 function request(db,method,key,value){
  return new Promise((resolve,reject)=>{
   const t=db.transaction(STORE,method==="get"?"readonly":"readwrite");
   const r=t.objectStore(STORE)[method](...(method==="put"?[value,key]:[key]));
   r.onsuccess=()=>resolve(r.result);
   r.onerror=()=>reject(r.error||Error("보안 저장소 작업이 실패했습니다."));
  });
 }
 async function googleUserId(){
  const c=await root.RKBOOnline?.getClient?.();
  if(!c)throw Error("Google 로그인 후 제작자 인증을 진행해 주시기 바랍니다.");
  const {data,error}=await c.auth.getUser(),user=data?.user;
  if(error||!user||user.is_anonymous)throw Error("Google 로그인 후 제작자 인증을 진행해 주시기 바랍니다.");
  const providers=[user.app_metadata?.provider,...(user.app_metadata?.providers||[]),
   ...(user.identities||[]).map(identity=>identity.provider)];
  if(!providers.includes("google"))throw Error("Google 계정으로 로그인해야 제작자 인증을 사용할 수 있습니다.");
  return user.id;
 }
 async function remember(token,uid){
  if(!root.crypto?.subtle)throw Error("암호화 기능을 사용할 수 없습니다.");
  const db=await openDB();
  try{
   let key=await request(db,"get","key");
   if(!key){
    key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
    await request(db,"put","key",key);
   }
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(token));
   await request(db,"put","credential",{uid,iv:Array.from(iv),encrypted:Array.from(new Uint8Array(encrypted))});
  }finally{db.close()}
 }
 async function forget(){
  const db=await openDB();try{await request(db,"delete","credential")}finally{db.close()}
 }
 async function restore(){
  if(restoring||root.RKBOAdminBridge?.isAuthorized?.())return;
  const field=document.getElementById("admin-token"),button=document.getElementById("admin-connect");
  if(!field||!button)return;
  restoring=true;
  try{
   const uid=await googleUserId();
   const db=await openDB();let saved,key;
   try{[saved,key]=await Promise.all([request(db,"get","credential"),request(db,"get","key")])}finally{db.close()}
   if(!saved||saved.uid!==uid||!key)return;
   const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(saved.iv)},
    key,new Uint8Array(saved.encrypted));
   field.value=new TextDecoder().decode(bytes);
   button.click();
  }catch(e){console.warn("[TRT admin vault] Automatic connection unavailable",e)}
  finally{restoring=false}
 }
 function bind(uid){connectedUid=uid}
 function unbind(){connectedUid=null}
 async function watch(){
  const c=await root.RKBOOnline?.getClient?.();if(!c)return;
  c.auth.onAuthStateChange((event,session)=>{
   if(connectedUid&&session?.user?.id!==connectedUid){
    root.RKBOAdminBridge?.disconnect?.();
   }
   if(event==="SIGNED_IN"&&!root.RKBOAdminBridge?.isAuthorized?.()){
    root.setTimeout(()=>void restore(),250);
   }
  });
 }
 root.RKBOAdminVault={googleUserId,remember,forget,restore,bind,unbind,watch};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{
  root.setTimeout(()=>void restore(),800);
  void watch().catch(e=>console.warn("[TRT admin vault]",e));
 });else{
  root.setTimeout(()=>void restore(),800);void watch().catch(console.warn);
 }
})(window);
