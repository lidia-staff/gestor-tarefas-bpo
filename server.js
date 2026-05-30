const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'staffconect_jwt_2024_TROQUE_ISSO';
const DATA = path.join(__dirname, 'data');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── ARMAZENAMENTO JSON ──────────────────────────────
fs.mkdirSync(path.join(DATA, 'day_tasks'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'contas'), { recursive: true });

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
  manuals:      ()         => read(path.join(DATA, 'manuals.json'), []),
  saveManuals:  d          => write(path.join(DATA, 'manuals.json'), d),
  chat:         ()         => read(path.join(DATA, 'chat.json'), []),
  saveChat:     d          => write(path.join(DATA, 'chat.json'), d),
  contas:       ym         => read(path.join(DATA, 'contas', `${ym}.json`), {}),
  saveContas:   (ym, d)    => write(path.join(DATA, 'contas', `${ym}.json`), d),
  mensagens:    ()         => read(path.join(DATA, 'mensagens.json'), []),
  saveMensagens:d          => write(path.join(DATA, 'mensagens.json'), d),
  emailNotifs:        ()   => read(path.join(DATA, 'email_notifs.json'), []),
  saveEmailNotifs:    d    => write(path.join(DATA, 'email_notifs.json'), d),
  intakeLancamentos:  ()   => read(path.join(DATA, 'intake_lancamentos.json'), []),
  saveIntakeLancamentos: d => write(path.join(DATA, 'intake_lancamentos.json'), d),
};

// ─── FUSO HORÁRIO BRASIL ─────────────────────────────
// Retorna YYYY-MM-DD no horário de Brasília (UTC-3), independente do fuso do servidor
function todayBR(){return new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});}

