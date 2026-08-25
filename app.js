
const STORAGE_KEY = "yarntime_v1";
let state = loadState();
let detailProjectId = null;
let pendingLapProjectId = null;
let pendingLapSnapshot = null;
let pendingProjectPhotoFile = null;
let pendingProjectPhotoPreviewUrl = null;
let pendingLapPhotoFile = null;
let pendingLapPhotoPreviewUrl = null;
const photoUrlCache = new Map();
let latestResumeBlob = null;
let latestResumeProjectId = null;
let currentProjectFilter = "active";
let latestRecapBlob = null;
let latestRecapProjectId = null;
let latestRecapUrl = null;
let editingProjectId = null;
let editingSessionId = null;
const sessionVisibleByProject = new Map();
const lapVisibleByProject = new Map();
let resumeMediaItems = [];
let latestAlbumBlobs = [];
let latestAlbumProjectId = null;
let latestAlbumPreviewUrl = null;

function defaultState(){ return {projects:[], activeProjectId:null}; }
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : defaultState();
    if(!s.projects) s.projects=[];
    if(!("activeProjectId" in s)) s.activeProjectId=null;
    s.projects.forEach(p=>{
      if(!Array.isArray(p.sessions)) p.sessions=[];
      if(!p.projectInfo || typeof p.projectInfo!=="object") p.projectInfo={};
      if(!p.sellerPricing || typeof p.sellerPricing!=="object") p.sellerPricing={};
      if(!("valueAdd" in p.sellerPricing)) p.sellerPricing.valueAdd=null;
      if(!Array.isArray(p.laps)) p.laps=[];
      if(!p.resumePrefs || typeof p.resumePrefs!=="object") p.resumePrefs={selectedKeys:[],heroKey:null};
      if(!Array.isArray(p.resumePrefs.selectedKeys)) p.resumePrefs.selectedKeys=[];
      if(!p.lastWorkedAt) p.lastWorkedAt=p.createdAt||Date.now();
      if(!("isCompleted" in p)) p.isCompleted=false;
    });
    return s;
  }catch(e){ return defaultState(); }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function uuid(){
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now()+"_"+Math.random().toString(16).slice(2));
}
function now(){ return Date.now(); }
function getProject(id){ return state.projects.find(p=>p.id===id); }
function elapsedMs(p){
  const running = p.isRunning && p.startedAt ? (now()-p.startedAt) : 0;
  return (p.accumulatedMs||0) + running;
}
function fmt(ms){
  ms=Math.max(0,ms||0);
  const sec=Math.floor(ms/1000), h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  return [h,m,s].map(n=>String(n).padStart(2,"0")).join(":");
}
function fmtHuman(ms){
  const min=Math.floor((ms||0)/60000), h=Math.floor(min/60), m=min%60;
  if(h===0) return `${m} 分`;
  return `${h} 小時 ${m} 分`;
}
function escapeHTML(str=""){
  return str.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}


