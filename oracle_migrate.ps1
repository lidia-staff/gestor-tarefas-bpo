# oracle_migrate.ps1 — Migração Oracle Cloud → Railway (Windows PowerShell)
#
# Pré-requisitos:
#   - OpenSSH instalado (já vem no Windows 10/11: Settings > Apps > Optional Features > OpenSSH Client)
#   - Node.js instalado (para mesclar users.json)
#   - Chave SSH na raiz do projeto: "oracle ssh-key-2026-04-21.key"
#
# Uso:
#   1. Abra o PowerShell na pasta do projeto:  cd "C:\Gestor de tarefas"
#   2. Ajuste as variáveis CONFIG abaixo se necessário
#   3. Execute:  .\oracle_migrate.ps1
#   4. Siga as instruções de upload ao Railway que aparecem no final

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── CONFIG ────────────────────────────────────────────────────────────────────
$ORACLE_HOST    = "136.248.112.181"
$ORACLE_USER    = "opc"                            # usuário SSH (normalmente opc ou ubuntu)
$ORACLE_KEY     = ".\oracle ssh-key-2026-04-21.key" # chave privada — já está na raiz
$ORACLE_DATADIR = "/home/opc/gestor/data"          # caminho dos dados no servidor Oracle
$LOCAL_BACKUP   = ".\oracle_backup"
$TENANT         = "staffconect"
$LOCAL_DATA     = ".\data"
# ─────────────────────────────────────────────────────────────────────────────

$SSH_OPTS = "-i `"$ORACLE_KEY`" -o StrictHostKeyChecking=no -o BatchMode=yes"
$REMOTE   = "$ORACLE_USER@$ORACLE_HOST"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Migração Oracle → Railway — Gestor de Tarefas" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ── 0. Verifica dependências ──────────────────────────────────────────────────
Write-Host "🔍 Verificando dependências..." -ForegroundColor Yellow

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "  ❌ OpenSSH não encontrado." -ForegroundColor Red
    Write-Host "     Instale via: Settings > Apps > Optional Features > OpenSSH Client" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ ssh" -ForegroundColor Green

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    Write-Host "  ❌ scp não encontrado. Instale OpenSSH Client." -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ scp" -ForegroundColor Green

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  ⚠ Node.js não encontrado — merge de users.json será pulado." -ForegroundColor Yellow
    $hasNode = $false
} else {
    Write-Host "  ✓ node" -ForegroundColor Green
    $hasNode = $true
}

if (-not (Test-Path $ORACLE_KEY)) {
    Write-Host "  ❌ Chave SSH não encontrada: $ORACLE_KEY" -ForegroundColor Red
    Write-Host "     Certifique-se de que a chave está na pasta do projeto." -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Chave SSH: $ORACLE_KEY" -ForegroundColor Green

# Permissões da chave (Windows exige que só o usuário atual tenha acesso)
Write-Host "  🔧 Ajustando permissões da chave SSH..."
icacls $ORACLE_KEY /inheritance:r /grant:r "$env:USERNAME`:F" 2>$null | Out-Null
Write-Host "  ✓ Permissões OK" -ForegroundColor Green

# ── 1. Testa conexão SSH ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "🔌 Testando conexão SSH com $ORACLE_HOST..." -ForegroundColor Yellow

$testResult = ssh -i $ORACLE_KEY -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" "echo OK" 2>&1
if ($testResult -ne "OK") {
    Write-Host "  ❌ Falha na conexão SSH. Saída:" -ForegroundColor Red
    Write-Host "     $testResult" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Verifique:" -ForegroundColor Yellow
    Write-Host "    - IP: $ORACLE_HOST (servidor Oracle ativo?)"
    Write-Host "    - Usuário: $ORACLE_USER"
    Write-Host "    - Chave: $ORACLE_KEY (correta?)"
    Write-Host "    - Firewall Oracle: porta 22 aberta?"
    exit 1
}
Write-Host "  ✓ Conexão OK" -ForegroundColor Green

# ── 2. Descobre o caminho real dos dados no Oracle ───────────────────────────
Write-Host ""
Write-Host "🔍 Descobrindo estrutura de pastas no Oracle..." -ForegroundColor Yellow