// ─── FERIADOS E DIAS ÚTEIS ───────────────────────────
function getEaster(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  const mm=String(month).padStart(2,'0'),dd=String(day).padStart(2,'0');
  return `${year}-${mm}-${dd}`;
}
function addDaysISO(iso,n){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function getBrHolidays(year){
  const e=getEaster(year);
  const fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'].map(h=>`${year}-${h}`);
  const variable=[addDaysISO(e,-48),addDaysISO(e,-47),addDaysISO(e,-2),addDaysISO(e,60)];
  return new Set([...fixed,...variable]);
}
function isBusinessDay(dateStr){
  const d=new Date(dateStr+'T12:00:00Z'),dow=d.getUTCDay();
  if(dow===0||dow===6)return false;
  return !getBrHolidays(d.getUTCFullYear()).has(dateStr);
}
function prevBizDay(dateStr){let d=new Date(dateStr+'T12:00:00Z');do{d.setUTCDate(d.getUTCDate()-1);}while(!isBusinessDay(d.toISOString().slice(0,10)));return d.toISOString().slice(0,10);}
function nextBizDay(dateStr){let d=new Date(dateStr+'T12:00:00Z');do{d.setUTCDate(d.getUTCDate()+1);}while(!isBusinessDay(d.toISOString().slice(0,10)));return d.toISOString().slice(0,10);}
function calcNextDue(lastDue,freq){
  let next;
  if(freq==='daily'){next=nextBizDay(lastDue);}
  else if(freq==='weekly'){next=addDaysISO(lastDue,7);if(!isBusinessDay(next))next=prevBizDay(next);}
  else{const d=new Date(lastDue+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);next=d.toISOString().slice(0,10);if(!isBusinessDay(next))next=prevBizDay(next);}
  return next;
}

// ─── TAREFAS RECORRENTES ─────────────────────────────
function generateRecurring(){
  const today=todayBR();
  if(!isBusinessDay(today)){console.log('Hoje não é dia útil — recorrentes suspensas');return;}
  const tasks=DB.extraTasks();
  const toAdd=[];
  tasks.filter(t=>t.recurring&&t.status==='done'&&t.due_date).forEach(t=>{
    let next=t.due_date;
    while(next<today)next=calcNextDue(next,t.frequency||'daily');
    if(next!==today)return;
    const isDup=(arr)=>arr.some(x=>x.recurring&&x.status!=='done'&&x.title===t.title&&String(x.client_id)===String(t.client_id)&&String(x.operator_id)===String(t.operator_id)&&x.due_date===today);
    if(!isDup(tasks)&&!isDup(toAdd)){
      // Arquiva a nota de execução do dia anterior no histórico
      const prevEntry = t.exec_notes?.trim() ? {date:t.due_date, note:t.exec_notes.trim()} : null;
      const history = [...(t.exec_notes_history||[]), ...(prevEntry?[prevEntry]:[])].slice(-60);
      toAdd.push({...t, id:String(Date.now()+Math.random()), status:'pending', due_date:today, done_at:null,
        exec_notes:'', exec_notes_history:history,
        steps:(t.steps||[]).map(s=>({...s,done:false})), createdAt:new Date().toISOString()});
    }
  });
  if(toAdd.length){DB.saveExtra([...tasks,...toAdd]);console.log(`✓ ${toAdd.length} tarefas recorrentes geradas para ${today}`);}
}

// ─── BACKUP AUTOMÁTICO ───────────────────────────────
function runBackup(){
  const today=todayBR();
  const dir=path.join(DATA,'backups',today);
  if(fs.existsSync(dir))return;
  fs.mkdirSync(dir,{recursive:true});
  fs.readdirSync(DATA).filter(f=>f.endsWith('.json')).forEach(f=>fs.copyFileSync(path.join(DATA,f),path.join(dir,f)));
  const dtDir=path.join(DATA,'day_tasks');
  if(fs.existsSync(dtDir)){fs.mkdirSync(path.join(dir,'day_tasks'),{recursive:true});fs.readdirSync(dtDir).slice(-14).forEach(f=>fs.copyFileSync(path.join(dtDir,f),path.join(dir,'day_tasks',f)));}
  // Remove backups com mais de 30 dias
  const bRoot=path.join(DATA,'backups');
  const cutoff=addDaysISO(today,-30);
  fs.readdirSync(bRoot).filter(d=>d<cutoff&&d.match(/^\d{4}-\d{2}-\d{2}$/)).forEach(d=>fs.rmSync(path.join(bRoot,d),{recursive:true,force:true}));
  console.log(`✓ Backup criado: ${dir}`);
}

// ─── LIMPEZA DE IMAGENS DO CHAT ─────────────────────
function cleanChatUploads(){
  const uploadDir=path.join(__dirname,'public','uploads','chat');
  if(!fs.existsSync(uploadDir))return;
  const cutoff=Date.now()-10*24*60*60*1000; // 10 dias em ms
  let removed=0;
  fs.readdirSync(uploadDir).forEach(f=>{
    const fp=path.join(uploadDir,f);
    try{if(fs.statSync(fp).mtimeMs<cutoff){fs.unlinkSync(fp);removed++;}}catch{}
  });
  if(removed>0)console.log(`✓ Limpeza chat: ${removed} imagem(ns) removida(s) (>10 dias)`);
}

// ─── NOTIFICAÇÕES DE ATRASO ──────────────────────────
async function sendOverdueNotifs(){
  // Push de atraso desativado — notificações apenas via chat e e-mail
  const today=todayBR();
  const tasks=DB.extraTasks();
  const overdue=tasks.filter(t=>t.due_date&&t.due_date<today&&t.status!=='done'&&t.operator_id);
  if(overdue.length)console.log(`ℹ Tarefas em atraso: ${overdue.length} (push desativado)`);
}

// ─── RUNNER DIÁRIO ───────────────────────────────────
const LAST_RUN_FILE=path.join(DATA,'last_daily_run.json');
function runDailyJobs(){
  const today=todayBR();
  const last=read(LAST_RUN_FILE,{date:''});
  if(last.date===today)return;
  generateRecurring();
  runBackup();
  cleanChatUploads();
  sendOverdueNotifs();
  write(LAST_RUN_FILE,{date:today,ts:new Date().toISOString()});
  console.log(`✓ Jobs diários executados para ${today}`);
}
// Roda no startup e verifica a cada 30 minutos
runDailyJobs();
setInterval(runDailyJobs,30*60*1000);

// ─── VAPID / PUSH ────────────────────────────────────
const VAPID_FILE = path.join(DATA, 'vapid.json');
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
}
webpush.setVapidDetails('mailto:lidia@staffconsult.com.br', vapidKeys.publicKey, vapidKeys.privateKey);
const getSubs = () => read(path.join(DATA, 'push_subs.json'), {});
const saveSubs = d => write(path.join(DATA, 'push_subs.json'), d);

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
  const { name, email, password, assignedClients } = req.body || {};
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
  const newUser = { id: Date.now(), name, email: emailNorm, password_hash: bcrypt.hashSync(password, 10), role, assignedClients: assignedClients || [] };
  DB.saveUsers([...users, newUser]);

  const token = jwt.sign({ id:newUser.id, name, email:emailNorm, role }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user: { id:newUser.id, name, email:emailNorm, role, assignedClients: newUser.assignedClients } });
});

// ─── CLIENTES ────────────────────────────────────────
app.get('/api/clients', auth, (req, res) => {
  res.json(DB.clients().sort((a, b) => a.priority - b.priority));
});

app.post('/api/clients', auth, (req, res) => {
  const clients = DB.clients();
  const novo = { ...req.body, id: String(Date.now()) };
  DB.saveClients([...clients, novo]);
  res.json(novo);
});

app.put('/api/clients/:id', auth, (req, res) => {
  const clients = DB.clients().map(c => c.id === req.params.id ? { ...c, ...req.body, id: c.id } : c);
  DB.saveClients(clients);
  res.json({ ok: true });
});

