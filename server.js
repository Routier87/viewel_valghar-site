const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const db = new Database(path.join(__dirname, "valgharie.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token_hash TEXT,
  verification_expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Créations',
  size TEXT NOT NULL DEFAULT 'medium',
  meta TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS live_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  twitch_channel TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('founder','developer')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json({limit:"12mb"}));
app.use(session({
  store:new SQLiteStore({db:"sessions.sqlite",dir:__dirname}),
  secret:process.env.SESSION_SECRET || "CHANGE_ME_IN_PRODUCTION",
  resave:false,
  saveUninitialized:false,
  cookie:{
    httpOnly:true,
    sameSite:"lax",
    secure:process.env.NODE_ENV==="production",
    maxAge:1000*60*60*24*7
  }
}));
const uploadsDir = path.join(__dirname, "uploads");
require("fs").mkdirSync(uploadsDir, {recursive:true});
app.use("/uploads", express.static(uploadsDir));


function clean(v){ return String(v||"").trim(); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function hashToken(token){ return crypto.createHash("sha256").update(token).digest("hex"); }

function mailer(){
  if(!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host:process.env.SMTP_HOST,
    port:Number(process.env.SMTP_PORT || 587),
    secure:process.env.SMTP_SECURE === "true",
    auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS}
  });
}

async function sendVerificationEmail(email, token){
  const transport = mailer();
  const link = `${BASE_URL}/verify-email.html?token=${encodeURIComponent(token)}`;
  if(!transport){
    console.log("\\n[DEV] Email de vérification :");
    console.log(link);
    console.log("");
    return;
  }
  await transport.sendMail({
    from:process.env.SMTP_FROM || process.env.SMTP_USER,
    to:email,
    subject:"Valgharie — vérifie ton adresse email",
    text:`Bienvenue sur Valgharie ! Vérifie ton adresse email ici : ${link}\\n\\nLe lien expire dans 30 minutes.`,
    html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Bienvenue sur Valgharie 👋</h2><p>Vérifie ton adresse email pour activer ton compte.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#713cff;color:white;text-decoration:none;border-radius:6px">Vérifier mon email</a></p><p>Le lien expire dans 30 minutes.</p></div>`
  });
}

async function sendResetEmail(email, token){
  const transport = mailer();
  if(!transport) return;
  const link = `${BASE_URL}/reset-password.html?token=${encodeURIComponent(token)}`;
  await transport.sendMail({
    from:process.env.SMTP_FROM || process.env.SMTP_USER,
    to:email,
    subject:"Valgharie — réinitialisation du mot de passe",
    text:`Réinitialise ton mot de passe ici : ${link}\\n\\nLe lien expire dans 30 minutes.`,
    html:`<p>Réinitialise ton mot de passe Valgharie :</p><p><a href="${link}">Créer un nouveau mot de passe</a></p><p>Le lien expire dans 30 minutes.</p>`
  });
}

app.post("/api/auth/register", async (req,res)=>{
  try{
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || "");
    if(!validEmail(email)) return res.status(400).json({error:"Adresse email invalide."});
    if(password.length < 8) return res.status(400).json({error:"Le mot de passe doit contenir au moins 8 caractères."});

    let user = db.prepare("SELECT id,email,email_verified FROM users WHERE email=?").get(email);
    if(user && user.email_verified) return res.status(409).json({error:"Cette adresse email possède déjà un compte."});

    const hash = await bcrypt.hash(password,12);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expires = Date.now() + 1000*60*30;

    if(user){
      db.prepare(`UPDATE users SET password_hash=?,verification_token_hash=?,verification_expires_at=? WHERE id=?`)
        .run(hash,tokenHash,expires,user.id);
    }else{
      const r = db.prepare(`INSERT INTO users(email,password_hash,email_verified,verification_token_hash,verification_expires_at)
        VALUES(?,?,0,?,?)`).run(email,hash,tokenHash,expires);
      user = {id:r.lastInsertRowid,email};
    }

    await sendVerificationEmail(email,token);
    res.json({ok:true,message:"Compte créé. Vérifie ton email avant de te connecter."});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Impossible de créer le compte pour le moment."});
  }
});