$remoteCheck = ssh -i $ORACLE_KEY -o StrictHostKeyChecking=no "$REMOTE" "ls $ORACLE_DATADIR 2>/dev/null && echo FOUND || echo NOTFOUND" 2>&1
if ($remoteCheck -match "NOTFOUND") {
    Write-Host "  ⚠ Pasta '$ORACLE_DATADIR' não encontrada. Tentando localizar..." -ForegroundColor Yellow
    $remoteFind = ssh -i $ORACLE_KEY -o StrictHostKeyChecking=no "$REMOTE" "find /home -name 'clients.json' 2>/dev/null | head -3" 2>&1
    if ($remoteFind) {
        Write-Host "  Arquivos encontrados em:" -ForegroundColor Cyan
        Write-Host "    $remoteFind"
        Write-Host ""
        Write-Host "  ➡ Edite a variável `$ORACLE_DATADIR no script com o caminho correto e execute novamente." -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "  ❌ Nenhum clients.json encontrado no Oracle. Verifique o caminho." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  ✓ Pasta encontrada: $ORACLE_DATADIR" -ForegroundColor Green

# ── 3. Cria pasta de backup local ─────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $LOCAL_BACKUP | Out-Null
New-Item -ItemType Directory -Force -Path "$LOCAL_DATA\$TENANT\day_tasks" | Out-Null
New-Item -ItemType Directory -Force -Path "$LOCAL_DATA\$TENANT\contas" | Out-Null

# ── 4. Download dos arquivos JSON ─────────────────────────────────────────────
Write-Host ""
Write-Host "📥 Baixando arquivos do Oracle..." -ForegroundColor Yellow

$FILES_TENANT = @("clients.json", "extra_tasks.json", "manuals.json", "mensagens.json", "email_notifs.json", "intake_lancamentos.json")
$FILES_GLOBAL = @("users.json")

foreach ($file in ($FILES_GLOBAL + $FILES_TENANT)) {
    $remotePath = "$REMOTE`:$ORACLE_DATADIR/$file"
    $localPath  = "$LOCAL_BACKUP\$file"
    Write-Host "  ↓ $file..." -NoNewline
    $result = scp -i $ORACLE_KEY -o StrictHostKeyChecking=no "$remotePath" "$localPath" 2>&1
    if (Test-Path $localPath) {
        $size = (Get-Item $localPath).Length
        Write-Host " ✓ ($size bytes)" -ForegroundColor Green
    } else {
        Write-Host " ⚠ não encontrado" -ForegroundColor Yellow
    }
}

# Baixa day_tasks/ (opcional)
Write-Host "  ↓ day_tasks/ (opcional)..." -NoNewline
New-Item -ItemType Directory -Force -Path "$LOCAL_BACKUP\day_tasks" | Out-Null
$dtResult = scp -i $ORACLE_KEY -o StrictHostKeyChecking=no -r "$REMOTE`:$ORACLE_DATADIR/day_tasks/" "$LOCAL_BACKUP\" 2>&1
if (Test-Path "$LOCAL_BACKUP\day_tasks") {
    $dtCount = (Get-ChildItem "$LOCAL_BACKUP\day_tasks" -ErrorAction SilentlyContinue).Count
    Write-Host " ✓ ($dtCount arquivo(s))" -ForegroundColor Green
} else {
    Write-Host " ⚠ não encontrado (ok — pode perder)" -ForegroundColor Yellow
}

# ── 5. Copia para data/{tenant}/ ──────────────────────────────────────────────
Write-Host ""
Write-Host "🔄 Copiando para $LOCAL_DATA\$TENANT\..." -ForegroundColor Yellow

foreach ($file in $FILES_TENANT) {
    $src = "$LOCAL_BACKUP\$file"
    $dst = "$LOCAL_DATA\$TENANT\$file"
    if (-not (Test-Path $src)) { Write-Host "  ⚠ Pulado (não baixado): $file" -ForegroundColor Yellow; continue }
    if (Test-Path $dst) {
        Write-Host "  ✓ $file já existe em data\$TENANT\ — MANTENDO (não sobrescreve)" -ForegroundColor Cyan
    } else {
        Copy-Item $src $dst
        Write-Host "  ✓ $file → data\$TENANT\$file" -ForegroundColor Green
    }
}

# Copia day_tasks
if (Test-Path "$LOCAL_BACKUP\day_tasks") {
    $dtFiles = Get-ChildItem "$LOCAL_BACKUP\day_tasks" -ErrorAction SilentlyContinue
    $copied = 0
    foreach ($f in $dtFiles) {
        $dst = "$LOCAL_DATA\$TENANT\day_tasks\$($f.Name)"
        if (-not (Test-Path $dst)) { Copy-Item $f.FullName $dst; $copied++ }
    }
    Write-Host "  ✓ day_tasks/: $copied arquivo(s) novo(s) copiado(s)" -ForegroundColor Green
}

# ── 6. Mescla users.json ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "🔧 Mesclando users.json..." -ForegroundColor Yellow

$usersBackup = "$LOCAL_BACKUP\users.json"
$usersDest   = "$LOCAL_DATA\users.json"

if (-not (Test-Path $usersBackup)) {
    Write-Host "  ⚠ users.json não encontrado no backup — pulando" -ForegroundColor Yellow
} elseif ($hasNode) {
    $mergeScript = @"
const fs = require('fs');
const src = '$($usersBackup -replace '\\','/')';
const dst = '$($usersDest  -replace '\\','/')';
const backupUsers  = JSON.parse(fs.readFileSync(src,'utf8'));
const existingUsers = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst,'utf8')) : [];
const existingEmails = new Set(existingUsers.map(u=>u.email));
let added = 0;
const merged = [...existingUsers];
for (const u of backupUsers) {
  if (existingEmails.has(u.email)) { console.log('    = Ja existe: '+u.email); continue; }
  merged.push({ ...u, tenant_id: 'staffconect' });
  added++;
  console.log('    + Importado: '+u.email+' ('+u.role+')');
}
fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
console.log('    OK: '+added+' usuario(s) importado(s)');
"@
    node -e $mergeScript
} else {
    # Sem Node — copia direto se não existe
    if (-not (Test-Path $usersDest)) {
        $users = Get-Content $usersBackup | ConvertFrom-Json
        foreach ($u in $users) {
            if (-not $u.tenant_id) { $u | Add-Member -NotePropertyName tenant_id -NotePropertyValue $TENANT -Force }
        }
        $users | ConvertTo-Json -Depth 10 | Set-Content $usersDest -Encoding utf8
        Write-Host "  ✓ users.json copiado (sem Node, tenant_id adicionado via PowerShell)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ users.json já existe em data\ — MANTENDO. Mescle manualmente se necessário." -ForegroundColor Yellow
    }
}