function currentSessionMs(p){
  return p?.isRunning && p.startedAt ? Math.max(0,now()-p.startedAt) : 0;
}
function ensureSessions(p){
  if(!Array.isArray(p.sessions)) p.sessions=[];
  return p.sessions;
}
function recordSession(p,startedAt,endedAt){
  if(!p || !startedAt || !endedAt || endedAt<=startedAt) return;
  const durationMs=endedAt-startedAt;
  if(durationMs<1000) return;
  ensureSessions(p).push({
    id:uuid(),
    startedAt,
    endedAt,
    durationMs
  });
}
function formatSessionClock(ms){
  return new Intl.DateTimeFormat("zh-TW",{hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(ms));
}
function formatSessionDate(ms){
  const d=new Date(ms);
  const today=new Date();
  const yesterday=new Date(); yesterday.setDate(today.getDate()-1);
  const same=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  if(same(d,today)) return "今天";
  if(same(d,yesterday)) return "昨天";
  return new Intl.DateTimeFormat("zh-TW",{month:"numeric",day:"numeric",weekday:"short"}).format(d);
}
function localDayStart(ms=Date.now()){
  const d=new Date(ms);
  d.setHours(0,0,0,0);
  return d.getTime();
}
function localMonthStart(ms=Date.now()){
  const d=new Date(ms);
  d.setDate(1); d.setHours(0,0,0,0);
  return d.getTime();
}
function nextMonthStart(ms=Date.now()){
  const d=new Date(ms);
  d.setMonth(d.getMonth()+1,1); d.setHours(0,0,0,0);
  return d.getTime();
}
function overlapDuration(start,end,rangeStart,rangeEnd){
  return Math.max(0,Math.min(end,rangeEnd)-Math.max(start,rangeStart));
}
function sessionDurationInRange(session,rangeStart,rangeEnd){
  return overlapDuration(session.startedAt||0,session.endedAt||0,rangeStart,rangeEnd);
}
function allSessions(){
  return state.projects.flatMap(p=>(p.sessions||[]).map(s=>({...s,projectId:p.id,projectName:p.name})));
}
function projectSessionDurationInRange(p,rangeStart,rangeEnd){
  return (p.sessions||[]).reduce((sum,s)=>sum+sessionDurationInRange(s,rangeStart,rangeEnd),0);
}
function fmtCompact(ms){
  const minutes=Math.round((ms||0)/60000);
  if(minutes<60) return `${minutes}m`;
  const h=Math.floor(minutes/60),m=minutes%60;
  return m?`${h}h ${m}m`:`${h}h`;
}
function parseCost(value){
  const n=Number(String(value||"").replace(/,/g,"").trim());
  return Number.isFinite(n) && n>=0 ? n : null;
}

function sessionTotalMs(p){
  return (p.sessions||[]).reduce((sum,s)=>sum+(s.durationMs||0),0);
}
function sessionLegacyBaseMs(p){
  return Math.max(0,(p.accumulatedMs||0)-sessionTotalMs(p));
}
function recalcAccumulatedFromSessions(p,legacyBase=null){
  const base=legacyBase==null?sessionLegacyBaseMs(p):legacyBase;
  p.accumulatedMs=base+sessionTotalMs(p);
}
function localDateInputValue(ms){
  const d=new Date(ms);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function localTimeInputValue(ms){
  const d=new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function combineLocalDateTime(dateStr,timeStr){
  if(!dateStr || !timeStr) return null;
  const [y,m,d]=dateStr.split("-").map(Number);
  const [hh,mm]=timeStr.split(":").map(Number);
  const date=new Date(y,m-1,d,hh,mm,0,0);
  return date.getTime();
}
function money(n){
  if(!Number.isFinite(n)) return "—";
  return `NT$ ${Math.round(n).toLocaleString("zh-TW")}`;
}
function roundPrice(n){
  if(!Number.isFinite(n) || n<=0) return 0;
  return Math.ceil(n/10)*10;
}
function calcSellerPricing(p){
  const info=p.projectInfo||{};
  const s=p.sellerPricing||{};
  const material=Number(info.cost)||0;
  const packaging=Number(s.packaging)||0;
  const hourlyRate=Number(s.hourlyRate)||0;
  const feeRate=Math.min(99,Math.max(0,Number(s.feeRate)||0));
  const valueAdd=Math.max(0,Number(s.valueAdd)||0);
  const actualPrice=Math.max(0,Number(s.actualPrice)||0);

  const hours=elapsedMs(p)/3600000;
  const labor=hours*hourlyRate;
  const cashCost=material+packaging;

  // 只回收現金支出時，仍要考慮平台抽成。
  const cashFloor=feeRate<100 ? cashCost/(1-feeRate/100) : cashCost;

  // 目標售價：現金成本 + 理想人工 + 自訂設計/技術價值，再補足平台抽成。
  const targetNet=cashCost+labor+valueAdd;
  const targetPrice=feeRate<100 ? targetNet/(1-feeRate/100) : targetNet;
  const roundedCashFloor=roundPrice(cashFloor);
  const roundedTarget=roundPrice(targetPrice);
  const targetFeeAmount=roundedTarget*feeRate/100;

  // 使用者自己的市場售價，反推出「扣掉現金成本後，時間實際換到多少錢」。
  let actualHourly=null;
  let goalPercent=null;
  let actualNetForTime=null;
  let actualFeeAmount=null;
  if(actualPrice>0){
    actualFeeAmount=actualPrice*feeRate/100;
    actualNetForTime=actualPrice-actualFeeAmount-cashCost;
    if(hours>0) actualHourly=actualNetForTime/hours;
    if(hourlyRate>0 && actualHourly!=null) goalPercent=(actualHourly/hourlyRate)*100;
  }

  return {
    material,packaging,hourlyRate,feeRate,valueAdd,actualPrice,hours,labor,cashCost,
    cashFloor,roundedCashFloor,targetPrice,roundedTarget,targetFeeAmount,
    actualHourly,goalPercent,actualNetForTime,actualFeeAmount
  };
}

// ---------- 作品與進度照片 ----------
const PHOTO_DB_NAME="yarntime_media_v2";
const PHOTO_STORE_NAME="photos";
const LEGACY_PHOTO_DB_NAME="yarntime_photos_v1";

function openPhotoDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(PHOTO_DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(PHOTO_STORE_NAME)){
        db.createObjectStore(PHOTO_STORE_NAME,{keyPath:"mediaKey"});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function putMedia(mediaKey,blob){
  const db=await openPhotoDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(PHOTO_STORE_NAME,"readwrite");
    tx.objectStore(PHOTO_STORE_NAME).put({mediaKey,blob,updatedAt:Date.now()});
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
  revokeCachedPhoto(mediaKey);
}
async function getMediaBlob(mediaKey){
  const db=await openPhotoDB();
  const row=await new Promise((resolve,reject)=>{
    const tx=db.transaction(PHOTO_STORE_NAME,"readonly");
    const req=tx.objectStore(PHOTO_STORE_NAME).get(mediaKey);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
  db.close();
  return row?.blob||null;
}
async function deleteMedia(mediaKey){
  const db=await openPhotoDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(PHOTO_STORE_NAME,"readwrite");
    tx.objectStore(PHOTO_STORE_NAME).delete(mediaKey);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
  revokeCachedPhoto(mediaKey);
}
function revokeCachedPhoto(mediaKey){
  const old=photoUrlCache.get(mediaKey);
  if(old) URL.revokeObjectURL(old);
  photoUrlCache.delete(mediaKey);
}
async function clearAllProjectPhotos(){
  const db=await openPhotoDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(PHOTO_STORE_NAME,"readwrite");
    tx.objectStore(PHOTO_STORE_NAME).clear();
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
  for(const url of photoUrlCache.values()) URL.revokeObjectURL(url);
  photoUrlCache.clear();
}
async function putProjectPhoto(projectId,blob){ return putMedia(`project:${projectId}`,blob); }
async function deleteProjectPhoto(projectId){ return deleteMedia(`project:${projectId}`); }
async function putLapPhoto(projectId,lapId,blob){ return putMedia(`lap:${projectId}:${lapId}`,blob); }
async function getLapPhotoBlob(projectId,lapId){ return getMediaBlob(`lap:${projectId}:${lapId}`); }
async function deleteLapPhoto(projectId,lapId){ return deleteMedia(`lap:${projectId}:${lapId}`); }

async function getProjectPhotoBlob(projectId){
  const current=await getMediaBlob(`project:${projectId}`);
  if(current) return current;
  // v4 封面照片相容：第一次讀到時自動搬到新版媒體庫。
  try{
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(LEGACY_PHOTO_DB_NAME,1);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    if(!db.objectStoreNames.contains("photos")){ db.close(); return null; }
    const row=await new Promise((resolve,reject)=>{
      const tx=db.transaction("photos","readonly");
      const req=tx.objectStore("photos").get(projectId);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
    db.close();
    if(row?.blob){
      await putProjectPhoto(projectId,row.blob);
      // 搬移完成後移除 v4 舊副本，避免使用者之後刪除照片又被舊資料復原。
      try{
        const legacyDb=await new Promise((resolve,reject)=>{
          const req=indexedDB.open(LEGACY_PHOTO_DB_NAME,1);
          req.onsuccess=()=>resolve(req.result);
          req.onerror=()=>reject(req.error);
        });
        if(legacyDb.objectStoreNames.contains("photos")){
          await new Promise((resolve,reject)=>{
            const tx=legacyDb.transaction("photos","readwrite");
            tx.objectStore("photos").delete(projectId);
            tx.oncomplete=resolve;
            tx.onerror=()=>reject(tx.error);
          });
        }
        legacyDb.close();
      }catch(e){}
      return row.blob;
    }
  }catch(e){}
  return null;
}
async function getProjectPhotoUrl(projectId){
  const key=`project:${projectId}`;
  if(photoUrlCache.has(key)) return photoUrlCache.get(key);
  const blob=await getProjectPhotoBlob(projectId);
  if(!blob) return null;
  const url=URL.createObjectURL(blob);
  photoUrlCache.set(key,url);
  return url;
}
async function getLapPhotoUrl(projectId,lapId){
  const key=`lap:${projectId}:${lapId}`;
  if(photoUrlCache.has(key)) return photoUrlCache.get(key);
  const blob=await getLapPhotoBlob(projectId,lapId);
  if(!blob) return null;
  const url=URL.createObjectURL(blob);
  photoUrlCache.set(key,url);
  return url;
}
function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src=url;
  });
}
async function compressPhoto(file){
  const img=await loadImageFromFile(file);
  const maxSide=1400;
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
  const width=Math.max(1,Math.round(img.naturalWidth*scale));
  const height=Math.max(1,Math.round(img.naturalHeight*scale));
  const canvas=document.createElement("canvas");
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#FFFFFF";
  ctx.fillRect(0,0,width,height);
  ctx.drawImage(img,0,0,width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.82));
  if(!blob) throw new Error("compress");
  return blob;
}
function blobToDataURL(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL){
  const [meta,data]=dataURL.split(",");
  const mime=(meta.match(/data:([^;]+)/)||[])[1]||"image/jpeg";
  const bytes=atob(data);
  const arr=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
async function applyProjectPhotos(){
  const imgs=[...document.querySelectorAll("img[data-photo-project]")];
  await Promise.all(imgs.map(async img=>{
    const id=img.dataset.photoProject;
    const url=await getProjectPhotoUrl(id);
    if(!img.isConnected) return;
    const fallback=img.parentElement?.querySelector(".project-fallback");
    if(url){
      img.src=url;
      img.classList.remove("hidden");
      fallback?.classList.add("hidden");
    }else{
      img.removeAttribute("src");
      img.classList.add("hidden");
      fallback?.classList.remove("hidden");
    }
  }));
}
async function renderDetailPhoto(){
  if(!detailProjectId) return;
  const projectId=detailProjectId;
  const img=document.getElementById("detailPhotoImg");
  const empty=document.getElementById("detailPhotoEmpty");
  const removeBtn=document.getElementById("detailPhotoRemoveBtn");
  const changeBtn=document.getElementById("detailPhotoChangeBtn");
  const url=await getProjectPhotoUrl(projectId);
  if(detailProjectId!==projectId) return;
  if(url){
    img.src=url;
    img.classList.remove("hidden");
    empty.classList.add("hidden");
    removeBtn.classList.remove("hidden");
    changeBtn.textContent="更換照片";
  }else{
    img.removeAttribute("src");
    img.classList.add("hidden");
    empty.classList.remove("hidden");
    removeBtn.classList.add("hidden");
    changeBtn.textContent="新增照片";
  }
}
function setPendingProjectPhoto(file){
  pendingProjectPhotoFile=file||null;
  const preview=document.getElementById("projectPhotoPreview");
  const clearBtn=document.getElementById("clearProjectPhotoBtn");
  if(pendingProjectPhotoPreviewUrl){
    URL.revokeObjectURL(pendingProjectPhotoPreviewUrl);
    pendingProjectPhotoPreviewUrl=null;
  }
  if(file){
    pendingProjectPhotoPreviewUrl=URL.createObjectURL(file);
    preview.innerHTML=`<img src="${pendingProjectPhotoPreviewUrl}" alt="照片預覽">`;
    clearBtn.classList.remove("hidden");
  }else{
    preview.innerHTML=`<span class="photo-plus">＋</span><span>從相簿選擇或拍照</span>`;
    clearBtn.classList.add("hidden");
  }
}

function setPendingLapPhoto(file){
  pendingLapPhotoFile=file||null;
  const preview=document.getElementById("lapPhotoPreview");
  const clearBtn=document.getElementById("clearLapPhotoBtn");
  if(pendingLapPhotoPreviewUrl){
    URL.revokeObjectURL(pendingLapPhotoPreviewUrl);
    pendingLapPhotoPreviewUrl=null;
  }
  if(file){
    pendingLapPhotoPreviewUrl=URL.createObjectURL(file);
    preview.innerHTML=`<img src="${pendingLapPhotoPreviewUrl}" alt="進度照片預覽">`;
    clearBtn.classList.remove("hidden");
  }else{
    preview.innerHTML=`<span class="photo-plus">＋</span><span>加入這次的進度照</span>`;
    clearBtn.classList.add("hidden");
  }
}
function projectDurationText(p){
  const start=p.createdAt||now();
  const end=p.completedAt||now();
  return `${Math.max(1,Math.ceil((end-start)/86400000))} 天`;
}

function formatCardDate(ms){
  if(!ms) return "—";
  return new Intl.DateTimeFormat("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ms));
}
function safeFilename(name){
  return (name||"YarnTime").replace(/[\\/:*?"<>|]/g,"_").trim()||"YarnTime";
}
function canvasRoundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}
function drawCoverImage(ctx,img,x,y,w,h,r=28){
  ctx.save();
  canvasRoundRect(ctx,x,y,w,h,r);
  ctx.clip();
  const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight);
  const dw=img.naturalWidth*scale, dh=img.naturalHeight*scale;
  ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  ctx.restore();
}
function loadImageFromBlob(blob){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src=url;
  });
}
function wrapCanvasText(ctx,text,maxWidth,maxLines=2){
  const chars=[...(text||"")];
  const lines=[];
  let line="";
  for(const ch of chars){
    const test=line+ch;
    if(ctx.measureText(test).width>maxWidth && line){
      lines.push(line);
      line=ch;
      if(lines.length===maxLines-1) break;
    }else line=test;
  }
  if(lines.length<maxLines && line){
    const consumed=lines.join("").length+line.length;
    if(consumed<chars.length){
      while(line && ctx.measureText(line+"…").width>maxWidth) line=line.slice(0,-1);
      line+="…";
    }
    lines.push(line);
  }
  return lines;
}
async function collectProjectMediaItems(p){
  const items=[];
  const cover=await getProjectPhotoBlob(p.id);

  if(cover){
    items.push({
      key:`project:${p.id}`,
      kind:"cover",
      blob:cover,
      title:"作品封面",
      subtitle:formatCardDate(p.createdAt),
      at:p.createdAt||0,
      lap:null,
      index:0
    });
  }

  for(let i=0;i<(p.laps||[]).length;i++){
    const lap=p.laps[i];
    const blob=await getLapPhotoBlob(p.id,lap.id);
    if(blob){
      items.push({
        key:`lap:${p.id}:${lap.id}`,
        kind:"lap",
        blob,
        title:lap.name||`進度 ${i+1}`,
        subtitle:`${formatCardDate(lap.at)} · 累積 ${fmtHuman(lap.totalMs||0)}`,
        at:lap.at||0,
        lap,
        index:i+1
      });
    }
  }

  return items.sort((a,b)=>(a.at||0)-(b.at||0));
}

function ensureResumePrefs(p,items=[]){
  if(!p.resumePrefs || typeof p.resumePrefs!=="object"){
    p.resumePrefs={selectedKeys:[],heroKey:null};
  }
  if(!Array.isArray(p.resumePrefs.selectedKeys)) p.resumePrefs.selectedKeys=[];

  const valid=new Set(items.map(x=>x.key));
  p.resumePrefs.selectedKeys=p.resumePrefs.selectedKeys.filter(k=>valid.has(k));

  // 第一次使用時，預設把全部照片都納入；單張履歷只會取其中精選，
  // 多頁回顧與影片則可以使用完整選取清單。
  if(!p.resumePrefs.selectedKeys.length && items.length){
    p.resumePrefs.selectedKeys=items.map(x=>x.key);
  }

  if(!p.resumePrefs.heroKey || !valid.has(p.resumePrefs.heroKey)){
    const defaultHero=items.find(x=>x.kind==="cover")||items.at(-1)||items[0]||null;
    p.resumePrefs.heroKey=defaultHero?.key||null;
  }

  if(p.resumePrefs.heroKey && !p.resumePrefs.selectedKeys.includes(p.resumePrefs.heroKey)){
    p.resumePrefs.selectedKeys.unshift(p.resumePrefs.heroKey);
  }

  return p.resumePrefs;
}

function selectedResumeMedia(p,items=resumeMediaItems){
  const prefs=ensureResumePrefs(p,items);
  const selectedSet=new Set(prefs.selectedKeys||[]);
  return items.filter(x=>selectedSet.has(x.key));
}

function getResumeHeroAndProgress(p,items=resumeMediaItems){
  const prefs=ensureResumePrefs(p,items);
  const selected=selectedResumeMedia(p,items);
  const hero=selected.find(x=>x.key===prefs.heroKey)||selected[0]||items[0]||null;
  const progress=selected.filter(x=>!hero || x.key!==hero.key).slice(0,3);
  return {hero,progress,selected};
}

async function renderResumePhotoLibrary(p){
  resumeMediaItems=await collectProjectMediaItems(p);
  const prefs=ensureResumePrefs(p,resumeMediaItems);
  saveState();

  const selectedSet=new Set(prefs.selectedKeys||[]);
  const grid=document.getElementById("resumePhotoGrid");
  const noPhotos=document.getElementById("resumeNoPhotos");

  document.getElementById("resumePhotoCount").textContent=
    `${resumeMediaItems.length} 張 · 已選 ${selectedSet.size} 張`;

  noPhotos.classList.toggle("hidden",resumeMediaItems.length>0);

  grid.innerHTML=resumeMediaItems.map(item=>`
    <button type="button"
      class="resume-photo-item ${selectedSet.has(item.key)?"selected":""} ${prefs.heroKey===item.key?"hero":""}"
      data-resume-key="${escapeHTML(item.key)}">
      <img data-resume-thumb="${escapeHTML(item.key)}" alt="${escapeHTML(item.title)}">
      <span class="resume-photo-check">${selectedSet.has(item.key)?"✓":""}</span>
      <span class="resume-photo-caption">${escapeHTML(item.title)}</span>
      <span class="resume-photo-meta">${escapeHTML(item.subtitle||"")}</span>
      <span class="resume-hero-btn" data-set-hero="${escapeHTML(item.key)}">${prefs.heroKey===item.key?"主圖":"設主圖"}</span>
    </button>
  `).join("");

  const thumbImgs=[...grid.querySelectorAll("img[data-resume-thumb]")];
  for(const img of thumbImgs){
    const item=resumeMediaItems.find(x=>x.key===img.dataset.resumeThumb);
    if(!item) continue;
    const url=URL.createObjectURL(item.blob);
    img.onload=()=>URL.revokeObjectURL(url);
    img.src=url;
  }

  const selectedCount=selectedSet.size;
  document.getElementById("resumeSingleUseText").textContent=
    selectedCount?`主圖＋最多 ${Math.min(3,Math.max(0,selectedCount-1))} 張精選`:"尚未選照片";
  document.getElementById("resumeAlbumUseText").textContent=
    selectedCount?`${selectedCount} 張照片，自動分頁`:"尚未選照片";
}

async function collectProgressPhotos(p){
  const items=await collectProjectMediaItems(p);
  const {progress}=getResumeHeroAndProgress(p,items);
  return progress.map(item=>({
    lap:item.lap,
    blob:item.blob,
    key:item.key,
    index:item.index||0
  }));
}
async function buildResumeCard(projectId){
  const p=getProject(projectId);
  if(!p) throw new Error("project");
  const canvas=document.getElementById("resumeCanvas");
  const ctx=canvas.getContext("2d");
  const W=1080,H=1350;
  canvas.width=W; canvas.height=H;

  // Palette
  const bg="#F7F1E8", ink="#3E332B", muted="#8C7B6D", accent="#D8892B", card="#FFFDFC", line="#E9DDCF", soft="#F1E6D9";
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Header
  ctx.fillStyle=accent;
  ctx.font='800 26px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText("YARNTIME · HANDMADE JOURNAL",72,78);

  ctx.fillStyle=ink;
  let titleSize=64;
  ctx.font=`800 ${titleSize}px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif`;
  let titleLines=wrapCanvasText(ctx,p.name,936,2);
  while(titleLines.some(line=>ctx.measureText(line).width>936) && titleSize>48){
    titleSize-=2; ctx.font=`800 ${titleSize}px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif`; titleLines=wrapCanvasText(ctx,p.name,936,2);
  }
  titleLines.forEach((line,i)=>ctx.fillText(line,72,156+i*(titleSize+10)));
  const titleBottom=156+(titleLines.length-1)*(titleSize+10);

  ctx.fillStyle=muted;
  ctx.font='500 27px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText(`${p.type}   ${formatCardDate(p.createdAt)} → ${formatCardDate(p.completedAt||Date.now())}`,72,titleBottom+54);

  // Hero image
  const heroX=72, heroY=titleBottom+88, heroW=936, heroH=470;
  ctx.fillStyle=soft; canvasRoundRect(ctx,heroX,heroY,heroW,heroH,34); ctx.fill();
  const resumeItems=await collectProjectMediaItems(p);
  const resumeChoice=getResumeHeroAndProgress(p,resumeItems);
  let heroBlob=resumeChoice.hero?.blob||await getProjectPhotoBlob(p.id);
  if(!heroBlob){
    for(let i=(p.laps||[]).length-1;i>=0;i--){
      heroBlob=await getLapPhotoBlob(p.id,p.laps[i].id);
      if(heroBlob) break;
    }
  }
  if(heroBlob){
    try{ drawCoverImage(ctx,await loadImageFromBlob(heroBlob),heroX,heroY,heroW,heroH,34); }
    catch(e){}
  }else{
    ctx.fillStyle=accent; ctx.font='700 76px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'; ctx.textAlign="center";
    ctx.fillText("🧶",W/2,heroY+205);
    ctx.fillStyle=muted; ctx.font='600 28px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText("我的手作作品",W/2,heroY+270); ctx.textAlign="left";
  }

  // Metric cards
  const metricsY=heroY+506, gap=18, metricW=(936-gap*2)/3, metricH=142;
  const metrics=[
    ["總工時",fmtHuman(elapsedMs(p))],
    ["製作期間",projectDurationText(p)],
    ["進度紀錄",`${p.laps?.length||0} 次`]
  ];
  metrics.forEach(([label,value],i)=>{
    const x=72+i*(metricW+gap);
    ctx.fillStyle=card; canvasRoundRect(ctx,x,metricsY,metricW,metricH,24); ctx.fill();
    ctx.strokeStyle=line; ctx.lineWidth=2; canvasRoundRect(ctx,x,metricsY,metricW,metricH,24); ctx.stroke();
    ctx.fillStyle=muted; ctx.font='600 23px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'; ctx.fillText(label,x+24,metricsY+40);
    ctx.fillStyle=i===0?accent:ink; ctx.font='800 34px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    const valueText=value.length>12?value.slice(0,12):value;
    ctx.fillText(valueText,x+24,metricsY+94);
  });

  // Progress photo strip
  const stripTitleY=metricsY+194;
  ctx.fillStyle=ink; ctx.font='800 31px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'; ctx.fillText("從一針一線到完成",72,stripTitleY);
  ctx.fillStyle=muted; ctx.font='500 22px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'; ctx.fillText("每一次紀錄，都是作品長大的一點點。",72,stripTitleY+38);

  const progress=await collectProgressPhotos(p);
  const tileY=stripTitleY+68, tileGap=16, tileW=(936-tileGap*2)/3, tileH=174;
  for(let i=0;i<3;i++){
    const x=72+i*(tileW+tileGap);
    ctx.fillStyle=soft; canvasRoundRect(ctx,x,tileY,tileW,tileH,20); ctx.fill();
    const item=progress[i];
    if(item){
      try{ drawCoverImage(ctx,await loadImageFromBlob(item.blob),x,tileY,tileW,tileH,20); }catch(e){}
      ctx.fillStyle="rgba(62,51,43,.72)"; canvasRoundRect(ctx,x+12,tileY+12,48,34,17); ctx.fill();
      ctx.fillStyle="#FFFFFF"; ctx.font='800 18px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'; ctx.textAlign="center";
      const progressNo=item.lap ? ((p.laps||[]).findIndex(l=>l.id===item.lap.id)+1) : (i+1);
      ctx.fillText(String(Math.max(1,progressNo)).padStart(2,"0"),x+36,tileY+35); ctx.textAlign="left";
    }else{
      ctx.fillStyle="#D7C7B8"; ctx.font='700 28px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif'; ctx.textAlign="center";
      ctx.fillText("·",x+tileW/2,tileY+96); ctx.textAlign="left";
    }
  }

  // Footer
  ctx.fillStyle=muted; ctx.font='600 21px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText("Made slowly, stitch by stitch.",72,1310);
  ctx.textAlign="right"; ctx.fillStyle=accent; ctx.font='800 22px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText("YarnTime",1008,1310); ctx.textAlign="left";

  latestResumeBlob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png",1));
  latestResumeProjectId=projectId;
  if(!latestResumeBlob) throw new Error("canvas");
  return latestResumeBlob;
}
function downloadResumeBlob(blob,p){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`${safeFilename(p.name)}_YarnTime.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}



// ---------- 多頁作品回顧 ----------
function drawPhotoAlbumHeader(ctx,p,pageNo,totalPages){
  ctx.fillStyle="#F7F1E8";
  ctx.fillRect(0,0,1080,1350);

  ctx.fillStyle="#D8892B";
  ctx.font='800 24px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText("YARNTIME · PHOTO JOURNAL",64,66);

  ctx.textAlign="right";
  ctx.fillStyle="#8C7B6D";
  ctx.font='650 18px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText(`${String(pageNo).padStart(2,"0")} / ${String(totalPages).padStart(2,"0")}`,1016,66);
  ctx.textAlign="left";

  ctx.fillStyle="#3E332B";
  ctx.font='800 38px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  const titleLine=wrapCanvasText(ctx,p.name,760,1)[0]||p.name;
  ctx.fillText(titleLine,64,116);

  ctx.fillStyle="#8C7B6D";
  ctx.font='550 18px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText(`${formatCardDate(p.createdAt)} → ${formatCardDate(p.completedAt||Date.now())} · ${fmtHuman(elapsedMs(p))}`,64,150);
}

async function drawPhotoAlbumTile(ctx,item,x,y,w,h){
  ctx.fillStyle="#EEE3D7";
  canvasRoundRect(ctx,x,y,w,h,22);
  ctx.fill();

  try{
    const img=await loadImageFromBlob(item.blob);
    drawCoverImage(ctx,img,x,y,w,h,22);
  }catch(e){}

  const overlayH=82;
  ctx.fillStyle="rgba(48,39,33,.78)";
  ctx.fillRect(x,y+h-overlayH,w,overlayH);

  ctx.fillStyle="#FFFDFC";
  ctx.font='750 21px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  const title=wrapCanvasText(ctx,item.title||"作品進度",w-32,1)[0]||"作品進度";
  ctx.fillText(title,x+16,y+h-46);

  ctx.fillStyle="#DED1C6";
  ctx.font='550 14px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  const subtitle=wrapCanvasText(ctx,item.subtitle||"",w-32,1)[0]||"";
  ctx.fillText(subtitle,x+16,y+h-20);
}

async function buildPhotoAlbum(projectId,onProgress=()=>{}){
  const p=getProject(projectId);
  if(!p || !p.isCompleted) throw new Error("project");

  const items=await collectProjectMediaItems(p);
  const prefs=ensureResumePrefs(p,items);
  const selected=selectedResumeMedia(p,items);

  if(!selected.length) throw new Error("no_photos");

  const hero=selected.find(x=>x.key===prefs.heroKey)||selected[0];
  const continuation=selected.filter(x=>x.key!==hero?.key);

  const chunks=[];
  for(let i=0;i<continuation.length;i+=4){
    chunks.push(continuation.slice(i,i+4));
  }

  const totalPages=1+chunks.length;
  const result=[];

  // 第一頁沿用單張履歷卡
  const first=await buildResumeCard(projectId);
  result.push(first);
  onProgress(1,totalPages);

  for(let pageIndex=0; pageIndex<chunks.length; pageIndex++){
    const canvas=document.createElement("canvas");
    canvas.width=1080;
    canvas.height=1350;
    const ctx=canvas.getContext("2d");

    drawPhotoAlbumHeader(ctx,p,pageIndex+2,totalPages);

    const gap=18;
    const tileW=(952-gap)/2;
    const tileH=510;
    const x0=64;
    const y0=190;
    const positions=[
      [x0,y0],
      [x0+tileW+gap,y0],
      [x0,y0+tileH+gap],
      [x0+tileW+gap,y0+tileH+gap]
    ];

    const pageItems=chunks[pageIndex];
    for(let i=0;i<pageItems.length;i++){
      const [x,y]=positions[i];
      await drawPhotoAlbumTile(ctx,pageItems[i],x,y,tileW,tileH);
    }

    ctx.fillStyle="#8C7B6D";
    ctx.font='550 16px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText("Made slowly, stitch by stitch.",64,1318);

    ctx.textAlign="right";
    ctx.fillStyle="#D8892B";
    ctx.font='800 18px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText("YarnTime",1016,1318);
    ctx.textAlign="left";

    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.90));
    if(!blob) throw new Error("canvas");

    result.push(blob);
    onProgress(pageIndex+2,totalPages);
  }

  latestAlbumBlobs=result;
  latestAlbumProjectId=projectId;
  return result;
}

function albumFilesForProject(p){
  return latestAlbumBlobs.map((blob,i)=>{
    const ext=blob.type==="image/jpeg"?"jpg":"png";
    return new File(
      [blob],
      `${safeFilename(p.name)}_YarnTime_${String(i+1).padStart(2,"0")}.${ext}`,
      {type:blob.type||"image/png"}
    );
  });
}

function downloadAlbumPages(p){
  latestAlbumBlobs.forEach((blob,i)=>{
    setTimeout(()=>{
      const ext=blob.type==="image/jpeg"?"jpg":"png";
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      a.download=`${safeFilename(p.name)}_YarnTime_${String(i+1).padStart(2,"0")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1800);
    },i*260);
  });
}

