# MASTER LOG — Gestor de Tarefas Staff Conect
**Última atualização:** 2026-05-15  
**Gerado a partir das sessões:** 76cb154f (anterior) + sessão atual

---

## 1. INFRAESTRUTURA

| Item | Valor |
|---|---|
| URL pública | https://gestor.staffconect.com.br |
| Servidor | Oracle Cloud Free — Ubuntu 22.04, IP 136.248.112.181 |
| Stack | Node.js + Express + JSON files + PM2 |
| SSH key | `C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key` |
| Deploy | `scp` → `pm2 restart gestor` |

---

## 2. ARQUIVOS DO PROJETO

### Alterados nesta sessão

| Arquivo | O que mudou |
|---|---|
| `public/index.html` | Ver seção 3 abaixo — ~15 alterações significativas |
| `server.js` | Adicionados endpoints de e-mail notificações + DB.emailNotifs |

### Arquivos de dados (gerados automaticamente)
| Arquivo | Conteúdo |
|---|---|
| `data/extra_tasks.json` | Tarefas avulsas e recorrentes |
| `data/day_tasks/YYYY-MM-DD.json` | Checklist diário por cliente |
| `data/chat.json` | Mensagens do chat interno |
| `data/email_notifs.json` | **NOVO** — notificações de e-mail |
| `data/users.json` | Operadores cadastrados |
| `data/clients.json` | Cadastro de clientes |
| `data/manuals.json` | Manuais / trilha de conhecimento |
| `data/mensagens.json` | Mensagens rápidas |
| `data/push_subs.json` | Assinaturas Web Push |
| `data/backups/YYYY-MM-DD/` | Backups diários automáticos (30 dias) |

---

## 3. FUNCIONALIDADES IMPLEMENTADAS NESTA SESSÃO

### 3.1 Dois Blocos Diários por Cliente (Op1 + Op2)
**Status:** ✅ Funcional

- Admin configura no cadastro do cliente: modelo de rotina para Op1 (manhã) e modelo para tarde (auditoria)
- Op2 (Lídia) escolhe o modelo no próprio card da Fila do Dia via botão **⇄ Modelo**
- Ao escolher modelo, **só `bloco2` é alterado** — `bloco1` e `bloco1b` ficam intocados
- Bloco 2 ativado automaticamente ao escolher modelo com CAP

### 3.2 Modelos de Rotina (ROTINA_TIPOS)
**Status:** ✅ Funcional — 7 modelos configurados

| ID | Nome | Passos | Uso |
|---|---|---|---|
| `padrao` | Padrão (atual) | Usa BLOCO1 padrão | Op1 legado |
| `completo` | Conciliação Completa | 13 passos | Op1 |
| `bancos_rev` | Bancos + Revisão | 5 passos | Op1 |
| `conc_rel` | Conciliação + Relatórios | 8 passos | Op1 |
| `sem_cap` | Rotina sem Contas a Pagar | 7 passos | Op2 |
| `com_cap` | Rotina com Contas a Pagar | 10 passos | Op2 |
| `auditoria` | Organização e Auditoria (tarde) | 6 passos | Tarde |

**Passo "Atualizar posição bancária" adicionado em:** `completo`, `bancos_rev`, `conc_rel`

#### Passos — sem_cap (Op2)
1. Acessar e-mail — salvar boletos e NFs
2. Verificar WhatsApp — conferir grupo e individual, anotar solicitações pendentes
3. Lançar no Conta Azul — lançar todas as solicitações de pagamento identificadas
4. Conferir contas a pagar — verificar se há pagamento para o dia. Caso sim, transferir para o outro operador
5. Conferir DDA — verificar no banco se há boletos não cadastrados no Conta Azul. Caso sim, transferir para o outro operador
6. Atualizar posição bancária — conforme saldo do dia
7. Enviar rotina ao cliente

