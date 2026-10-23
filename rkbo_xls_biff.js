/* Minimal dependency-free BIFF8 .xls loader for RKBO historic record files. */
(function(root){
'use strict';
const U16=(b,o)=>b[o]+(b[o+1]<<8);
const U32=(b,o)=>((b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0);
const dec=new TextDecoder('utf-16le');
function compound(input){
 const b=input instanceof Uint8Array?input:new Uint8Array(input);
 if(b[0]!==0xD0||b[1]!==0xCF||b[2]!==0x11||b[3]!==0xE0)throw Error('Excel XLS/OLE2 파일이 아닙니다.');
 const SS=1<<U16(b,0x1e),miniSS=1<<U16(b,0x20),EOC=0xFFFFFFFE,FREE=0xFFFFFFFF;
 if(SS!==512&&SS!==4096)throw Error('지원되지 않는 XLS 섹터 크기 '+SS);
 const sector=n=>b.subarray(512+n*SS,512+(n+1)*SS);
 const difats=[];for(let p=0x4c;p<0x200;p+=4){const n=U32(b,p);if(n!==FREE)difats.push(n)}
 let dif=U32(b,0x44);
 for(let k=0;k<U32(b,0x48)&&dif!==EOC&&dif!==FREE&&k<1000;k++){
  const v=sector(dif);for(let i=0;i<SS-4;i+=4){const n=U32(v,i);if(n!==FREE)difats.push(n)}dif=U32(v,SS-4);
 }
 const fat=new Uint32Array(difats.length*SS/4);for(let i=0;i<difats.length;i++){const s=sector(difats[i]);for(let j=0;j<SS/4;j++)fat[i*SS/4+j]=U32(s,j*4)}
 function chain(start,length,store=sector,nextIndex=n=>fat[n],chunkSize=SS){
  const chunks=[];let cur=start,count=0,limit=length===Infinity?100000:Math.ceil(length/chunkSize)+1;
  while(cur!==EOC&&cur!==FREE&&cur<0xFFFFFFF0&&count<limit){
   if(cur<0||cur>=fat.length&&store===sector)throw Error('XLS FAT sector invalid '+cur);
   chunks.push(store(cur));cur=nextIndex(cur);count++;
  }
  const size=length===Infinity?chunks.length*chunkSize:Math.min(length,chunks.length*chunkSize);
  const out=new Uint8Array(size);let off=0;for(const chunk of chunks){let len=Math.min(chunk.length,size-off);out.set(chunk.subarray(0,len),off);off+=len;if(off>=size)break}return out;
 }
 const directory=chain(U32(b,0x30),Infinity);
 const entries=[];for(let off=0;off+128<=directory.length;off+=128){
  const nameLen=U16(directory,off+0x40),type=directory[off+0x42];if(!nameLen||!type)continue;
  const name=dec.decode(directory.subarray(off,off+nameLen-2));
  entries.push({name,type,start:U32(directory,off+0x74),size:U32(directory,off+0x78)});
 }
 const rootDir=entries.find(e=>e.type===5),workbook=entries.find(e=>e.type===2&&/^(Workbook|Book)$/i.test(e.name));
 if(!workbook)throw Error('Workbook 스트림을 찾지 못했습니다.');
 if(workbook.size>=U32(b,0x38))return chain(workbook.start,workbook.size);
 // Mini stream handling (rare for workbook)
 if(!rootDir)throw Error('Root Entry 없음');
 const minib=chain(rootDir.start,rootDir.size),miniFATData=chain(U32(b,0x3c),U32(b,0x40)*SS);
 const miniFAT=Uint32Array.from({length:miniFATData.length/4},(_,i)=>U32(miniFATData,i*4));
 return chain(workbook.start,workbook.size,n=>minib.subarray(n*miniSS,(n+1)*miniSS),n=>miniFAT[n],miniSS);
}
const readDouble=(b,o)=>new DataView(b.buffer,b.byteOffset+o,8).getFloat64(0,true);
function rk(n){const raw=n>>>0;if(raw&2)return (raw>>2)/(raw&1?100:1);const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setUint32(0,0,true);view.setUint32(4,raw&0xfffffffc,true);return view.getFloat64(0,true)/(raw&1?100:1)}
function strSegment(b,off,len,wide){const bytes=b.subarray(off,off+len*(wide?2:1));return wide?dec.decode(bytes):new TextDecoder('windows-1252').decode(bytes)}
function readSST(pieces){
 // The BIFF CONTINUE record starts with a 1-byte encoding flag if a unicode string is split.
 let part=0,pos=0,total=pieces.reduce((n,p)=>n+p.length,0),copied=0;
 const next=()=>{part++;pos=0};
 function byte(){while(part<pieces.length&&pos>=pieces[part].length)next();if(part>=pieces.length)throw Error('SST 자료 부족');copied++;return pieces[part][pos++]}
 function u16(){let a=byte();return a|(byte()<<8)}
 function u32(){const a=u16(),b=u16();return a+b*65536}
 const n=u32(),uniq=u32(),items=[];
 for(let idx=0;idx<uniq;idx++){
  const nchar=u16(),opts=byte(),rich=opts&8?u16():0,ext=opts&4?u32():0;
  let wide=!!(opts&1),out='',rem=nchar;
  while(rem>0){
   if(part>=pieces.length)throw Error('SST 문자열 손상');
   if(pos>=pieces[part].length){next();if(part>=pieces.length)throw Error('SST continuation 없음');wide=!!(byte()&1)}
   const bytes=pieces[part].length-pos,cnt=Math.min(rem,Math.floor(bytes/(wide?2:1)));
   if(!cnt){next();if(part>=pieces.length)throw Error('SST continuation 없음');wide=!!(byte()&1);continue}
   out+=strSegment(pieces[part],pos,cnt,wide);pos+=cnt*(wide?2:1);rem-=cnt;
  }
  for(let i=0;i<rich*4+ext;i++)byte();
  items.push(out);
 }
 return items;
}
function parseBIFF(array){
 const b=compound(array),sheets=[],records={},types=new Map();let sst=[];
 for(let off=0;off+4<=b.length;){const type=U16(b,off),len=U16(b,off+2),pos=off+4;if(!type&&!len)break;if(pos+len>b.length)break;
  types.set(type,(types.get(type)||0)+1);
  if(type===0x85){const sheetOffset=U32(b,pos),n=b[pos+6],wide=b[pos+7];const name=strSegment(b,pos+8,n,!!wide);sheets.push({offset:sheetOffset,name})}
  if(type===0xfc){const seg=[b.subarray(pos,pos+len)];let nx=pos+len;while(nx+4<=b.length&&U16(b,nx)===0x3c){const l=U16(b,nx+2);seg.push(b.subarray(nx+4,nx+4+l));nx+=4+l}sst=readSST(seg)}
  off=pos+len;
 }
 function sheet(sh){const rows=new Map();let maxCol=0;const put=(r,c,v)=>{if(r>50000||c>200||c<0)return;let row=rows.get(r);if(!row){row=[];rows.set(r,row)}row[c]=v;maxCol=Math.max(maxCol,c)};
  let end=false;for(let off=sh.offset;off+4<=b.length&&!end;){const type=U16(b,off),len=U16(b,off+2),pos=off+4;if(!type&&!len||pos+len>b.length)break;
   if(type===0x0A)end=true;
   if(type===0xFD){const r=U16(b,pos),c=U16(b,pos+2),i=U32(b,pos+6);put(r,c,sst[i]||'')}
   else if(type===0x203){put(U16(b,pos),U16(b,pos+2),readDouble(b,pos+6))}
   else if(type===0x27e){put(U16(b,pos),U16(b,pos+2),rk(U32(b,pos+6)))}
   else if(type===0xbd){const r=U16(b,pos),first=U16(b,pos+2),last=U16(b,pos+len-2);for(let c=first;c<=last;c++)put(r,c,rk(U32(b,pos+4+(c-first)*6+2)))}
   else if(type===0x6){const r=U16(b,pos),c=U16(b,pos+2),v=readDouble(b,pos+6);if(Number.isFinite(v))put(r,c,v)}
   else if(type===0x204){const r=U16(b,pos),c=U16(b,pos+2),n=U16(b,pos+6);put(r,c,new TextDecoder('windows-1252').decode(b.subarray(pos+8,pos+8+n)))}
   off=pos+len;
  }
  return {name:sh.name,rows:[...rows.entries()].sort((a,b)=>a[0]-b[0]).map(([index,cells])=>({index,cells}))};
 }
 return {sheets:sheets.map(sheet),stats:Object.fromEntries([...types.entries()].map(([k,v])=>[k.toString(16),v])),sstCount:sst.length};
}
root.RKBOXLS={parse:parseBIFF};
})(typeof window==='undefined'?globalThis:window);