app.post("/api/auth/login", async (req,res)=>{
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT id,email,password_hash,email_verified FROM users WHERE email=?").get(email);

  if(!user || !(await bcrypt.compare(password,user.password_hash || "")))
    return res.status(401).json({error:"Adresse email ou mot de passe incorrect."});

  if(!user.email_verified)
    return res.status(403).json({error:"Vérifie d’abord ton adresse email avec le lien reçu."});

  req.session.userId = user.id;
  res.json({ok:true,user:{id:user.id,email:user.email}});
});

app.get("/api/auth/verify", (req,res)=>{
  const token = clean(req.query.token);
  if(!token) return res.status(400).json({error:"Lien de vérification invalide."});

  const user = db.prepare(`SELECT id,email FROM users
    WHERE verification_token_hash=? AND verification_expires_at>?`).get(hashToken(token),Date.now());

  if(!user) return res.status(400).json({error:"Ce lien est invalide ou a expiré."});

  db.prepare(`UPDATE users SET email_verified=1,verification_token_hash=NULL,verification_expires_at=NULL WHERE id=?`).run(user.id);
  res.json({ok:true});
});

app.post("/api/auth/resend-verification", async (req,res)=>{
  const email = clean(req.body.email).toLowerCase();
  const user = db.prepare("SELECT id,email,email_verified FROM users WHERE email=?").get(email);
  if(!user || user.email_verified) return res.json({ok:true});
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("UPDATE users SET verification_token_hash=?,verification_expires_at=? WHERE id=?")
    .run(hashToken(token),Date.now()+1000*60*30,user.id);
  await sendVerificationEmail(email,token);
  res.json({ok:true});
});

app.post("/api/auth/forgot", async (req,res)=>{
  const email = clean(req.body.email).toLowerCase();
  const generic = {ok:true,message:"Si un compte existe pour cette adresse, un email a été envoyé."};
  const user = db.prepare("SELECT id,email FROM users WHERE email=?").get(email);
  if(!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("DELETE FROM password_resets WHERE user_id=?").run(user.id);
  db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,?)")
    .run(user.id,hashToken(token),Date.now()+1000*60*30);
  await sendResetEmail(email,token);
  res.json(generic);
});

app.post("/api/auth/reset", async (req,res)=>{
  const token = clean(req.body.token);
  const password = String(req.body.password || "");
  if(!token || password.length < 8) return res.status(400).json({error:"Lien ou mot de passe invalide."});

  const row = db.prepare("SELECT id,user_id,expires_at FROM password_resets WHERE token_hash=?").get(hashToken(token));
  if(!row || row.expires_at < Date.now()) return res.status(400).json({error:"Ce lien a expiré ou n’est plus valide."});

  const hash = await bcrypt.hash(password,12);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash,row.user_id);
  db.prepare("DELETE FROM password_resets WHERE id=?").run(row.id);
  req.session.userId = row.user_id;
  res.json({ok:true});
});

app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/auth/me",(req,res)=>{
  if(!req.session.userId) return res.json({user:null});
  const user = db.prepare("SELECT id,email FROM users WHERE id=? AND email_verified=1").get(req.session.userId);
  res.json({user:user||null});
});


app.get("/api/gallery",(req,res)=>{
  const rows=db.prepare("SELECT id,title,category,size,meta,image_path AS image FROM gallery_images WHERE approved=1 ORDER BY id DESC").all();
  res.json({images:rows});
});

app.get("/api/lives",(req,res)=>{
  const rows=db.prepare("SELECT id,name,twitch_channel FROM live_channels WHERE active=1 ORDER BY id ASC").all();
  res.json({lives:rows});
});

