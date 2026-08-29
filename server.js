// server.js
// API REST com persistência SQLite + sessões simples (tokens) e controle de permissões.
// Requisitos: Node 18+, dependências em package.json.

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.sqlite');
const PORT = process.env.PORT || 3000;

(async () => {
  // abrir DB
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // criar diretórios e tabelas se necessário
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      turma TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT,
      turma TEXT NOT NULL DEFAULT 'all',
      roles TEXT NOT NULL -- JSON array
    );
    CREATE TABLE IF NOT EXISTS comunicados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      turma TEXT NOT NULL DEFAULT 'all',
      roles TEXT NOT NULL -- JSON array
    );
  `);

  // seed users (se estiver vazio)
  const row = await db.get('SELECT COUNT(1) AS cnt FROM users');
  if (row && row.cnt === 0) {
    const seed = [
      { username:'pedro', password:'1234', name:'Pedro', role:'aluno', turma:'8B' },
      { username:'maria', password:'prof123', name:'Maria', role:'professor', turma:'8B' },
      { username:'admin', password:'admin', name:'Administrador', role:'admin', turma:'all' }
    ];
    for (const u of seed) {
      const hash = await bcrypt.hash(u.password, 10);
      await db.run(
        'INSERT INTO users(username, password, name, role, turma) VALUES(?,?,?,?,?)',
        [u.username, hash, u.name, u.role, u.turma]
      );
    }
    // seed events
    const seedEvents = [
      { title:"Reunião com pais", date:"2026-09-10", time:"19:00", type:"meeting", detail:"Auditório", turma:"all", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Palestra: Robótica", date:"2026-09-12", time:"14:00", type:"lecture", detail:"Sala 101", turma:"8B", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Prova de Matemática", date:"2026-09-15", time:"09:00", type:"test", detail:"Sala 7B", turma:"8A", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Entrega de tarefa História", date:"2026-09-04", time:"23:59", type:"homework", detail:"Online", turma:"8B", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Reunião de equipe", date:"2026-09-03", time:"08:30", type:"meeting", detail:"Sala dos professores", turma:"all", roles:JSON.stringify(['professor','admin']) }
    ];
    for (const e of seedEvents) {
      await db.run('INSERT INTO events(title,date,time,type,detail,turma,roles) VALUES(?,?,?,?,?,?,?)',
        [e.title,e.date,e.time,e.type,e.detail,e.turma,e.roles]);
    }

    const seedCom = [
      { title:"Reunião de pais", text:"Reunião com os responsáveis na próxima quinta, às 19:00 — sala multimídia.", turma:"all", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Palestra sobre robótica", text:"Alunos do clube de robótica apresentarão projetos na sexta.", turma:"8B", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Entrega de materiais", text:"Materiais do semestre já disponíveis para retirada na secretaria.", turma:"all", roles:JSON.stringify(['aluno','professor','admin']) },
      { title:"Relatório Pedagógico", text:"Relatório disponível somente para docente e coordenação.", turma:"all", roles:JSON.stringify(['professor','admin']) }
    ];
    for (const c of seedCom) {
      await db.run('INSERT INTO comunicados(title,text,turma,roles) VALUES(?,?,?,?)',[c.title,c.text,c.turma,c.roles]);
    }
    console.log('Seed inicial inserido.');
  }

  // helpers
  function genToken(){ return randomBytes(20).toString('hex'); }
  async function authFromHeader(req){
    const h = req.headers.authorization;
    if(!h) return null;
    const parts = h.split(' ');
    if(parts.length !== 2) return null;
    const token = parts[1];
    const s = await db.get('SELECT username FROM sessions WHERE token = ?', [token]);
    if(!s) return null;
    const user = await db.get('SELECT username, name, role, turma FROM users WHERE username = ?', [s.username]);
    return user || null;
  }
  function canViewByRole(itemRolesArr, role){
    if(!Array.isArray(itemRolesArr)) return true;
    if(!role) role = 'visitante';
    if(role === 'visitante') return itemRolesArr.includes('aluno') || itemRolesArr.includes('professor') || itemRolesArr.includes('admin');
    return itemRolesArr.includes(role) || itemRolesArr.includes('all');
  }
  function canViewByTurma(itemTurma, selectedTurma){
    if(!itemTurma || itemTurma === 'all') return true;
    if(!selectedTurma || selectedTurma === 'all') return true;
    return itemTurma === selectedTurma;
  }

  // app
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  // servir frontend estático se existir /public
  app.use(express.static(path.join(__dirname, 'public')));

  // --- endpoints ---

  app.get('/api/health', async (req,res) => res.json({ ok:true, now: new Date().toISOString() }));

  // login
  app.post('/api/login', async (req,res) => {
    const { username, password } = req.body || {};
    if(!username || !password) return res.status(400).json({ error:'username e password são obrigatórios' });
    const u = await db.get('SELECT username,password,name,role,turma FROM users WHERE username = ?', [username]);
    if(!u) return res.status(401).json({ error:'Credenciais inválidas' });
    const ok = await bcrypt.compare(password, u.password);
    if(!ok) return res.status(401).json({ error:'Credenciais inválidas' });

    const token = genToken();
    await db.run('INSERT INTO sessions(token,username,createdAt) VALUES(?,?,?)',[token,u.username,Date.now()]);
    const safe = { username:u.username, name:u.name, role:u.role, turma:u.turma };
    res.json({ token, user: safe });
  });

  // logout
  app.post('/api/logout', async (req,res) => {
    const auth = (req.headers.authorization || '').split(' ')[1];
    if(auth) await db.run('DELETE FROM sessions WHERE token = ?', [auth]);
    res.json({ ok:true });
  });

  // me
  app.get('/api/me', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Não autenticado' });
    res.json({ user });
  });

  // list events (filtros)
  app.get('/api/events', async (req,res) => {
    const user = await authFromHeader(req);
    const role = user ? user.role : 'visitante';
    const turma = req.query.turma || 'all';
    const q = (req.query.q || '').toLowerCase();

    const rows = await db.all('SELECT * FROM events ORDER BY date, time');
    const filtered = rows.filter(r => {
      const roles = JSON.parse(r.roles || '[]');
      if(!canViewByRole(roles, role)) return false;
      if(!canViewByTurma(r.turma, turma)) return false;
      if(q){
        const hay = (r.title + ' ' + (r.detail||'') + ' ' + r.type).toLowerCase();
        if(!hay.includes(q)) return false;
      }
      // convert roles JSON to array in response
      r.roles = roles;
      return true;
    });
    res.json({ events: filtered });
  });

  // get single event
  app.get('/api/events/:id', async (req,res) => {
    const id = req.params.id;
    const row = await db.get('SELECT * FROM events WHERE id = ?', [id]);
    if(!row) return res.status(404).json({ error:'Evento não encontrado' });
    row.roles = JSON.parse(row.roles || '[]');
    res.json({ event: row });
  });

  // create event (professor/admin)
  app.post('/api/events', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Autentique-se' });
    if(!(user.role === 'professor' || user.role === 'admin')) return res.status(403).json({ error:'Permissão negada' });

    const { title, date, time, type='other', detail='', turma='all', roles=['aluno','professor','admin'] } = req.body || {};
    if(!title || !date || !time) return res.status(400).json({ error:'title, date e time são obrigatórios' });

    const result = await db.run(
      'INSERT INTO events(title,date,time,type,detail,turma,roles) VALUES(?,?,?,?,?,?,?)',
      [title, date, time, type, detail, turma, JSON.stringify(roles)]
    );
    const ev = await db.get('SELECT * FROM events WHERE id = ?', [result.lastID]);
    ev.roles = JSON.parse(ev.roles || '[]');
    res.status(201).json({ event: ev });
  });

  // update event (professor/admin)
  app.put('/api/events/:id', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Autentique-se' });
    if(!(user.role === 'professor' || user.role === 'admin')) return res.status(403).json({ error:'Permissão negada' });

    const id = req.params.id;
    const existing = await db.get('SELECT * FROM events WHERE id = ?', [id]);
    if(!existing) return res.status(404).json({ error:'Evento não encontrado' });

    const { title, date, time, type, detail, turma, roles } = req.body || {};
    await db.run(
      'UPDATE events SET title = ?, date = ?, time = ?, type = ?, detail = ?, turma = ?, roles = ? WHERE id = ?',
      [
        title || existing.title,
        date || existing.date,
        time || existing.time,
        type || existing.type,
        detail || existing.detail,
        turma || existing.turma,
        roles ? JSON.stringify(roles) : existing.roles,
        id
      ]
    );
    const ev = await db.get('SELECT * FROM events WHERE id = ?', [id]);
    ev.roles = JSON.parse(ev.roles || '[]');
    res.json({ event: ev });
  });

  // delete event
  app.delete('/api/events/:id', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Autentique-se' });
    if(!(user.role === 'professor' || user.role === 'admin')) return res.status(403).json({ error:'Permissão negada' });

    const id = req.params.id;
    await db.run('DELETE FROM events WHERE id = ?', [id]);
    res.json({ ok:true });
  });

  // comunicados list
  app.get('/api/comunicados', async (req,res) => {
    const user = await authFromHeader(req);
    const role = user ? user.role : 'visitante';
    const turma = req.query.turma || 'all';
    const q = (req.query.q || '').toLowerCase();

    const rows = await db.all('SELECT * FROM comunicados ORDER BY id DESC');
    const filtered = rows.filter(r => {
      const roles = JSON.parse(r.roles || '[]');
      if(!canViewByRole(roles, role)) return false;
      if(!canViewByTurma(r.turma, turma)) return false;
      if(q){
        const hay = (r.title + ' ' + r.text).toLowerCase();
        if(!hay.includes(q)) return false;
      }
      r.roles = roles;
      return true;
    });
    res.json({ comunicados: filtered });
  });

  // create comunicado (prof/admin)
  app.post('/api/comunicados', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Autentique-se' });
    if(!(user.role === 'professor' || user.role === 'admin')) return res.status(403).json({ error:'Permissão negada' });

    const { title, text, turma='all', roles=['aluno','professor','admin'] } = req.body || {};
    if(!title || !text) return res.status(400).json({ error:'title e text são obrigatórios' });
    const result = await db.run('INSERT INTO comunicados(title,text,turma,roles) VALUES(?,?,?,?)', [title,text,turma,JSON.stringify(roles)]);
    const com = await db.get('SELECT * FROM comunicados WHERE id = ?', [result.lastID]);
    com.roles = JSON.parse(com.roles || '[]');
    res.status(201).json({ comunicado: com });
  });

  // update comunicado
  app.put('/api/comunicados/:id', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Autentique-se' });
    if(!(user.role === 'professor' || user.role === 'admin')) return res.status(403).json({ error:'Permissão negada' });

    const id = req.params.id;
    const existing = await db.get('SELECT * FROM comunicados WHERE id = ?', [id]);
    if(!existing) return res.status(404).json({ error:'Comunicado não encontrado' });

    const { title, text, turma, roles } = req.body || {};
    await db.run('UPDATE comunicados SET title = ?, text = ?, turma = ?, roles = ? WHERE id = ?',
      [title || existing.title, text || existing.text, turma || existing.turma, roles ? JSON.stringify(roles) : existing.roles, id]);
    const com = await db.get('SELECT * FROM comunicados WHERE id = ?', [id]);
    com.roles = JSON.parse(com.roles || '[]');
    res.json({ comunicado: com });
  });

  // delete comunicado
  app.delete('/api/comunicados/:id', async (req,res) => {
    const user = await authFromHeader(req);
    if(!user) return res.status(401).json({ error:'Autentique-se' });
    if(!(user.role === 'professor' || user.role === 'admin')) return res.status(403).json({ error:'Permissão negada' });

    const id = req.params.id;
    await db.run('DELETE FROM comunicados WHERE id = ?', [id]);
    res.json({ ok:true });
  });

  // fallback: serve index.html for SPA routes (optional)
  app.get('*', (req,res) => {
    const p = path.join(__dirname, 'public', 'index.html');
    res.sendFile(p);
  });

  app.listen(PORT, () => {
    console.log(`API rodando em http://localhost:${PORT}`);
  });
})();