// ---------- 完成回顧影片 ----------
function chooseRecapMimeType(){
  if(typeof MediaRecorder==="undefined") return "";
  const candidates=[
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return candidates.find(t=>MediaRecorder.isTypeSupported?.(t))||"";
}
function recapExtension(type){
  return (type||"").includes("mp4")?"mp4":"webm";
}
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function easeInOut(t){ return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2; }

function drawRecapBackground(ctx,W,H){
  ctx.fillStyle="#F7F1E8";
  ctx.fillRect(0,0,W,H);
}
function drawRecapText(ctx,text,x,y,maxWidth,font,fill="#3E332B",align="left"){
  ctx.font=font;
  ctx.fillStyle=fill;
  ctx.textAlign=align;
  const lines=wrapCanvasText(ctx,text,maxWidth,2);
  lines.forEach((line,i)=>ctx.fillText(line,x,y+i*56));
  ctx.textAlign="left";
}
function drawRecapPhoto(ctx,img,x,y,w,h,r=34,zoom=1){
  ctx.save();
  canvasRoundRect(ctx,x,y,w,h,r);
  ctx.clip();
  const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight)*zoom;
  const dw=img.naturalWidth*scale,dh=img.naturalHeight*scale;
  ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  ctx.restore();
}
async function collectRecapSlides(p){
  const slides=[];
  const mediaItems=await collectProjectMediaItems(p);
  const prefs=ensureResumePrefs(p,mediaItems);
  let selected=selectedResumeMedia(p,mediaItems);

  if(!selected.length) selected=mediaItems;

  for(const item of selected){
    if(item.kind==="cover"){
      slides.push({
        kind:"photo",
        blob:item.blob,
        title:p.name,
        subtitle:`開始 · ${formatCardDate(p.createdAt)}`,
        time:"從第一針開始"
      });
    }else{
      slides.push({
        kind:"photo",
        blob:item.blob,
        title:item.title,
        subtitle:item.index?`第 ${item.index} 個里程碑`:"作品進度",
        time:item.lap?`累積 ${fmt(item.lap.totalMs||0)}`:""
      });
    }
  }

  if(!slides.length){
    for(let i=0;i<(p.laps||[]).length;i++){
      const lap=p.laps[i];
      slides.push({
        kind:"text",
        title:lap.name||`進度 ${i+1}`,
        subtitle:`第 ${i+1} 個里程碑`,
        time:`累積 ${fmt(lap.totalMs||0)}`
      });
    }
  }

  const hero=(selected.find(x=>x.key===prefs.heroKey)||selected.at(-1)||mediaItems.at(-1))?.blob||null;

  slides.push({
    kind:"summary",
    title:p.name,
    subtitle:"完成",
    time:`總工時 ${fmtHuman(elapsedMs(p))}`,
    duration:projectDurationText(p),
    count:p.laps?.length||0,
    blob:hero
  });

  return slides;
}
async function loadRecapSlideImages(slides){
  const result=[];
  for(const slide of slides){
    let image=null;
    if(slide.blob){
      try{ image=await loadImageFromBlob(slide.blob); }catch(e){}
    }
    result.push({...slide,image});
  }
  return result;
}
function drawRecapFrame(ctx,W,H,slide,progress){
  drawRecapBackground(ctx,W,H);
  const ink="#3E332B",muted="#8C7B6D",accent="#D8892B",soft="#F1E6D9",card="#FFFDFC";

  ctx.fillStyle=accent;
  ctx.font='800 20px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText("YARNTIME · HANDMADE JOURNAL",44,62);

  if(slide.kind==="summary"){
    if(slide.image){
      const zoom=1+progress*.025;
      drawRecapPhoto(ctx,slide.image,44,108,632,660,34,zoom);
      const grd=ctx.createLinearGradient(0,560,0,800);
      grd.addColorStop(0,"rgba(62,51,43,0)");
      grd.addColorStop(1,"rgba(62,51,43,.52)");
      ctx.fillStyle=grd;
      canvasRoundRect(ctx,44,108,632,660,34);
      ctx.fill();
    }else{
      ctx.fillStyle=soft; canvasRoundRect(ctx,44,108,632,660,34); ctx.fill();
      ctx.font='700 84px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
      ctx.textAlign="center"; ctx.fillStyle=accent; ctx.fillText("🧶",360,420); ctx.textAlign="left";
    }

    ctx.fillStyle=card; canvasRoundRect(ctx,44,804,632,370,30); ctx.fill();
    drawRecapText(ctx,slide.title,76,880,568,'800 48px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif',ink);
    ctx.fillStyle=accent; ctx.font='800 26px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText("完成 ✨",76,980);
    ctx.fillStyle=ink; ctx.font='800 34px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText(slide.time,76,1032);
    ctx.fillStyle=muted; ctx.font='600 23px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText(`${slide.duration} · ${slide.count} 次製作紀錄`,76,1082);
    ctx.fillStyle=muted; ctx.font='600 18px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.fillText("Made slowly, stitch by stitch.",76,1138);
    return;
  }

  const photoY=116,photoH=770;
  if(slide.image){
    const zoom=1+easeInOut(progress)*.035;
    drawRecapPhoto(ctx,slide.image,44,photoY,632,photoH,34,zoom);
  }else{
    ctx.fillStyle=soft; canvasRoundRect(ctx,44,photoY,632,photoH,34); ctx.fill();
    ctx.font='700 78px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
    ctx.textAlign="center"; ctx.fillStyle=accent; ctx.fillText("🧶",360,480); ctx.textAlign="left";
  }

  ctx.fillStyle="rgba(255,253,252,.96)";
  canvasRoundRect(ctx,44,924,632,268,30); ctx.fill();
  drawRecapText(ctx,slide.title,76,998,568,'800 42px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif',ink);
  ctx.fillStyle=muted;
  ctx.font='600 22px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText(slide.subtitle||"",76,1090);
  ctx.fillStyle=accent;
  ctx.font='800 28px -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif';
  ctx.fillText(slide.time||"",76,1142);
}
async function buildRecapVideo(projectId,onProgress=()=>{}){
  const p=getProject(projectId);
  if(!p || !p.isCompleted) throw new Error("project");
  const canvas=document.getElementById("recapCanvas");
  if(!canvas.captureStream || typeof MediaRecorder==="undefined"){
    throw new Error("unsupported");
  }
  const mimeType=chooseRecapMimeType();
  if(!mimeType) throw new Error("unsupported");

  const rawSlides=await collectRecapSlides(p);
  const slides=await loadRecapSlideImages(rawSlides);
  const W=720,H=1280;
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");

  const stream=canvas.captureStream(30);
  const options={mimeType,videoBitsPerSecond:4_500_000};
  const recorder=new MediaRecorder(stream,options);
  const chunks=[];
  recorder.ondataavailable=e=>{ if(e.data?.size) chunks.push(e.data); };

  const stopped=new Promise((resolve,reject)=>{
    recorder.onstop=()=>resolve();
    recorder.onerror=e=>reject(e.error||new Error("record"));
  });

  recorder.start(250);

  const durations=slides.map((s,i)=>s.kind==="summary"?2400:1500);
  const totalDuration=durations.reduce((a,b)=>a+b,0);
  const started=performance.now();

  for(let i=0;i<slides.length;i++){
    const duration=durations[i];
    const slideStart=performance.now();
    while(true){
      const t=Math.min(1,(performance.now()-slideStart)/duration);
      drawRecapFrame(ctx,W,H,slides[i],t);
      const elapsed=performance.now()-started;
      onProgress(Math.min(0.98,elapsed/totalDuration));
      if(t>=1) break;
      await new Promise(requestAnimationFrame);
    }
  }

  // 多畫幾幀，避免最後一格被截斷。
  drawRecapFrame(ctx,W,H,slides[slides.length-1],1);
  await sleep(160);
  recorder.stop();
  await stopped;
  stream.getTracks().forEach(t=>t.stop());

  const actualType=recorder.mimeType||mimeType;
  const blob=new Blob(chunks,{type:actualType});
  if(!blob.size) throw new Error("empty");

  latestRecapBlob=blob;
  latestRecapProjectId=projectId;
  if(latestRecapUrl) URL.revokeObjectURL(latestRecapUrl);
  latestRecapUrl=URL.createObjectURL(blob);
  return {blob,url:latestRecapUrl,type:actualType};
}
function downloadRecapBlob(blob,p){
  const ext=recapExtension(blob.type);
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`${safeFilename(p.name)}_YarnTime_Recap.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1800);
}

// 目前這一段 = 現在總工時 - 上一次分段的累積工時
function currentSegmentMs(p){
  const boundary=p.laps?.length
    ? (p.laps[p.laps.length-1].totalMs||0)
    : (p.lapBaselineMs||0);
  return Math.max(0,elapsedMs(p)-boundary);
}

function pauseProject(p){
  if(!p || !p.isRunning) return;
  const endedAt=now();
  const startedAt=p.startedAt;
  const duration=Math.max(0,endedAt-startedAt);
  p.accumulatedMs=(p.accumulatedMs||0)+duration;
  recordSession(p,startedAt,endedAt);
  p.startedAt=null;
  p.isRunning=false;
  p.lastWorkedAt=endedAt;
  if(state.activeProjectId===p.id) state.activeProjectId=null;
}
function startProject(id){
  const target=getProject(id);
  if(target?.isCompleted){
    alert("這個作品已標記完成。若要繼續製作，請先在作品頁改回「製作中」。");
    return;
  }
  if(state.activeProjectId && state.activeProjectId!==id){
    pauseProject(getProject(state.activeProjectId));
  }
  const p=getProject(id); if(!p) return;
  if(!p.isRunning){
    p.isRunning=true;
    p.startedAt=now();
    p.lastWorkedAt=now();
    state.activeProjectId=id;
  }
  saveState(); renderAll();
}
function toggleProject(id){
  const p=getProject(id); if(!p) return;
  if(p.isRunning) pauseProject(p); else startProject(id);
  saveState(); renderAll();
}
function createProject(name,type,note,projectInfo={}){
  const p={
    id:uuid(),name,type,note,
    projectInfo,
    sellerPricing:{hourlyRate:null,packaging:null,feeRate:null,valueAdd:null,actualPrice:null},
    createdAt:now(),lastWorkedAt:now(),completedAt:null,isCompleted:false,
    accumulatedMs:0,isRunning:false,startedAt:null,
    sessions:[],
    laps:[],lapBaselineMs:0
  };
  state.projects.unshift(p); saveState(); return p;
}

function craftMarkSVG(type){
  if(type==="棒針"){
    return `<svg class="craft-mark-svg" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M13 39 34 9M20 41 39 14"/>
      <path d="m32 8 4-2-1 5M37 13l4-1-2 4"/>
      <path d="M13 33c7 3 14 4 22 3"/>
    </svg>`;
  }
  if(type==="鉤針"){
    return `<svg class="craft-mark-svg" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M14 38 32 11c2-3 6-2 6 1 0 3-3 5-6 4"/>
      <path d="M12 35c7 3 14 3 21 1M18 29c6 2 12 2 18 0"/>
    </svg>`;
  }
  return `<svg class="craft-mark-svg" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M11 25c0-8 5-14 13-14 8 0 14 6 14 15 0 9-6 15-15 15-9 0-16-6-16-14 0-6 4-11 10-11 5 0 9 4 9 9 0 4-3 7-7 7-3 0-6-2-6-5 0-3 2-5 5-5"/>
    <path d="M23 41c7 0 12 2 17 5"/>
  </svg>`;
}

function renderProjects(){
  const list=document.getElementById("projectList");
  const empty=document.getElementById("emptyState");
  const activeProjects=state.projects
    .filter(p=>!p.isCompleted)
    .sort((a,b)=>{
      if(!!a.isRunning!==!!b.isRunning) return b.isRunning-a.isRunning;
      return (b.lastWorkedAt||b.createdAt||0)-(a.lastWorkedAt||a.createdAt||0);
    });
  const completedProjects=state.projects
    .filter(p=>p.isCompleted)
    .sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));

  document.getElementById("activeProjectCount").textContent=activeProjects.length;
  document.getElementById("completedProjectCount").textContent=completedProjects.length;

  const projects=currentProjectFilter==="completed"?completedProjects:activeProjects;
  empty.classList.toggle("hidden",projects.length>0);

  const emptyTitle=document.getElementById("emptyStateTitle");
  const emptyText=document.getElementById("emptyStateText");
  const emptyAdd=document.getElementById("emptyAddBtn");
  if(currentProjectFilter==="completed"){
    emptyTitle.textContent="還沒有完成作品";
    emptyText.textContent="完成的作品會安靜地收在這裡。";
    emptyAdd.classList.add("hidden");
  }else{
    emptyTitle.textContent="現在沒有正在做的作品";
    emptyText.textContent="新增一件作品，讓它從第一分鐘開始長大。";
    emptyAdd.classList.remove("hidden");
  }

  list.innerHTML=projects.map((p,index)=>{
    const photoBlock=`
      <div class="project-visual">
        <img class="project-thumb hidden" data-photo-project="${p.id}" alt="${escapeHTML(p.name)}">
        <span class="project-fallback">${craftMarkSVG(p.type)}</span>
        ${p.isRunning?`<span class="project-live-dot" aria-label="正在計時"></span>`:""}
      </div>`;

    if(p.isCompleted){
      return `
        <article class="project-card identity-project-card completed-project-card" data-id="${p.id}">
          <div class="project-card-thread" aria-hidden="true"><i></i><span></span></div>
          <div class="project-row">
            ${photoBlock}
            <div class="project-main">
              <div class="project-overline">FINISHED · ${escapeHTML(p.type)}</div>
              <div class="project-title-row">
                <div class="project-title">${escapeHTML(p.name)}</div>
              </div>
              <div class="project-journal-meta">${p.sessions?.length||0} 次製作 · ${projectDurationText(p)}</div>
              <div class="project-finished-date">${formatCardDate(p.completedAt)}</div>
            </div>
            <div class="project-time-wrap">
              <span>總工時</span>
              <div class="project-time">${fmt(elapsedMs(p))}</div>
            </div>
          </div>
          <div class="project-actions completed-actions">
            <button class="detail-mini completed-detail-btn" data-action="detail" data-id="${p.id}">查看作品結論 <span>→</span></button>
          </div>
        </article>`;
    }

    return `
      <article class="project-card identity-project-card ${p.isRunning?"running":""}" data-id="${p.id}">
        <div class="project-card-thread" aria-hidden="true"><i></i><span></span></div>
        <div class="project-row">
          ${photoBlock}
          <div class="project-main">
            <div class="project-overline">${p.isRunning?"NOW MAKING":escapeHTML(p.type)}</div>
            <div class="project-title">${escapeHTML(p.name)}</div>
            <div class="project-journal-meta">${p.sessions?.length||0} 次製作${p.lastWorkedAt?` · 最近 ${formatCardDate(p.lastWorkedAt)}`:""}</div>
          </div>
          <div class="project-time-wrap">
            <span>${p.isRunning?"正在累積":"目前工時"}</span>
            <div class="project-time" data-time-id="${p.id}">${fmt(elapsedMs(p))}</div>
          </div>
        </div>
        <div class="project-actions">
          <button class="start-mini" data-action="toggle" data-id="${p.id}">${p.isRunning?"暫停":"開始製作"}</button>
          <button class="detail-mini" data-action="detail" data-id="${p.id}">作品日誌 <span>→</span></button>
        </div>
      </article>`;
  }).join("");
  applyProjectPhotos();
}
function renderActive(){
  const card=document.getElementById("activeCard");
  const p=state.activeProjectId?getProject(state.activeProjectId):null;
  if(!p || !p.isRunning){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  document.getElementById("activeName").textContent=p.name;
  document.getElementById("activeTimer").textContent=fmt(elapsedMs(p));
}

async function applyLapPhotos(projectId){
  const imgs=[...document.querySelectorAll(`img[data-lap-photo-project="${projectId}"]`)];
  await Promise.all(imgs.map(async img=>{
    const lapId=img.dataset.lapPhotoId;
    const url=await getLapPhotoUrl(projectId,lapId);
    if(!img.isConnected) return;
    const wrap=img.closest(".timeline-photo-wrap");
    if(url){
      img.src=url;
      img.classList.remove("hidden");
      wrap?.classList.add("has-photo");
    }else{
      img.removeAttribute("src");
      img.classList.add("hidden");
      wrap?.classList.remove("has-photo");
    }
  }));
}

function renderSellerPricingResult(p){
  if(!p) return;
  const r=calcSellerPricing(p);

  document.getElementById("sellerWorkHours").textContent=fmtHuman(elapsedMs(p));
  document.getElementById("sellerMaterialSummary").textContent=money(r.material);

  document.getElementById("sellerCashFloor").textContent=money(r.roundedCashFloor);
  document.getElementById("sellerTargetPrice").textContent=r.hourlyRate>0?money(r.roundedTarget):"—";
  document.getElementById("sellerActualPriceView").textContent=r.actualPrice>0?money(r.actualPrice):"尚未輸入";

  document.getElementById("sellerTargetExplanation").textContent=r.hourlyRate>0
    ? `以理想時薪 ${money(r.hourlyRate)} / 小時${r.valueAdd>0?`，另含 ${money(r.valueAdd)} 價值加成`:""}`
    : "填入理想時薪後顯示";

  document.getElementById("sellerMaterialCost").textContent=money(r.material);
  document.getElementById("sellerLaborCost").textContent=r.hourlyRate>0?money(r.labor):"—";
  document.getElementById("sellerPackagingCost").textContent=money(r.packaging);
  document.getElementById("sellerValueAddCost").textContent=money(r.valueAdd);
  document.getElementById("sellerFeeAmount").textContent=r.hourlyRate>0?money(r.targetFeeAmount):"—";

  const reality=document.getElementById("sellerRealityCard");
  if(r.actualPrice>0){
    reality.classList.remove("hidden");
    document.getElementById("sellerActualHourly").textContent=r.actualHourly!=null
      ? `${money(r.actualHourly)} / hr`
      : "工時不足";

    const percentEl=document.getElementById("sellerGoalPercent");
    const fill=document.getElementById("sellerGoalFill");
    if(r.goalPercent!=null){
      const shown=Math.max(0,Math.round(r.goalPercent));
      percentEl.textContent=`${shown}%`;
      fill.style.width=`${Math.min(100,shown)}%`;
    }else{
      percentEl.textContent="—";
      fill.style.width="0%";
    }

    const gap=document.getElementById("sellerPriceGap");
    if(r.hourlyRate>0 && r.roundedTarget>0){
      const difference=r.actualPrice-r.roundedTarget;
      if(Math.abs(difference)<10){
        gap.textContent="你的售價大致等於這次設定下的目標售價。";
      }else if(difference<0){
        gap.textContent=`你的售價比「目標售價」低約 ${money(Math.abs(difference))}。這不代表價格錯，只表示市場售價沒有完全涵蓋你設定的理想時薪／價值加成。`;
      }else{
        gap.textContent=`你的售價比「目標售價」高約 ${money(difference)}。可能反映設計、品牌、稀有度或其他市場價值。`;
      }
    }else{
      gap.textContent="填入理想時薪後，YarnTime 可以幫你比較「市場售價」與「目標售價」。";
    }
  }else{
    reality.classList.add("hidden");
  }
}

function renderDetail(){
  if(!detailProjectId) return;
  const p=getProject(detailProjectId); if(!p){ closeModal("detailModal"); return; }
  document.getElementById("detailType").textContent=p.type;
  document.getElementById("detailName").textContent=p.name;
  document.getElementById("detailTimer").textContent=fmt(elapsedMs(p));
  document.getElementById("detailStartPauseBtn").textContent=p.isRunning?"暫停":"開始";
  document.getElementById("detailTotal").textContent=fmtHuman(elapsedMs(p));
  document.getElementById("detailSessionCount").textContent=p.sessions?.length||0;
  document.getElementById("detailCurrentSegment").textContent=fmt(currentSessionMs(p));
  document.getElementById("detailNote").textContent=p.note?.trim()||"—";
  renderDetailPhoto();

  document.getElementById("completionTitle").textContent=p.isCompleted?"已完成":"製作中";
  document.getElementById("completionText").textContent=p.isCompleted
    ? `總工時 ${fmtHuman(elapsedMs(p))} · 製作期間 ${projectDurationText(p)}`
    : "完成後會留下總工時與製作期間。";
  document.getElementById("toggleCompleteBtn").textContent=p.isCompleted?"改回製作中":"標記完成";
  document.getElementById("resumeCardBtn").classList.toggle("hidden",!p.isCompleted);
  document.getElementById("recapVideoBtn").classList.toggle("hidden",!p.isCompleted);

  const detailActions=document.querySelector("#detailModal .detail-actions");
  const liveStats=document.getElementById("detailLiveStats");
  const conclusion=document.getElementById("completedConclusion");
  document.getElementById("detailTimerLabel").textContent=p.isCompleted?"完成總工時":"總工時";
  detailActions.classList.toggle("hidden",!!p.isCompleted);
  liveStats.classList.toggle("hidden",!!p.isCompleted);
  conclusion.classList.toggle("hidden",!p.isCompleted);

  if(p.isCompleted){
    const sessionCount=p.sessions?.length||0;
    const sessionTotal=(p.sessions||[]).reduce((sum,s)=>sum+(s.durationMs||0),0);
    document.getElementById("conclusionTotal").textContent=fmtHuman(elapsedMs(p));
    document.getElementById("conclusionDuration").textContent=projectDurationText(p);
    document.getElementById("conclusionSessions").textContent=`${sessionCount} 次`;
    document.getElementById("conclusionAverage").textContent=sessionCount?fmtHuman(sessionTotal/sessionCount):"—";
    document.getElementById("conclusionStartDate").textContent=formatCardDate(p.createdAt);
    document.getElementById("conclusionEndDate").textContent=formatCardDate(p.completedAt);
  }

  const sessions=(p.sessions||[]).slice().reverse();
  document.getElementById("sessionCountLabel").textContent=`${sessions.length} 次`;
  const sessionList=document.getElementById("sessionList");
  const legacyNote=document.getElementById("sessionLegacyNote");
  const sessionRecordedMs=(p.sessions||[]).reduce((sum,s)=>sum+(s.durationMs||0),0);
  const legacyMs=Math.max(0,(p.accumulatedMs||0)-sessionRecordedMs);
  if(legacyMs>=60000){
    legacyNote.textContent=`先前版本已有 ${fmtHuman(legacyMs)} 工時；v8 起才開始逐次記錄製作時間。`;
    legacyNote.classList.remove("hidden");
  }else{
    legacyNote.classList.add("hidden");
  }
  const sessionVisible=sessionVisibleByProject.get(p.id)||40;
  const visibleSessions=sessions.slice(0,sessionVisible);
  sessionList.innerHTML=visibleSessions.length?visibleSessions.map((s,index)=>`
    <button class="session-row session-row-button" data-session-id="${s.id}">
      <div class="session-date">
        <strong>${formatSessionDate(s.startedAt)}</strong>
        <small>${formatSessionClock(s.startedAt)} – ${formatSessionClock(s.endedAt)}</small>
      </div>
      <div class="session-row-right">
        <div class="session-duration">${fmtHuman(s.durationMs)}</div>
        <span class="session-edit-chevron">›</span>
      </div>
    </button>
  `).join(""):`<div class="session-empty">第一次按「開始 → 暫停」後，這裡就會自動出現紀錄。</div>`;

  const moreSessionsBtn=document.getElementById("loadMoreSessionsBtn");
  moreSessionsBtn.classList.toggle("hidden",sessions.length<=sessionVisible);
  if(sessions.length>sessionVisible){
    moreSessionsBtn.textContent=`再顯示 ${Math.min(40,sessions.length-sessionVisible)} 筆（還有 ${sessions.length-sessionVisible} 筆）`;
  }

  const info=p.projectInfo||{};
  const infoItems=[
    ["開始日期",formatCardDate(p.createdAt)],
    ["針號",info.needle],
    ["毛線",info.yarn],
    ["使用線量",info.amount],
    ["材料成本",info.cost!==""&&info.cost!=null?`NT$ ${Number(info.cost).toLocaleString("zh-TW")}`:""],
    ["用途",info.purpose],
    ["來源",info.source]
  ].filter(([,v])=>String(v||"").trim());
  document.getElementById("projectInfoGrid").innerHTML=infoItems.length
    ? infoItems.map(([label,value])=>`<div class="project-info-item"><span>${escapeHTML(label)}</span><strong>${escapeHTML(String(value))}</strong></div>`).join("")
    : `<div class="project-info-empty">還沒有填作品資料。可以補上針號、毛線、用量或材料成本。</div>`;

  const currentMs=currentSessionMs(p);
  const longWarning=document.getElementById("longTimerWarning");
  const showLong=p.isRunning && currentMs>=4*3600000;
  longWarning.classList.toggle("hidden",!showLong);
  if(showLong){
    document.getElementById("longTimerWarningText").textContent=`本次已計時 ${fmtHuman(currentMs)}。如果其實早就停工，可以先暫停，再點製作紀錄修正。`;
  }

  const sellerSection=document.getElementById("sellerPricingSection");
  const isSeller=(p.projectInfo?.purpose==="販售");
  sellerSection.classList.toggle("hidden",!isSeller);
  if(isSeller){
    const seller=p.sellerPricing||{};
    const sellerSectionFocused=sellerSection.contains(document.activeElement);
    if(!sellerSectionFocused){
      document.getElementById("sellerHourlyRateInput").value=seller.hourlyRate??"";
      document.getElementById("sellerPackagingInput").value=seller.packaging??"";
      document.getElementById("sellerFeeRateInput").value=seller.feeRate??"";
      document.getElementById("sellerValueAddInput").value=seller.valueAdd??"";
      document.getElementById("sellerActualPriceInput").value=seller.actualPrice??"";
    }
    renderSellerPricingResult(p);
  }

  const lapList=document.getElementById("lapList");
  let previousTotal=p.lapBaselineMs||0;
  const chronological=(p.laps||[]).map((l,index)=>{
    const segmentMs=Number.isFinite(l.segmentMs)
      ? l.segmentMs
      : Math.max(0,(l.totalMs||0)-previousTotal);
    previousTotal=l.totalMs||previousTotal;
    return {...l,segmentMs,index:index+1};
  });
  const laps=chronological.slice().reverse();
  document.getElementById("lapCountLabel").textContent=`${laps.length} 個`;
  const lapVisible=lapVisibleByProject.get(p.id)||40;
  const visibleLaps=laps.slice(0,lapVisible);

  lapList.innerHTML=visibleLaps.length?visibleLaps.map(l=>`
    <article class="timeline-item">
      <div class="timeline-marker">
        <span class="yarn-knot"><b>${l.index}</b></span>
        <i></i>
      </div>
      <div class="timeline-card">
        <div class="timeline-card-head">
          <div>
            <strong>${escapeHTML(l.name||`進度 ${l.index}`)}</strong>
            <small>${new Date(l.at).toLocaleString("zh-TW")}</small>
          </div>
          <div class="timeline-time milestone-time">
            <b>累積 ${fmt(l.totalMs)}</b>
          </div>
        </div>
        ${l.note?`<p class="timeline-note">${escapeHTML(l.note)}</p>`:""}
        <div class="timeline-photo-wrap">
          <img class="timeline-photo hidden" data-lap-photo-project="${p.id}" data-lap-photo-id="${l.id}" alt="進度照片">
        </div>
      </div>
    </article>
  `).join(""):`<div class="timeline-empty"><span class="timeline-empty-knot" aria-hidden="true"></span><p>還沒有里程碑。<br>做到值得紀念的地方再記就好。</p></div>`;

  const moreLapsBtn=document.getElementById("loadMoreLapsBtn");
  moreLapsBtn.classList.toggle("hidden",laps.length<=lapVisible);
  if(laps.length>lapVisible){
    moreLapsBtn.textContent=`再顯示 ${Math.min(40,laps.length-lapVisible)} 個（還有 ${laps.length-lapVisible} 個）`;
  }

  applyLapPhotos(p.id);
}

function renderStats(){
  const total=state.projects.reduce((a,p)=>a+elapsedMs(p),0);
  const active=state.projects.filter(p=>!p.isCompleted);
  const nowMs=now();
  const monthStart=localMonthStart(nowMs);
  const monthEnd=nextMonthStart(nowMs);
  const sessions=allSessions();

  const monthMs=sessions.reduce((sum,s)=>sum+sessionDurationInRange(s,monthStart,monthEnd),0);
  const monthCompleted=state.projects.filter(p=>p.completedAt>=monthStart && p.completedAt<monthEnd).length;
  const monthSessions=sessions.filter(s=>s.endedAt>=monthStart && s.endedAt<monthEnd);
  const avgSession=monthSessions.length
    ? monthSessions.reduce((sum,s)=>sum+(s.durationMs||0),0)/monthSessions.length
    : 0;
  const craftDays=new Set(monthSessions.map(s=>{
    const d=new Date(s.startedAt);
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  })).size;

  const dayData=[];
  for(let i=6;i>=0;i--){
    const d=new Date();
    d.setDate(d.getDate()-i);
    d.setHours(0,0,0,0);
    const start=d.getTime();
    const end=start+86400000;
    const ms=sessions.reduce((sum,s)=>sum+sessionDurationInRange(s,start,end),0);
    dayData.push({
      label:new Intl.DateTimeFormat("zh-TW",{weekday:"short"}).format(d),
      ms,
      isToday:i===0
    });
  }
  const maxDay=Math.max(...dayData.map(d=>d.ms),1);

  const projectMonth=state.projects.map(p=>({
    p,
    ms:projectSessionDurationInRange(p,monthStart,monthEnd)
  })).sort((a,b)=>b.ms-a.ms);
  const topMonth=projectMonth.find(x=>x.ms>0);

  const sorted=[...state.projects].sort((a,b)=>elapsedMs(b)-elapsedMs(a));

  const content=document.getElementById("statsContent");
  content.innerHTML=`
    <section class="stats-summary">
      <div class="eyebrow">YarnTime Journal</div>
      <div class="stats-total">${fmtHuman(total)}</div>
      <p>你累積留下的所有手作工時</p>
    </section>

    <section class="stats-metric-grid">
      <div class="metric-card"><span>本月工時</span><strong>${fmtHuman(monthMs)}</strong><small>${craftDays} 天有做手作</small></div>
      <div class="metric-card"><span>製作中</span><strong>${active.length}</strong><small>件作品</small></div>
      <div class="metric-card"><span>本月完成</span><strong>${monthCompleted}</strong><small>件作品</small></div>
      <div class="metric-card"><span>平均每次</span><strong>${monthSessions.length?fmtHuman(avgSession):"—"}</strong><small>${monthSessions.length} 次製作</small></div>
    </section>

    <section class="weekly-card">
      <div class="section-head">
        <div><h2>最近 7 天</h2><p>每天花多少時間做手作</p></div>
        <strong>${fmtHuman(dayData.reduce((s,d)=>s+d.ms,0))}</strong>
      </div>
      <div class="week-bars">
        ${dayData.map(d=>`
          <div class="week-day ${d.isToday?"today":""}">
            <div class="week-value">${d.ms?fmtCompact(d.ms):""}</div>
            <div class="week-bar-track"><div class="week-bar-fill" style="height:${Math.max(d.ms?8:0,Math.round((d.ms/maxDay)*100))}%"></div></div>
            <span>${d.label}</span>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="insight-card">
      <div>
        <span>本月最投入</span>
        <strong>${topMonth?escapeHTML(topMonth.p.name):"還沒有資料"}</strong>
      </div>
      <b>${topMonth?fmtHuman(topMonth.ms):"—"}</b>
    </section>

    <section class="stats-list">
      <div class="section-head"><div><h2>作品總工時</h2><p>目前累積最花時間的作品</p></div></div>
      ${sorted.length?sorted.map(p=>`
        <div class="stat-row">
          <div><strong>${escapeHTML(p.name)}</strong><div class="project-meta">${escapeHTML(p.type)} · ${p.sessions?.length||0} 次製作${p.isCompleted?" · 已完成":""}</div></div>
          <strong>${fmtHuman(elapsedMs(p))}</strong>
        </div>
      `).join(""):`<p>還沒有統計資料。</p>`}
      ${total>0 && sessions.length===0?`<p class="stats-footnote">逐次製作統計會從 v8 開始累積；之前的總工時仍完整保留。</p>`:""}
    </section>`;
}
function updateDetailLiveOnly(){
  if(!detailProjectId) return;
  const p=getProject(detailProjectId); if(!p) return;

  const timer=document.getElementById("detailTimer");
  const total=document.getElementById("detailTotal");
  const current=document.getElementById("detailCurrentSegment");
  if(timer) timer.textContent=fmt(elapsedMs(p));
  if(total) total.textContent=fmtHuman(elapsedMs(p));
  if(current) current.textContent=fmt(currentSessionMs(p));

  const warning=document.getElementById("longTimerWarning");
  if(warning){
    const currentMs=currentSessionMs(p);
    const showLong=p.isRunning && currentMs>=4*3600000;
    warning.classList.toggle("hidden",!showLong);
    if(showLong){
      const text=document.getElementById("longTimerWarningText");
      if(text) text.textContent=`本次已計時 ${fmtHuman(currentMs)}。如果其實早就停工，可以先暫停，再點製作紀錄修正。`;
    }
  }

  // 價格結果中的「總工時」會跟計時同步，但不重建輸入框。
  if(p.projectInfo?.purpose==="販售"){
    renderSellerPricingResult(p);
  }
}

function renderAll(){ renderProjects(); renderActive(); renderDetail(); renderStats(); }

const modalStack=[];

function refreshModalStack(){
  modalStack.forEach((id,index)=>{
    const modal=document.getElementById(id);
    if(!modal) return;
    modal.style.zIndex=String(50 + index*10);
    modal.classList.toggle("modal-topmost",index===modalStack.length-1);
    modal.setAttribute("aria-hidden","false");
  });
  document.body.classList.toggle("modal-open",modalStack.length>0);
}

function openModal(id){
  const modal=document.getElementById(id);
  if(!modal) return;

  // 已經開啟的視窗再次被呼叫時，把它移到最上層。
  const existingIndex=modalStack.indexOf(id);
  if(existingIndex>=0) modalStack.splice(existingIndex,1);

  modal.classList.remove("hidden");
  modalStack.push(id);
  refreshModalStack();

  // 每次開啟時從 sheet 頂端開始，避免「編輯」看起來卡在下方捲動位置。
  const sheet=modal.querySelector(".modal-sheet");
  if(sheet) requestAnimationFrame(()=>sheet.scrollTo({top:0,behavior:"auto"}));
}

function closeModal(id){
  const modal=document.getElementById(id);
  if(!modal) return;

  modal.classList.add("hidden");
  modal.style.zIndex="";
  modal.classList.remove("modal-topmost");
  modal.setAttribute("aria-hidden","true");

  const index=modalStack.lastIndexOf(id);
  if(index>=0) modalStack.splice(index,1);
  refreshModalStack();
}

function closeTopModal(){
  const topId=modalStack.at(-1);
  if(topId) closeModal(topId);
}

document.querySelectorAll("[data-project-filter]").forEach(btn=>btn.onclick=()=>{
  currentProjectFilter=btn.dataset.projectFilter;
  document.querySelectorAll("[data-project-filter]").forEach(x=>x.classList.toggle("active",x===btn));
  renderProjects();
});

function fillProjectModal(p=null){
  editingProjectId=p?.id||null;
  document.getElementById("projectModalTitle").textContent=p?"編輯作品資訊":"新增作品";
  document.getElementById("projectNameInput").value=p?.name||"";
  document.getElementById("projectTypeInput").value=p?.type||"鉤針";
  document.getElementById("projectNoteInput").value=p?.note||"";
  const info=p?.projectInfo||{};
  document.getElementById("projectStartDateInput").value=localDateInputValue(p?.createdAt||now());
  document.getElementById("projectNeedleInput").value=info.needle||"";
  document.getElementById("projectYarnInput").value=info.yarn||"";
  document.getElementById("projectAmountInput").value=info.amount||"";
  document.getElementById("projectCostInput").value=info.cost??"";
  document.getElementById("projectPurposeInput").value=info.purpose||"";
  document.getElementById("projectSourceInput").value=info.source||"";
  document.getElementById("projectPhotoInput").value="";
  setPendingProjectPhoto(null);
  document.getElementById("saveProjectBtn").textContent=p?"儲存修改":"儲存";
}
function readProjectInfoInputs(){
  return {
    needle:document.getElementById("projectNeedleInput").value.trim(),
    yarn:document.getElementById("projectYarnInput").value.trim(),
    amount:document.getElementById("projectAmountInput").value.trim(),
    cost:parseCost(document.getElementById("projectCostInput").value),
    purpose:document.getElementById("projectPurposeInput").value,
    source:document.getElementById("projectSourceInput").value.trim()
  };
}
function openSessionModal(projectId,sessionId=null){
  const p=getProject(projectId); if(!p) return;
  editingSessionId=sessionId;
  const s=sessionId?(p.sessions||[]).find(x=>x.id===sessionId):null;
  const reference=s?.startedAt||now();
  const endRef=s?.endedAt||(reference+30*60000);

  document.getElementById("sessionModalTitle").textContent=s?"修正製作紀錄":"補登製作";
  document.getElementById("sessionDateInput").value=localDateInputValue(reference);
  document.getElementById("sessionStartInput").value=localTimeInputValue(reference);
  document.getElementById("sessionEndInput").value=localTimeInputValue(endRef);
  document.getElementById("deleteSessionBtn").classList.toggle("hidden",!s);
  updateSessionDurationPreview();
  openModal("sessionModal");
}
function readSessionEditorTimes(){
  const date=document.getElementById("sessionDateInput").value;
  const startTime=document.getElementById("sessionStartInput").value;
  const endTime=document.getElementById("sessionEndInput").value;
  let start=combineLocalDateTime(date,startTime);
  let end=combineLocalDateTime(date,endTime);
  if(start==null || end==null) return null;
  if(end<=start) end+=86400000;
  return {start,end,durationMs:end-start};
}
function updateSessionDurationPreview(){
  const times=readSessionEditorTimes();
  const el=document.getElementById("sessionDurationPreview");
  if(!times){
    el.textContent="本次製作：—";
    return;
  }
  el.textContent=`本次製作：${fmtHuman(times.durationMs)}`;
}
["sessionDateInput","sessionStartInput","sessionEndInput"].forEach(id=>{
  document.getElementById(id).addEventListener("input",updateSessionDurationPreview);
});

document.getElementById("addProjectBtn").onclick=()=>{
  fillProjectModal(null);
  openModal("projectModal");
};
document.getElementById("emptyAddBtn").onclick=()=>document.getElementById("addProjectBtn").click();

document.getElementById("saveProjectBtn").onclick=async()=>{
  const name=document.getElementById("projectNameInput").value.trim();
  if(!name){ alert("請輸入作品名稱"); return; }

  const type=document.getElementById("projectTypeInput").value;
  const note=document.getElementById("projectNoteInput").value;
  const projectInfo=readProjectInfoInputs();
  let p=editingProjectId?getProject(editingProjectId):null;
  const isEdit=!!p;

  const startDateStr=document.getElementById("projectStartDateInput").value;
  const parsedStart=startDateStr?combineLocalDateTime(startDateStr,"00:00"):null;

  if(p){
    p.name=name;
    p.type=type;
    p.note=note;
    p.projectInfo=projectInfo;
    if(parsedStart) p.createdAt=parsedStart;
  }else{
    p=createProject(name,type,note,projectInfo);
    if(parsedStart) p.createdAt=parsedStart;
  }

  const btn=document.getElementById("saveProjectBtn");
  btn.disabled=true;
  try{
    if(pendingProjectPhotoFile){
      const blob=await compressPhoto(pendingProjectPhotoFile);
      await putProjectPhoto(p.id,blob);
    }
  }catch(err){
    console.error(err);
    alert(isEdit?"資料已更新，但照片儲存失敗。":"作品已建立，但照片儲存失敗；可以稍後再新增。");
  }
  setPendingProjectPhoto(null);
  editingProjectId=null;
  btn.disabled=false;
  saveState();
  closeModal("projectModal");
  renderAll();
};

document.getElementById("projectPhotoBtn").onclick=()=>document.getElementById("projectPhotoInput").click();
document.getElementById("projectPhotoInput").onchange=(e)=>{
  const file=e.target.files?.[0];
  if(file) setPendingProjectPhoto(file);
};
document.getElementById("clearProjectPhotoBtn").onclick=()=>{
  document.getElementById("projectPhotoInput").value="";
  setPendingProjectPhoto(null);
};

document.getElementById("projectList").onclick=(e)=>{
  const btn=e.target.closest("button"); if(!btn) return;
  const id=btn.dataset.id;
  if(btn.dataset.action==="toggle") toggleProject(id);
  if(btn.dataset.action==="detail"){
    detailProjectId=id; renderDetail(); openModal("detailModal");
  }
};

document.querySelectorAll("[data-close]").forEach(b=>{
  b.onclick=()=>{
    const targetId=b.dataset.close;
    // 如果按的是目前最上層的關閉，就正常回到上一層。
    // 若因特殊狀況不是最上層，也只關掉指定那一層。
    closeModal(targetId);
  };
});

// 點灰色背景：只關掉「最上層」視窗。
// 點到白色 sheet 裡面不會誤關。
document.querySelectorAll(".modal-backdrop").forEach(backdrop=>{
  backdrop.addEventListener("pointerdown",(e)=>{
    if(e.target!==backdrop) return;
    if(modalStack.at(-1)!==backdrop.id) return;
    closeTopModal();
  });
});

// 電腦測試時 Esc 也視為「返回上一層」。
document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape" && modalStack.length){
    e.preventDefault();
    closeTopModal();
  }
});