#### Passos — com_cap (Op2)
1. Acessar e-mail — conferir e salvar boletos e NFs
2. Verificar WhatsApp — conferir grupo e individual, anotar solicitações pendentes
3. Lançar no Conta Azul — lançar todas as solicitações de pagamento identificadas
4. Conferir contas a pagar — verificar pagamentos do dia
5. Conferir DDA — verificar no banco se há boletos não cadastrados no Conta Azul
6. Salvar contas a pagar — salvar relação de contas a pagar do dia na pasta do cliente
7. Agendar pagamentos — agendar todos os pagamentos no internet banking e confirmar cada um
8. Salvar programação bancária — exportar comprovante de agendamento e salvar na pasta
9. Atualizar posição bancária — conforme saldo do dia
10. Enviar rotina ao cliente

### 3.3 Fila do Dia — Separação por Operador
**Status:** ✅ Funcional

**Seções na visão de cada operador:**
1. 🌅 Rotina da Manhã → clientes Op1 ou Op2 com trabalho pendente
2. 🌆 Rotina da Tarde → clientes com `rotina_tipo_tarde` (só Op1)
3. ⏰ Tarefas Atrasadas → vencidas, cards completos e interativos
4. 🟡 Tarefas do Dia → tarefas avulsas e recorrentes do dia
5. 🔴 Aguardando Resposta → tarefas travadas

**Regras de separação:**
- **Op1** some da fila quando `bloco1.status === 'done'` (independente do Op2)
- **Op2** some da fila quando `bloco2.status === 'done'` (independente do Op1)
- **Admin "Todos"**: cliente some quando `fullyDone = true` (ambos concluídos)
- Stats (contador manhã): refletem o trabalho do próprio operador, não o geral

### 3.4 Visão padrão da Fila do Dia
**Status:** ✅ Funcional

- Todos os usuários (incluindo admin) abrem a Fila do Dia na **própria visão** por padrão
- Admin ainda tem botão "Todos" para ver o painel geral com todos os operadores
- Labels: "· Clientes Santos" para Op2 na visão própria, "· Bloco 2 ativo" na visão admin

### 3.5 Aba 📧 E-mails (Notificações)
**Status:** ✅ Funcional

**Frontend (`EmailNotificacoes`):**
- Lista de notificações de e-mail com botão **✓ E-mail lido** por operador
- Badge vermelho na aba mostra quantos não lidos
- Admin pode adicionar nova notificação (De, Assunto, Resumo) e excluir
- Polling a cada 30s para detectar novas notificações

**Backend (`server.js`):**
- `GET /api/email-notifs` — lista todas
- `POST /api/email-notifs` — cria nova (admin only)
- `PATCH /api/email-notifs/:id/read` — marca como lido (qualquer operador)
- `DELETE /api/email-notifs/:id` — remove (admin only)
- Dados em `data/email_notifs.json`

**API object:** adicionado método `patch()` ao objeto `API` no frontend

### 3.6 Renomeação de Labels na Fila
**Status:** ✅ Funcional

| Antes | Agora |
|---|---|
| ⚠️ Pendências Atrasadas | ⏰ Tarefas Atrasadas |
| 🔴 Tarefas Travadas | 🔴 Aguardando Resposta |
| 🚫 Travadas (filtro aba Tarefas) | ⏳ Aguardando |

### 3.7 Tarefas Atrasadas — Cards Interativos
**Status:** ✅ Funcional

- Substituídas as mini-cards read-only por `TarefaCard` completo
- Operador pode **Iniciar**, **Concluir**, **Anotar Pendência**, **Marcar Travado** direto da Fila do Dia
- Badge "⏰ Execução em atraso — venceu DD/MM" acima de cada card
- Resolve o caso de tarefas recorrentes (ex: RBJ) que ficavam presas em datas passadas

### 3.8 Correção — Cliente RBJ na Fila do Dia
**Status:** ✅ Corrigido

**Causa raiz:** filtro `outrosCli` exigia `c.op1_id === opId` no cliente, mas RBJ não tinha operador cadastrado.

**Fix:** filtro agora usa `operator_id` da **tarefa**, não do cliente:
```js
const outrosCli = outrosSemRotina.filter(c=>
  (extraTasks||[]).some(t=>
    String(t.client_id)===String(c.id) &&
    t.due_date===today &&
    t.status!=='done' && t.status!=='waiting' &&
    String(t.operator_id||'')===sId
  )
);
```
Funciona mesmo para clientes sem operador cadastrado. Robusto também para quando o operador for registrado futuramente.

