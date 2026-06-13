const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET     = process.env.JWT_SECRET     || 'staffconect_jwt_2024_TROQUE_ISSO';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'staffbot_email_2024';
const CA_API_URL     = process.env.CA_API_URL     || 'https://app.staffconsult.com.br';
const CA_API_SECRET  = process.env.CA_API_SECRET  || 'staffbot_email_2024';
const DATA           = process.env.DATA_DIR       || path.join(__dirname, 'data');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── ARMAZENAMENTO JSON ──────────────────────────────
fs.mkdirSync(DATA, { recursive: true });

const read  = (file, def) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); };

// Global: users (com tenant_id) + tenants catalog
const globalDB = {
  users:       ()  => read(path.join(DATA, 'users.json'), []),
  saveUsers:   d   => write(path.join(DATA, 'users.json'), d),
  tenants:     ()  => read(path.join(DATA, 'tenants.json'), []),
  saveTenants: d   => write(path.join(DATA, 'tenants.json'), d),
};

// Por tenant: dados isolados em data/{tenant_id}/
function tenantDB(tid) {
  const T = path.join(DATA, tid);
  return {
    clients:               ()         => read(path.join(T, 'clients.json'), []),
    saveClients:           d          => write(path.join(T, 'clients.json'), d),
    dayTasks:              date       => read(path.join(T, 'day_tasks', `${date}.json`), {}),
    saveDayTasks:          (date, d)  => write(path.join(T, 'day_tasks', `${date}.json`), d),
    extraTasks:            ()         => read(path.join(T, 'extra_tasks.json'), []),
    saveExtra:             d          => write(path.join(T, 'extra_tasks.json'), d),
    manuals:               ()         => read(path.join(T, 'manuals.json'), []),
    saveManuals:           d          => write(path.join(T, 'manuals.json'), d),
    chat:                  ()         => read(path.join(T, 'chat.json'), []),
    saveChat:              d          => write(path.join(T, 'chat.json'), d),
    contas:                ym         => read(path.join(T, 'contas', `${ym}.json`), {}),
    saveContas:            (ym, d)    => write(path.join(T, 'contas', `${ym}.json`), d),
    mensagens:             ()         => read(path.join(T, 'mensagens.json'), []),
    saveMensagens:         d          => write(path.join(T, 'mensagens.json'), d),
    emailNotifs:           ()         => read(path.join(T, 'email_notifs.json'), []),
    saveEmailNotifs:       d          => write(path.join(T, 'email_notifs.json'), d),
    intakeLancamentos:     ()         => read(path.join(T, 'intake_lancamentos.json'), []),
    saveIntakeLancamentos: d          => write(path.join(T, 'intake_lancamentos.json'), d),
    pushSubs:              ()         => read(path.join(T, 'push_subs.json'), {}),
    savePushSubs:          d          => write(path.join(T, 'push_subs.json'), d),
    lastDailyRun:          ()         => read(path.join(T, 'last_daily_run.json'), { date: '' }),
    saveLastDailyRun:      d          => write(path.join(T, 'last_daily_run.json'), d),
  };
}

// Retorna IDs de tenants ativos (bootstrap: ['staffconect'] se nenhum cadastrado ainda)
function getActiveTenantIds() {
  const tenants = globalDB.tenants();
  if (tenants.length === 0) return ['staffconect'];
  return tenants.filter(t => t.active !== false).map(t => t.id);
}

// ─── FUSO HORÁRIO BRASIL ─────────────────────────────
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
function generateRecurring(tid){
  const today=todayBR();
  if(!isBusinessDay(today)){console.log(`[${tid}] Hoje não é dia útil — recorrentes suspensas`);return;}
  const tDB=tenantDB(tid);
  const tasks=tDB.extraTasks();
  const toAdd=[];
  tasks.filter(t=>t.recurring&&t.status==='done'&&t.due_date).forEach(t=>{
    let next=t.due_date;
    while(next<today)next=calcNextDue(next,t.frequency||'daily');
    if(next!==today)return;
    const isDup=(arr)=>arr.some(x=>x.recurring&&x.status!=='done'&&x.title===t.title&&String(x.client_id)===String(t.client_id)&&String(x.operator_id)===String(t.operator_id)&&x.due_date===today);
    if(!isDup(tasks)&&!isDup(toAdd)){
      const prevEntry = t.exec_notes?.trim() ? {date:t.due_date, note:t.exec_notes.trim()} : null;
      const history = [...(t.exec_notes_history||[]), ...(prevEntry?[prevEntry]:[])].slice(-60);
      toAdd.push({...t, id:String(Date.now()+Math.random()), status:'pending', due_date:today, done_at:null,
        exec_notes:'', exec_notes_history:history,
        steps:(t.steps||[]).map(s=>({...s,done:false})), createdAt:new Date().toISOString()});
    }
  });
  if(toAdd.length){tDB.saveExtra([...tasks,...toAdd]);console.log(`[${tid}] ✓ ${toAdd.length} tarefas recorrentes geradas para ${today}`);}
}

// ─── BACKUP AUTOMÁTICO ───────────────────────────────
function runBackup(tid){
  const today=todayBR();
  const tPath=path.join(DATA,tid);
  const dir=path.join(tPath,'backups',today);
  if(fs.existsSync(dir))return;
  fs.mkdirSync(dir,{recursive:true});
  if(fs.existsSync(tPath))fs.readdirSync(tPath).filter(f=>f.endsWith('.json')).forEach(f=>fs.copyFileSync(path.join(tPath,f),path.join(dir,f)));
  const dtDir=path.join(tPath,'day_tasks');
  if(fs.existsSync(dtDir)){fs.mkdirSync(path.join(dir,'day_tasks'),{recursive:true});fs.readdirSync(dtDir).slice(-14).forEach(f=>fs.copyFileSync(path.join(dtDir,f),path.join(dir,'day_tasks',f)));}
  const bRoot=path.join(tPath,'backups');
  const cutoff=addDaysISO(today,-30);
  if(fs.existsSync(bRoot))fs.readdirSync(bRoot).filter(d=>d<cutoff&&d.match(/^\d{4}-\d{2}-\d{2}$/)).forEach(d=>fs.rmSync(path.join(bRoot,d),{recursive:true,force:true}));
  console.log(`[${tid}] ✓ Backup criado: ${dir}`);
}

// ─── LIMPEZA DE IMAGENS DO CHAT ─────────────────────
function cleanChatUploads(){
  const uploadDir=path.join(__dirname,'public','uploads','chat');
  if(!fs.existsSync(uploadDir))return;
  const cutoff=Date.now()-10*24*60*60*1000;
  let removed=0;
  fs.readdirSync(uploadDir).forEach(f=>{
    const fp=path.join(uploadDir,f);
    try{if(fs.statSync(fp).mtimeMs<cutoff){fs.unlinkSync(fp);removed++;}}catch{}
  });
  if(removed>0)console.log(`✓ Limpeza chat: ${removed} imagem(ns) removida(s) (>10 dias)`);
}

// ─── NOTIFICAÇÕES DE ATRASO ──────────────────────────
async function sendOverdueNotifs(){
  const today=todayBR();
  getActiveTenantIds().forEach(tid=>{
    const tasks=tenantDB(tid).extraTasks();
    const overdue=tasks.filter(t=>t.due_date&&t.due_date<today&&t.status!=='done'&&t.operator_id);
    if(overdue.length)console.log(`[${tid}] ℹ Tarefas em atraso: ${overdue.length} (push desativado)`);
  });
}

// ─── RUNNER DIÁRIO ───────────────────────────────────
function runDailyJobs(){
  const today=todayBR();
  getActiveTenantIds().forEach(tid=>{
    const tDB=tenantDB(tid);
    const last=tDB.lastDailyRun();
    if(last.date===today)return;
    generateRecurring(tid);
    runBackup(tid);
    tDB.saveLastDailyRun({date:today,ts:new Date().toISOString()});
    console.log(`[${tid}] ✓ Jobs diários executados para ${today}`);
  });
  cleanChatUploads();
  sendOverdueNotifs();
}
runDailyJobs();
setInterval(runDailyJobs,30*60*1000);