// ─── TAREFAS DO DIA ──────────────────────────────────
app.get('/api/day-tasks/history', auth, (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const result = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const date = d.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    const tasks = DB.dayTasks(date);
    if (Object.keys(tasks).length > 0) {
      const clients = DB.clients();
      const entries = Object.entries(tasks).map(([cid, t]) => {
        const client = clients.find(c => String(c.id) === String(cid));
        return { clientId: cid, clientName: client?.name || cid, fullyDone: !!t.fullyDone, b1Status: t.bloco1?.status, b2Active: !!t.bloco2?.active, b2Status: t.bloco2?.status };
      });
      result.push({ date, entries, total: entries.length, done: entries.filter(e => e.fullyDone).length });
    }
  }
  res.json(result);
});

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
  const id = String(req.params.id);
  DB.saveExtra(DB.extraTasks().map(t => String(t.id) === id ? { ...t, ...req.body } : t));
  res.json({ ok: true });
});

// Excluir tarefa — apenas admin
// ?mode=single  → só esta instância
// ?mode=all     → esta + todas recorrentes do mesmo grupo (title+client_id+operator_id)
app.delete('/api/extra-tasks/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = String(req.params.id);
  const mode = req.query.mode || 'single';
  const tasks = DB.extraTasks();
  const target = tasks.find(t => String(t.id) === id);
  if (!target) return res.status(404).json({ error: 'Não encontrada' });
  let remaining;
  if (mode === 'all' && target.recurring) {
    // Remove todas do mesmo grupo recorrente
    remaining = tasks.filter(t =>
      !(t.recurring &&
        t.title === target.title &&
        String(t.client_id||'') === String(target.client_id||'') &&
        String(t.operator_id||'') === String(target.operator_id||''))
    );
  } else {
    remaining = tasks.filter(t => String(t.id) !== id);
  }
  DB.saveExtra(remaining);
  res.json({ ok: true, removed: tasks.length - remaining.length });
});

// ─── OPERADORES ──────────────────────────────────────
app.get('/api/operators', auth, (req, res) => {
  res.json(DB.users().map(u => ({ id:u.id, name:u.name, email:u.email||null, role:u.role, noLogin:!!u.noLogin, assignedClients: u.assignedClients || [] })));
});

// Criar operador sem acesso ao sistema (apenas para delegação de tarefas)
app.post('/api/operators/no-login', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const { name, assignedClients } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  const users = DB.users();
  const newUser = { id: Date.now(), name: name.trim(), email: null, password_hash: null, role: 'operator', noLogin: true, assignedClients: assignedClients || [] };
  DB.saveUsers([...users, newUser]);
  res.json({ ok: true, user: { id:newUser.id, name:newUser.name, noLogin:true } });
});

app.put('/api/operators/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  const { assignedClients } = req.body;
  DB.saveUsers(DB.users().map(u => u.id === id ? { ...u, assignedClients: assignedClients || [] } : u));
  res.json({ ok: true });
});

app.delete('/api/operators/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).json({ error: 'Não pode remover a si mesmo' });
  DB.saveUsers(DB.users().filter(u => u.id !== id));
  res.json({ ok: true });
});

// Seed manuais padrão no banco se ainda não existirem
(function seedManuals() {
  const ex = DB.manuals();
  if (ex.find(m => m.id === 'default_b1')) return;
  DB.saveManuals([
    { id:'default_b1', num:'1', title:'Bloco 1 — Abertura e Conciliação', category:'Rotina Diária', assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Acessar e-mail',detail:"Verificar todos os e-mails. Identificar boletos, NF's e solicitações."},
      {n:2,action:"Salvar boletos e NF's",detail:"Salvar na pasta: NF's e Boletos de Fornecedores. Organizar por data."},
      {n:3,action:'Salvar na pasta do mês',detail:'Garantir que todos os documentos do dia estejam na pasta do mês corrente.'},
      {n:4,action:'Verificar WhatsApp',detail:'Conferir grupo e individual. Anotar solicitações pendentes.'},
      {n:5,action:'Lançar no Conta Azul',detail:'Lançar todas as solicitações de pagamento identificadas.'},
      {n:6,action:'Acessar banco e extratos',detail:'Acessar internet banking. Baixar extrato PDF e OFX do dia.'},
      {n:7,action:'Importar OFX',detail:'Importar o arquivo OFX no Conta Azul para atualizar o fluxo.'},
      {n:8,action:'Conciliação bancária',detail:'Conciliar entradas e saídas. Em caso de dúvida, perguntar no grupo antes de concluir.'},
      {n:9,action:'Salvar conciliação',detail:'Exportar e salvar o arquivo da conciliação na pasta do mês.'},
    ]},
    { id:'default_b2', num:'2', title:'Bloco 2 — Pagamentos', category:'Rotina Diária', assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Conferir contas a pagar',detail:'Verificar no Conta Azul todas as contas com vencimento no dia.'},
      {n:2,action:"Conferir NF's e boletos",detail:"Verificar fisicamente se os boletos e NF's batem com o sistema."},
      {n:3,action:'Conferir DDA',detail:'Verificar o DDA no banco para garantir que não há boletos não cadastrados.'},
      {n:4,action:'Salvar contas a pagar',detail:'Salvar a relação de contas a pagar do dia na pasta do cliente.'},
      {n:5,action:'Agendar pagamentos',detail:'Agendar todos os pagamentos no internet banking. Confirmar cada um.'},
      {n:6,action:'Salvar programação bancária',detail:'Exportar comprovante de agendamento e salvar na pasta.'},
      {n:7,action:'Atualizar saldo bancário',detail:'Atualizar o saldo no Conta Azul após os agendamentos.'},
      {n:8,action:'Enviar rotina ao cliente',detail:'Redigir mensagem de retorno com resumo do feito e enviar ao cliente.'},
    ]},
    ...ex,
  ]);
})();