document.getElementById("loadMoreSessionsBtn").onclick=()=>{
  if(!detailProjectId) return;
  const current=sessionVisibleByProject.get(detailProjectId)||40;
  sessionVisibleByProject.set(detailProjectId,current+40);
  renderDetail();
};

document.getElementById("loadMoreLapsBtn").onclick=()=>{
  if(!detailProjectId) return;
  const current=lapVisibleByProject.get(detailProjectId)||40;
  lapVisibleByProject.set(detailProjectId,current+40);
  renderDetail();
};

document.getElementById("addLapFromSectionBtn").onclick=()=>{
  if(detailProjectId) beginLap(detailProjectId);
};

document.getElementById("addSessionBtn").onclick=()=>{
  if(detailProjectId) openSessionModal(detailProjectId,null);
};
document.getElementById("sessionList").onclick=(e)=>{
  const row=e.target.closest("[data-session-id]");
  if(!row || !detailProjectId) return;
  openSessionModal(detailProjectId,row.dataset.sessionId);
};
document.getElementById("saveSessionBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  const times=readSessionEditorTimes();
  if(!times){ alert("請填完整的日期、開始與結束時間。"); return; }
  if(times.durationMs<60000){ alert("製作時間至少要 1 分鐘。"); return; }
  if(times.durationMs>24*3600000){ alert("單次紀錄不能超過 24 小時。"); return; }

  const legacyBase=sessionLegacyBaseMs(p);
  if(editingSessionId){
    const s=(p.sessions||[]).find(x=>x.id===editingSessionId);
    if(!s) return;
    s.startedAt=times.start;
    s.endedAt=times.end;
    s.durationMs=times.durationMs;
  }else{
    ensureSessions(p).push({
      id:uuid(),
      startedAt:times.start,
      endedAt:times.end,
      durationMs:times.durationMs,
      isManual:true
    });
  }
  p.sessions.sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
  recalcAccumulatedFromSessions(p,legacyBase);
  p.lastWorkedAt=Math.max(p.lastWorkedAt||0,times.end);
  saveState();
  editingSessionId=null;
  closeModal("sessionModal");
  renderAll();
};
document.getElementById("deleteSessionBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p || !editingSessionId) return;
  const s=(p.sessions||[]).find(x=>x.id===editingSessionId);
  if(!s) return;
  if(confirm(`確定刪除這筆 ${fmtHuman(s.durationMs)} 的製作紀錄嗎？`)){
    const legacyBase=sessionLegacyBaseMs(p);
    p.sessions=p.sessions.filter(x=>x.id!==editingSessionId);
    recalcAccumulatedFromSessions(p,legacyBase);
    editingSessionId=null;
    saveState();
    closeModal("sessionModal");
    renderAll();
  }
};