// ─── VAPID / PUSH ────────────────────────────────────
const VAPID_FILE = path.join(DATA, 'vapid.json');
let vapidKeys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
  console.log('⚠ VAPID gerado. Copie para env vars VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY:');
  console.log('  VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
  console.log('  VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
}
webpush.setVapidDetails('mailto:lidia@staffconsult.com.br', vapidKeys.publicKey, vapidKeys.privateKey);

// ─── SEED DEFAULTS POR TENANT ────────────────────────
function seedTenantDefaults(tid) {
  const tDB = tenantDB(tid);

  // Clientes: novos tenants começam vazios — nunca herdar dados de outro tenant
  // (staffconect importa os próprios clientes via migrate.js)

  const ex = tDB.manuals();
  const ROTINA_DEFAULTS = [
    { id:'default_b1', num:'1', title:'Bloco 1 — Abertura e Conciliação', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
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
    { id:'default_b2', num:'2', title:'Bloco 2 — Pagamentos', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Conferir contas a pagar',detail:'Verificar no Conta Azul todas as contas com vencimento no dia.'},
      {n:2,action:"Conferir NF's e boletos",detail:"Verificar fisicamente se os boletos e NF's batem com o sistema."},
      {n:3,action:'Conferir DDA',detail:'Verificar o DDA no banco para garantir que não há boletos não cadastrados.'},
      {n:4,action:'Salvar contas a pagar',detail:'Salvar a relação de contas a pagar do dia na pasta do cliente.'},
      {n:5,action:'Agendar pagamentos',detail:'Agendar todos os pagamentos no internet banking. Confirmar cada um.'},
      {n:6,action:'Salvar programação bancária',detail:'Exportar comprovante de agendamento e salvar na pasta.'},
      {n:7,action:'Atualizar saldo bancário',detail:'Atualizar o saldo no Conta Azul após os agendamentos.'},
      {n:8,action:'Enviar rotina ao cliente',detail:'Redigir mensagem de retorno com resumo do feito e enviar ao cliente.'},
    ]},
    { id:'rotina_completo', title:'🔵 Conciliação Completa', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Acessar banco',detail:''},
      {n:2,action:'Gerar extrato PDF',detail:'Salvar na pasta correta do cliente.'},
      {n:3,action:'Gerar OFX',detail:'Salvar na pasta correta do cliente.'},
      {n:4,action:'Importar OFX no sistema',detail:'Importar o arquivo OFX no Conta Azul para atualizar o fluxo.'},
      {n:5,action:'Realizar conciliação bancária',detail:'Conciliar entradas e saídas.'},
      {n:6,action:'Revisar movimentações pendentes',detail:''},
      {n:7,action:'Verificar receitas sem identificação',detail:''},
      {n:8,action:'Verificar despesas sem identificação',detail:''},
      {n:9,action:'Imprimir relatório de conciliação',detail:''},
      {n:10,action:'Salvar relatório na pasta correta',detail:''},
      {n:11,action:'Conferir todos os arquivos salvos',detail:''},
      {n:12,action:'Conferir nomes e pasta corretos',detail:''},
      {n:13,action:'Atualizar posição bancária',detail:'Atualizar conforme saldo do dia.'},
    ]},
    { id:'rotina_bancos_rev', title:'🏦 Bancos + Revisão', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Acessar banco',detail:''},
      {n:2,action:'Gerar extrato PDF',detail:'Salvar na pasta correta do cliente.'},
      {n:3,action:'Gerar OFX',detail:'Salvar na pasta correta do cliente.'},
      {n:4,action:'Conferir arquivos salvos e pasta correta',detail:''},
      {n:5,action:'Atualizar posição bancária',detail:'Atualizar conforme saldo do dia.'},
    ]},
    { id:'rotina_conc_rel', title:'📊 Conciliação + Relatórios', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Importar OFX no sistema',detail:''},
      {n:2,action:'Realizar conciliação bancária',detail:''},
      {n:3,action:'Revisar movimentações pendentes',detail:''},
      {n:4,action:'Verificar receitas sem identificação',detail:''},
      {n:5,action:'Verificar despesas sem identificação',detail:''},
      {n:6,action:'Imprimir relatório de conciliação',detail:''},
      {n:7,action:'Salvar relatório na pasta correta',detail:''},
      {n:8,action:'Atualizar posição bancária',detail:'Atualizar conforme saldo do dia.'},
    ]},
    { id:'rotina_sem_cap', title:'✅ Rotina sem Contas a Pagar', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Acessar e-mail',detail:'Salvar boletos e NFs na pasta correta.'},
      {n:2,action:'Verificar WhatsApp',detail:'Conferir grupo e individual. Anotar solicitações pendentes.'},
      {n:3,action:'Lançar no Conta Azul',detail:'Lançar todas as solicitações de pagamento identificadas.'},
      {n:4,action:'Conferir contas a pagar',detail:'Verificar se há pagamento para o dia. Caso sim, transferir para o outro operador.'},
      {n:5,action:'Conferir DDA',detail:'Verificar no banco se há boletos não cadastrados. Caso sim, transferir para o outro operador.'},
      {n:6,action:'Atualizar posição bancária',detail:'Atualizar conforme saldo do dia.'},
      {n:7,action:'Enviar rotina ao cliente',detail:''},
    ]},
    { id:'rotina_com_cap', title:'💰 Rotina com Contas a Pagar', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Acessar e-mail',detail:'Conferir e salvar boletos e NFs na pasta correta.'},
      {n:2,action:'Verificar WhatsApp',detail:'Conferir grupo e individual. Anotar solicitações pendentes.'},
      {n:3,action:'Lançar no Conta Azul',detail:'Lançar todas as solicitações de pagamento identificadas.'},
      {n:4,action:'Conferir contas a pagar',detail:'Verificar pagamentos do dia.'},
      {n:5,action:'Conferir DDA',detail:'Verificar no banco se há boletos não cadastrados no Conta Azul.'},
      {n:6,action:'Salvar contas a pagar',detail:'Salvar relação de contas a pagar do dia na pasta do cliente.'},
      {n:7,action:'Agendar pagamentos',detail:'Agendar todos os pagamentos no internet banking. Confirmar cada um.'},
      {n:8,action:'Salvar programação bancária',detail:'Exportar comprovante de agendamento e salvar na pasta.'},
      {n:9,action:'Atualizar posição bancária',detail:'Atualizar conforme saldo do dia.'},
      {n:10,action:'Enviar rotina ao cliente',detail:''},
    ]},
    { id:'rotina_auditoria', title:'🔍 Organização e Auditoria (tarde)', category:'Rotina Diária', isDefault:true, assignedOperators:[], createdAt:new Date().toISOString(), steps:[
      {n:1,action:'Revisar pastas e arquivos do dia',detail:''},
      {n:2,action:'Conferir relatórios gerados',detail:''},
      {n:3,action:'Revisar checklist dos clientes',detail:''},
      {n:4,action:'Verificar pendências abertas',detail:''},
      {n:5,action:'Organizar ambiente operacional',detail:''},
      {n:6,action:'Registrar resumo do dia',detail:''},
    ]},
  ];
  const missingDefaults = ROTINA_DEFAULTS.filter(d => !ex.find(m => String(m.id) === String(d.id)));
  if (missingDefaults.length > 0) {
    tDB.saveManuals([...missingDefaults, ...ex]);
  }
}

// Mapeamento legado rotina_tipo → manual ID
const ROTINA_TIPO_TO_MANUAL = {
  padrao:    'default_b1',
  completo:  'rotina_completo',
  bancos_rev:'rotina_bancos_rev',
  conc_rel:  'rotina_conc_rel',
  sem_cap:   'rotina_sem_cap',
  com_cap:   'rotina_com_cap',
};
const ROTINA_TIPO_TARDE_TO_MANUAL = {
  auditoria: 'rotina_auditoria',
};

// Migra clientes legado (rotina_tipo → rotina_manual_id) — roda uma vez, idempotente
// Passwords dos clientes Oracle (migração idempotente) — aplicados apenas se cliente não tiver nenhum
const ORACLE_CLIENT_PASSWORDS = {
  'up': [{"id":1777741610724,"link":"https://v65.medx.med.br/Login_Unificado/loginUnificado.html","sistema":"Medx","usuario":"dermapelle01@outlook.com","senha":"upclinique2024","obs":""}],
  'body': [{"id":1780521190134,"link":"https://agenciavirtual.light.com.br/portal/","sistema":"Light","usuario":"clinicaroundgluteorio@gmail.com","senha":"2412Vss@","obs":""}],
  'guimoo': [{"id":1776989303545,"link":"https://www.asaas.com/","sistema":"Asaas","usuario":"guimoobpofinanceirosantosif@gmail.com","senha":"Santos@2808","obs":""}],
  'matsu': [{"id":1778058872654,"link":"https://www.itau.com.br/empresas","sistema":"Banco Itau - Conta 98716-9","usuario":"871367162","senha":"120382","obs":"Acessos - Opcoes de acesso: Codigo do operador (871367162) - acesso básico"}],
  'ecofi': [{"id":1778058962486,"link":"","sistema":"Banco Itau - Conta 98720-1","usuario":"871367162","senha":"120382","obs":"Acessos - Opcoes de acesso: Codigo do operador (871367162) - acesso básico"},{"id":1778059109717,"link":"","sistema":"Bradesco - Conta 0648607-0","usuario":"LCSC00222","senha":"12031982","obs":"Mesmo acesso da UP e Galiza"}],
  'makinsthall': [{"id":1778059237585,"link":"","sistema":"Banco Itau - Conta 98483-6","usuario":"871367162","senha":"120382","obs":"Mesmo acesso da Ecofi e Matsu"},{"id":1778059300787,"link":"","sistema":"Bradesco - Conta 0648623-1","usuario":"LCSC00222","senha":"12031982","obs":"Mesmo acesso da UP e Galiza"},{"id":1778059336479,"link":"","sistema":"Banco Itau - Conta 98721-9","usuario":"871367162","senha":"120382","obs":"Mesmo acesso da Ecofi e Matsu"},{"id":1778059471279,"link":"https://www.santander.com.br/","sistema":"Santander - Conta 13004989-4","usuario":"83082913334","senha":"120382","obs":"Pessoa Juridica Ag 4198 Conta 130049894"},{"id":1778782639828,"link":"https://nfe.osasco.sp.gov.br/EissnfeWebApp/Portal/Default.aspx","sistema":"Acesso prefeitura de Osasco","usuario":"IM126265","senha":"126265","obs":"Emissao de NF"}],
  '1776945416932': [{"id":1776945305184,"link":"","sistema":"Simples Cte","usuario":"lidia@staffconsult.com.br","senha":"St12345*","obs":""},{"id":1776945338290,"link":"","sistema":"Prefeitura","usuario":"628.669.233-91","senha":"Rochab2020*","obs":""}],
  '1777644575935': [{"id":1777644876700,"link":"","sistema":"Instagram","usuario":"staff.consult","senha":"St12345*","obs":""},{"id":1777644919534,"link":"","sistema":"Instagram StaffConect","usuario":"lidia@staffconsult.com.br","senha":"St12345","obs":""},{"id":1777645300128,"link":"","sistema":"Google Meu Negócio","usuario":"adm.staffconsult@gmail.com","senha":"","obs":"Enviei um convite para este email"},{"id":1777645773849,"link":"","sistema":"Linkedin","usuario":"","senha":"","obs":"Te convidei como Administrador"},{"id":1777645796239,"link":"","sistema":"Meta","usuario":"adm.staffconsult@gmail.com","senha":"","obs":"Enviei um convite para este email"},{"id":1778677793240,"link":"","sistema":"Qualitycert","usuario":"LIDIAA.CRISTINA","senha":"@lidiaa2025","obs":"Link vline: https://vline.soluti.com.br/arqualitycert"},{"id":1778677858288,"link":"","sistema":"Conta Azul Santos","usuario":"contato.staffconsult@gmail.com","senha":"Sif12345*","obs":""}],
};