// ─── TRILHA DO CONHECIMENTO (MANUAIS) ────────────────
app.get('/api/manuals', auth, (req, res) => {
  res.json(DB.manuals());
});

app.post('/api/manuals', auth, (req, res) => {
  const { title, category, steps } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
  const manual = { id: Date.now(), ...req.body, title: title.trim(), category: category || 'Geral', steps: steps || [], createdAt: new Date().toISOString() };
  DB.saveManuals([...DB.manuals(), manual]);
  res.json(manual);
});

app.put('/api/manuals/:id', auth, (req, res) => {
  const raw = req.params.id;
  const id = isNaN(raw) ? raw : Number(raw);
  DB.saveManuals(DB.manuals().map(m => String(m.id) === String(id) ? { ...m, ...req.body, id: m.id } : m));
  res.json({ ok: true });
});

app.delete('/api/manuals/:id', auth, (req, res) => {
  const raw = req.params.id;
  const id = isNaN(raw) ? raw : Number(raw);
  DB.saveManuals(DB.manuals().filter(m => String(m.id) !== String(id)));
  res.json({ ok: true });
});

// ─── CHAT ────────────────────────────────────────────
app.get('/api/chat', auth, (req, res) => {
  const messages = DB.chat();
  const since = req.query.since;
  res.json(since ? messages.filter(m => m.createdAt > since) : messages.slice(-80));
});

app.post('/api/chat', auth, (req, res) => {
  const { text, type, targetOpId, imageUrl, replyToId, replyText, replyUser, source } = req.body;
  if (!text?.trim() && !imageUrl) return res.status(400).json({ error: 'Mensagem vazia' });
  const msg = { id: Date.now(), userId: req.user.id, userName: req.user.name, text: (text||'').trim(), type: type||'user', targetOpId: targetOpId||null, createdAt: new Date().toISOString() };
  if (imageUrl)   msg.imageUrl  = imageUrl;
  if (replyToId)  msg.replyToId = replyToId;
  if (replyText)  msg.replyText = replyText;
  if (replyUser)  msg.replyUser = replyUser;
  if (source)     msg.source    = source;
  const updated = [...DB.chat(), msg].slice(-200);
  DB.saveChat(updated);
  // Push apenas para mensagens reais de usuário direcionadas a um operador
  if(type !== 'system' && targetOpId) {
    const subs = getSubs();
    const sub = subs[String(targetOpId)];
    if(sub) {
      const sender = req.user.name.split(' ')[0];
      webpush.sendNotification(sub, JSON.stringify({
        title: `💬 ${sender}`,
        body: text.trim().replace(/\*/g,'').slice(0, 100),
        tag: 'chat',
      })).catch(err => {
        if(err.statusCode === 410){ const s=getSubs(); delete s[String(targetOpId)]; saveSubs(s); }
      });
    }
  }
  res.json(msg);
});

// ─── CONTAS A PAGAR ──────────────────────────────────
app.get('/api/contas', auth, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'Parâmetros start e end obrigatórios' });
  const result = {};
  const months = new Set();
  const cur = new Date(start + 'T12:00:00');
  const endDate = new Date(end + 'T12:00:00');
  while (cur <= endDate) {
    months.add(cur.toISOString().substring(0, 7));
    cur.setDate(cur.getDate() + 1);
  }
  months.forEach(ym => {
    const data = DB.contas(ym);
    Object.keys(data).forEach(date => { if (date >= start && date <= end) result[date] = data[date]; });
  });
  res.json(result);
});

app.put('/api/contas/:date/:clientId', auth, (req, res) => {
  const { date, clientId } = req.params;
  const ym = date.substring(0, 7);
  const data = DB.contas(ym);
  if (!data[date]) data[date] = {};
  data[date][clientId] = req.body;
  DB.saveContas(ym, data);
  res.json({ ok: true });
});

// ─── MENSAGENS PADRÃO ────────────────────────────────
app.get('/api/mensagens', auth, (req, res) => {
  res.json(DB.mensagens());
});

