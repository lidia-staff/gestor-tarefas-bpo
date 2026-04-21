const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'staffconect_jwt_2024_TROQUE_ISSO';
const DATA = path.join(__dirname, 'data');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── ARMAZENAMENTO JSON ──────────────────────────────
fs.mkdirSync(path.join(DATA, 'day_tasks'), { recursive: true });

const read  = (file, def) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); };

const DB = {
  users:        ()         => read(path.join(DATA, 'users.json'), []),
  saveUsers:    d          => write(path.join(DATA, 'users.json'), d),
  clients:      ()         => read(path.join(DATA, 'clients.json'), []),
  saveClients:  d          => write(path.join(DATA, 'clients.json'), d),
  dayTasks:     date       => read(path.join(DATA, 'day_tasks', `${date}.json`), {}),
  saveDayTasks: (date, d)  => write(path.join(DATA, 'day_tasks', `${date}.json`), d),
  extraTasks:   ()         => read(path.join(DATA, 'extra_tasks.json'), []),
  saveExtra:    d          => write(path.join(DATA, 'extra_tasks.json'), d),
};

// Popula clientes padrão se banco estiver vazio
if (DB.clients().length === 0) {
  DB.saveClients([
    { id:'kimberly',    name:'Kimberly',    priority:1,  banks:['Asaas','Sicredi'],            whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'up',          name:'UP',          priority:2,  banks:['Bradesco','Stone'],            whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'agro',        name:'Agro',        priority:3,  banks:['Sicoob'],                      whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'jsa',         name:'JSA',         priority:4,  banks:['Sicoob'],                      whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'body',        name:'Body Face',   priority:5,  banks:['Asaas','Stone'],               whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'guimoo',      name:'Guimoo',      priority:6,  banks:['Cora','Asaas'],                whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'galiza',      name:'Galiza',      priority:7,  banks:['Bradesco','Cora'],             whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'matsu',       name:'Matsu',       priority:8,  banks:['Itaú'],                        whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'ecofi',       name:'Ecofi',       priority:9,  banks:['Bradesco','Itaú'],             whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
    { id:'makinsthall', name:'Makinsthall', priority:10, banks:['Santander','Itaú','Bradesco'], whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[] },
  ]);
}

// ─── MIDDLEWARE AUTH ─────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Sessão expirada, faça login novamente' }); }
}

// ─── AUTH ────────────────────────────────────────────
app.get('/api/auth/setup', (req, res) => {
  res.json({ needsSetup: DB.users().length === 0 });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
  const user = DB.users().find(u => u.email === email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  const token = jwt.sign({ id:user.id, name:user.name, email:user.email, role:user.role }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user: { id:user.id, name:user.name, email:user.email, role:user.role } });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres' });

  const users = DB.users();
  if (users.length > 0) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ error: 'Apenas admins podem adicionar operadores' });
    try { const d = jwt.verify(token, JWT_SECRET); if (d.role !== 'admin') throw new Error(); }
    catch { return res.status(403).json({ error: 'Apenas admins podem adicionar operadores' }); }
  }

  const emailNorm = email.toLowerCase().trim();
  if (users.find(u => u.email === emailNorm)) return res.status(400).json({ error: 'E-mail já cadastrado' });

  const role = users.length === 0 ? 'admin' : 'operator';
  const newUser = { id: Date.now(), name, email: emailNorm, password_hash: bcrypt.hashSync(password, 10), role };
  DB.saveUsers([...users, newUser]);

  const token = jwt.sign({ id:newUser.id, name, email:emailNorm, role }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user: { id:newUser.id, name, email:emailNorm, role } });
});

// ─── CLIENTES ────────────────────────────────────────
app.get('/api/clients', auth, (req, res) => {
  res.json(DB.clients().sort((a, b) => a.priority - b.priority));
});

app.put('/api/clients/:id', auth, (req, res) => {
  const clients = DB.clients().map(c => c.id === req.params.id ? { ...c, ...req.body, id: c.id } : c);
  DB.saveClients(clients);
  res.json({ ok: true });
});

// ─── TAREFAS DO DIA ──────────────────────────────────
app.get('/api/day-tasks/:date', auth, (req, res) => {
  res.json(DB.dayTasks(req.params.date));
});

app.put('/api/day-tasks/:date/:clientId', auth, (req, res) => {
  const tasks = DB.dayTasks(req.params.date);
  tasks[req.params.clientId] = req.body;
  DB.saveDayTasks(req.params.date, tasks);
  res.json({ ok: true });
});

// ─── TAREFAS EXTRAS ──────────────────────────────────
app.get('/api/extra-tasks', auth, (req, res) => {
  res.json(DB.extraTasks().sort((a, b) => b.created_at - a.created_at));
});

app.post('/api/extra-tasks', auth, (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
  const task = { id: Date.now(), ...req.body, status: 'pending', created_at: new Date().toISOString(), done_at: null };
  DB.saveExtra([task, ...DB.extraTasks()]);
  res.json(task);
});

app.put('/api/extra-tasks/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  DB.saveExtra(DB.extraTasks().map(t => t.id === id ? { ...t, ...req.body } : t));
  res.json({ ok: true });
});

// ─── OPERADORES ──────────────────────────────────────
app.get('/api/operators', auth, (req, res) => {
  res.json(DB.users().map(u => ({ id:u.id, name:u.name, email:u.email, role:u.role })));
});

app.delete('/api/operators/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).json({ error: 'Não pode remover a si mesmo' });
  DB.saveUsers(DB.users().filter(u => u.id !== id));
  res.json({ ok: true });
});

// ─── SPA FALLBACK ────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Gestor de Tarefas rodando em http://localhost:${PORT}`);
  console.log(`  Primeiro acesso: crie sua conta em http://localhost:${PORT}\n`);
});