### 3.9 Correção — Conflito Op1/Op2 (Galiza, UP)
**Status:** ✅ Corrigido

**Causa raiz:** Op1 concluía o bloco 1, mas `fullyDone = false` porque Op2 ainda não havia concluído. O card ficava na fila do Op1 — gerando confusão.

**Fix:** visão própria de cada operador filtra pelo **próprio bloco**:
- Op1 não vê mais o cliente depois de concluir `bloco1`
- Op2 não vê mais o cliente depois de concluir `bloco2`
- Nenhum depende do outro para sair da fila

### 3.10 Correção — Duplicata "Aguardando Resposta" no Admin
**Status:** ✅ Corrigido

Clientes travados apareciam duas vezes no admin (sob Op1 e Op2). Corrigido para mostrar apenas na seção do Op1:
```js
const waitingSantos = santosSorted.filter(c=>
  dayTasks[c.id]?.waiting && String(c.op1_id||'')===sId
);
```

### 3.11 Rotina da Tarde (BlocoTardeCard)
**Status:** ✅ Funcional

- Seção separada "🌆 Rotina da Tarde" na Fila do Dia
- Modelo `auditoria` disponível apenas para bloco da tarde
- Aparece apenas na seção do Op1 (evita duplicata no admin)

### 3.12 Fluxo de Conclusão por Tipo de Rotina
**Status:** ✅ Funcional

- Rotinas com CAP (`com_cap`, `padrao`) → fluxo de pagamento com botão "Rotina Enviada"
- Rotinas sem CAP (`bancos_rev`, `conc_rel`, `completo`, `sem_cap`) → botão direto "✓ Concluir Rotina"
- Determinado por `hasPaymentFlow = !client.rotina_tipo || rotina_tipo==='padrao' || rotina_tipo==='com_cap'`

---

## 4. ARQUITETURA — CONSTANTES CHAVE

```js
// IDs de bloco na task diária
task.bloco1       // Op1 — passos principais
task.bloco1b      // Op1b (terceiro operador opcional)
task.bloco2       // Op2 (Lídia)
task.bloco_tarde  // Rotina da tarde
task.fullyDone    // true quando ambos Op1 e Op2 concluíram

// Modelo escolhido por Op2 no dia
task.bloco2.tipo  // id do modelo escolhido (ex: 'sem_cap', 'com_cap')
task.bloco2.steps // passos do modelo escolhido

// Filtro de exibição na fila
const isOwnView = viewAs !== 'all';
// isOwnView=true → cada op vê só seu próprio trabalho pendente
// isOwnView=false → admin vê tudo, some quando fullyDone
```

---

## 5. REGRAS DE NEGÓCIO IMPORTANTES

| Regra | Implementação |
|---|---|
| Op1/Op1b: modelo definido no cadastro do cliente | `client.rotina_tipo`, `client.rotina_tipo_tarde`, `client.bloco1b_steps` |
| Op2: modelo escolhido no dia, na fila | `⇄ Modelo` no header do card → atualiza apenas `task.bloco2` |
| Checklist do cliente deve ser finalizado no mesmo dia | Regra operacional — o sistema não impede, mas registra pendências separadas |
| Manhã exclusivamente operacional financeira | Regra organizacional — não implementada como restrição técnica |
| Período de adaptação: 30 dias | Monitorar consistência via indicadores diários |

---

## 6. PENDÊNCIAS ABERTAS

| # | Item | Prioridade | Observação |
|---|---|---|---|
| 1 | Arquivamento de `extra_tasks.json` | Média | Sem paginação/arquivamento para tasks `done` antigas. Monitorar crescimento do arquivo |
| 2 | Geração de recorrentes a partir de `pending` | Baixa | `generateRecurring()` só gera nova instância de tasks `done`. Tasks `pending` de dias anteriores ficam como "atrasadas" (resolvido via cards interativos) |
| 3 | Indicadores diários para gestor | Baixa | Documentado no arquivo operacional mas não implementado como painel/relatório no sistema |
| 4 | Resumo automático diário por e-mail | Baixa | Solicitado via `/schedule` em sessão anterior (tarefa criada, verificar se está rodando) |
| 5 | Cadastro de Op1/Op2 na RBJ | ✅ Feito pelo usuário | Op1 e Op2 cadastrados como Lídia |