function migrateClientRotinas(tid) {
  const tDB = tenantDB(tid);
  const clients = tDB.clients();
  let changed = false;
  const migrated = clients.map(c => {
    let upd = { ...c };
    if (!upd.rotina_manual_id && upd.rotina_tipo && ROTINA_TIPO_TO_MANUAL[upd.rotina_tipo]) {
      upd.rotina_manual_id = ROTINA_TIPO_TO_MANUAL[upd.rotina_tipo];
      changed = true;
    }
    if (!upd.rotina_tarde_manual_id && upd.rotina_tipo_tarde && ROTINA_TIPO_TARDE_TO_MANUAL[upd.rotina_tipo_tarde]) {
      upd.rotina_tarde_manual_id = ROTINA_TIPO_TARDE_TO_MANUAL[upd.rotina_tipo_tarde];
      changed = true;
    }
    // Migra passwords do Oracle se cliente não tiver nenhum
    const oraclePws = ORACLE_CLIENT_PASSWORDS[String(c.id)];
    if (oraclePws && (!upd.passwords || upd.passwords.length === 0)) {
      upd.passwords = oraclePws;
      changed = true;
    }
    return upd;
  });
  if (changed) {
    tDB.saveClients(migrated);
    console.log(`[${tid}] ✓ Migração clientes concluída (rotinas + passwords)`);
  }
}

// Usuários canônicos do Oracle — usados como fallback se Railway não tiver usuários corretos
const CANONICAL_USERS = [
  // Lidia é master global (tenant_id: null) — acessa StaffMaster e gestor operacional
  { id:1776819616478, name:'LIDIA CAVALCANTI', email:'lidia@staffconsult.com.br',
    password_hash:'$2a$10$BiGXcoFBTZCAY2tq6W16SOoiucgf6eNwk4sKU.F0Qrvreh5BSQDYG',
    role:'master', tenant_id:null, assignedClients:['1776945416932','1777644575935'] },
  { id:1776819683538, name:'LEONARDO CUNHA CAVALCANTI', email:'adm.staffconsult@gmail.com',
    password_hash:'$2a$10$Xe9fWZpEagn9OqS.58imsOvSbcReGh508MmIhT1AhIjRpGhAUsBvO',
    role:'operator', tenant_id:'staffconect',
    assignedClients:['kimberly','up','agro','jsa','body','guimoo','galiza','matsu','ecofi','makinsthall'] },
  { id:1777317713733, name:'MIRELLA - SANTOS INTELIGENCIA', email:null, password_hash:null,
    role:'operator', noLogin:true, tenant_id:'staffconect',
    assignedClients:['kimberly','agro','jsa','guimoo'] },
];

// Corrige IDs e tenant_id dos usuários (migração Railway)
function migrateUsers() {
  const existing = globalDB.users();
  const canonicalIds = new Set(CANONICAL_USERS.map(u => u.id));
  const canonicalEmails = new Set(CANONICAL_USERS.filter(u=>u.email).map(u=>u.email.toLowerCase()));

  // Constrói os usuários canônicos preservando password_hash atual (caso Lidia tenha trocado senha)
  const canonical = CANONICAL_USERS.map(canon => {
    const match =
      existing.find(u => u.id === canon.id) ||
      existing.find(u => canon.email && u.email && u.email.toLowerCase() === canon.email.toLowerCase() && !u.tenant_id);
    const hash = match?.password_hash || canon.password_hash;
    return { ...canon, password_hash: hash,
             ...(match?.must_change_password ? { must_change_password: true } : {}) };
  });

  // Preserva usuários de outros tenants (não-staffconect, não-canônicos)
  // Remove: quaisquer usuários staffconect duplicados/variantes (Lidia Administrador, etc.)
  // Preserva: usuários de outros tenants; ignora master (já está em canonical)
  const others = existing.filter(u => {
    if (canonicalIds.has(u.id)) return false;            // já está no canonical
    if (canonicalEmails.has((u.email||'').toLowerCase())) return false; // email duplicado com canônico
    if (u.tenant_id === 'staffconect') return false;     // staffconect não-canônico → remover
    if (!u.tenant_id && u.role !== 'master') return false; // tenant null sem ser master → remover
    return true; // outros tenants preservados
  });

  const final = [...canonical, ...others];
  const changed = JSON.stringify(final) !== JSON.stringify(existing);
  if (changed) {
    globalDB.saveUsers(final);
    console.log('[migrate] ✓ users.json reconstruído. Total:', final.length, final.map(u=>u.name).join(', '));
  } else {
    console.log('[migrate] ✓ users.json OK, sem alterações');
  }
}

function migrateExtraTasks(tid) {
  const MISSING_TASKS = [
    {"id":1781277266032,"title":"Incluir mes de janeiro na licenca nova da Galiza","client_id":"galiza","operator_id":1776819616478,"due_date":"2026-06-19","priority":"normal","notes":"","recurring":false,"frequency":"daily","steps":[],"status":"pending","created_at":"2026-06-12T15:14:26.032Z","done_at":null},
    {"id":1781274605237,"title":"Lançamento cartao Agro - ver com Roni","client_id":"agro","operator_id":1776819616478,"due_date":"2026-06-15","priority":"high","notes":"Mostrar como foi feito","recurring":false,"frequency":"daily","steps":[],"status":"pending","created_at":"2026-06-12T14:30:05.237Z","done_at":null},
    {"id":"1781234639350.7454","title":"Fechamento Operacional - 17:00 às 17:30h","client_id":"","operator_id":"1776819683538","due_date":"2026-06-12","priority":"high","notes":"","recurring":true,"frequency":"daily","steps":[{"id":"s_1781180721562","text":"Conferir relatórios gerados do dia","done":false},{"id":"s_1781180727425","text":"Conferir arquivos salvos","done":false},{"id":"s_1781180734268","text":"Conferir pastas atualizadas","done":false},{"id":"s_1781180746562","text":"Registrar pendências encontradas","done":false},{"id":"s_1781180753177","text":"Registrar resumo do dia","done":false}],"status":"pending","created_at":"2026-06-11T12:26:00.538Z","done_at":null,"exec_notes":"","exec_notes_history":[]},
    {"id":"1781234639352.2788","title":"Emitir NF - Guimoo","client_id":"guimoo","operator_id":1776819616478,"due_date":"2026-06-12","priority":"high","notes":"EMITIR TODOS OS DIAS - NF´S DAS VENDAS EFETUADAS / CONFIRMADAS NO DIA ANTERIOR\nEX: DIA 30/5 - EMITIR NF DE 29/05 COBRANÇAS CONFIRMADAS","recurring":true,"frequency":"daily","steps":[{"id":"s_1780087892391","text":"Acessar Menu Cobranças > Todas > Filtros","done":false},{"id":"s_1780087911966","text":"Aplicar filtro: Confirmadas","done":false},{"id":"s_1780088001599","text":"Filtro avançado","done":false},{"id":"s_1780088009649","text":"Criação: data do dia anterior","done":false},{"id":"s_1780088030843","text":"Situação das cobranças: Confirmada","done":false},{"id":"s_1780088050908","text":"Nao exibir cobranças removidas","done":false},{"id":"s_1780088057881","text":"Todas as faturas","done":false},{"id":"s_1780088074667","text":"Nota Fiscal: Sem nota fiscal","done":false}],"status":"pending","created_at":"2026-05-29T20:33:10.293Z","done_at":null,"exec_notes":"","exec_notes_history":[]},
    {"id":"1781234639352.7063","title":"Emitir NF´s Kim","client_id":"kimberly","operator_id":1776819616478,"due_date":"2026-06-12","priority":"high","notes":"Emissao de todas as notas até o ultimo dia util do mes","recurring":true,"frequency":"monthly","steps":[],"status":"pending","created_at":"2026-04-29T15:07:33.996Z","done_at":null,"exec_notes":"","exec_notes_history":[{"date":"2026-05-14","note":"AGUARDANDO PLANILHA"}]},
    {"id":"1781234639352.0703","title":"Emitir NF´s Body","client_id":"body","operator_id":1776819616478,"due_date":"2026-06-12","priority":"high","notes":"Emissao de todas as notas até o ultimo dia util do mes","recurring":true,"frequency":"monthly","steps":[],"status":"pending","created_at":"2026-04-29T15:06:51.648Z","done_at":null,"exec_notes":"","exec_notes_history":[{"date":"2026-05-13","note":"SOLICITAR AO VINICIUS DADOS DA PACIENTE Rafaella Costa PARA EMISSAO DA NF"}]},
    {"id":"1781234639354.269","title":"Recibo de motoristas","client_id":"1776945416932","operator_id":1776819616478,"due_date":"2026-06-12","priority":"normal","notes":"","recurring":true,"frequency":"weekly","steps":[{"id":"s_1777282956789","text":"Gerar e enviar recibos de motoristas","done":false}],"status":"pending","created_at":"2026-04-27T09:42:39.970Z","done_at":null,"exec_notes":"","exec_notes_history":[]},
    {"id":"1781234639354.6362","title":"Rotina Diaria - RBJ","client_id":"1776945416932","operator_id":1776819616478,"due_date":"2026-06-12","priority":"normal","notes":"","recurring":true,"frequency":"daily","steps":[{"id":"m_0_1777283266330","text":"Conferir ordem de compra no e-mail","done":false},{"id":"m_1_1777283266330","text":"Emitir Ctes e NF´s","done":false},{"id":"m_2_1777283266330","text":"Enviar EDI via STA","done":false},{"id":"m_3_1777283266330","text":"Enviar e-mail com protocolo e NF´s se houver","done":false},{"id":"m_4_1777283266330","text":"Atualizar planilha de faturamento","done":false}],"status":"pending","created_at":"2026-04-27T09:41:52.470Z","done_at":null,"exec_notes":"","exec_notes_history":[]},
  ];
  const db = tenantDB(tid);
  const tasks = db.extraTasks();
  const existingIds = new Set(tasks.map(t=>String(t.id)));
  const toAdd = MISSING_TASKS.filter(t=>!existingIds.has(String(t.id)));
  if (toAdd.length > 0) {
    db.saveExtra([...tasks, ...toAdd]);
    console.log(`[migrate] ✓ extra_tasks: adicionadas ${toAdd.length} tarefas do Oracle`);
  }
}