function adminHash(password, salt){
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function ensureAdminAccount(username, role, password){
  const existing=db.prepare("SELECT id FROM admin_users WHERE username=?").get(username);
  const salt=crypto.randomBytes(16).toString("hex");
  const passwordHash=adminHash(password,salt);
  if(existing){
    // Keep the requested initial credentials synchronized for this private build.
    db.prepare("UPDATE admin_users SET role=?, password_hash=?, password_salt=? WHERE id=?")
      .run(role,passwordHash,salt,existing.id);
    return;
  }
  db.prepare("INSERT INTO admin_users(username,role,password_hash,password_salt) VALUES(?,?,?,?)")
    .run(username,role,passwordHash,salt);
}
function seedAdmins(){
  // Initial credentials requested for this local/private build.
  // Change them in production and/or delete these defaults after first startup.
  ensureAdminAccount("viewelvalghar@gmail.com","founder","youyouminecraft");
  ensureAdminAccount("LeRoutier87@gmail.com","developer","200187");
}
seedAdmins();

function seedGallery(){
  const count=db.prepare("SELECT COUNT(*) AS n FROM gallery_images").get().n;
  if(count>0) return;
  const images=[
    ["Paysage Minecraft","Paysages","large","4096 × 2160","assets/landscape.jpg"],
    ["Build — Château","Builds","large","2560 × 1440","assets/castle.jpg"],
    ["Intérieur","Créations","medium","1920 × 1080","assets/interior.jpg"],
    ["Skin","Skins","medium","1024 × 1024","assets/skin.jpg"],
    ["Biome","Paysages","large","2560 × 1440","assets/biome.jpg"],
    ["Build — Île volante","Builds","large","4096 × 2304","assets/island.jpg"],
    ["Village","Créations","medium","1920 × 1080","assets/village.jpg"],
    ["Texture","Textures","small","128 × 128","assets/diamond.jpg"]
  ];
  const ins=db.prepare("INSERT INTO gallery_images(title,category,size,meta,image_path,approved) VALUES(?,?,?,?,?,1)");
  const tx=db.transaction(()=>images.forEach(x=>ins.run(...x))); tx();
}
function seedLives(){
  const row=db.prepare("SELECT id FROM live_channels WHERE twitch_channel=?").get("viewel_valghar");
  if(!row) db.prepare("INSERT INTO live_channels(name,twitch_channel,active) VALUES(?,?,1)").run("Viewel_Valghar","viewel_valghar");
}
seedGallery();
seedLives();

function requireAdmin(req,res,next){
  if(!req.session.adminId) return res.status(401).json({error:"Accès administrateur requis."});
  const admin=db.prepare("SELECT id,username,role FROM admin_users WHERE id=?").get(req.session.adminId);
  if(!admin) return res.status(401).json({error:"Session administrateur invalide."});
  req.admin=admin; next();
}
function requireFounder(req,res,next){
  if(req.admin?.role!=="founder") return res.status(403).json({error:"Cette action est réservée à la Fondatrice."});
  next();
}

app.post("/api/admin/login",(req,res)=>{
  const username=clean(req.body.username);
  const password=String(req.body.password||"");
  const admin=db.prepare("SELECT id,username,role,password_hash,password_salt FROM admin_users WHERE username=?").get(username);
  if(!admin || adminHash(password,admin.password_salt)!==admin.password_hash)
    return res.status(401).json({error:"Identifiants administrateur incorrects."});
  req.session.adminId=admin.id;
  res.json({ok:true,admin:{id:admin.id,username:admin.username,role:admin.role}});
});
app.post("/api/admin/logout",(req,res)=>{
  req.session.adminId=null;
  res.json({ok:true});
});
app.get("/api/admin/me",(req,res)=>{
  if(!req.session.adminId) return res.json({admin:null});
  const admin=db.prepare("SELECT id,username,role,created_at FROM admin_users WHERE id=?").get(req.session.adminId);
  res.json({admin:admin||null});
});
app.get("/api/admin/gallery",requireAdmin,(req,res)=>{
  res.json({images:db.prepare("SELECT * FROM gallery_images ORDER BY approved ASC, id DESC").all()});
});

app.post("/api/admin/gallery",requireAdmin,(req,res)=>{
  const dataUrl=clean(req.body.imageData);
  const originalName=clean(req.body.fileName)||"image";
  const match=dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!match) return res.status(400).json({error:"Choisis une image PNG, JPG ou WEBP valide."});
  const buffer=Buffer.from(match[2],"base64");
  if(buffer.length>8*1024*1024) return res.status(400).json({error:"L'image dépasse 8 Mo."});
  const ext=match[1]==="image/png"?".png":match[1]==="image/webp"?".webp":".jpg";
  const filename=`${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`;
  require("fs").writeFileSync(path.join(uploadsDir,filename),buffer);
  const title=clean(req.body.title)||originalName.replace(/\.[^.]+$/," ").trim();
  const category=clean(req.body.category)||"Créations";
  const size=clean(req.body.size)||"medium";
  const meta=clean(req.body.meta)||"";
  const r=db.prepare("INSERT INTO gallery_images(title,category,size,meta,image_path,approved) VALUES(?,?,?,?,?,0)").run(title,category,size,meta,"/uploads/"+filename);
  res.json({ok:true,id:r.lastInsertRowid,message:"Image envoyée. Elle est maintenant en attente de validation."});
});

