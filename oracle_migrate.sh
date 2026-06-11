#!/bin/bash
# oracle_migrate.sh — Baixa dados do Oracle Cloud e prepara para upload ao Railway
#
# Uso:
#   1. Edite as variáveis abaixo
#   2. chmod +x oracle_migrate.sh && ./oracle_migrate.sh
#   3. Siga os passos finais para fazer upload ao Railway

# ── CONFIG ────────────────────────────────────────────────────────────────────
ORACLE_HOST="136.248.112.181"
ORACLE_USER="opc"                        # usuário SSH do Oracle Cloud (normalmente opc ou ubuntu)
ORACLE_KEY="oracle ssh-key-2026-04-21.key"  # chave privada SSH (já está na raiz do projeto)
ORACLE_DATA_DIR="/home/opc/gestor/data"  # ajuste para o caminho real no Oracle
LOCAL_BACKUP="./oracle_backup"
TENANT="staffconect"
# ──────────────────────────────────────────────────────────────────────────────

set -e
echo ""
echo "======================================================"
echo "  Migração Oracle → Railway — Gestor de Tarefas"
echo "======================================================"
echo ""

# 1. Cria pasta local de backup
mkdir -p "$LOCAL_BACKUP"

echo "📥 Baixando dados do Oracle ($ORACLE_HOST)..."

# Arquivos JSON da raiz
for FILE in users.json clients.json extra_tasks.json manuals.json mensagens.json email_notifs.json intake_lancamentos.json; do
  echo "  ↓ $FILE"
  scp -i "$ORACLE_KEY" -o StrictHostKeyChecking=no \
    "$ORACLE_USER@$ORACLE_HOST:$ORACLE_DATA_DIR/$FILE" \
    "$LOCAL_BACKUP/$FILE" 2>/dev/null || echo "    ⚠ Não encontrado: $FILE"
done

# Pasta day_tasks (opcional — pode perder)
echo "  ↓ day_tasks/ (opcional)"
mkdir -p "$LOCAL_BACKUP/day_tasks"
scp -i "$ORACLE_KEY" -o StrictHostKeyChecking=no -r \
  "$ORACLE_USER@$ORACLE_HOST:$ORACLE_DATA_DIR/day_tasks/" \
  "$LOCAL_BACKUP/" 2>/dev/null || echo "    ⚠ day_tasks não encontrado (ok)"

echo ""
echo "✅ Download concluído em: $LOCAL_BACKUP/"
echo ""

# 2. Aplica estrutura multi-tenant localmente
echo "🔄 Reestruturando para multi-tenant (data/$TENANT/)..."
DATA_DIR="./data"
DEST_DIR="$DATA_DIR/$TENANT"
mkdir -p "$DEST_DIR/day_tasks" "$DEST_DIR/contas"

for FILE in clients.json extra_tasks.json manuals.json mensagens.json email_notifs.json intake_lancamentos.json; do
  SRC="$LOCAL_BACKUP/$FILE"
  DST="$DEST_DIR/$FILE"
  if [ -f "$SRC" ]; then
    if [ -f "$DST" ]; then
      echo "  ✓ $FILE já existe em data/$TENANT/ — PULANDO (não sobrescreve)"
    else
      cp "$SRC" "$DST"
      echo "  ✓ $FILE → data/$TENANT/$FILE"
    fi
  fi
done

# Copia day_tasks se existir
if [ -d "$LOCAL_BACKUP/day_tasks" ]; then
  cp -n "$LOCAL_BACKUP/day_tasks/"* "$DEST_DIR/day_tasks/" 2>/dev/null && \
    echo "  ✓ day_tasks/ copiado" || echo "  ✓ day_tasks/ — nenhum arquivo novo"
fi

# Atualiza users.json (adiciona tenant_id se não tiver)
echo "  🔧 Atualizando users.json..."
node - <<'JSEOF'
const fs = require('fs');
const src = './oracle_backup/users.json';
const dst = './data/users.json';
if (!fs.existsSync(src)) { console.log('    ⚠ users.json não encontrado no backup'); process.exit(0); }
const backupUsers = JSON.parse(fs.readFileSync(src,'utf8'));
const existingUsers = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst,'utf8')) : [];
const existingEmails = new Set(existingUsers.map(u=>u.email));
let added = 0;
const merged = [...existingUsers];
for (const u of backupUsers) {
  if (existingEmails.has(u.email)) { console.log(`    ✓ Já existe: ${u.email}`); continue; }
  merged.push({ ...u, tenant_id: 'staffconect' });
  added++;
  console.log(`    + Importado: ${u.email}`);
}
fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
console.log(`    ✓ users.json: ${added} usuário(s) importado(s)`);
JSEOF

echo ""
echo "======================================================"
echo "  ✅ Preparação local concluída!"
echo "======================================================"
echo ""
echo "PRÓXIMOS PASSOS — Upload para Railway:"
echo ""
echo "  Opção A — Railway CLI (recomendado):"
echo "    1. railway login"
echo "    2. railway link   (selecione o projeto Gestor)"
echo "    3. railway volume  (confirme que o volume está em /data)"
echo "    4. Para cada arquivo em data/staffconect/, faça upload via:"
echo "       railway run --service <service-name> -- cp /path/local /data/staffconect/"
echo ""
echo "  Opção B — Via script de seed no primeiro boot:"
echo "    1. Adicione os JSONs em data/ no repositório (temporariamente)"
echo "    2. Faça push → Railway vai deployar com os dados"
echo "    3. REMOVA os JSONs do repositório depois e faça novo push"
echo ""
echo "  Opção C — Acesso direto ao Volume (mais simples):"
echo "    1. No painel Railway → seu serviço → 'Shell' ou 'Connect'"
echo "    2. Use o terminal Railway para confirmar os arquivos em /data/"
echo "    3. Os arquivos já devem estar lá se migrate.js foi executado"
echo ""
echo "Dica: Verifique os dados em data/$TENANT/ antes de fazer upload."
echo ""
