/**
 * migrate.js — Migra dados existentes (Oracle) para estrutura multi-tenant.
 *
 * Uso: node migrate.js [--tenant staffconect]
 *
 * O que faz:
 *   1. Move data/*.json → data/staffconect/*.json
 *   2. Move data/day_tasks/ → data/staffconect/day_tasks/
 *   3. Move data/contas/ → data/staffconect/contas/
 *   4. Adiciona tenant_id='staffconect' em todos os usuários existentes
 *   5. Cria data/tenants.json com o tenant staffconect
 *
 * Seguro para re-executar: não sobrescreve se o destino já existir.
 */

const fs   = require('fs');
const path = require('path');

const DATA   = process.env.DATA_DIR || path.join(__dirname, 'data');
const TENANT = process.argv.find((a, i) => process.argv[i-1] === '--tenant') || 'staffconect';
const DEST   = path.join(DATA, TENANT);

console.log(`\n🔄 Migração: ${DATA} → ${DEST}\n`);

fs.mkdirSync(DEST, { recursive: true });

// ── 1. JSONs raiz (exceto users.json e tenants.json que ficam globais) ────────
const ROOT_FILES = [
  'clients.json',
  'extra_tasks.json',
  'manuals.json',
  'chat.json',
  'mensagens.json',
  'email_notifs.json',
  'intake_lancamentos.json',
  'push_subs.json',
  'last_daily_run.json',
  'vapid.json',  // vapid continua global — apenas registramos, não movemos
];

ROOT_FILES.forEach(file => {
  const src = path.join(DATA, file);
  const dst = path.join(DEST, file);
  if (file === 'vapid.json') return; // vapid fica global
  if (!fs.existsSync(src)) { console.log(`  ⚠ Não encontrado (ignorado): ${file}`); return; }
  if (fs.existsSync(dst))  { console.log(`  ✓ Já existe (pulado): ${TENANT}/${file}`); return; }
  fs.copyFileSync(src, dst);
  console.log(`  ✓ ${file} → ${TENANT}/${file}`);
});

// ── 2. Subpastas ──────────────────────────────────────────────────────────────
['day_tasks', 'contas'].forEach(dir => {
  const src = path.join(DATA, dir);
  const dst = path.join(DEST, dir);
  if (!fs.existsSync(src)) { console.log(`  ⚠ Não encontrado (ignorado): ${dir}/`); return; }
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  fs.readdirSync(src).forEach(file => {
    const s = path.join(src, file);
    const d = path.join(dst, file);
    if (!fs.existsSync(d)) { fs.copyFileSync(s, d); count++; }
  });
  console.log(`  ✓ ${dir}/ → ${TENANT}/${dir}/ (${count} arquivo(s) copiado(s))`);
});

// ── 3. Adiciona tenant_id nos usuários ───────────────────────────────────────
const usersFile = path.join(DATA, 'users.json');
if (fs.existsSync(usersFile)) {
  const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  let updated = 0;
  const newUsers = users.map(u => {
    if (u.tenant_id) return u;
    updated++;
    return { ...u, tenant_id: TENANT };
  });
  if (updated > 0) {
    fs.writeFileSync(usersFile, JSON.stringify(newUsers, null, 2));
    console.log(`  ✓ users.json — tenant_id='${TENANT}' adicionado em ${updated} usuário(s)`);
  } else {
    console.log(`  ✓ users.json — todos os usuários já têm tenant_id`);
  }
} else {
  console.log(`  ⚠ users.json não encontrado`);
}

// ── 4. Cria/atualiza tenants.json ─────────────────────────────────────────────
const tenantsFile = path.join(DATA, 'tenants.json');
let tenants = fs.existsSync(tenantsFile) ? JSON.parse(fs.readFileSync(tenantsFile, 'utf8')) : [];
if (!tenants.find(t => t.id === TENANT)) {
  tenants.push({
    id:          TENANT,
    name:        'Staff Conect',
    active:      true,
    plan:        'pro',
    primaryColor:'#1a73e8',
    createdAt:   new Date().toISOString(),
  });
  fs.writeFileSync(tenantsFile, JSON.stringify(tenants, null, 2));
  console.log(`  ✓ tenants.json — tenant '${TENANT}' registrado`);
} else {
  console.log(`  ✓ tenants.json — tenant '${TENANT}' já existe`);
}

console.log('\n✅ Migração concluída!\n');
console.log('Próximos passos:');
console.log('  1. Verifique os arquivos em data/' + TENANT + '/');
console.log('  2. Teste o servidor: node server.js');
console.log('  3. Após confirmar, pode remover os JSONs antigos da raiz de data/\n');