// Seed clientes canônicos do tenant staffconect (RBJ e Staff Consult)
function seedStaffconectClients() {
  const LIDIA = 1776819616478;
  const LEO   = 1776819683538;
  const SEED_CLIENTS = [
    { id:'1776945416932', name:'RBJ Transportes', priority:1, banks:[], whatsapp:'', cnpj:'', contact:'', erp:'STA', email:'', notes:'', passwords:[
        {id:1776945305184,link:'',sistema:'Simples Cte',usuario:'lidia@staffconsult.com.br',senha:'St12345*',obs:''},
        {id:1776945338290,link:'',sistema:'Prefeitura',usuario:'628.669.233-91',senha:'Rochab2020*',obs:''},
      ], rotina:{bloco1:{name:'',steps:[]},bloco2:{steps:[]}}, tipo:'outros', op1_id:LIDIA, op2_id:LIDIA,
    },
    { id:'1777644575935', name:'Staff Consult e Conect', priority:1, banks:[], whatsapp:'', cnpj:'', contact:'', erp:'Conta Azul', email:'', notes:'', passwords:[
        {id:1777644876700,link:'',sistema:'Instagram',usuario:'staff.consult',senha:'St12345*',obs:''},
        {id:1777644919534,link:'',sistema:'Instagram StaffConect',usuario:'lidia@staffconsult.com.br',senha:'St12345',obs:''},
        {id:1777645300128,link:'',sistema:'Google Meu Negócio',usuario:'adm.staffconsult@gmail.com',senha:'',obs:'Convite enviado'},
        {id:1777645773849,link:'',sistema:'Linkedin',usuario:'',senha:'',obs:'Convidei como Administrador'},
        {id:1777645796239,link:'',sistema:'Meta',usuario:'adm.staffconsult@gmail.com',senha:'',obs:'Convite enviado'},
        {id:1778677793240,link:'',sistema:'Qualitycert',usuario:'LIDIAA.CRISTINA',senha:'@lidiaa2025',obs:''},
        {id:1778677858288,link:'',sistema:'Conta Azul Santos',usuario:'contato.staffconsult@gmail.com',senha:'Sif12345*',obs:''},
      ], rotina:{bloco1:{name:'',steps:[]},bloco2:{steps:[]}},
      rotina_manual_id:'default_b1', rotina_tipo:'padrao', op1_id:LIDIA, op2_id:LIDIA,
    },
  ];
  const db = tenantDB('staffconect');
  const clients = db.clients();
  const existingIds = new Set(clients.map(c=>String(c.id)));
  // Remove quaisquer clientes criados com Date.now() que correspondem a RBJ/Staff Consult pelo nome
  const SEED_IDS = new Set(SEED_CLIENTS.map(c=>c.id));
  const SEED_NAMES = new Set(SEED_CLIENTS.map(c=>c.name.toLowerCase()));
  const filtered = clients.filter(c => {
    if (SEED_IDS.has(String(c.id))) return false; // remover versão antiga se existir
    if (SEED_NAMES.has((c.name||'').toLowerCase()) && !SEED_IDS.has(String(c.id))) return false; // duplicata por nome
    return true;
  });
  const toAdd = SEED_CLIENTS.filter(c=>!existingIds.has(c.id) || !clients.find(x=>String(x.id)===String(c.id)));
  // Sempre re-seed para garantir IDs corretos (idempotente — por ID)
  const final = [...filtered, ...SEED_CLIENTS];
  if (JSON.stringify(final) !== JSON.stringify(clients)) {
    db.saveClients(final);
    console.log('[seed] ✓ Clientes RBJ e Staff Consult sincronizados');
  }
}

// Seed apenas para staffconect no startup
seedTenantDefaults('staffconect');
migrateUsers();
migrateClientRotinas('staffconect');
migrateExtraTasks('staffconect');
seedStaffconectClients();

// ─── MIDDLEWARE AUTH ─────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user   = jwt.verify(token, JWT_SECRET);
    req.tenant = req.user.tenant_id || 'staffconect';
    req.tDB    = tenantDB(req.tenant);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada, faça login novamente' });
  }
}

// ─── AUTH ────────────────────────────────────────────
app.get('/api/auth/setup', (req, res) => {
  res.json({ needsSetup: globalDB.users().length === 0 });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
  const user = globalDB.users().find(u => u.email === email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  const tid = user.tenant_id || 'staffconect';
  const mustChange = !!user.must_change_password;
  const token = jwt.sign({ id:user.id, name:user.name, email:user.email, role:user.role, tenant_id:tid }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user: { id:user.id, name:user.name, email:user.email, role:user.role, tenant_id:tid, must_change_password:mustChange } });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Preencha todos os campos' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Nova senha deve ter mínimo 6 caracteres' });
  const users = globalDB.users();
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (!bcrypt.compareSync(currentPassword, users[idx].password_hash))
    return res.status(401).json({ error: 'Senha atual incorreta' });
  users[idx] = { ...users[idx], password_hash: bcrypt.hashSync(newPassword, 10), must_change_password: false };
  globalDB.saveUsers(users);
  res.json({ ok: true });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, assignedClients } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres' });

  const users = globalDB.users();
  let tenant_id = 'staffconect';

  if (users.length > 0) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ error: 'Apenas admins podem adicionar operadores' });
    try {
      const d = jwt.verify(token, JWT_SECRET);
      if (d.role !== 'admin') throw new Error();
      tenant_id = d.tenant_id || 'staffconect';
    }
    catch { return res.status(403).json({ error: 'Apenas admins podem adicionar operadores' }); }
  }

  const emailNorm = email.toLowerCase().trim();
  if (users.find(u => u.email === emailNorm)) return res.status(400).json({ error: 'E-mail já cadastrado' });

  const role = users.filter(u => (u.tenant_id||'staffconect') === tenant_id).length === 0 ? 'admin' : 'operator';
  const newUser = { id: Date.now(), name, email: emailNorm, password_hash: bcrypt.hashSync(password, 10), role, tenant_id, assignedClients: assignedClients || [] };
  globalDB.saveUsers([...users, newUser]);

  // Garante seed de defaults ao criar primeiro usuário de um tenant
  seedTenantDefaults(tenant_id);

  const token = jwt.sign({ id:newUser.id, name, email:emailNorm, role, tenant_id }, JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user: { id:newUser.id, name, email:emailNorm, role, tenant_id, assignedClients: newUser.assignedClients } });
});

// ─── CLIENTES ────────────────────────────────────────
app.get('/api/clients', auth, (req, res) => {
  res.json(req.tDB.clients().sort((a, b) => a.priority - b.priority));
});

app.post('/api/clients', auth, (req, res) => {
  const clients = req.tDB.clients();
  // Admin/master pode fornecer ID customizado (para importar clientes com IDs do Oracle)
  const id = (['admin','master'].includes(req.user.role) && req.body.id) ? String(req.body.id) : String(Date.now());
  const novo = { ...req.body, id };
  req.tDB.saveClients([...clients, novo]);
  res.json(novo);
});