document.getElementById("editProjectInfoBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  fillProjectModal(p);
  openModal("projectModal");
  requestAnimationFrame(()=>{
    const input=document.getElementById("projectNameInput");
    if(input) input.focus({preventScroll:true});
  });
};

document.getElementById("detailPhotoCard").onclick=()=>document.getElementById("detailPhotoInput").click();
document.getElementById("detailPhotoChangeBtn").onclick=()=>document.getElementById("detailPhotoInput").click();
document.getElementById("detailPhotoInput").onchange=async(e)=>{
  const file=e.target.files?.[0];
  if(!file || !detailProjectId) return;
  const projectId=detailProjectId;
  try{
    const blob=await compressPhoto(file);
    await putProjectPhoto(projectId,blob);
    await renderDetailPhoto();
    renderProjects();
  }catch(err){
    console.error(err);
    alert("照片儲存失敗，請換一張照片再試。");
  }
  e.target.value="";
};
document.getElementById("detailPhotoRemoveBtn").onclick=async()=>{
  if(!detailProjectId) return;
  const projectId=detailProjectId;
  if(confirm("確定要移除這張作品照片嗎？")){
    await deleteProjectPhoto(projectId);
    await renderDetailPhoto();
    renderProjects();
  }
};

function beginLap(id){
  const p=getProject(id); if(!p) return;
  pendingLapProjectId=id;
  pendingLapSnapshot={at:now(),totalMs:elapsedMs(p)};

  const segmentMs=currentSessionMs(p);

  document.getElementById("lapNameInput").value="";
  document.getElementById("lapNoteInput").value="";
  document.getElementById("lapPhotoInput").value="";
  setPendingLapPhoto(null);
  document.getElementById("lapSnapshotSegment").textContent=fmt(segmentMs);
  document.getElementById("lapSnapshotTotal").textContent=fmt(pendingLapSnapshot.totalMs);
  openModal("lapModal");
}