---

## 7. ACESSO RÁPIDO

```bash
# SSH
ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181

# Deploy index.html
scp -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no "C:\Gestor de tarefas\public\index.html" ubuntu@136.248.112.181:/home/ubuntu/gestor/public/index.html

# Deploy server.js + restart
scp -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no "C:\Gestor de tarefas\server.js" ubuntu@136.248.112.181:/home/ubuntu/gestor/server.js && ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181 "pm2 restart gestor"

# Verificar logs
ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181 "pm2 logs gestor --lines 30 --nostream"

# Checar tarefa específica no JSON
ssh -i "..." ubuntu@136.248.112.181 "cat /home/ubuntu/gestor/data/extra_tasks.json | python3 -c \"import json,sys; tasks=json.load(sys.stdin); print(json.dumps([t for t in tasks if 'RBJ' in t.get('title','')], indent=2, ensure_ascii=False))\""
```

---

## 8. HISTÓRICO DE BUGS CORRIGIDOS (SESSÃO ATUAL)

| Bug | Causa | Fix |
|---|---|---|
| ⇄ Modelo alterava bloco1 do Op1 | `onUpdate` sobrescrevia `bloco1.steps` | Alterado para atualizar apenas `task.bloco2` |
| ⇄ Modelo aparecia para Op1 (Leonardo) | Botão estava dentro do bloco1 render | Movido para header do card com condição `currentUser.id === client.op2_id` |
| Rotina da Tarde aparecia 2x no admin | `tardeClients` filtrava por `op1_id OR op2_id` | Corrigido para filtrar apenas `op1_id` |
| Botão "▶ Op2" nunca aparecia | `!String(x)===String(y)` sempre `false` | Corrigido para `String(x)!==String(y)` |
| RBJ não aparecia na Fila do Dia | `outrosCli` exigia `op1_id` no cliente | Filtro agora usa `operator_id` da tarefa |
| Op1 via cliente na fila após concluir | `fullyDone` dependia de ambos os blocos | Op1 some quando `bloco1.status==='done'` |
| Mesmo cliente aparecia 2x (Op1 e Op2) no admin "Aguardando" | `waitingSantos` filtrava `op1_id OR op2_id` | Corrigido para apenas `op1_id` |
| Fila do admin abria misturada por padrão | `viewAs` inicializava com `'all'` para admin | Alterado para `String(currentUser.id)` sempre |

---

## 9. DOCUMENTAÇÃO DO PROJETO — SEÇÃO 08 (REVISADA E CORRIGIDA)

### Visão Geral
Sistema web de gestão de tarefas e rotinas para BPO financeiro, com fila do dia por cliente, checklist de passos, controle por operador, tarefas extras recorrentes, chat interno e notificações push. Em produção em https://gestor.staffconect.com.br.

### Problema que Resolve
- Falta de visibilidade sobre o que cada analista está fazendo em tempo real
- Controle de rotinas por cliente feito em planilha ou de forma manual
- Sem rastreabilidade de início, conclusão e atrasos das tarefas diárias
- Comunicação interna fragmentada entre operadores

### Arquitetura
```
Browser ←──HTTPS──→ Nginx ←──proxy──→ Node.js :3000 ←──→ JSON files
```
- Frontend: React 18 SPA (CDN + Babel standalone, sem bundler)
- Backend: Node.js + Express REST API
- Banco: Arquivos JSON em `/home/ubuntu/gestor/data/`
- Servidor: Oracle Cloud Free Tier, Ubuntu 22.04
- Domínio: https://gestor.staffconect.com.br (SSL via Let's Encrypt, auto-renovável)
- Processo: PM2 (restart automático)
- Proxy: Nginx (HTTPS termination + reverse proxy porta 3000)
- DNS: Cloudflare (DNS only)

### Arquivos Principais