app.put('/api/clients/:id', auth, (req, res) => {
  const clients = req.tDB.clients().map(c => c.id === req.params.id ? { ...c, ...req.body, id: c.id } : c);
  req.tDB.saveClients(clients);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', auth, (req, res) => {
  if (!['admin','master'].includes(req.user.role)) return res.status(403).json({ error: 'Apenas admins podem excluir clientes' });
  req.tDB.saveClients(req.tDB.clients().filter(c => c.id !== req.params.id));
  res.json({ ok: true });
});

// ─── TAREFAS DO DIA ──────────────────────────────────
app.get('/api/day-tasks/history', auth, (req, res) => {
  const days = parseInt(req.query.days) || 14;
  const result = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const date = d.toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    const tasks = req.tDB.dayTasks(date);
    if (Object.keys(tasks).length > 0) {
      const clients = req.tDB.clients();
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
  res.json(req.tDB.dayTasks(req.params.date));
});

// Nunca rebaixa status de um bloco: done > active > pending
const STATUS_RANK = {pending:0, active:1, done:2};
function mergeBloco(existing, incoming) {
  if (!existing || !incoming) return incoming ?? existing;
  if ((STATUS_RANK[existing.status] ?? 0) > (STATUS_RANK[incoming.status] ?? 0)) {
    return { ...incoming, status: existing.status, doneAt: existing.doneAt,
             ...(existing.opDone !== undefined ? {opDone: existing.opDone} : {}) };
  }
  return incoming;
}

app.put('/api/day-tasks/:date/:clientId', auth, (req, res) => {
  const tasks  = req.tDB.dayTasks(req.params.date);
  const existing = tasks[req.params.clientId];
  if (existing) {
    const inc = req.body;
    tasks[req.params.clientId] = {
      ...inc,
      bloco1:  mergeBloco(existing.bloco1,  inc.bloco1),
      bloco2:  mergeBloco(existing.bloco2,  inc.bloco2),
      bloco1b: mergeBloco(existing.bloco1b, inc.bloco1b),
      fullyDone: existing.fullyDone || !!inc.fullyDone,
    };
  } else {
    tasks[req.params.clientId] = req.body;
  }
  req.tDB.saveDayTasks(req.params.date, tasks);
  res.json({ ok: true });
});

// ─── TAREFAS EXTRAS ──────────────────────────────────
app.get('/api/extra-tasks', auth, (req, res) => {
  res.json(req.tDB.extraTasks().sort((a, b) => b.created_at - a.created_at));
});

app.post('/api/extra-tasks', auth, (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
  const task = { id: Date.now(), ...req.body, status: 'pending', created_at: new Date().toISOString(), done_at: null };
  req.tDB.saveExtra([task, ...req.tDB.extraTasks()]);
  res.json(task);
});

app.put('/api/extra-tasks/:id', auth, (req, res) => {
  const id = String(req.params.id);
  const body = { ...req.body };

  // Operadores não podem marcar diretamente como done — vai para pending_approval (se tenant exigir)
  const _tenantCfg = globalDB.tenants().find(t => t.id === req.tenant) || {};
  if (body.status === 'done' && req.user.role === 'operator' && _tenantCfg.requiresApproval) {
    body.status              = 'pending_approval';
    body.approval_requested_at = new Date().toISOString();
    body.approval_requested_by = req.user.name;
    body.approval_comment    = null;
    body.rejected_reason     = null;
  }

  req.tDB.saveExtra(req.tDB.extraTasks().map(t => String(t.id) === id ? { ...t, ...body } : t));
  res.json({ ok: true });
});

// Aprovar tarefa (admin ou master)
app.post('/api/extra-tasks/:id/aprovar', auth, (req, res) => {
  if (req.user.role === 'operator') return res.status(403).json({ error: 'Apenas admins podem aprovar' });
  const id = String(req.params.id);
  const { comment } = req.body || {};
  const tasks = req.tDB.extraTasks();
  const idx = tasks.findIndex(t => String(t.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'Tarefa não encontrada' });
  if (tasks[idx].status !== 'pending_approval') return res.status(409).json({ error: 'Tarefa não está aguardando aprovação' });
  tasks[idx] = { ...tasks[idx], status: 'done', done_at: new Date().toISOString(),
    approved_at: new Date().toISOString(), approved_by: req.user.name,
    approval_comment: comment || null, rejected_reason: null };
  req.tDB.saveExtra(tasks);
  res.json({ ok: true });
});

// Rejeitar tarefa (admin ou master)
app.post('/api/extra-tasks/:id/rejeitar', auth, (req, res) => {
  if (req.user.role === 'operator') return res.status(403).json({ error: 'Apenas admins podem rejeitar' });
  const id = String(req.params.id);
  const { reason } = req.body || {};
  const tasks = req.tDB.extraTasks();
  const idx = tasks.findIndex(t => String(t.id) === id);
  if (idx === -1) return res.status(404).json({ error: 'Tarefa não encontrada' });
  if (tasks[idx].status !== 'pending_approval') return res.status(409).json({ error: 'Tarefa não está aguardando aprovação' });
  tasks[idx] = { ...tasks[idx], status: 'active', done_at: null,
    rejected_at: new Date().toISOString(), rejected_by: req.user.name,
    rejected_reason: reason || '', approved_at: null, approved_by: null };
  req.tDB.saveExtra(tasks);
  res.json({ ok: true });
});

// ?mode=single → só esta instância | ?mode=all → todas do grupo recorrente
app.delete('/api/extra-tasks/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = String(req.params.id);
  const mode = req.query.mode || 'single';
  const tasks = req.tDB.extraTasks();
  const target = tasks.find(t => String(t.id) === id);
  if (!target) return res.status(404).json({ error: 'Não encontrada' });
  let remaining;
  if (mode === 'all' && target.recurring) {
    remaining = tasks.filter(t =>
      !(t.recurring &&
        t.title === target.title &&
        String(t.client_id||'') === String(target.client_id||'') &&
        String(t.operator_id||'') === String(target.operator_id||''))
    );
  } else {
    remaining = tasks.filter(t => String(t.id) !== id);
  }
  req.tDB.saveExtra(remaining);
  res.json({ ok: true, removed: tasks.length - remaining.length });
});

// ─── OPERADORES ──────────────────────────────────────
app.get('/api/operators', auth, (req, res) => {
  const users = globalDB.users().filter(u => (u.tenant_id||'staffconect') === req.tenant);
  res.json(users.map(u => ({ id:u.id, name:u.name, email:u.email||null, role:u.role, noLogin:!!u.noLogin, assignedClients: u.assignedClients || [] })));
});

app.post('/api/operators/no-login', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const { name, assignedClients } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  const users = globalDB.users();
  const newUser = { id: Date.now(), name: name.trim(), email: null, password_hash: null, role: 'operator', noLogin: true, tenant_id: req.tenant, assignedClients: assignedClients || [] };
  globalDB.saveUsers([...users, newUser]);
  res.json({ ok: true, user: { id:newUser.id, name:newUser.name, noLogin:true } });
});

app.put('/api/operators/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  const { assignedClients } = req.body;
  globalDB.saveUsers(globalDB.users().map(u => u.id === id ? { ...u, assignedClients: assignedClients || [] } : u));
  res.json({ ok: true });
});

app.delete('/api/operators/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).json({ error: 'Não pode remover a si mesmo' });
  globalDB.saveUsers(globalDB.users().filter(u => u.id !== id));
  res.json({ ok: true });
});

// ─── TRILHA DO CONHECIMENTO (MANUAIS) ────────────────
app.get('/api/manuals', auth, (req, res) => {
  res.json(req.tDB.manuals());
});

app.post('/api/manuals', auth, (req, res) => {
  const { title, category, steps } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Título obrigatório' });
  const manual = { id: Date.now(), ...req.body, title: title.trim(), category: category || 'Geral', steps: steps || [], createdAt: new Date().toISOString() };
  req.tDB.saveManuals([...req.tDB.manuals(), manual]);
  res.json(manual);
});

app.put('/api/manuals/:id', auth, (req, res) => {
  const raw = req.params.id;
  const id = isNaN(raw) ? raw : Number(raw);
  req.tDB.saveManuals(req.tDB.manuals().map(m => String(m.id) === String(id) ? { ...m, ...req.body, id: m.id } : m));
  res.json({ ok: true });
});

app.delete('/api/manuals/:id', auth, (req, res) => {
  const raw = req.params.id;
  const id = isNaN(raw) ? raw : Number(raw);
  const manual = req.tDB.manuals().find(m => String(m.id) === String(id));
  if (manual?.isDefault && req.user.role !== 'master') {
    return res.status(403).json({ error: 'Modelos padrão só podem ser excluídos pelo Master StaffConect' });
  }
  req.tDB.saveManuals(req.tDB.manuals().filter(m => String(m.id) !== String(id)));
  res.json({ ok: true });
});

// Salva array completo de manuais (para reordenação)
app.put('/api/manuals', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Array esperado' });
  req.tDB.saveManuals(list);
  res.json({ ok: true });
});

