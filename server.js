const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "ma-store.db");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('perfume','fabric')),
 price INTEGER NOT NULL CHECK(price >= 0), family TEXT, size TEXT, notes TEXT, fabric_type TEXT, color TEXT,
 description TEXT NOT NULL, image TEXT NOT NULL, tag TEXT DEFAULT '', stock INTEGER NOT NULL DEFAULT 20,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, address TEXT NOT NULL, city TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id), subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL, product_name TEXT NOT NULL, unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscribers(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const seed = require("./seed.json");
const count = db.prepare("SELECT COUNT(*) n FROM products").get().n;
if (!count) {
  const insert = db.prepare(`INSERT INTO products(id,name,category,price,family,size,notes,fabric_type,color,description,image,tag,stock)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(rows => rows.forEach(p => insert.run(
    p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9],p[10],p[11],25
  )));
  tx(seed);
}
const adminCount = db.prepare("SELECT COUNT(*) n FROM admins").get().n;
if (!adminCount) {
  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(username,bcrypt.hashSync(password,12));
  console.log(`Initial admin created: ${username}. Change ADMIN_PASSWORD before public deployment.`);
}

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:false}));
app.use(session({
  name:"ma.sid",
  secret:process.env.SESSION_SECRET || "development-only-change-this-session-secret",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:8*60*60*1000}
}));
app.use(express.static(path.join(__dirname,"public")));

const publicProduct = p => ({...p,active:!!p.active});
const listProducts = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY created_at DESC, name");
app.get("/api/health",(req,res)=>res.json({ok:true,service:"MA storefront API"}));
app.get("/api/products",(req,res)=>{
  const {category,search,sort="featured",min,max,family,fabric}=req.query;
  let rows=db.prepare("SELECT * FROM products WHERE active=1").all();
  if(category && ["perfume","fabric"].includes(category)) rows=rows.filter(p=>p.category===category);
  if(search) {const s=String(search).toLowerCase();rows=rows.filter(p=>(p.name+" "+p.description+" "+(p.family||"")+" "+(p.fabric_type||"")).toLowerCase().includes(s));}
  if(min) rows=rows.filter(p=>p.price>=Number(min));
  if(max) rows=rows.filter(p=>p.price<=Number(max));
  if(family) rows=rows.filter(p=>(p.family||"").toLowerCase()===String(family).toLowerCase());
  if(fabric) rows=rows.filter(p=>(p.fabric_type||"").toLowerCase()===String(fabric).toLowerCase());
  if(sort==="price-asc") rows.sort((a,b)=>a.price-b.price);
  if(sort==="price-desc") rows.sort((a,b)=>b.price-a.price);
  if(sort==="name") rows.sort((a,b)=>a.name.localeCompare(b.name));
  res.json(rows.map(publicProduct));
});
app.get("/api/products/:id",(req,res)=>{
  const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);
  if(!p)return res.status(404).json({error:"Product not found"});
  res.json(publicProduct(p));
});
app.post("/api/orders",(req,res)=>{
  const {name,phone,email,address,city,items,paymentMethod}=req.body||{};
  if(!name||!phone||!address||!city||!Array.isArray(items)||!items.length) return res.status(400).json({error:"Please complete all required fields and add at least one item."});
  if(String(name).length>120||String(phone).length>30||String(address).length>500||String(city).length>100) return res.status(400).json({error:"One or more fields are too long."});
  const normalized=items.map(i=>({id:String(i.id),qty:Number(i.quantity)}));
  if(normalized.some(i=>!Number.isInteger(i.qty)||i.qty<1||i.qty>20)) return res.status(400).json({error:"Invalid item quantity."});
  const orderTx=db.transaction(()=>{
    const lines=[];let subtotal=0;
    for(const item of normalized){
      const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(item.id);
      if(!p) throw new Error("A selected product is no longer available.");
      if(p.stock<item.qty) throw new Error(`${p.name} does not have enough stock.`);
      lines.push({p,qty:item.qty});subtotal+=p.price*item.qty;
    }
    const customer=db.prepare("INSERT INTO customers(name,phone,email,address,city) VALUES(?,?,?,?,?)").run(String(name).trim(),String(phone).trim(),email?String(email).trim():null,String(address).trim(),String(city).trim());
    const orderNumber="MA-"+Date.now().toString().slice(-8)+"-"+Math.floor(Math.random()*90+10);
    const order=db.prepare("INSERT INTO orders(order_number,customer_id,subtotal,shipping,total,payment_method) VALUES(?,?,?,?,?,?)").run(orderNumber,customer.lastInsertRowid,subtotal,0,subtotal,paymentMethod==="Cash on Delivery"?"Cash on Delivery":"Cash on Delivery");
    const addLine=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES(?,?,?,?,?)");
    const updateStock=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
    lines.forEach(({p,qty})=>{addLine.run(order.lastInsertRowid,p.id,p.name,p.price,qty);updateStock.run(qty,p.id);});
    return {orderNumber,total:subtotal};
  });
  try{res.status(201).json(orderTx());}catch(e){res.status(400).json({error:e.message||"Could not create order."});}
});
app.post("/api/newsletter",(req,res)=>{
  const email=String(req.body.email||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Enter a valid email address."});
  try{db.prepare("INSERT INTO subscribers(email) VALUES(?)").run(email);res.status(201).json({message:"You're on the list."});}
  catch(e){if(String(e).includes("UNIQUE"))return res.json({message:"This email is already subscribed."});res.status(500).json({error:"Subscription could not be saved."});}
});

function requireAdmin(req,res,next){if(!req.session.admin)return res.status(401).json({error:"Admin login required."});next();}
app.post("/api/admin/login",(req,res)=>{
  const {username,password}=req.body||{};
  const admin=db.prepare("SELECT * FROM admins WHERE username=?").get(String(username||""));
  if(!admin||!bcrypt.compareSync(String(password||""),admin.password_hash))return res.status(401).json({error:"Incorrect username or password."});
  req.session.admin={id:admin.id,username:admin.username};res.json({username:admin.username});
});
app.post("/api/admin/logout",requireAdmin,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",(req,res)=>res.json({admin:req.session.admin||null}));
app.get("/api/admin/dashboard",requireAdmin,(req,res)=>{
  const products=db.prepare("SELECT COUNT(*) n FROM products").get().n;
  const orders=db.prepare("SELECT COUNT(*) n FROM orders").get().n;
  const pending=db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Pending'").get().n;
  const revenue=db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='Cancelled'").get().n;
  const lowStock=db.prepare("SELECT COUNT(*) n FROM products WHERE stock<=5 AND active=1").get().n;
  res.json({products,orders,pending,revenue,lowStock});
});
app.get("/api/admin/products",requireAdmin,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY created_at DESC,name").all()));
app.post("/api/admin/products",requireAdmin,(req,res)=>{
  const p=req.body||{};
  if(!p.id||!p.name||!["perfume","fabric"].includes(p.category)||!Number.isFinite(Number(p.price))||!p.description||!p.image)return res.status(400).json({error:"ID, name, category, price, description and image are required."});
  try{
    db.prepare(`INSERT INTO products(id,name,category,price,family,size,notes,fabric_type,color,description,image,tag,stock,active)
      VALUES(@id,@name,@category,@price,@family,@size,@notes,@fabric_type,@color,@description,@image,@tag,@stock,1)`).run({...p,price:Number(p.price),stock:Number(p.stock??0)});
    res.status(201).json({ok:true});
  }catch(e){res.status(400).json({error:"Could not save product. Check unique ID and values."});}
});
app.put("/api/admin/products/:id",requireAdmin,(req,res)=>{
  const p=req.body||{};
  const existing=db.prepare("SELECT id FROM products WHERE id=?").get(req.params.id);
  if(!existing)return res.status(404).json({error:"Product not found."});
  const fields=["name","category","price","family","size","notes","fabric_type","color","description","image","tag","stock","active"];
  const set=fields.filter(k=>p[k]!==undefined).map(k=>`${k}=@${k}`).join(",");
  if(!set)return res.json({ok:true});
  const data={id:req.params.id};fields.forEach(k=>{if(p[k]!==undefined)data[k]=p[k]});
  db.prepare(`UPDATE products SET ${set} WHERE id=@id`).run(data);res.json({ok:true});
});
app.delete("/api/admin/products/:id",requireAdmin,(req,res)=>{
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id);res.json({ok:true});
});
app.get("/api/admin/orders",requireAdmin,(req,res)=>{
  const orders=db.prepare(`SELECT o.*,c.name,c.phone,c.email,c.address,c.city FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC`).all();
  const items=db.prepare("SELECT * FROM order_items WHERE order_id=?");
  res.json(orders.map(o=>({...o,items:items.all(o.id)})));
});
app.patch("/api/admin/orders/:id",requireAdmin,(req,res)=>{
  const allowed=["Pending","Confirmed","Packed","Shipped","Delivered","Cancelled"];
  if(!allowed.includes(req.body.status))return res.status(400).json({error:"Invalid order status."});
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,req.params.id);res.json({ok:true});
});
app.get("/api/admin/subscribers",requireAdmin,(req,res)=>res.json(db.prepare("SELECT * FROM subscribers ORDER BY created_at DESC").all()));

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`MA storefront running at http://localhost:${PORT}`));
