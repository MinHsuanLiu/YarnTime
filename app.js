
const STORAGE_KEY = "yarntime_v1";
let state = loadState();
let detailProjectId = null;
let pendingLapProjectId = null;

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

function pauseProject(p){
  if(!p || !p.isRunning) return;
  p.accumulatedMs=(p.accumulatedMs||0)+(now()-p.startedAt);
  p.startedAt=null;
  p.isRunning=false;
  if(state.activeProjectId===p.id) state.activeProjectId=null;
}
function startProject(id){
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
  const p={id:uuid(),name,type,note,createdAt:now(),accumulatedMs:0,isRunning:false,startedAt:null,laps:[]};
  state.projects.unshift(p); saveState(); return p;
}

function renderProjects(){
  const list=document.getElementById("projectList");
  const empty=document.getElementById("emptyState");
  empty.classList.toggle("hidden", state.projects.length>0);
  list.innerHTML=state.projects.map(p=>`
    <article class="project-card ${p.isRunning?"running":""}" data-id="${p.id}">
      <div class="project-row">
        <div class="project-icon">${p.type==="棒針"?"🪡":"🧶"}</div>
        <div class="project-main">
          <div class="project-title">${escapeHTML(p.name)}</div>
          <div class="project-meta">${escapeHTML(p.type)}${p.isRunning?" · 計時中":""}</div>
        </div>
        <div class="project-time" data-time-id="${p.id}">${fmt(elapsedMs(p))}</div>
      </div>
      <div class="project-actions">
        <button class="start-mini" data-action="toggle" data-id="${p.id}">${p.isRunning?"暫停":"開始"}</button>
        <button class="detail-mini" data-action="detail" data-id="${p.id}">查看</button>
      </div>
    </article>
  `).join("");
}

function renderActive(){
  const card=document.getElementById("activeCard");
  const p=state.activeProjectId?getProject(state.activeProjectId):null;
  if(!p || !p.isRunning){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  document.getElementById("activeName").textContent=p.name;
  document.getElementById("activeTimer").textContent=fmt(elapsedMs(p));
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
  document.getElementById("detailNote").textContent=p.note?.trim()||"—";
  const lapList=document.getElementById("lapList");
  const laps=(p.laps||[]).slice().reverse();
  lapList.innerHTML=laps.length?laps.map(l=>`
    <div class="lap-item">
      <div><strong>${escapeHTML(l.name||"未命名分段")}</strong><small>${new Date(l.at).toLocaleString("zh-TW")}</small></div>
      <div>${fmt(l.totalMs)}</div>
    </div>
  `).join(""):`<p>還沒有分段紀錄。</p>`;
}

function renderStats(){
  const total=state.projects.reduce((a,p)=>a+elapsedMs(p),0);
  const content=document.getElementById("statsContent");
  const sorted=[...state.projects].sort((a,b)=>elapsedMs(b)-elapsedMs(a));
  content.innerHTML=`
    <section class="stats-summary">
      <div class="eyebrow">全部作品</div>
      <div class="stats-total">${fmtHuman(total)}</div>
      <p>${state.projects.length} 件作品的累積工時</p>
    </section>
    <section class="stats-list">
      ${sorted.length?sorted.map(p=>`
        <div class="stat-row"><div><strong>${escapeHTML(p.name)}</strong><div class="project-meta">${escapeHTML(p.type)}</div></div><strong>${fmtHuman(elapsedMs(p))}</strong></div>
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
  openModal("projectModal");
};
document.getElementById("emptyAddBtn").onclick=()=>document.getElementById("addProjectBtn").click();

document.getElementById("saveProjectBtn").onclick=()=>{
  const name=document.getElementById("projectNameInput").value.trim();
  if(!name){ alert("請輸入作品名稱"); return; }
  createProject(name, document.getElementById("projectTypeInput").value, document.getElementById("projectNoteInput").value);
  closeModal("projectModal"); renderAll();
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

document.getElementById("pauseActiveBtn").onclick=()=>{
  if(state.activeProjectId) toggleProject(state.activeProjectId);
};
document.getElementById("lapActiveBtn").onclick=()=>{
  if(!state.activeProjectId) return;
  pendingLapProjectId=state.activeProjectId;
  document.getElementById("lapNameInput").value="";
  openModal("lapModal");
};
document.getElementById("detailStartPauseBtn").onclick=()=>{
  if(detailProjectId) toggleProject(detailProjectId);
};
document.getElementById("detailLapBtn").onclick=()=>{
  if(!detailProjectId) return;
  pendingLapProjectId=detailProjectId;
  document.getElementById("lapNameInput").value="";
  openModal("lapModal");
};
document.getElementById("saveLapBtn").onclick=()=>{
  const p=getProject(pendingLapProjectId); if(!p) return;
  const name=document.getElementById("lapNameInput").value.trim()||`分段 ${p.laps.length+1}`;
  p.laps.push({id:uuid(),name,at:now(),totalMs:elapsedMs(p)});
  saveState(); closeModal("lapModal"); renderAll();
};
document.getElementById("clearLapsBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(confirm("確定要清除這個作品的所有分段紀錄嗎？")){
    p.laps=[]; saveState(); renderAll();
  }
};
document.getElementById("deleteProjectBtn").onclick=()=>{
  const p=getProject(detailProjectId); if(!p) return;
  if(confirm(`確定刪除「${p.name}」嗎？這個動作無法復原。`)){
    if(state.activeProjectId===p.id) state.activeProjectId=null;
    state.projects=state.projects.filter(x=>x.id!==p.id);
    saveState(); closeModal("detailModal"); detailProjectId=null; renderAll();
  }
};

document.querySelectorAll(".nav-item").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("statsView").classList.add("hidden");
  document.getElementById("settingsView").classList.add("hidden");
  if(btn.dataset.view==="stats"){ renderStats(); document.getElementById("statsView").classList.remove("hidden"); }
  if(btn.dataset.view==="settings") document.getElementById("settingsView").classList.remove("hidden");
});

document.getElementById("exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`YarnTime_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
document.getElementById("importInput").onchange=async(e)=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.projects)) throw new Error("bad");
    if(confirm("匯入會覆蓋目前資料，確定嗎？")){
      state=data; saveState(); renderAll(); alert("匯入完成");
    }
  }catch(err){ alert("這不是有效的 YarnTime 備份檔"); }
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