| Arquivo | Propósito |
|---|---|
| `public/index.html` | SPA React completa |
| `server.js` | API REST completa |
| `public/sw.js` | Service Worker para push notifications |
| `data/users.json` | Operadores/admins (bcrypt passwords) |
| `data/clients.json` | Clientes com configurações completas |
| `data/day_tasks/YYYY-MM-DD.json` | Progresso diário por cliente |
| `data/extra_tasks.json` | Tarefas avulsas e recorrentes |
| `data/manuals.json` | Trilha do conhecimento |
| `data/mensagens.json` | Mensagens padrão WhatsApp |
| `data/chat.json` | Histórico do chat interno |
| `data/email_notifs.json` | Novo — notificações de e-mail (entrada manual ou futuramente via Intake) |
| `data/backups/YYYY-MM-DD/` | Backups diários automáticos (30 dias) |

### Funcionalidades Implementadas

#### Fila do Dia
- Dois blocos diários por cliente: Op1 (manhã) e Op2 (Lídia) com modelos independentes
- Op2 escolhe modelo no card via botão ⇄ Modelo — altera **apenas bloco2**, sem afetar Op1 ou Op1b
- **5 seções na fila:** 🌅 Rotina da Manhã · 🌆 Rotina da Tarde · ⏰ Tarefas Atrasadas · 🟡 Tarefas do Dia · 🔴 Aguardando Resposta
- Visão padrão: **todos os usuários** (incluindo admin) abrem na própria fila; admin tem botão "Todos"
- Op1 some da fila ao concluir bloco1; Op2 some ao concluir bloco2 — **completamente independentes**
- Tarefas atrasadas com **cards interativos completos** (Iniciar, Concluir, Anotar, Travar) — operador age direto da fila sem precisar ir à aba Tarefas
- Histórico 14 dias colapsável (✓/✗ por cliente por dia)

#### 7 Modelos de Rotina (ROTINA_TIPOS)

| ID | Nome | Passos | Uso |
|---|---|---|---|
| `padrao` | Padrão | BLOCO1 padrão | Op1 legado |
| `completo` | Conciliação Completa | 13 | Op1 |
| `bancos_rev` | Bancos + Revisão | 5 | Op1 |
| `conc_rel` | Conciliação + Relatórios | 8 | Op1 |
| `sem_cap` | Rotina sem Contas a Pagar | 7 | Op2 |
| `com_cap` | Rotina com Contas a Pagar | 10 | Op2 |
| `auditoria` | Organização e Auditoria | 6 | Tarde |

#### Aba E-mails
- Lista de notificações de e-mail recebidas do Intake Worker ou adicionadas manualmente pelo admin
- Botão ✓ E-mail lido por operador; badge vermelho com contador de não lidos; polling a cada 30s
- Endpoints Gestor: `GET /api/email-notifs` · `POST /api/email-notifs` (admin JWT) · `PATCH /:id/read` · `DELETE /:id`
- **Integração Intake → Gestor:** o Intake chama `/api/webhook/intake-notify` (autenticado por `GESTOR_SECRET`) ao processar um documento com confiança baixa/média ou falha no download. Esse endpoint ainda não existe no `server.js` do Gestor — o Intake usa fallback para o endpoint legado `/api/webhook/email-notify` enquanto o novo não é criado.

#### Fila de Lançamentos (Intake → Aprovação → Conta Azul)
**Status: CÓDIGO PRONTO, aguardando deploy no Gestor**

O fluxo completo:
```
E-mail recebido pelo Intake Worker (Railway)
        ↓
   Classificação (Claude Haiku + filtro por remetente/domínio)
        ↓
nf / boleto / fatura  →  Fila de Lançamentos (operador aprova → lança no CA automaticamente)
operacional           →  Tarefa manual no Gestor
arquivo ok (alta)     →  Drive silencioso (sem notificação)
baixa confiança/falha →  Aba E-mails (ação manual)
```

**Situação por camada:**

| Camada | Status | Arquivo |
|---|---|---|
| Intake Worker (Railway) — classifica e chama o Gestor | ✅ Em produção | `email_intake.py` |
| gestor_api.py — funções que chamam os endpoints | ✅ Implementado | `gestor_api.py` |
| Endpoints backend Gestor (Oracle server.js) | ⚠️ Patch pronto, não aplicado | `patch_lancamentos.js` + `patch_ca_retry.js` |
| UI Gestor (index.html) — aba Lançamentos | ⚠️ Patch pronto, não aplicado | `patch_lancamentos_ui_v2.js` |