app.post('/api/mensagens', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const { title, text } = req.body;
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'Título e texto obrigatórios' });
  const msg = { id: Date.now(), title: title.trim(), text: text.trim(), createdAt: new Date().toISOString() };
  DB.saveMensagens([...DB.mensagens(), msg]);
  res.json(msg);
});

app.put('/api/mensagens/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  DB.saveMensagens(DB.mensagens().map(m => m.id === id ? { ...m, ...req.body, id } : m));
  res.json({ ok: true });
});

app.delete('/api/mensagens/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  DB.saveMensagens(DB.mensagens().filter(m => m.id !== id));
  res.json({ ok: true });
});

// Salva array completo de mensagens (para reordenação)
app.put('/api/mensagens', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Array esperado' });
  DB.saveMensagens(list);
  res.json({ ok: true });
});

// ─── EMAIL NOTIFICAÇÕES ──────────────────────────────
app.get('/api/email-notifs', auth, (req, res) => {
  res.json(DB.emailNotifs());
});

app.post('/api/email-notifs', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const notifs = DB.emailNotifs();
  const novo = { ...req.body, id: String(Date.now()), createdAt: new Date().toISOString(), readBy: [] };
  DB.saveEmailNotifs([novo, ...notifs]);
  res.json(novo);
});

app.patch('/api/email-notifs/:id/read', auth, (req, res) => {
  const uid = String(req.user.id);
  const notifs = DB.emailNotifs().map(n =>
    n.id === req.params.id ? { ...n, readBy: [...new Set([...(n.readBy||[]), uid])] } : n
  );
  DB.saveEmailNotifs(notifs);
  res.json({ ok: true });
});

app.delete('/api/email-notifs/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  DB.saveEmailNotifs(DB.emailNotifs().filter(n => n.id !== req.params.id));
  res.json({ ok: true });
});

// Salva array completo de manuais (para reordenação)
app.put('/api/manuals', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Array esperado' });
  DB.saveManuals(list);
  res.json({ ok: true });
});

// ─── PUSH NOTIFICATIONS ──────────────────────────────
app.get('/api/push/vapid-key', auth, (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', auth, (req, res) => {
  const subs = getSubs();
  subs[String(req.user.id)] = req.body;
  saveSubs(subs);
  res.json({ ok: true });
});

app.post('/api/push/notify', auth, (req, res) => {
  const { operatorId, title, body } = req.body;
  const subs = getSubs();
  const sub = subs[String(operatorId)];
  if (!sub) return res.json({ ok: false, reason: 'sem inscrição' });
  webpush.sendNotification(sub, JSON.stringify({ title, body }))
    .then(() => res.json({ ok: true }))
    .catch(err => {
      if (err.statusCode === 410) { const s = getSubs(); delete s[String(operatorId)]; saveSubs(s); }
      res.json({ ok: false, reason: err.message });
    });
});

// ─── WEBHOOK — EMAIL MONITOR ─────────────────────────
// Chamado pelo email_monitor.py do StaffConsult-Bot
// quando chega email novo em uma caixa de cliente.
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET  || 'staffbot_email_2024';
const CA_API_URL      = process.env.CA_API_URL      || 'https://app.staffconsult.com.br';
const CA_API_SECRET   = process.env.CA_API_SECRET   || 'staffbot_email_2024';

app.post('/api/webhook/email-notify', (req, res) => {
  const { secret, cliente, cliente_id, remetente, assunto, data_recebido } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Não autorizado' });

  const users   = DB.users();
  const clients = DB.clients();

  // Localiza o cliente no Staff Conect pelo id ou nome
  const client = clients.find(c =>
    String(c.id) === String(cliente_id) ||
    c.name.toLowerCase() === (cliente || '').toLowerCase()
  );

  // Localiza o operador designado ao cliente
  const operator = client
    ? users.find(u => !u.noLogin && (u.assignedClients || []).map(String).includes(String(client.id)))
    : null;

  // 1. Cria tarefa extra
  const task = {
    id: Date.now(),
    title: `📧 Email recebido — ${cliente}`,
    description: `De: ${remetente}\nAssunto: ${assunto}\nRecebido: ${data_recebido}`,
    status: 'pending',
    client_id: client?.id || null,
    operator_id: operator?.id || null,
    priority: 'high',
    source: 'email_monitor',
    created_at: new Date().toISOString(),
    done_at: null,
    steps: [],
  };
  DB.saveExtra([task, ...DB.extraTasks()]);

  // 2. Push notification para o operador (se inscrito)
  if (operator) {
    const subs = getSubs();
    const sub  = subs[String(operator.id)];
    if (sub) {
      webpush.sendNotification(sub, JSON.stringify({
        title: `📧 Email — ${cliente}`,
        body:  `De: ${remetente}\n${assunto}`,
      })).catch(() => {});
    }
  }

  // 3. Registra no chat como mensagem de sistema
  const chatMsg = {
    id:         Date.now() + 1,
    userId:     0,
    userName:   '🤖 Bot',
    text:       `📧 Novo email para *${cliente}*\nDe: ${remetente}\nAssunto: ${assunto}\nRecebido: ${data_recebido}`,
    type:       'system',
    source:     'email_monitor',
    targetOpId: operator?.id || null,
    createdAt:  new Date().toISOString(),
  };
  DB.saveChat([...DB.chat(), chatMsg].slice(-200));

  console.log(`[webhook] Email notify: ${cliente} | ${remetente} | ${assunto}`);
  res.json({ ok: true, task_id: task.id, operator: operator?.name || null });
});