document.getElementById("longTimerPauseBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p || !p.isRunning) return;
  pauseProject(p);
  saveState();
  renderAll();
  const last=[...(p.sessions||[])].sort((a,b)=>(b.endedAt||0)-(a.endedAt||0))[0];
  if(last) setTimeout(()=>openSessionModal(p.id,last.id),120);
};

document.getElementById("pauseActiveBtn").onclick=()=>{
  if(state.activeProjectId) toggleProject(state.activeProjectId);
};
document.getElementById("lapActiveBtn").onclick=()=>{
  if(!state.activeProjectId) return;
  beginLap(state.activeProjectId);
};
document.getElementById("detailStartPauseBtn").onclick=()=>{
  if(detailProjectId) toggleProject(detailProjectId);
};
document.getElementById("detailLapBtn").onclick=()=>{
  if(!detailProjectId) return;
  beginLap(detailProjectId);
};
document.getElementById("lapPhotoBtn").onclick=()=>document.getElementById("lapPhotoInput").click();
document.getElementById("lapPhotoInput").onchange=(e)=>{
  const file=e.target.files?.[0];
  if(file) setPendingLapPhoto(file);
};
document.getElementById("clearLapPhotoBtn").onclick=()=>{
  document.getElementById("lapPhotoInput").value="";
  setPendingLapPhoto(null);
};