// ─── CHAT ────────────────────────────────────────────
app.get('/api/chat', auth, (req, res) => {
  const messages = req.tDB.chat();
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
  const updated = [...req.tDB.chat(), msg].slice(-200);
  req.tDB.saveChat(updated);
  if(type !== 'system' && targetOpId) {
    const subs = req.tDB.pushSubs();
    const sub = subs[String(targetOpId)];
    if(sub) {
      const sender = req.user.name.split(' ')[0];
      webpush.sendNotification(sub, JSON.stringify({
        title: `💬 ${sender}`,
        body: text.trim().replace(/\*/g,'').slice(0, 100),
        tag: 'chat',
      })).catch(err => {
        if(err.statusCode === 410){ const s=req.tDB.pushSubs(); delete s[String(targetOpId)]; req.tDB.savePushSubs(s); }
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
    const data = req.tDB.contas(ym);
    Object.keys(data).forEach(date => { if (date >= start && date <= end) result[date] = data[date]; });
  });
  res.json(result);
});

app.put('/api/contas/:date/:clientId', auth, (req, res) => {
  const { date, clientId } = req.params;
  const ym = date.substring(0, 7);
  const data = req.tDB.contas(ym);
  if (!data[date]) data[date] = {};
  data[date][clientId] = req.body;
  req.tDB.saveContas(ym, data);
  res.json({ ok: true });
});

// ─── MENSAGENS PADRÃO ────────────────────────────────
app.get('/api/mensagens', auth, (req, res) => {
  res.json(req.tDB.mensagens());
});

app.post('/api/mensagens', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const { title, text } = req.body;
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'Título e texto obrigatórios' });
  const msg = { id: Date.now(), title: title.trim(), text: text.trim(), createdAt: new Date().toISOString() };
  req.tDB.saveMensagens([...req.tDB.mensagens(), msg]);
  res.json(msg);
});

app.put('/api/mensagens/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  req.tDB.saveMensagens(req.tDB.mensagens().map(m => m.id === id ? { ...m, ...req.body, id } : m));
  res.json({ ok: true });
});

app.delete('/api/mensagens/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const id = Number(req.params.id);
  req.tDB.saveMensagens(req.tDB.mensagens().filter(m => m.id !== id));
  res.json({ ok: true });
});

app.put('/api/mensagens', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Array esperado' });
  req.tDB.saveMensagens(list);
  res.json({ ok: true });
});

// ─── EMAIL NOTIFICAÇÕES ──────────────────────────────
app.get('/api/email-notifs', auth, (req, res) => {
  res.json(req.tDB.emailNotifs());
});

app.post('/api/email-notifs', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  const notifs = req.tDB.emailNotifs();
  const novo = { ...req.body, id: String(Date.now()), createdAt: new Date().toISOString(), readBy: [] };
  req.tDB.saveEmailNotifs([novo, ...notifs]);
  res.json(novo);
});

app.patch('/api/email-notifs/:id/read', auth, (req, res) => {
  const uid = String(req.user.id);
  const notifs = req.tDB.emailNotifs().map(n =>
    n.id === req.params.id ? { ...n, readBy: [...new Set([...(n.readBy||[]), uid])] } : n
  );
  req.tDB.saveEmailNotifs(notifs);
  res.json({ ok: true });
});

app.delete('/api/email-notifs/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admins' });
  req.tDB.saveEmailNotifs(req.tDB.emailNotifs().filter(n => n.id !== req.params.id));
  res.json({ ok: true });
});

// ─── PUSH NOTIFICATIONS ──────────────────────────────
app.get('/api/push/vapid-key', auth, (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', auth, (req, res) => {
  const subs = req.tDB.pushSubs();
  subs[String(req.user.id)] = req.body;
  req.tDB.savePushSubs(subs);
  res.json({ ok: true });
});

app.post('/api/push/notify', auth, (req, res) => {
  const { operatorId, title, body } = req.body;
  const subs = req.tDB.pushSubs();
  const sub = subs[String(operatorId)];
  if (!sub) return res.json({ ok: false, reason: 'sem inscrição' });
  webpush.sendNotification(sub, JSON.stringify({ title, body }))
    .then(() => res.json({ ok: true }))
    .catch(err => {
      if (err.statusCode === 410) { const s = req.tDB.pushSubs(); delete s[String(operatorId)]; req.tDB.savePushSubs(s); }
      res.json({ ok: false, reason: err.message });
    });
});

// ─── WEBHOOK — EMAIL MONITOR ─────────────────────────
app.post('/api/webhook/email-notify', (req, res) => {
  const { secret, tenant_id, cliente, cliente_id, remetente, assunto, data_recebido } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Não autorizado' });
  const tid = tenant_id || 'staffconect';
  const tDB = tenantDB(tid);
  const users   = globalDB.users().filter(u => (u.tenant_id||'staffconect') === tid);
  const clients = tDB.clients();

  const client = clients.find(c =>
    String(c.id) === String(cliente_id) ||
    c.name.toLowerCase() === (cliente || '').toLowerCase()
  );
  const operator = client
    ? users.find(u => !u.noLogin && (u.assignedClients || []).map(String).includes(String(client.id)))
    : null;

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
  tDB.saveExtra([task, ...tDB.extraTasks()]);

  if (operator) {
    const sub = tDB.pushSubs()[String(operator.id)];
    if (sub) {
      webpush.sendNotification(sub, JSON.stringify({
        title: `📧 Email — ${cliente}`,
        body:  `De: ${remetente}\n${assunto}`,
      })).catch(() => {});
    }
  }

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
  tDB.saveChat([...tDB.chat(), chatMsg].slice(-200));

  console.log(`[webhook/${tid}] Email notify: ${cliente} | ${remetente} | ${assunto}`);
  res.json({ ok: true, task_id: task.id, operator: operator?.name || null });
});

// ─── UPLOAD DE IMAGEM NO CHAT ────────────────────────
app.post('/api/chat/upload', auth, (req, res) => {
  const { data, mimeType } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Sem dados' });
  if (data.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Imagem muito grande (máx ~1.5 MB)' });
  const ext = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/gif' ? '.gif' : '.png';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const uploadDir = path.join(__dirname, 'public', 'uploads', 'chat');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(data, 'base64'));
  res.json({ url: `/uploads/chat/${filename}` });
});

// ─── WEBHOOK — INTAKE WORKER (Fase 1) ────────────────
app.post('/api/webhook/intake-notify', (req, res) => {
  const {
    secret, tenant_id, cliente, cliente_id, origem, remetente, assunto,
    classificacao, fornecedor, drive_url, drive_pasta, nome_arquivo,
    data_recebido, confianca, processado, link_original, motivo_falha,
  } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Não autorizado' });
  const tid = tenant_id || 'staffconect';
  const tDB = tenantDB(tid);
  const users   = globalDB.users().filter(u => (u.tenant_id||'staffconect') === tid);
  const clients = tDB.clients();

  const client = clients.find(c =>
    String(c.id) === String(cliente_id) ||
    c.name?.toLowerCase() === (cliente || '').toLowerCase()
  );
  const operator = client
    ? users.find(u => !u.noLogin && (u.assignedClients || []).map(String).includes(String(client.id)))
    : null;

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
  const notifs = tDB.emailNotifs();
  notifs.unshift(notif);
  tDB.saveEmailNotifs(notifs.slice(0, 500));

  if (operator) {
    const sub = tDB.pushSubs()[String(operator.id)];
    if (sub) {
      webpush.sendNotification(sub, JSON.stringify({
        title: `📄 ${(classificacao || 'Documento').toUpperCase()} — ${cliente}`,
        body:  `${fornecedor || remetente}\n${assunto}`,
      })).catch(() => {});
    }
  }

  console.log(`[intake-notify/${tid}] ${cliente} | ${classificacao} | ${confianca} | ${nome_arquivo}`);
  res.json({ ok: true, notif_id: notif.id });
});

app.post('/api/webhook/intake-operacional', (req, res) => {
  const {
    secret, tenant_id, cliente, cliente_id, origem, remetente, assunto,
    descricao, texto_original, data_recebido, critico,
  } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Não autorizado' });
  const tid = tenant_id || 'staffconect';
  const tDB = tenantDB(tid);

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
  const notifs = tDB.emailNotifs();
  notifs.unshift(notif);
  tDB.saveEmailNotifs(notifs.slice(0, 500));

  const users   = globalDB.users().filter(u => (u.tenant_id||'staffconect') === tid);
  const client  = tDB.clients().find(c => String(c.id) === String(cliente_id) || c.name?.toLowerCase() === (cliente||'').toLowerCase());
  const operator = client ? users.find(u => !u.noLogin && (u.assignedClients||[]).map(String).includes(String(client.id))) : null;
  if (operator) {
    const sub = tDB.pushSubs()[String(operator.id)];
    if (sub) webpush.sendNotification(sub, JSON.stringify({
      title: critico ? `🔴 CRÍTICO — ${cliente}` : `📋 Operacional — ${cliente}`,
      body:  descricao || assunto,
      tag:   critico ? 'critico' : 'operacional',
    })).catch(() => {});
  }

  console.log(`[intake-operacional/${tid}] ${cliente} | ${assunto} | critico=${!!critico}`);
  res.json({ ok: true, notif_id: notif.id });
});

// ─── WEBHOOK — FILA DE LANÇAMENTOS (Fase 2) ──────────
app.post('/api/webhook/intake-lancamento', (req, res) => {
  const {
    secret, tenant_id, cliente, cliente_id, origem, classificacao, fornecedor,
    drive_url, nome_arquivo, data_recebido, sugestao_ia, confianca, intake_id,
  } = req.body;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const tid = tenant_id || 'staffconect';
  const tDB = tenantDB(tid);

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
    status:       'pendente',
    sugestao_ia:  sugestao_ia || {},
    createdAt:    new Date().toISOString(),
    resolvedAt:   null,
    resolvedBy:   null,
    ca_id:        null,
    ca_erro:      null,
    rejeicao_motivo: null,
    lancamento_final: null,
  };

  const lista = tDB.intakeLancamentos();
  lista.unshift(lancamento);
  tDB.saveIntakeLancamentos(lista.slice(0, 500));

  const subs = tDB.pushSubs();
  Object.entries(subs).forEach(([, sub]) => {
    webpush.sendNotification(sub, JSON.stringify({
      title: `💰 Lançamento para aprovar — ${cliente}`,
      body:  `${fornecedor || classificacao}${sugestao_ia?.valor ? ' | R$ ' + sugestao_ia.valor : ''}`,
    })).catch(err => {
      if (err.statusCode === 410) { const s = tDB.pushSubs(); delete s[sub]; tDB.savePushSubs(s); }
    });
  });

  console.log(`[intake-lancamento/${tid}] ${cliente} | ${fornecedor} | ${sugestao_ia?.valor || ''}`);
  res.json({ ok: true, fila_id: lancamento.id });
});