**Endpoints do backend (prontos para aplicar):**
- `POST /api/webhook/intake-lancamento` — recebe lançamento do Railway, salva com status `pendente`
- `GET /api/intake-lancamentos` — lista com filtro de status (auth necessária)
- `POST /api/intake/aprovar/:id` — operador aprova + chama CA API automaticamente
- `POST /api/intake/rejeitar/:id` — operador rejeita com motivo
- `POST /api/intake/retentar-ca/:id` — retenta criação no CA quando token estava expirado

**Autenticação:** todos os webhooks de entrada (Railway → Oracle) usam campo `secret: "staffbot_email_2024"` no body — não JWT.

**CA API:** ao aprovar, o Gestor chama `POST https://app.staffconsult.com.br/api/internal/create-payable`. Se o token CA estiver expirado, o item fica como `aprovado` com `ca_id=null` e `ca_erro` preenchido — operador vê badge de alerta e pode usar o botão "Retentar CA".

#### Tarefas Extras
- CRUD completo com recorrência: diária, semanal, mensal
- Geração automática diária via `generateRecurring()` no `server.js` (roda a cada 30min)
- Checklist de passos + "Do Manual"
- Filtros por status, operador, prazo

#### Clientes
- Cadastro completo: CNPJ, contato, WhatsApp, e-mail, ERP, bancos, observações
- Senhas e Acessos, Operador 1, Operador 1b e Operador 2, modelos de rotina por bloco

#### Chat Interno
- Polling a cada 3s, badge com contador, mensagens automáticas do sistema
- Upload de imagens inline (base64 → salvo em `public/uploads/chat/`), limpeza automática após 10 dias

#### Notificações Push
- Service Worker + notificação nativa do SO, funciona com aba minimizada
- Push apenas para: mensagens diretas no chat + e-mails via webhook (`source='email_monitor'`)

#### Trilha do Conhecimento
- Manuais com passos, categorias, reordenação; mensagens padrão WhatsApp

#### Autenticação
- JWT (`sc_token`), roles admin e operador, setup flow no primeiro acesso

### Status Atual
- Em produção — https://gestor.staffconect.com.br
- SSL ativo com renovação automática
- PM2 com restart automático
- Backup diário automático (30 dias)
- Recorrência de tarefas automática (roda diariamente via job interno)

### Pendências Técnicas

| Item | Prioridade |
|---|---|
| Aplicar `patch_lancamentos.js` + `patch_ca_retry.js` no server.js do Gestor (endpoints da fila) | Alta |
| Aplicar `patch_lancamentos_ui_v2.js` no index.html do Gestor (aba Lançamentos) | Alta |
| Criar `POST /api/webhook/intake-notify` no server.js (substitui fallback legado email-notify) | Alta |
| Versionar no GitHub (server.js e index.html nunca commitados) | Média |
| App mobile / PWA instalável (manifesto + ícone) | Média |
| Relatórios de produtividade por operador | Média |
| Limpeza Oracle: rm ~/gestor/server.js.bak_* ~/gestor/patch_*.js | Média |
| Arquivamento de extra_tasks.json (tasks done antigas sem paginação) | Média |
| Migração para Railway + Volume (Oracle difícil de manter) | Média |
| Notificação push para tarefas em atraso (scheduled) | Baixa |
| Edição de passos na fila para clientes "Outros" | Baixa |

### Público-Alvo
Escritórios de BPO financeiro com equipe de 2+ analistas. Adaptável para qualquer empresa com rotinas operacionais repetitivas por cliente.

### Tecnologia
Node.js · Express · React 18 · bcryptjs · jsonwebtoken · web-push · PM2 · Nginx · Oracle Cloud Free Tier · Let's Encrypt

### Notas Técnicas
- IP servidor: 136.248.112.181 (Oracle Cloud AMD E2.1.Micro — Free Tier)
- SSH: `ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181`
- Deploy: `scp arquivo → pm2 restart gestor`
- Contexto: ~3 operadores, 10 clientes (Santos Inteligência + RBJ e outros)
