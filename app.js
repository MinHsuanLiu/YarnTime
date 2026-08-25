
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

function defaultState(){ return {projects:[], activeProjectId:null}; }
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : defaultState();
    if(!s.projects) s.projects=[];
    if(!("activeProjectId" in s)) s.activeProjectId=null;
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

// 目前這一段 = 現在總工時 - 上一次分段的累積工時
function currentSegmentMs(p){
  const boundary=p.laps?.length
    ? (p.laps[p.laps.length-1].totalMs||0)
    : (p.lapBaselineMs||0);
  return Math.max(0,elapsedMs(p)-boundary);
}

function pauseProject(p){
  if(!p || !p.isRunning) return;
  p.accumulatedMs=(p.accumulatedMs||0)+(now()-p.startedAt);
  p.startedAt=null;
  p.isRunning=false;
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
    p.isRunning=true; p.startedAt=now(); state.activeProjectId=id;
  }
  saveState(); renderAll();
}
function toggleProject(id){
  const p=getProject(id); if(!p) return;
  if(p.isRunning) pauseProject(p); else startProject(id);
  saveState(); renderAll();
}
function createProject(name,type,note){
  const p={id:uuid(),name,type,note,createdAt:now(),completedAt:null,isCompleted:false,accumulatedMs:0,isRunning:false,startedAt:null,laps:[],lapBaselineMs:0};
  state.projects.unshift(p); saveState(); return p;
}