app.get('/api/intake-lancamentos', auth, (req, res) => {
  const status = req.query.status || null;
  const limit  = parseInt(req.query.limit) || 100;
  let lista = req.tDB.intakeLancamentos();
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

app.post('/api/intake/aprovar/:id', auth, async (req, res) => {
  const fila_id = req.params.id;
  const lista   = req.tDB.intakeLancamentos();
  const idx     = lista.findIndex(l => l.id === fila_id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.status !== 'pendente') return res.status(409).json({ ok: false, error: `Já ${item.status}` });

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
    ca_id = JSON.parse(caRes.body).ca_id || null;
    console.log(`[intake-aprovar] CA ok | ca_id: ${ca_id}`);
  } catch (err) {
    ca_erro = err.message;
    console.error(`[intake-aprovar] Erro CA API: ${ca_erro}`);
  }

  lista[idx] = { ...item, status: 'aprovado', resolvedAt: new Date().toISOString(), resolvedBy: req.user.name, ca_id, ca_erro, lancamento_final: lancamento };
  req.tDB.saveIntakeLancamentos(lista);

  console.log(`[intake-aprovar] ${item.cliente} | ${item.fornecedor} | ca_id: ${ca_id}${ca_erro ? ` | ERRO: ${ca_erro}` : ''}`);
  res.json({ ok: true, ca_id, ca_erro });
});

app.post('/api/intake/rejeitar/:id', auth, (req, res) => {
  const fila_id = req.params.id;
  const lista   = req.tDB.intakeLancamentos();
  const idx     = lista.findIndex(l => l.id === fila_id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.status !== 'pendente') return res.status(409).json({ ok: false, error: `Já ${item.status}` });

  lista[idx] = { ...item, status: 'rejeitado', resolvedAt: new Date().toISOString(), resolvedBy: req.user.name, rejeicao_motivo: req.body.motivo || '' };
  req.tDB.saveIntakeLancamentos(lista);

  console.log(`[intake-rejeitar] ${item.cliente} | ${item.fornecedor} | motivo: ${req.body.motivo || ''}`);
  res.json({ ok: true });
});

app.post('/api/intake/retentar-ca/:id', auth, async (req, res) => {
  const fila_id = req.params.id;
  const lista   = req.tDB.intakeLancamentos();
  const idx     = lista.findIndex(l => l.id === fila_id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.status !== 'aprovado') return res.status(409).json({ ok: false, error: `Status atual: ${item.status} (precisa ser aprovado)` });
  if (item.ca_id)                 return res.status(409).json({ ok: false, error: `Já lançado no CA: ${item.ca_id}` });

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

  let ca_id = null, ca_erro = null;
  try {
    const caRes = await _chamarCAApi(lancamento);
    if (caRes.status >= 400) {
      const detail = (() => { try { return JSON.parse(caRes.body)?.detail || caRes.body; } catch { return caRes.body; } })();
      throw new Error(`CA ${caRes.status}: ${detail}`);
    }
    ca_id = JSON.parse(caRes.body).ca_id || null;
    console.log(`[retentar-ca] CA ok | ca_id: ${ca_id}`);
  } catch (err) {
    ca_erro = err.message;
    console.error(`[retentar-ca] Erro CA API: ${ca_erro}`);
  }

  lista[idx] = { ...item, ca_id, ca_erro, lancamento_final: lancamento };
  req.tDB.saveIntakeLancamentos(lista);
  res.json({ ok: !!ca_id, ca_id, ca_erro });
});

app.delete('/api/intake/lancamento/:id', auth, (req, res) => {
  const lista = req.tDB.intakeLancamentos();
  const idx   = lista.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Lançamento não encontrado' });

  const item = lista[idx];
  if (item.ca_id) return res.status(409).json({ ok: false, error: 'Lançamento já registrado no CA — não pode excluir' });

  lista.splice(idx, 1);
  req.tDB.saveIntakeLancamentos(lista);
  console.log(`[intake-delete] Lançamento ${req.params.id} removido por ${req.user?.name || 'operador'}`);
  res.json({ ok: true });
});

// ─── BOOTSTRAP MASTER ────────────────────────────────
// Cria o primeiro usuário master. Desabilitado automaticamente após o primeiro uso.
// Uso: POST /api/bootstrap-master { secret, name, email, password }
// Secret definido via env BOOTSTRAP_SECRET (padrão: não funciona sem definir)
app.post('/api/bootstrap-master', (req, res) => {
  const BOOTSTRAP = process.env.BOOTSTRAP_SECRET;
  if (!BOOTSTRAP) return res.status(403).json({ error: 'BOOTSTRAP_SECRET não configurado' });
  const { secret, name, email, password } = req.body || {};
  if (secret !== BOOTSTRAP) return res.status(403).json({ error: 'Secret inválido' });
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password obrigatórios' });
  const users = globalDB.users();
  if (users.find(u => u.role === 'master')) return res.status(409).json({ error: 'Usuário master já existe' });
  const emailNorm = email.toLowerCase().trim();
  if (users.find(u => u.email === emailNorm)) return res.status(409).json({ error: 'E-mail já cadastrado' });
  const master = { id: Date.now(), name, email: emailNorm, password_hash: bcrypt.hashSync(password, 10), role: 'master', tenant_id: null };
  globalDB.saveUsers([...users, master]);
  console.log(`[bootstrap] Usuário master criado: ${emailNorm}`);
  res.json({ ok: true, message: 'Master criado. Remova BOOTSTRAP_SECRET do env.' });
});

// ─── MASTER API ──────────────────────────────────────
function masterAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.role !== 'master') return res.status(403).json({ error: 'Acesso restrito ao Master' });
    next();
  } catch { res.status(401).json({ error: 'Sessão expirada' }); }
}

// GET /api/master/tenants — lista tenants com stats
app.get('/api/master/tenants', masterAuth, (req, res) => {
  const tenants = globalDB.tenants();
  const allUsers = globalDB.users();
  const result = tenants.map(t => {
    const tDB = tenantDB(t.id);
    const users = allUsers.filter(u => (u.tenant_id||'staffconect') === t.id);
    const clients = tDB.clients();
    const extra = tDB.extraTasks();
    const lastRun = tDB.lastDailyRun();
    return {
      ...t,
      stats: {
        users:    users.length,
        clients:  clients.length,
        tasks:    extra.filter(x => x.status !== 'done').length,
        lastActivity: lastRun.ts || null,
      },
    };
  });
  res.json(result);
});

// POST /api/master/tenants — cria novo tenant
app.post('/api/master/tenants', masterAuth, (req, res) => {
  const { id, name, plan, primaryColor, activeTabIds } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id e name obrigatórios' });
  const slug = id.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const tenants = globalDB.tenants();
  if (tenants.find(t => t.id === slug)) return res.status(409).json({ error: 'Tenant já existe' });
  const tenant = {
    id: slug, name, plan: plan || 'basic', primaryColor: primaryColor || '#00C48C',
    activeTabIds: activeTabIds || ['fila','tarefas','clientes','conhecimento','chat'],
    active: true, createdAt: new Date().toISOString(),
  };
  globalDB.saveTenants([...tenants, tenant]);
  seedTenantDefaults(slug);
  res.json(tenant);
});

// PUT /api/master/tenants/:id — edita tenant
app.put('/api/master/tenants/:id', masterAuth, (req, res) => {
  const tenants = globalDB.tenants().map(t =>
    t.id === req.params.id ? { ...t, ...req.body, id: t.id } : t
  );
  globalDB.saveTenants(tenants);
  res.json({ ok: true });
});

// GET /api/tenant-info — retorna config do tenant atual (activeTabIds etc.)
app.get('/api/tenant-info', auth, (req, res) => {
  const tenants = globalDB.tenants();
  const tenant  = tenants.find(t => t.id === req.tenant) || { id: req.tenant, activeTabIds: null };
  res.json({ id: tenant.id, name: tenant.name, activeTabIds: tenant.activeTabIds || null, primaryColor: tenant.primaryColor || '#00C48C', requiresApproval: !!tenant.requiresApproval });
});