document.getElementById("saveLapBtn").onclick=async()=>{
  const p=getProject(pendingLapProjectId); if(!p) return;
  const name=document.getElementById("lapNameInput").value.trim()||`里程碑 ${p.laps.length+1}`;
  const note=document.getElementById("lapNoteInput").value.trim();
  const snapshot=pendingLapSnapshot||{at:now(),totalMs:elapsedMs(p)};
  const previousBoundary=p.laps.length
    ? (p.laps[p.laps.length-1].totalMs||0)
    : (p.lapBaselineMs||0);
  const segmentMs=Math.max(0,snapshot.totalMs-previousBoundary);
  const lap={id:uuid(),name,note,at:snapshot.at,totalMs:snapshot.totalMs,segmentMs};
  p.laps.push(lap);
  saveState();

  const btn=document.getElementById("saveLapBtn");
  btn.disabled=true;
  btn.textContent="正在儲存…";
  try{
    if(pendingLapPhotoFile){
      const blob=await compressPhoto(pendingLapPhotoFile);
      await putLapPhoto(p.id,lap.id,blob);
    }
  }catch(err){
    console.error(err);
    alert("里程碑已記錄，但照片儲存失敗。");
  }finally{
    btn.disabled=false;
    btn.textContent="儲存里程碑";
  }

  latestResumeBlob=null;
  latestResumeProjectId=null;
  latestAlbumBlobs=[];
  resumeMediaItems=[];
  pendingLapSnapshot=null;
  pendingLapProjectId=null;
  setPendingLapPhoto(null);
  closeModal("lapModal");
  renderAll();
};
document.getElementById("clearLapsBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(confirm("確定要清除這個作品的所有里程碑嗎？")){
    // 清除後從「目前累積時間」重新當作下一段的起點。
    p.lapBaselineMs=elapsedMs(p);
    const oldLaps=[...(p.laps||[])];
    p.laps=[];
    Promise.all(oldLaps.map(l=>deleteLapPhoto(p.id,l.id).catch(()=>{})));
    saveState(); renderAll();
  }
};
document.getElementById("deleteProjectBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(confirm(`確定刪除「${p.name}」嗎？這個動作無法復原。`)){
    if(state.activeProjectId===p.id) state.activeProjectId=null;
    state.projects=state.projects.filter(x=>x.id!==p.id);
    deleteProjectPhoto(p.id).catch(()=>{});
    Promise.all((p.laps||[]).map(l=>deleteLapPhoto(p.id,l.id).catch(()=>{})));
    saveState(); closeModal("detailModal"); detailProjectId=null; renderAll();
  }
};

function readSellerPricingInputs(){
  return {
    hourlyRate:parseCost(document.getElementById("sellerHourlyRateInput").value),
    packaging:parseCost(document.getElementById("sellerPackagingInput").value),
    feeRate:parseCost(document.getElementById("sellerFeeRateInput").value),
    valueAdd:parseCost(document.getElementById("sellerValueAddInput").value),
    actualPrice:parseCost(document.getElementById("sellerActualPriceInput").value)
  };
}
["sellerHourlyRateInput","sellerPackagingInput","sellerFeeRateInput","sellerValueAddInput","sellerActualPriceInput"].forEach(id=>{
  document.getElementById(id).addEventListener("input",()=>{
    const p=getProject(detailProjectId); if(!p) return;
    // v18.1: 輸入時直接同步到目前作品，避免計時刷新把文字洗掉。
    p.sellerPricing=readSellerPricingInputs();
    saveState();
    renderSellerPricingResult(p);
  });
});
document.getElementById("saveSellerPricingBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  p.sellerPricing=readSellerPricingInputs();
  saveState();
  renderSellerPricingResult(p);
  alert("售價設定已儲存。");
};

document.getElementById("toggleCompleteBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(!p.isCompleted){
    if(p.isRunning) pauseProject(p);
    p.isCompleted=true;
    p.completedAt=now();
    p.lastWorkedAt=p.completedAt;
  }else{
    p.isCompleted=false;
    p.completedAt=null;
  }
  latestResumeBlob=null;
  latestResumeProjectId=null;
  saveState();
  renderAll();
};


document.getElementById("resumeCardBtn").onclick=async()=>{
  const p=getProject(detailProjectId); if(!p || !p.isCompleted) return;
  openModal("resumeModal");
  const loading=document.getElementById("resumeLoading");
  loading.classList.remove("hidden");
  try{
    await renderResumePhotoLibrary(p);
    await buildResumeCard(p.id);
  }catch(err){
    console.error(err);
    alert("履歷卡生成失敗，請再試一次。");
    closeModal("resumeModal");
  }finally{
    loading.classList.add("hidden");
  }
};


document.getElementById("resumePhotoGrid").onclick=async(e)=>{
  const p=getProject(detailProjectId); if(!p) return;
  const heroControl=e.target.closest("[data-set-hero]");

  if(heroControl){
    e.preventDefault();
    e.stopPropagation();
    const key=heroControl.dataset.setHero;
    ensureResumePrefs(p,resumeMediaItems);
    p.resumePrefs.heroKey=key;
    if(!p.resumePrefs.selectedKeys.includes(key)){
      p.resumePrefs.selectedKeys.push(key);
    }
    latestResumeBlob=null;
    saveState();
    await renderResumePhotoLibrary(p);
    return;
  }

  const tile=e.target.closest("[data-resume-key]");
  if(!tile) return;

  const key=tile.dataset.resumeKey;
  ensureResumePrefs(p,resumeMediaItems);
  const selected=new Set(p.resumePrefs.selectedKeys||[]);

  if(selected.has(key)){
    if(p.resumePrefs.heroKey===key){
      const replacement=resumeMediaItems.find(item=>item.key!==key && selected.has(item.key));
      if(!replacement){
        alert("至少保留一張主圖。");
        return;
      }
      p.resumePrefs.heroKey=replacement.key;
    }
    selected.delete(key);
  }else{
    selected.add(key);
  }

  p.resumePrefs.selectedKeys=resumeMediaItems
    .filter(item=>selected.has(item.key))
    .map(item=>item.key);

  latestResumeBlob=null;
  saveState();
  await renderResumePhotoLibrary(p);
};

document.getElementById("resumeSelectAllBtn").onclick=async()=>{
  const p=getProject(detailProjectId); if(!p) return;
  ensureResumePrefs(p,resumeMediaItems);
  p.resumePrefs.selectedKeys=resumeMediaItems.map(x=>x.key);
  if(!p.resumePrefs.heroKey && resumeMediaItems.length){
    p.resumePrefs.heroKey=resumeMediaItems[0].key;
  }
  latestResumeBlob=null;
  saveState();
  await renderResumePhotoLibrary(p);
};

document.getElementById("resumeClearSelectionBtn").onclick=async()=>{
  const p=getProject(detailProjectId); if(!p) return;
  ensureResumePrefs(p,resumeMediaItems);
  const hero=p.resumePrefs.heroKey||resumeMediaItems[0]?.key||null;
  p.resumePrefs.selectedKeys=hero?[hero]:[];
  latestResumeBlob=null;
  saveState();
  await renderResumePhotoLibrary(p);
};