// ─── UPLOAD DE IMAGEM NO CHAT ────────────────────────
app.post('/api/chat/upload', auth, (req, res) => {
  const { data, mimeType } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Sem dados' });
  // Limite ~2 MB em base64 ≈ ~1.5 MB de imagem
  if (data.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Imagem muito grande (máx ~1.5 MB)' });
  const ext = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/gif' ? '.gif' : '.png';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const uploadDir = path.join(__dirname, 'public', 'uploads', 'chat');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(data, 'base64'));
  res.json({ url: `/uploads/chat/${filename}` });
});

// ─── WEBHOOK — INTAKE WORKER (Fase 1) ────────────────
// Chamado pelo intake worker no Railway quando processa um documento.
// Autenticação: campo "secret" no body (não JWT).

app.post('/api/webhook/intake-notify', (req, res) => {
  const {
    secret, cliente, cliente_id, origem, remetente, assunto,
    classificacao, fornecedor, drive_url, drive_pasta, nome_arquivo,
    data_recebido, confianca, processado, link_original, motivo_falha,
  } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Não autorizado' });

  const users   = DB.users();
  const clients = DB.clients();

  const client = clients.find(c =>
    String(c.id) === String(cliente_id) ||
    c.name?.toLowerCase() === (cliente || '').toLowerCase()
  );
  const operator = client
    ? users.find(u => !u.noLogin && (u.assignedClients || []).map(String).includes(String(client.id)))
    : null;

  // Cria notificação na aba E-mails
  const notif = {
    id:          String(Date.now()),
    cliente,
    cliente_id,
    origem:      origem || 'email',
    remetente,
    assunto,
    classificacao,
    fornecedor,
    drive_url:   drive_url || '',
    drive_pasta: drive_pasta || '',
    nome_arquivo:nome_arquivo || '',
    data_recebido,
    confianca:   confianca || 'media',
    processado:  processado !== false,
    link_original: link_original || null,
    motivo_falha:  motivo_falha || null,
    readBy:      [],
    createdAt:   new Date().toISOString(),
  };
  const notifs = DB.emailNotifs();
  notifs.unshift(notif);
  DB.saveEmailNotifs(notifs.slice(0, 500));

  // Push para o operador do cliente
  if (operator) {
    const subs = getSubs();
    const sub  = subs[String(operator.id)];
    if (sub) {
      webpush.sendNotification(sub, JSON.stringify({
        title: `📄 ${(classificacao || 'Documento').toUpperCase()} — ${cliente}`,
        body:  `${fornecedor || remetente}\n${assunto}`,
      })).catch(() => {});
    }
  }

  console.log(`[intake-notify] ${cliente} | ${classificacao} | ${confianca} | ${nome_arquivo}`);
  res.json({ ok: true, notif_id: notif.id });
});

app.post('/api/webhook/intake-operacional', (req, res) => {
  const {
    secret, cliente, cliente_id, origem, remetente, assunto,
    descricao, texto_original, data_recebido, critico,
  } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Não autorizado' });

  // Salva em email_notifs.json — aparece na aba E-mails, não cria tarefa
  const notif = {
    id:            String(Date.now()),
    tipo:          'operacional',
    cliente,
    cliente_id,
    origem:        origem || 'email',
    remetente,
    assunto,
    classificacao: 'operacional',
    descricao:     descricao || assunto,
    confianca:     'media',
    critico:       !!critico,
    processado:    false,
    link_original: null,
    motivo_falha:  null,
    readBy:        [],
    createdAt:     new Date().toISOString(),
  };
  const notifs = DB.emailNotifs();
  notifs.unshift(notif);
  DB.saveEmailNotifs(notifs.slice(0, 500));

  // Push para o operador do cliente
  const client   = DB.clients().find(c => String(c.id) === String(cliente_id) || c.name?.toLowerCase() === (cliente||'').toLowerCase());
  const operator = client ? DB.users().find(u => !u.noLogin && (u.assignedClients||[]).map(String).includes(String(client.id))) : null;
  if (operator) {
    const sub = getSubs()[String(operator.id)];
    if (sub) webpush.sendNotification(sub, JSON.stringify({
      title: critico ? `🔴 CRÍTICO — ${cliente}` : `📋 Operacional — ${cliente}`,
      body:  descricao || assunto,
      tag:   critico ? 'critico' : 'operacional',
    })).catch(() => {});
  }

  console.log(`[intake-operacional] ${cliente} | ${assunto} | critico=${!!critico}`);
  res.json({ ok: true, notif_id: notif.id });
});

// ─── WEBHOOK — FILA DE LANÇAMENTOS (Fase 2) ──────────
// Recebe lançamentos financeiros do intake worker para aprovação manual.

app.post('/api/webhook/intake-lancamento', (req, res) => {
  const {
    secret, cliente, cliente_id, origem, classificacao, fornecedor,
    drive_url, nome_arquivo, data_recebido, sugestao_ia, confianca, intake_id,
  } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const lancamento = {
    id:           String(Date.now()),
    intake_id:    intake_id || null,
    cliente,
    cliente_id,
    origem:       origem || 'email',
    classificacao,
    fornecedor,
    drive_url:    drive_url || '',
    nome_arquivo: nome_arquivo || '',
    data_recebido,
    confianca:    confianca || 'media',
    status:       'pendente',   // pendente | aprovado | rejeitado
    sugestao_ia:  sugestao_ia || {},
    createdAt:    new Date().toISOString(),
    resolvedAt:   null,
    resolvedBy:   null,
    ca_id:        null,
    ca_erro:      null,
    rejeicao_motivo: null,
    lancamento_final: null,
  };

  const lista = DB.intakeLancamentos();
  lista.unshift(lancamento);
  DB.saveIntakeLancamentos(lista.slice(0, 500));

  // Push para todos os operadores inscritos
  const subs = getSubs();
  Object.entries(subs).forEach(([, sub]) => {
    webpush.sendNotification(sub, JSON.stringify({
      title: `💰 Lançamento para aprovar — ${cliente}`,
      body:  `${fornecedor || classificacao}${sugestao_ia?.valor ? ' | R$ ' + sugestao_ia.valor : ''}`,
    })).catch(err => {
      if (err.statusCode === 410) { const s = getSubs(); delete s[sub]; saveSubs(s); }
    });
  });

  console.log(`[intake-lancamento] ${cliente} | ${fornecedor} | ${sugestao_ia?.valor || ''}`);
  res.json({ ok: true, fila_id: lancamento.id });
});

// GET /api/intake-lancamentos — lista com filtro (auth necessária)
app.get('/api/intake-lancamentos', auth, (req, res) => {
  const status = req.query.status || null;
  const limit  = parseInt(req.query.limit) || 100;
  let lista = DB.intakeLancamentos();
  if (status === 'ca_pendente') {
    lista = lista.filter(l => l.status === 'aprovado' && !l.ca_id);
  } else if (status) {
    lista = lista.filter(l => l.status === status);
  }
  res.json(lista.slice(0, limit));
});

// ── Função auxiliar: converte data_recebido para DD/MM/YYYY ──────────────────
function _dataRecebidoParaDDMMYYYY(s) {
  if (!s) return new Date().toLocaleDateString('pt-BR');
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[3]}/${m1[2]}/${m1[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return new Date().toLocaleDateString('pt-BR');
}

// ── Função auxiliar: chama CA API ────────────────────────────────────────────
async function _chamarCAApi(lancamento) {
  const https = require('https');
  const body  = JSON.stringify({ secret: CA_API_SECRET, ...lancamento });
  const url   = new URL('/api/internal/create-payable', CA_API_URL);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout:  20000,
    };
    const req2 = https.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve({ status: r.statusCode, body: data }));
    });
    req2.on('error', reject);
    req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
    req2.write(body);
    req2.end();
  });
}

