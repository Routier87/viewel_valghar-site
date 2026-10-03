const state={category:VALGHARIE_CONFIG.defaultCategory,size:"all",query:"",page:1,likes:new Set(),images:[]};
const grid=document.querySelector("#galleryGrid"), search=document.querySelector("#searchInput"), size=document.querySelector("#sizeFilter");
function filtered(){return state.images.filter(x=>(state.category==="Toutes"||x.category===state.category)&& (state.size==="all"||x.size===state.size)&&(!state.query||`${x.title} ${x.category}`.toLowerCase().includes(state.query.toLowerCase())))}
function render(){
  if(!grid)return;
  const items=filtered();
  grid.innerHTML=items.map((x,i)=>`<article class="card"><div class="card-image" style="background-image:url('${x.image}')"><button class="heart ${state.likes.has(i)?"liked":""}" data-like="${i}" aria-label="Favori">♡</button></div><div class="card-info"><div class="card-title">${x.title}</div><div class="card-meta">${x.meta||""}</div></div></article>`).join("");
  if(!items.length)grid.innerHTML=`<div style="grid-column:1/-1;padding:50px;text-align:center;color:#8e9bb0">Aucune image ne correspond à votre recherche.</div>`;
  grid.querySelectorAll("[data-like]").forEach(b=>b.addEventListener("click",()=>{const i=+b.dataset.like;state.likes.has(i)?state.likes.delete(i):state.likes.add(i);render()}));
}
async function loadGallery(){
  try{const r=await fetch("/api/gallery");const d=await r.json();state.images=d.images||[];render();}
  catch{state.images=VALGHARIE_CONFIG.images||[];render();}
}
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{document.querySelector(".tab.active")?.classList.remove("active");t.classList.add("active");state.category=t.dataset.filter;state.page=1;render()}));
size?.addEventListener("change",e=>{state.size=e.target.value;render()});
search?.addEventListener("input",e=>{state.query=e.target.value;render()});
document.querySelectorAll(".nav-link").forEach(a=>a.addEventListener("click",()=>{document.querySelector(".nav-link.active")?.classList.remove("active");a.classList.add("active")}));
document.querySelectorAll("#pagination button").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.page==="prev")state.page=Math.max(1,state.page-1);else if(b.dataset.page==="next")state.page=Math.min(12,state.page+1);else state.page=+b.dataset.page;document.querySelectorAll(".pagination .page").forEach(p=>p.classList.toggle("active",+p.dataset.page===state.page))}));
document.querySelector("#discoverBtn")?.addEventListener("click",()=>document.querySelector("#galerie")?.scrollIntoView({behavior:"smooth"}));
loadGallery();

// --- Authentification Valgharie ---
const API_BASE = (window.VALGHARIE_CONFIG && window.VALGHARIE_CONFIG.apiBase) || "";
const loginModal = document.querySelector("#loginModal");
const signupModal = document.querySelector("#signupModal");
const loginBtn = document.querySelector("#loginBtn");
const signupBtn = document.querySelector("#signupBtn");
const openModal = m => m?.classList.remove("hidden");
const closeModal = m => m?.classList.add("hidden");

loginBtn?.addEventListener("click", ()=>openModal(loginModal));
signupBtn?.addEventListener("click", ()=>openModal(signupModal));
document.querySelector("#toSignup")?.addEventListener("click", ()=>{closeModal(loginModal);openModal(signupModal)});
document.querySelector("#toLogin")?.addEventListener("click", ()=>{closeModal(signupModal);openModal(loginModal)});
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(document.getElementById(b.dataset.close))));
[loginModal,signupModal].forEach(m=>m?.addEventListener("click",e=>{if(e.target===m)closeModal(m)}));

async function api(path, options={}) {
  const r = await fetch(API_BASE + path, {credentials:"include", headers:{"Content-Type":"application/json",...(options.headers||{})}, ...options});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}
function message(id,text,success=false){const el=document.getElementById(id);if(!el)return;el.textContent=text;el.classList.toggle("success",success)}

document.querySelector("#signupForm")?.addEventListener("submit", async e=>{
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  if(f.get("password")!==f.get("password2")) return message("signupMessage","Les mots de passe ne correspondent pas.");
  try{
    const data=await api("/api/auth/register",{method:"POST",body:JSON.stringify({email:f.get("email"),password:f.get("password")})});
    message("signupMessage",data.message||"Compte créé. Vérifie ton email.",true);
    e.currentTarget.reset();
  }catch(err){message("signupMessage",err.message)}
});
document.querySelector("#loginForm")?.addEventListener("submit", async e=>{
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  try{
    await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:f.get("email"),password:f.get("password")})});
    message("loginMessage","Connexion réussie.",true);
    setTimeout(()=>{closeModal(loginModal);location.reload()},400);
  }catch(err){
    message("loginMessage",err.message);
  }
});
async function refreshUser(){
  try{
    const data=await api("/api/auth/me");
    if(!data.user)return;
    document.querySelector("#loginBtn")?.remove();
    document.querySelector("#signupBtn")?.remove();
    const actions=document.querySelector(".top-actions");
    const chip=document.createElement("div");chip.className="user-chip";chip.innerHTML=`♟ ${data.user.username}<button class="logout-btn">Déconnexion</button>`;
    actions?.appendChild(chip);
    chip.querySelector(".logout-btn").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});location.reload()};
  }catch{}
}
refreshUser();

document.querySelector("#forgotPasswordBtn")?.addEventListener("click",()=>{
  closeModal(loginModal); openModal(document.querySelector("#resetModal"));
});
document.querySelector("#backToLogin")?.addEventListener("click",()=>{
  closeModal(document.querySelector("#resetModal")); openModal(loginModal);
});
document.querySelector("#resetForm")?.addEventListener("submit",async e=>{
  e.preventDefault(); const f=new FormData(e.currentTarget);
  try{
    const d=await api("/api/auth/forgot",{method:"POST",body:JSON.stringify({email:f.get("email")})});
    message("resetMessage",d.message,true);
  }catch(err){message("resetMessage",err.message)}
});
