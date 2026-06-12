# oracle_migrate.ps1 - Migracao Oracle Cloud -> Railway (PowerShell 5 / Windows)
#
# Pre-requisitos:
#   - OpenSSH Client instalado (Windows 10/11: Configuracoes > Aplicativos > Recursos Opcionais > Cliente OpenSSH)
#   - Node.js instalado (para mesclar users.json)
#   - Chave SSH na raiz do projeto: "oracle ssh-key-2026-04-21.key"
#
# Uso:
#   cd "C:\Gestor de tarefas"
#   .\oracle_migrate.ps1

# ---- CONFIG ------------------------------------------------------------------
$ORACLE_HOST    = "136.248.112.181"
$ORACLE_USER    = "ubuntu"
$ORACLE_KEY     = ".\oracle ssh-key-2026-04-21.key"
$ORACLE_DATADIR = "/home/ubuntu/gestor/data"
$LOCAL_BACKUP   = ".\oracle_backup"
$TENANT         = "staffconect"
$LOCAL_DATA     = ".\data"
# ------------------------------------------------------------------------------

$REMOTE = "$ORACLE_USER@$ORACLE_HOST"

Write-Host ""
Write-Host "======================================================"
Write-Host "  Migracao Oracle -> Railway - Gestor de Tarefas"
Write-Host "======================================================"
Write-Host ""

# ---- 0. Verifica dependencias ------------------------------------------------
Write-Host "Verificando dependencias..."

$sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshCmd) {
    Write-Host "ERRO: ssh nao encontrado."
    Write-Host "  Instale via: Configuracoes > Aplicativos > Recursos Opcionais > Cliente OpenSSH"
    exit 1
}
Write-Host "  OK: ssh encontrado em $($sshCmd.Source)"

$scpCmd = Get-Command scp -ErrorAction SilentlyContinue
if (-not $scpCmd) {
    Write-Host "ERRO: scp nao encontrado. Instale o Cliente OpenSSH."
    exit 1
}
Write-Host "  OK: scp encontrado"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "  AVISO: node.js nao encontrado - merge de users.json sera feito via PowerShell"
    $hasNode = $false
} else {
    Write-Host "  OK: node encontrado em $($nodeCmd.Source)"
    $hasNode = $true
}

if (-not (Test-Path $ORACLE_KEY)) {
    Write-Host "ERRO: Chave SSH nao encontrada: $ORACLE_KEY"
    Write-Host "  Certifique-se de que a chave esta na pasta do projeto."
    exit 1
}
Write-Host "  OK: chave SSH encontrada"

# ---- Ajusta permissoes da chave SSH ------------------------------------------
Write-Host "  Ajustando permissoes da chave SSH..."
try {
    $fullPath = (Resolve-Path $ORACLE_KEY).Path
    icacls $fullPath /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
    Write-Host "  OK: permissoes ajustadas"
} catch {
    Write-Host "  AVISO: nao foi possivel ajustar permissoes automaticamente"
    Write-Host "  Se o SSH reclamar da chave, clique com botao direito > Propriedades > Seguranca"
}

# ---- 1. Testa conexao SSH ----------------------------------------------------
Write-Host ""
Write-Host "Testando conexao SSH com $ORACLE_HOST..."