app.post("/api/admin/gallery/:id/approve",requireAdmin,requireFounder,(req,res)=>{
  db.prepare("UPDATE gallery_images SET approved=1 WHERE id=?").run(req.params.id);
  res.json({ok:true});
});
app.delete("/api/admin/gallery/:id",requireAdmin,requireFounder,(req,res)=>{
  const row=db.prepare("SELECT image_path FROM gallery_images WHERE id=?").get(req.params.id);
  if(!row) return res.status(404).json({error:"Image introuvable."});
  if(row.image_path.startsWith("/uploads/")){ try{ require("fs").unlinkSync(path.join(uploadsDir,row.image_path.replace("/uploads/",""))); }catch{} }
  db.prepare("DELETE FROM gallery_images WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("/api/admin/lives",requireAdmin,(req,res)=>{
  res.json({lives:db.prepare("SELECT * FROM live_channels ORDER BY id DESC").all()});
});
app.post("/api/admin/lives",requireAdmin,(req,res)=>{
  const name=clean(req.body.name);
  const channel=clean(req.body.twitch_channel).toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//,"").replace(/\/.*$/," ").trim();
  if(!name || !/^[a-z0-9_]+$/.test(channel)) return res.status(400).json({error:"Nom ou chaîne Twitch invalide."});
  try{const r=db.prepare("INSERT INTO live_channels(name,twitch_channel,active) VALUES(?,?,1)").run(name,channel);res.json({ok:true,id:r.lastInsertRowid});}
  catch(e){res.status(409).json({error:"Cette chaîne Twitch est déjà ajoutée."});}
});
app.delete("/api/admin/lives/:id",requireAdmin,(req,res)=>{db.prepare("DELETE FROM live_channels WHERE id=?").run(req.params.id);res.json({ok:true});});

app.get("/api/admin/stats",requireAdmin,(req,res)=>{
  const users=db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const verified=db.prepare("SELECT COUNT(*) AS n FROM users WHERE email_verified=1").get().n;
  const admins=db.prepare("SELECT COUNT(*) AS n FROM admin_users").get().n;
  res.json({users,verified,admins,role:req.admin.role});
});
app.get("/api/admin/users",requireAdmin,requireFounder,(req,res)=>{
  const users=db.prepare("SELECT id,email,email_verified,created_at FROM users ORDER BY id DESC").all();
  res.json({users});
});
app.delete("/api/admin/users/:id",requireAdmin,requireFounder,(req,res)=>{
  const id=Number(req.params.id);
  db.prepare("DELETE FROM users WHERE id=?").run(id);
  res.json({ok:true});
});

app.listen(PORT,()=>console.log(`Valgharie lancé sur ${BASE_URL}`));