// POST /api/master/impersonate/:tenantId — master obtém token de admin para visualizar o Gestor de um tenant
app.post('/api/master/impersonate/:tenantId', masterAuth, (req, res) => {
  const tid = req.params.tenantId;
  const tenants = globalDB.tenants();
  if (!tenants.find(t => t.id === tid)) return res.status(404).json({ error: 'Empresa não encontrada' });
  const token = jwt.sign(
    { id: req.user.id, name: req.user.name + ' (Master)', email: req.user.email, role: 'admin', tenant_id: tid, _impersonated: true },
    JWT_SECRET, { expiresIn: '8h' }
  );
  res.json({ token });
});

// GET /api/master/tenants/:id/integrations
app.get('/api/master/tenants/:id/integrations', masterAuth, (req, res) => {
  const tid = req.params.id;
  const tPath = path.join(DATA, tid, 'integrations.json');
  const cfg = fs.existsSync(tPath) ? JSON.parse(fs.readFileSync(tPath, 'utf8')) : {};
  // Ofusca senhas antes de enviar
  const safe = JSON.parse(JSON.stringify(cfg));
  if (safe.ca?.secret)              safe.ca.secret = '••••••••';
  if (safe.email?.pass)             safe.email.pass = '••••••••';
  if (safe.drive?.serviceAccount)   safe.drive.serviceAccount = '••••••••';
  res.json(safe);
});

// PUT /api/master/tenants/:id/integrations
app.put('/api/master/tenants/:id/integrations', masterAuth, (req, res) => {
  const tid = req.params.id;
  const tDir = path.join(DATA, tid);
  if (!fs.existsSync(tDir)) fs.mkdirSync(tDir, { recursive: true });
  const tPath = path.join(tDir, 'integrations.json');
  // Merge: se campo é '••••••••' mantém o valor anterior
  const existing = fs.existsSync(tPath) ? JSON.parse(fs.readFileSync(tPath, 'utf8')) : {};
  const body = req.body;
  const merged = { ...existing };
  if (body.ca) {
    merged.ca = { ...existing.ca, ...body.ca };
    if (body.ca.secret === '••••••••') merged.ca.secret = existing.ca?.secret || '';
  }
  if (body.email) {
    merged.email = { ...existing.email, ...body.email };
    if (body.email.pass === '••••••••') merged.email.pass = existing.email?.pass || '';
  }
  if (body.drive) {
    merged.drive = { ...existing.drive, ...body.drive };
    if (body.drive.serviceAccount === '••••••••') merged.drive.serviceAccount = existing.drive?.serviceAccount || '';
  }
  fs.writeFileSync(tPath, JSON.stringify(merged, null, 2));
  res.json({ ok: true });
});

// POST /api/master/tenants/:id/integrations/test-ca
app.post('/api/master/tenants/:id/integrations/test-ca', masterAuth, async (req, res) => {
  const tid = req.params.id;
  const tPath = path.join(DATA, tid, 'integrations.json');
  const cfg = fs.existsSync(tPath) ? JSON.parse(fs.readFileSync(tPath, 'utf8')) : {};
  const url    = cfg.ca?.url    || CA_API_URL;
  const secret = cfg.ca?.secret || CA_API_SECRET;
  try {
    const https = require('https');
    const http  = require('http');
    const lib   = url.startsWith('https') ? https : http;
    await new Promise((resolve, reject) => {
      const req2 = lib.request(`${url}/api/health`, { method:'GET', headers:{ 'x-api-secret': secret }, timeout:5000 }, r => {
        r.resume();
        r.statusCode < 500 ? resolve(r.statusCode) : reject(new Error(`HTTP ${r.statusCode}`));
      });
      req2.on('error', reject);
      req2.on('timeout', ()=>{ req2.destroy(); reject(new Error('Timeout')); });
      req2.end();
    });
    res.json({ ok: true, message: 'Conexão com Conta Azul OK' });
  } catch (e) {
    res.status(502).json({ error: `Falha: ${e.message}` });
  }
});

// GET /api/master/users — todos os usuários com info de tenant
app.get('/api/master/users', masterAuth, (req, res) => {
  const users = globalDB.users().map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role,
    tenant_id: u.tenant_id || 'staffconect', noLogin: !!u.noLogin,
    assignedClients: u.assignedClients || [],
  }));
  res.json(users);
});

// POST /api/master/reset-password — reseta senha de qualquer usuário
app.post('/api/master/reset-password', masterAuth, (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword) return res.status(400).json({ error: 'userId e newPassword obrigatórios' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres' });
  const users = globalDB.users();
  const idx = users.findIndex(u => String(u.id) === String(userId));
  if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado' });
  users[idx] = { ...users[idx], password_hash: bcrypt.hashSync(newPassword, 10), must_change_password: true };
  globalDB.saveUsers(users);
  console.log(`[master] Reset de senha: ${users[idx].name} (${users[idx].email})`);
  res.json({ ok: true });
});

// GET /api/master/aprovacoes — tarefas pending_approval de todos os tenants
app.get('/api/master/aprovacoes', masterAuth, (req, res) => {
  const result = [];
  getActiveTenantIds().forEach(tid => {
    const tenant = globalDB.tenants().find(t => t.id === tid);
    tenantDB(tid).extraTasks()
      .filter(t => t.status === 'pending_approval')
      .forEach(t => result.push({ ...t, tenant_id: tid, tenant_name: tenant?.name || tid }));
  });
  result.sort((a,b) => new Date(b.approval_requested_at||0) - new Date(a.approval_requested_at||0));
  res.json(result);
});

// POST /api/master/extra-tasks/:tenantId/:id/aprovar — master aprova de qualquer tenant
app.post('/api/master/extra-tasks/:tenantId/:id/aprovar', masterAuth, (req, res) => {
  const tDB = tenantDB(req.params.tenantId);
  const tasks = tDB.extraTasks();
  const idx = tasks.findIndex(t => String(t.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tarefa não encontrada' });
  tasks[idx] = { ...tasks[idx], status: 'done', done_at: new Date().toISOString(),
    approved_at: new Date().toISOString(), approved_by: req.user.name,
    approval_comment: req.body.comment || null, rejected_reason: null };
  tDB.saveExtra(tasks);
  res.json({ ok: true });
});

// POST /api/master/extra-tasks/:tenantId/:id/rejeitar — master rejeita de qualquer tenant
app.post('/api/master/extra-tasks/:tenantId/:id/rejeitar', masterAuth, (req, res) => {
  const tDB = tenantDB(req.params.tenantId);
  const tasks = tDB.extraTasks();
  const idx = tasks.findIndex(t => String(t.id) === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tarefa não encontrada' });
  tasks[idx] = { ...tasks[idx], status: 'pending', done_at: null,
    rejected_at: new Date().toISOString(), rejected_by: req.user.name,
    rejected_reason: req.body.reason || '', approved_at: null, approved_by: null };
  tDB.saveExtra(tasks);
  res.json({ ok: true });
});

// POST /api/master/users — cria usuário em qualquer tenant
app.post('/api/master/users', masterAuth, (req, res) => {
  const { name, email, password, role, tenant_id } = req.body;
  if (!name || !email || !password || !tenant_id) return res.status(400).json({ error: 'name, email, password e tenant_id obrigatórios' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres' });
  const users = globalDB.users();
  const emailNorm = email.toLowerCase().trim();
  if (users.find(u => u.email === emailNorm)) return res.status(409).json({ error: 'E-mail já cadastrado' });
  const newUser = {
    id: Date.now(), name, email: emailNorm,
    password_hash: bcrypt.hashSync(password, 10),
    role: role || 'operator', tenant_id, assignedClients: [],
    must_change_password: true,
  };
  globalDB.saveUsers([...users, newUser]);
  res.json({ ok: true, user: { id: newUser.id, name, email: emailNorm, role: newUser.role, tenant_id } });
});

// PUT /api/master/users/:id — edita nome, email, role de usuário (master only)
app.put('/api/master/users/:id', masterAuth, (req, res) => {
  const id = isNaN(req.params.id) ? req.params.id : Number(req.params.id);
  const { name, email, role } = req.body;
  const users = globalDB.users();
  const idx = users.findIndex(u => String(u.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (users[idx].role === 'master') return res.status(403).json({ error: 'Não é possível editar o usuário master' });
  if (name)  users[idx].name  = name.trim();
  if (email) users[idx].email = email.toLowerCase().trim();
  if (role && ['operator','admin'].includes(role)) users[idx].role = role;
  globalDB.saveUsers(users);
  res.json({ ok: true });
});

// DELETE /api/master/users/:id — remove usuário por ID (master only)
app.delete('/api/master/users/:id', masterAuth, (req, res) => {
  const id = isNaN(req.params.id) ? req.params.id : Number(req.params.id);
  const users = globalDB.users();
  const target = users.find(u => String(u.id) === String(id));
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.role === 'master') return res.status(403).json({ error: 'Não é possível excluir o usuário master' });
  globalDB.saveUsers(users.filter(u => String(u.id) !== String(id)));
  res.json({ ok: true, removed: target.name });
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