$sshArgs = @("-i", $ORACLE_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", $REMOTE, "echo CONEXAO_OK")
$testOutput = & ssh @sshArgs 2>&1
$testStr = $testOutput | Out-String

if ($testStr -notmatch "CONEXAO_OK") {
    Write-Host "ERRO: Falha na conexao SSH."
    Write-Host "  Saida: $testStr"
    Write-Host ""
    Write-Host "  Verifique:"
    Write-Host "    - IP: $ORACLE_HOST (servidor ativo?)"
    Write-Host "    - Usuario: $ORACLE_USER"
    Write-Host "    - Chave: $ORACLE_KEY"
    Write-Host "    - Firewall Oracle Cloud: porta 22 aberta?"
    exit 1
}
Write-Host "  OK: conexao SSH funcionando"

# ---- 2. Descobre caminho dos dados no Oracle ---------------------------------
Write-Host ""
Write-Host "Verificando caminho dos dados no Oracle..."

$checkArgs = @("-i", $ORACLE_KEY, "-o", "StrictHostKeyChecking=no", $REMOTE, "ls $ORACLE_DATADIR/clients.json 2>/dev/null && echo ARQUIVO_OK || echo ARQUIVO_NAO_ENCONTRADO")
$checkOutput = & ssh @checkArgs 2>&1 | Out-String

if ($checkOutput -notmatch "ARQUIVO_OK") {
    Write-Host "  AVISO: '$ORACLE_DATADIR/clients.json' nao encontrado."
    Write-Host "  Tentando localizar clients.json no servidor..."

    $findArgs = @("-i", $ORACLE_KEY, "-o", "StrictHostKeyChecking=no", $REMOTE, "find /home -name 'clients.json' 2>/dev/null | head -5")
    $findOutput = & ssh @findArgs 2>&1 | Out-String

    if ($findOutput.Trim() -ne "") {
        Write-Host ""
        Write-Host "  Arquivos encontrados:"
        Write-Host "    $($findOutput.Trim())"
        Write-Host ""
        Write-Host "  Edite a variavel ORACLE_DATADIR no script com o caminho correto e execute novamente."
    } else {
        Write-Host "  ERRO: Nenhum clients.json encontrado. Verifique o servidor e o caminho."
    }
    exit 1
}
Write-Host "  OK: dados encontrados em $ORACLE_DATADIR"

# ---- 3. Cria pastas locais ---------------------------------------------------
Write-Host ""
Write-Host "Criando estrutura de pastas local..."

New-Item -ItemType Directory -Force -Path $LOCAL_BACKUP | Out-Null
New-Item -ItemType Directory -Force -Path "$LOCAL_BACKUP\day_tasks" | Out-Null
New-Item -ItemType Directory -Force -Path "$LOCAL_DATA\$TENANT\day_tasks" | Out-Null
New-Item -ItemType Directory -Force -Path "$LOCAL_DATA\$TENANT\contas" | Out-Null
Write-Host "  OK: pastas criadas"

# ---- 4. Download dos arquivos JSON ------------------------------------------
Write-Host ""
Write-Host "Baixando arquivos do Oracle..."

$FILES_TENANT = @("clients.json", "extra_tasks.json", "manuals.json", "mensagens.json", "email_notifs.json", "intake_lancamentos.json")
$FILES_GLOBAL = @("users.json")
$ALL_FILES = $FILES_GLOBAL + $FILES_TENANT

foreach ($file in $ALL_FILES) {
    $remotePath = "${REMOTE}:${ORACLE_DATADIR}/${file}"
    $localPath  = "$LOCAL_BACKUP\$file"
    Write-Host "  Baixando $file ..." -NoNewline

    $scpArgs = @("-i", $ORACLE_KEY, "-o", "StrictHostKeyChecking=no", $remotePath, $localPath)
    & scp @scpArgs 2>&1 | Out-Null

    if (Test-Path $localPath) {
        $size = (Get-Item $localPath).Length
        Write-Host " OK ($size bytes)"
    } else {
        Write-Host " AVISO: nao encontrado no servidor"
    }
}

# Baixa day_tasks/ (opcional)
Write-Host "  Baixando day_tasks/ (opcional) ..." -NoNewline
$scpDtArgs = @("-i", $ORACLE_KEY, "-o", "StrictHostKeyChecking=no", "-r", "${REMOTE}:${ORACLE_DATADIR}/day_tasks/", "$LOCAL_BACKUP\")
& scp @scpDtArgs 2>&1 | Out-Null

$dtItems = Get-ChildItem "$LOCAL_BACKUP\day_tasks" -ErrorAction SilentlyContinue
if ($dtItems) {
    Write-Host " OK ($($dtItems.Count) arquivo(s))"
} else {
    Write-Host " nao encontrado (pode ser ignorado)"
}

# ---- 5. Copia para data/{tenant}/ -------------------------------------------
Write-Host ""
Write-Host "Copiando para $LOCAL_DATA\$TENANT\ ..."

foreach ($file in $FILES_TENANT) {
    $src = "$LOCAL_BACKUP\$file"
    $dst = "$LOCAL_DATA\$TENANT\$file"

    if (-not (Test-Path $src)) {
        Write-Host "  PULADO (nao baixado): $file"
        continue
    }

    if (Test-Path $dst) {
        Write-Host "  JA EXISTE - mantendo: data\$TENANT\$file"
    } else {
        Copy-Item $src $dst
        Write-Host "  Copiado: $file -> data\$TENANT\$file"
    }
}

# Copia day_tasks
$dtSrcItems = Get-ChildItem "$LOCAL_BACKUP\day_tasks" -ErrorAction SilentlyContinue
if ($dtSrcItems) {
    $copied = 0
    foreach ($f in $dtSrcItems) {
        $dst = "$LOCAL_DATA\$TENANT\day_tasks\$($f.Name)"
        if (-not (Test-Path $dst)) {
            Copy-Item $f.FullName $dst
            $copied++
        }
    }
    Write-Host "  day_tasks\: $copied arquivo(s) novo(s) copiado(s)"
}

# ---- 6. Mescla users.json ---------------------------------------------------
Write-Host ""
Write-Host "Mesclando users.json..."

$usersBackup = "$LOCAL_BACKUP\users.json"
$usersDest   = "$LOCAL_DATA\users.json"

if (-not (Test-Path $usersBackup)) {
    Write-Host "  AVISO: users.json nao encontrado no backup - pulando"
} elseif ($hasNode) {
    $backupEsc = $usersBackup  -replace '\\', '/'
    $destEsc   = $usersDest    -replace '\\', '/'

    $mergeScript = @"
var fs = require('fs');
var src = '$backupEsc';
var dst = '$destEsc';
var backupUsers   = JSON.parse(fs.readFileSync(src,'utf8'));
var existingUsers = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst,'utf8')) : [];
var emails = {};
existingUsers.forEach(function(u){ emails[u.email] = true; });
var added = 0;
var merged = existingUsers.slice();
backupUsers.forEach(function(u){
  if(emails[u.email]){ console.log('  = Ja existe: '+u.email); return; }
  u.tenant_id = 'staffconect';
  merged.push(u);
  added++;
  console.log('  + Importado: '+u.email+' ('+u.role+')');
});
fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
console.log('  OK: '+added+' usuario(s) importado(s)');
"@
    node -e $mergeScript
} else {
    # Sem Node - usa PowerShell puro
    if (-not (Test-Path $usersDest)) {
        $rawJson  = Get-Content $usersBackup -Raw -Encoding UTF8
        $usersArr = $rawJson | ConvertFrom-Json

        $result = @()
        foreach ($u in $usersArr) {
            $obj = @{
                id            = $u.id
                name          = $u.name
                email         = $u.email
                password_hash = $u.password_hash
                role          = $u.role
                tenant_id     = "staffconect"
            }
            if ($u.assignedClients) { $obj.assignedClients = $u.assignedClients }
            $result += $obj
        }
        $result | ConvertTo-Json -Depth 10 | Set-Content $usersDest -Encoding UTF8
        Write-Host "  OK: users.json copiado via PowerShell ($($result.Count) usuario(s))"
    } else {
        Write-Host "  AVISO: users.json ja existe em data\ - mantendo."
        Write-Host "  Instale Node.js e execute novamente para mesclar usuarios automaticamente."
    }
}