# ── 7. Resumo e próximos passos ───────────────────────────────────────────────
Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "  ✅ Preparação local concluída!" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Arquivos preparados em:" -ForegroundColor Cyan
Write-Host "  data\$TENANT\         ← dados do tenant staffconect"
Write-Host "  data\users.json       ← usuários globais"
Write-Host ""
Write-Host "PRÓXIMOS PASSOS — Enviar para o Railway:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Opção A — Railway CLI (mais rápido):" -ForegroundColor Cyan
Write-Host "    1. npm install -g @railway/cli"
Write-Host "    2. railway login"
Write-Host "    3. railway link    (selecione o projeto Gestor)"
Write-Host "    4. railway up      (redeploy com os dados locais incluídos)"
Write-Host "    Obs: o servidor.js vai salvar em /data no Railway (DATA_DIR=/data)"
Write-Host ""
Write-Host "  Opção B — Commit temporário (mais simples):" -ForegroundColor Cyan
Write-Host "    1. Adicione data/ ao .gitignore temporariamente: remova a linha 'data/'"
Write-Host "    2. git add data\ && git commit -m 'tmp: seed dados oracle'"
Write-Host "    3. git push  (Railway redeploy automaticamente)"
Write-Host "    4. Confirme os dados no Railway"
Write-Host "    5. git rm -r --cached data\ && git commit -m 'chore: remove dados locais'"
Write-Host "       (os arquivos ficam locais mas saem do repo)"
Write-Host ""
Write-Host "  Opção C — Upload direto via Railway Shell:" -ForegroundColor Cyan
Write-Host "    1. Painel Railway → seu serviço → aba 'Deploy' → 'Connect'"
Write-Host "    2. No terminal Railway, execute: node migrate.js"
Write-Host "       (migrate.js já está no repo e move data/*.json → data/staffconect/)"
Write-Host ""
Write-Host "Dica: Os arquivos em data\$TENANT\ NÃO foram commitados." -ForegroundColor DarkGray
Write-Host "      Verifique-os antes de escolher a opção de upload." -ForegroundColor DarkGray
Write-Host ""