// POST /api/intake/aprovar/:id — operador aprova lançamento
app.post('/api/intake/aprovar/:id', auth, async (req, res) => {
  const fila_id = req.params.id;
  const lista   = DB.intakeLancamentos();
  const idx     = lista.findIndex(l => l.id === fila_id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.status !== 'pendente') {
    return res.status(409).json({ ok: false, error: `Já ${item.status}` });
  }

  const lancamento = {
    cliente_id:          item.cliente_id,
    fornecedor:          req.body.fornecedor          || item.fornecedor || item.sugestao_ia?.descricao || '',
    valor:               req.body.valor               ?? item.sugestao_ia?.valor ?? 0,
    vencimento:          req.body.vencimento          || item.sugestao_ia?.vencimento || _dataRecebidoParaDDMMYYYY(item.data_recebido),
    descricao:           req.body.descricao           || item.sugestao_ia?.descricao || `${item.fornecedor} — ${item.data_recebido?.slice(0,7) || ''}`,
    categoria_id:        req.body.categoria_id        || item.sugestao_ia?.categoria_id || null,
    conta_financeira_id: req.body.conta_financeira_id || item.sugestao_ia?.conta_bancaria_id || null,
    intake_id:           item.id,
  };

  let ca_id   = null;
  let ca_erro = null;

  try {
    const caRes = await _chamarCAApi(lancamento);
    if (caRes.status >= 400) {
      const detail = (() => { try { return JSON.parse(caRes.body)?.detail || caRes.body; } catch { return caRes.body; } })();
      throw new Error(`CA ${caRes.status}: ${detail}`);
    }
    const caJson = JSON.parse(caRes.body);
    ca_id = caJson.ca_id || null;
    console.log(`[intake-aprovar] CA ok | ca_id: ${ca_id}`);
  } catch (err) {
    ca_erro = err.message;
    console.error(`[intake-aprovar] Erro CA API: ${ca_erro}`);
  }

  lista[idx] = { ...item, status: 'aprovado', resolvedAt: new Date().toISOString(), resolvedBy: req.user.name, ca_id, ca_erro, lancamento_final: lancamento };
  DB.saveIntakeLancamentos(lista);

  console.log(`[intake-aprovar] ${item.cliente} | ${item.fornecedor} | ca_id: ${ca_id}${ca_erro ? ` | ERRO: ${ca_erro}` : ''}`);
  res.json({ ok: true, ca_id, ca_erro });
});