# ---- 7. Resumo ---------------------------------------------------------------
Write-Host ""
Write-Host "======================================================"
Write-Host "  CONCLUIDO - dados preparados localmente"
Write-Host "======================================================"
Write-Host ""
Write-Host "Arquivos em:"
Write-Host "  $LOCAL_DATA\$TENANT\  <- dados do tenant staffconect"
Write-Host "  $LOCAL_DATA\users.json <- usuarios globais"
Write-Host ""
Write-Host "PROXIMOS PASSOS - Enviar para o Railway:"
Write-Host ""
Write-Host "  Opcao A - Commit temporario (mais simples):"
Write-Host "    1. Abra .gitignore e remova ou comente a linha que ignora data/"
Write-Host "    2. git add data\"
Write-Host "    3. git commit -m 'tmp: seed dados oracle'"
Write-Host "    4. git push  (Railway redeploy automatico)"
Write-Host "    5. Confirme os dados no Railway"
Write-Host "    6. Restaure o .gitignore e faca: git rm -r --cached data\"
Write-Host "       git commit -m 'chore: remove dados locais do repo'"
Write-Host ""
Write-Host "  Opcao B - Railway CLI:"
Write-Host "    1. npm install -g @railway/cli"
Write-Host "    2. railway login"
Write-Host "    3. railway link  (selecione o projeto Gestor)"
Write-Host "    4. railway run node migrate.js"
Write-Host ""
Write-Host "  Opcao C - Shell do Railway (painel web):"
Write-Host "    1. Painel Railway -> seu servico -> aba Deploy -> botao Connect"
Write-Host "    2. No terminal Railway: node migrate.js"
Write-Host "       (migrate.js esta no repo e reestrutura data/ para data/staffconect/)"
Write-Host ""