document.getElementById("regenerateResumeBtn").onclick=async()=>{
  const p=getProject(detailProjectId); if(!p) return;
  const loading=document.getElementById("resumeLoading");
  loading.classList.remove("hidden");
  try{
    latestResumeBlob=null;
    await buildResumeCard(p.id);
  }catch(err){
    console.error(err);
    alert("重新生成失敗，請再試一次。");
  }finally{
    loading.classList.add("hidden");
  }
};

document.getElementById("createPhotoAlbumBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p || !p.isCompleted) return;

  latestAlbumBlobs=[];
  latestAlbumProjectId=p.id;

  if(latestAlbumPreviewUrl){
    URL.revokeObjectURL(latestAlbumPreviewUrl);
    latestAlbumPreviewUrl=null;
  }

  document.getElementById("albumPreviewImage").classList.add("hidden");
  document.getElementById("albumPlaceholder").classList.remove("hidden");
  document.getElementById("shareAlbumBtn").classList.add("hidden");
  document.getElementById("downloadAlbumBtn").classList.add("hidden");
  document.getElementById("buildAlbumBtn").classList.remove("hidden");

  const selectedCount=selectedResumeMedia(p,resumeMediaItems).length;
  document.getElementById("albumStatus").textContent=`已選 ${selectedCount} 張照片`;

  openModal("photoAlbumModal");
};

document.getElementById("buildAlbumBtn").onclick=async()=>{
  const p=getProject(latestAlbumProjectId||detailProjectId); if(!p) return;

  const loading=document.getElementById("albumLoading");
  const status=document.getElementById("albumStatus");
  const preview=document.getElementById("albumPreviewImage");
  const placeholder=document.getElementById("albumPlaceholder");
  const btn=document.getElementById("buildAlbumBtn");

  loading.classList.remove("hidden");
  btn.disabled=true;

  try{
    const blobs=await buildPhotoAlbum(p.id,(page,total)=>{
      loading.textContent=`正在生成第 ${page} / ${total} 頁…`;
      status.textContent=`正在整理 ${page} / ${total}`;
    });

    if(latestAlbumPreviewUrl) URL.revokeObjectURL(latestAlbumPreviewUrl);
    latestAlbumPreviewUrl=URL.createObjectURL(blobs[0]);

    preview.src=latestAlbumPreviewUrl;
    preview.classList.remove("hidden");
    placeholder.classList.add("hidden");

    status.textContent=`完成 · 共 ${blobs.length} 頁`;
    document.getElementById("shareAlbumBtn").classList.remove("hidden");
    document.getElementById("downloadAlbumBtn").classList.remove("hidden");
    btn.classList.add("hidden");
  }catch(err){
    console.error(err);
    if(err?.message==="no_photos"){
      alert("請至少選一張照片。");
    }else{
      alert("多頁回顧生成失敗，請稍後再試。");
    }
  }finally{
    loading.classList.add("hidden");
    btn.disabled=false;
  }
};

document.getElementById("shareAlbumBtn").onclick=async()=>{
  const p=getProject(latestAlbumProjectId||detailProjectId);
  if(!p || !latestAlbumBlobs.length) return;

  const files=albumFilesForProject(p);

  try{
    if(navigator.share && (!navigator.canShare || navigator.canShare({files}))){
      await navigator.share({
        title:`${p.name} · YarnTime`,
        text:`${p.name}｜${latestAlbumBlobs.length} 頁作品回顧`,
        files
      });
    }else{
      downloadAlbumPages(p);
    }
  }catch(err){
    if(err?.name!=="AbortError"){
      console.error(err);
      alert("這台裝置目前無法一次分享多張，改用「下載全部」即可。");
    }
  }
};

document.getElementById("downloadAlbumBtn").onclick=()=>{
  const p=getProject(latestAlbumProjectId||detailProjectId);
  if(p && latestAlbumBlobs.length){
    downloadAlbumPages(p);
  }
};

document.getElementById("shareResumeBtn").onclick=async()=>{
  const p=getProject(latestResumeProjectId||detailProjectId); if(!p) return;
  try{
    const blob=(latestResumeProjectId===p.id && latestResumeBlob) ? latestResumeBlob : await buildResumeCard(p.id);
    const file=new File([blob],`${safeFilename(p.name)}_YarnTime.png`,{type:"image/png"});
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      await navigator.share({title:`${p.name} · YarnTime`,text:`${p.name}｜總工時 ${fmtHuman(elapsedMs(p))}`,files:[file]});
    }else{
      downloadResumeBlob(blob,p);
    }
  }catch(err){
    if(err?.name!=="AbortError"){
      console.error(err);
      alert("這台裝置目前無法直接分享，改用「下載 PNG」即可。");
    }
  }
};

document.getElementById("downloadResumeBtn").onclick=async()=>{
  const p=getProject(latestResumeProjectId||detailProjectId); if(!p) return;
  try{
    const blob=(latestResumeProjectId===p.id && latestResumeBlob) ? latestResumeBlob : await buildResumeCard(p.id);
    downloadResumeBlob(blob,p);
  }catch(err){
    console.error(err);
    alert("圖片下載失敗，請再試一次。");
  }
};


document.getElementById("recapVideoBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p || !p.isCompleted) return;
  latestRecapBlob=null;
  latestRecapProjectId=p.id;
  if(latestRecapUrl){ URL.revokeObjectURL(latestRecapUrl); latestRecapUrl=null; }
  const video=document.getElementById("recapVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.classList.add("hidden");
  document.getElementById("recapPlaceholder").classList.remove("hidden");
  document.getElementById("shareRecapBtn").classList.add("hidden");
  document.getElementById("downloadRecapBtn").classList.add("hidden");
  document.getElementById("createRecapBtn").classList.remove("hidden");
  openModal("recapModal");
};

document.getElementById("createRecapBtn").onclick=async()=>{
  const p=getProject(latestRecapProjectId||detailProjectId); if(!p) return;
  const loading=document.getElementById("recapLoading");
  const loadingText=document.getElementById("recapLoadingText");
  const btn=document.getElementById("createRecapBtn");
  const placeholder=document.getElementById("recapPlaceholder");
  const video=document.getElementById("recapVideo");
  loading.classList.remove("hidden");
  btn.disabled=true;
  placeholder.classList.add("hidden");
  try{
    loadingText.textContent="正在整理照片…";
    const result=await buildRecapVideo(p.id,progress=>{
      loadingText.textContent=`正在生成影片 ${Math.round(progress*100)}%`;
    });
    video.src=result.url;
    video.classList.remove("hidden");
    document.getElementById("shareRecapBtn").classList.remove("hidden");
    document.getElementById("downloadRecapBtn").classList.remove("hidden");
    btn.classList.add("hidden");
    loadingText.textContent="完成";
  }catch(err){
    console.error(err);
    placeholder.classList.remove("hidden");
    if(err?.message==="unsupported"){
      alert("這台 iPhone / Safari 目前不支援 YarnTime 的本機影片編碼。履歷卡與所有作品紀錄不受影響。");
    }else{
      alert("影片生成失敗，請關閉其他較吃記憶體的 App 後再試一次。");
    }
  }finally{
    loading.classList.add("hidden");
    btn.disabled=false;
  }
};

document.getElementById("shareRecapBtn").onclick=async()=>{
  const p=getProject(latestRecapProjectId||detailProjectId);
  if(!p || !latestRecapBlob) return;
  const ext=recapExtension(latestRecapBlob.type);
  const file=new File([latestRecapBlob],`${safeFilename(p.name)}_YarnTime_Recap.${ext}`,{type:latestRecapBlob.type||"video/mp4"});
  try{
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      await navigator.share({
        title:`${p.name} · YarnTime`,
        text:`${p.name}｜總工時 ${fmtHuman(elapsedMs(p))}`,
        files:[file]
      });
    }else{
      downloadRecapBlob(latestRecapBlob,p);
    }
  }catch(err){
    if(err?.name!=="AbortError"){
      console.error(err);
      alert("目前無法直接分享，請改用下載影片。");
    }
  }
};

document.getElementById("downloadRecapBtn").onclick=()=>{
  const p=getProject(latestRecapProjectId||detailProjectId);
  if(p && latestRecapBlob) downloadRecapBlob(latestRecapBlob,p);
};

async function refreshStorageStatus(){
  const usageEl=document.getElementById("storageUsageText");
  const persistEl=document.getElementById("storagePersistText");
  try{
    if(navigator.storage?.estimate){
      const est=await navigator.storage.estimate();
      const mb=(est.usage||0)/1024/1024;
      usageEl.textContent=mb<1?`${Math.round(mb*1024)} KB`:`${mb.toFixed(1)} MB`;
    }else{
      usageEl.textContent="此瀏覽器不提供";
    }
  }catch(e){ usageEl.textContent="無法取得"; }

  try{
    if(navigator.storage?.persisted){
      const persisted=await navigator.storage.persisted();
      persistEl.textContent=persisted?"已啟用":"尚未啟用";
    }else{
      persistEl.textContent="此瀏覽器不提供";
    }
  }catch(e){ persistEl.textContent="無法取得"; }
}
document.getElementById("requestPersistBtn").onclick=async()=>{
  try{
    if(!navigator.storage?.persist){
      alert("這個 iPhone / Safari 版本沒有提供此功能，定期備份即可。");
      return;
    }
    const ok=await navigator.storage.persist();
    alert(ok?"已取得持久儲存權限。":"瀏覽器目前沒有授予持久儲存；資料仍可正常使用，記得定期備份。");
    refreshStorageStatus();
  }catch(e){
    alert("目前無法要求持久儲存，請定期匯出備份。");
  }
};

document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("statsView").classList.add("hidden");
  document.getElementById("settingsView").classList.add("hidden");
  if(btn.dataset.view==="stats"){ renderStats(); document.getElementById("statsView").classList.remove("hidden"); }
  if(btn.dataset.view==="settings"){
    document.getElementById("settingsView").classList.remove("hidden");
    refreshStorageStatus();
  }
});

document.getElementById("exportBtn").onclick=async()=>{
  const btn=document.getElementById("exportBtn");
  btn.disabled=true;
  btn.textContent="正在整理備份…";
  try{
    const photos={};
    const lapPhotos={};
    for(const p of state.projects){
      const photo=await getProjectPhotoBlob(p.id);
      if(photo) photos[p.id]=await blobToDataURL(photo);
      for(const lap of (p.laps||[])){
        const lapPhoto=await getLapPhotoBlob(p.id,lap.id);
        if(lapPhoto) lapPhotos[`${p.id}|${lap.id}`]=await blobToDataURL(lapPhoto);
      }
    }
    const payload={...state,_yarntimeVersion:18.1,photos,lapPhotos};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`YarnTime_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(err){
    console.error(err);
    alert("備份失敗，請稍後再試。");
  }finally{
    btn.disabled=false;
    btn.textContent="匯出備份";
  }
};
document.getElementById("importInput").onchange=async(e)=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.projects)) throw new Error("bad");
    if(confirm("匯入會覆蓋目前資料，確定嗎？")){
      const photos=data.photos||{};
      const lapPhotos=data.lapPhotos||{};
      const nextState={
        projects:data.projects,
        activeProjectId:data.activeProjectId||null
      };
      await clearAllProjectPhotos();
      for(const [projectId,dataURL] of Object.entries(photos)){
        if(typeof dataURL==="string" && dataURL.startsWith("data:")){
          await putProjectPhoto(projectId,dataURLToBlob(dataURL));
        }
      }
      for(const [key,dataURL] of Object.entries(lapPhotos)){
        const [projectId,lapId]=key.split("|");
        if(projectId && lapId && typeof dataURL==="string" && dataURL.startsWith("data:")){
          await putLapPhoto(projectId,lapId,dataURLToBlob(dataURL));
        }
      }
      state=nextState;
      saveState();
      renderAll();
      alert("匯入完成");
    }
  }catch(err){
    console.error(err);
    alert("這不是有效的 YarnTime 備份檔");
  }
  e.target.value="";
};

setInterval(()=>{
  document.querySelectorAll("[data-time-id]").forEach(el=>{
    const p=getProject(el.dataset.timeId); if(p) el.textContent=fmt(elapsedMs(p));
  });
  renderActive();
  // v18.1: 不再每秒重畫整個作品詳情，避免輸入框、捲動位置被重設。
  updateDetailLiveOnly();
},1000);

document.addEventListener("visibilitychange", ()=>{
  if(!document.hidden){
    renderAll();
    const p=state.activeProjectId?getProject(state.activeProjectId):null;
    if(p && currentSessionMs(p)>=4*3600000){
      console.warn("YarnTime: long running session",p.name,fmtHuman(currentSessionMs(p)));
    }
  }
});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
renderAll();