// POST /api/intake/rejeitar/:id — operador rejeita
app.post('/api/intake/rejeitar/:id', auth, (req, res) => {
  const fila_id = req.params.id;
  const lista   = DB.intakeLancamentos();
  const idx     = lista.findIndex(l => l.id === fila_id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.status !== 'pendente') {
    return res.status(409).json({ ok: false, error: `Já ${item.status}` });
  }

  lista[idx] = { ...item, status: 'rejeitado', resolvedAt: new Date().toISOString(), resolvedBy: req.user.name, rejeicao_motivo: req.body.motivo || '' };
  DB.saveIntakeLancamentos(lista);

  console.log(`[intake-rejeitar] ${item.cliente} | ${item.fornecedor} | motivo: ${req.body.motivo || ''}`);
  res.json({ ok: true });
});

// POST /api/intake/retentar-ca/:id — retenta criação CA sem reaprovar
app.post('/api/intake/retentar-ca/:id', auth, async (req, res) => {
  const fila_id = req.params.id;
  const lista   = DB.intakeLancamentos();
  const idx     = lista.findIndex(l => l.id === fila_id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.status !== 'aprovado')  return res.status(409).json({ ok: false, error: `Status atual: ${item.status} (precisa ser aprovado)` });
  if (item.ca_id)                  return res.status(409).json({ ok: false, error: `Já lançado no CA: ${item.ca_id}` });

  const lf = item.lancamento_final || {
    cliente_id:  item.cliente_id,
    fornecedor:  item.fornecedor || '',
    valor:       item.sugestao_ia?.valor ?? 0,
    vencimento:  item.sugestao_ia?.vencimento || _dataRecebidoParaDDMMYYYY(item.data_recebido),
    descricao:   item.sugestao_ia?.descricao || item.fornecedor || '',
    intake_id:   item.id,
  };
  const lancamento = {
    ...lf,
    valor:               req.body.valor               ?? lf.valor,
    vencimento:          req.body.vencimento          || lf.vencimento,
    descricao:           req.body.descricao           || lf.descricao,
    categoria_id:        req.body.categoria_id        || lf.categoria_id        || null,
    conta_financeira_id: req.body.conta_financeira_id || lf.conta_financeira_id || null,
  };

  let ca_id   = null;
  let ca_erro = null;

  try {
    const caRes = await _chamarCAApi(lancamento);
    if (caRes.status >= 400) {
      const detail = (() => { try { return JSON.parse(caRes.body)?.detail || caRes.body; } catch { return caRes.body; } })();
      throw new Error(`CA ${caRes.status}: ${detail}`);
    }
    const caJson = JSON.parse(caRes.body);
    ca_id = caJson.ca_id || null;
    console.log(`[retentar-ca] CA ok | ca_id: ${ca_id}`);
  } catch (err) {
    ca_erro = err.message;
    console.error(`[retentar-ca] Erro CA API: ${ca_erro}`);
  }

  lista[idx] = { ...item, ca_id, ca_erro, lancamento_final: lancamento };
  DB.saveIntakeLancamentos(lista);

  res.json({ ok: !!ca_id, ca_id, ca_erro });
});

// DELETE /api/intake/lancamento/:id — remove lançamento com erro da fila
app.delete('/api/intake/lancamento/:id', auth, (req, res) => {
  const lista = DB.intakeLancamentos();
  const idx   = lista.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  // Só permite excluir se não foi lançado com sucesso no CA
  if (item.ca_id) return res.status(409).json({ ok: false, error: 'Lançamento já registrado no CA — não pode excluir' });

  lista.splice(idx, 1);
  DB.saveIntakeLancamentos(lista);
  console.log(`[intake-delete] Lançamento ${req.params.id} removido por ${req.user?.nome || 'operador'}`);
  res.json({ ok: true });
});

// ─── SPA FALLBACK ────────────────────────────────────
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Gestor de Tarefas rodando em http://localhost:${PORT}\n`);
});