function renderProjects(){
  const list=document.getElementById("projectList");
  const empty=document.getElementById("emptyState");
  empty.classList.toggle("hidden", state.projects.length>0);
  list.innerHTML=state.projects.map(p=>`
    <article class="project-card ${p.isRunning?"running":""}" data-id="${p.id}">
      <div class="project-row">
        <div class="project-icon">
          <img class="project-thumb hidden" data-photo-project="${p.id}" alt="${escapeHTML(p.name)}">
          <span class="project-fallback">${p.type==="棒針"?"🪡":"🧶"}</span>
        </div>
        <div class="project-main">
          <div class="project-title">${escapeHTML(p.name)}</div>
          <div class="project-meta">${escapeHTML(p.type)}${p.isRunning?" · 計時中":""}${p.isCompleted?" · 已完成":""}</div>
          <div class="project-journal-meta">${p.laps?.length||0} 次紀錄${p.isCompleted?` · ${projectDurationText(p)}`:""}</div>
        </div>
        <div class="project-time" data-time-id="${p.id}">${fmt(elapsedMs(p))}</div>
      </div>
      <div class="project-actions">
        <button class="start-mini" data-action="toggle" data-id="${p.id}">${p.isRunning?"暫停":"開始"}</button>
        <button class="detail-mini" data-action="detail" data-id="${p.id}">查看</button>
      </div>
    </article>
  `).join("");
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

function renderDetail(){
  if(!detailProjectId) return;
  const p=getProject(detailProjectId); if(!p){ closeModal("detailModal"); return; }
  document.getElementById("detailType").textContent=p.type;
  document.getElementById("detailName").textContent=p.name;
  document.getElementById("detailTimer").textContent=fmt(elapsedMs(p));
  document.getElementById("detailStartPauseBtn").textContent=p.isRunning?"暫停":"開始";
  document.getElementById("detailTotal").textContent=fmtHuman(elapsedMs(p));
  document.getElementById("detailLapCount").textContent=p.laps?.length||0;
  document.getElementById("detailCurrentSegment").textContent=fmt(currentSegmentMs(p));
  document.getElementById("detailNote").textContent=p.note?.trim()||"—";
  renderDetailPhoto();

  document.getElementById("completionTitle").textContent=p.isCompleted?"已完成 🎉":"製作中";
  document.getElementById("completionText").textContent=p.isCompleted
    ? `總工時 ${fmtHuman(elapsedMs(p))} · 製作期間 ${projectDurationText(p)}`
    : "完成後會留下總工時與製作期間。";
  document.getElementById("toggleCompleteBtn").textContent=p.isCompleted?"改回製作中":"標記完成";

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

  lapList.innerHTML=laps.length?laps.map(l=>`
    <article class="timeline-item">
      <div class="timeline-marker">
        <span>${l.index}</span>
        <i></i>
      </div>
      <div class="timeline-card">
        <div class="timeline-card-head">
          <div>
            <strong>${escapeHTML(l.name||`進度 ${l.index}`)}</strong>
            <small>${new Date(l.at).toLocaleString("zh-TW")}</small>
          </div>
          <div class="timeline-time">
            <span>本段 ${fmt(l.segmentMs)}</span>
            <b>累積 ${fmt(l.totalMs)}</b>
          </div>
        </div>
        ${l.note?`<p class="timeline-note">${escapeHTML(l.note)}</p>`:""}
        <div class="timeline-photo-wrap">
          <img class="timeline-photo hidden" data-lap-photo-project="${p.id}" data-lap-photo-id="${l.id}" alt="進度照片">
        </div>
      </div>
    </article>
  `).join(""):`<div class="timeline-empty"><span>🧶</span><p>還沒有製作紀錄。<br>按「分段」留下第一個進度節點吧。</p></div>`;

  applyLapPhotos(p.id);
}

function renderStats(){
  const total=state.projects.reduce((a,p)=>a+elapsedMs(p),0);
  const completed=state.projects.filter(p=>p.isCompleted);
  const active=state.projects.filter(p=>!p.isCompleted);
  const totalCheckpoints=state.projects.reduce((a,p)=>a+(p.laps?.length||0),0);
  const sorted=[...state.projects].sort((a,b)=>elapsedMs(b)-elapsedMs(a));
  const averageCompleted=completed.length
    ? completed.reduce((a,p)=>a+elapsedMs(p),0)/completed.length
    : 0;

  const content=document.getElementById("statsContent");
  content.innerHTML=`
    <section class="stats-summary">
      <div class="eyebrow">YarnTime Journal</div>
      <div class="stats-total">${fmtHuman(total)}</div>
      <p>你目前留下的所有手作工時</p>
    </section>
    <section class="journal-metrics">
      <div class="metric-card"><span>作品</span><strong>${state.projects.length}</strong><small>${active.length} 件製作中</small></div>
      <div class="metric-card"><span>已完成</span><strong>${completed.length}</strong><small>${completed.length?`平均 ${fmtHuman(averageCompleted)}`:"還沒有完成作品"}</small></div>
      <div class="metric-card"><span>進度節點</span><strong>${totalCheckpoints}</strong><small>你的製作足跡</small></div>
    </section>
    <section class="stats-list">
      <div class="section-head"><div><h2>工時排行</h2><p>哪件作品最花時間？</p></div></div>
      ${sorted.length?sorted.map(p=>`
        <div class="stat-row">
          <div><strong>${escapeHTML(p.name)}</strong><div class="project-meta">${escapeHTML(p.type)} · ${p.laps?.length||0} 次紀錄${p.isCompleted?" · 已完成":""}</div></div>
          <strong>${fmtHuman(elapsedMs(p))}</strong>
        </div>
      `).join(""):`<p>還沒有統計資料。</p>`}
    </section>`;
}

function renderAll(){ renderProjects(); renderActive(); renderDetail(); renderStats(); }

function openModal(id){ document.getElementById(id).classList.remove("hidden"); }
function closeModal(id){ document.getElementById(id).classList.add("hidden"); }

document.getElementById("addProjectBtn").onclick=()=>{
  document.getElementById("projectNameInput").value="";
  document.getElementById("projectTypeInput").value="鉤針";
  document.getElementById("projectNoteInput").value="";
  document.getElementById("projectPhotoInput").value="";
  setPendingProjectPhoto(null);
  openModal("projectModal");
};
document.getElementById("emptyAddBtn").onclick=()=>document.getElementById("addProjectBtn").click();

document.getElementById("saveProjectBtn").onclick=async()=>{
  const name=document.getElementById("projectNameInput").value.trim();
  if(!name){ alert("請輸入作品名稱"); return; }
  const p=createProject(name,document.getElementById("projectTypeInput").value,document.getElementById("projectNoteInput").value);
  const btn=document.getElementById("saveProjectBtn");
  btn.disabled=true;
  try{
    if(pendingProjectPhotoFile){
      const blob=await compressPhoto(pendingProjectPhotoFile);
      await putProjectPhoto(p.id,blob);
    }
  }catch(err){
    console.error(err);
    alert("作品已建立，但照片儲存失敗；可以稍後在作品頁重新新增。");
  }
  setPendingProjectPhoto(null);
  btn.disabled=false;
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

document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));

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

  const previousBoundary=p.laps?.length
    ? (p.laps[p.laps.length-1].totalMs||0)
    : (p.lapBaselineMs||0);
  const segmentMs=Math.max(0,pendingLapSnapshot.totalMs-previousBoundary);

  document.getElementById("lapNameInput").value="";
  document.getElementById("lapNoteInput").value="";
  document.getElementById("lapPhotoInput").value="";
  setPendingLapPhoto(null);
  document.getElementById("lapSnapshotSegment").textContent=fmt(segmentMs);
  document.getElementById("lapSnapshotTotal").textContent=fmt(pendingLapSnapshot.totalMs);
  openModal("lapModal");
}

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
  const name=document.getElementById("lapNameInput").value.trim()||`進度 ${p.laps.length+1}`;
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
    alert("進度已記錄，但照片儲存失敗。");
  }finally{
    btn.disabled=false;
    btn.textContent="儲存這次進度";
  }

  pendingLapSnapshot=null;
  pendingLapProjectId=null;
  setPendingLapPhoto(null);
  closeModal("lapModal");
  renderAll();
};
document.getElementById("clearLapsBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(confirm("確定要清除這個作品的所有分段紀錄嗎？")){
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

document.getElementById("toggleCompleteBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(!p.isCompleted){
    if(p.isRunning) pauseProject(p);
    p.isCompleted=true;
    p.completedAt=now();
  }else{
    p.isCompleted=false;
    p.completedAt=null;
  }
  saveState();
  renderAll();
};

document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("statsView").classList.add("hidden");
  document.getElementById("settingsView").classList.add("hidden");
  if(btn.dataset.view==="stats"){ renderStats(); document.getElementById("statsView").classList.remove("hidden"); }
  if(btn.dataset.view==="settings") document.getElementById("settingsView").classList.remove("hidden");
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
    const payload={...state,_yarntimeVersion:5,photos,lapPhotos};
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
  if(detailProjectId) renderDetail();
},1000);

document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) renderAll(); });

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
renderAll();
