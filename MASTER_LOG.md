# MASTER LOG — Gestor de Tarefas Staff Conect
**Última atualização:** 2026-05-30  
**Projeto:** `C:\Gestor de tarefas\`  
**URL produção:** https://gestor.staffconect.com.br

---

## 1. INFRAESTRUTURA

| Item | Valor |
|---|---|
| Servidor | Oracle Cloud Free — Ubuntu 22.04, IP `136.248.112.181` |
| Stack | Node.js + Express + JSON files + PM2 + Nginx |
| SSH key | `C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key` |
| Deploy | `scp` local → Oracle → `pm2 restart gestor` |
| SSL | Let's Encrypt, auto-renovável |
| DNS | Cloudflare (DNS only) |

### Comandos de deploy rápido

```bash
# Deploy index.html
scp -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no "C:\Gestor de tarefas\public\index.html" ubuntu@136.248.112.181:/home/ubuntu/gestor/public/index.html

# Deploy server.js + restart
scp -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no "C:\Gestor de tarefas\server.js" ubuntu@136.248.112.181:/home/ubuntu/gestor/server.js && ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181 "pm2 restart gestor"

# Verificar logs PM2
ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181 "pm2 logs gestor --lines 50 --nostream"

# SSH interativo
ssh -i "C:\Users\Marcelo\Downloads\oracle ssh-key-2026-04-21.key" -o StrictHostKeyChecking=no ubuntu@136.248.112.181
```

---

## 2. ARQUIVOS DO PROJETO

| Arquivo | Propósito | Status |
|---|---|---|
| `public/index.html` | SPA React completa (sem bundler, Babel CDN) | ✅ Em produção |
| `server.js` | API REST completa + webhooks + DB JSON | ✅ Em produção |
| `public/sw.js` | Service Worker para push notifications | ✅ Em produção |
| `package.json` | Dependências: express, bcryptjs, jsonwebtoken, web-push | ✅ |

### Arquivos de dados (`data/`)

| Arquivo | Conteúdo |
|---|---|
| `users.json` | Operadores cadastrados (senhas bcrypt) |
| `clients.json` | Clientes com configurações completas |
| `day_tasks/YYYY-MM-DD.json` | Progresso diário por cliente |
| `extra_tasks.json` | Tarefas avulsas e recorrentes |
| `chat.json` | Histórico do chat interno |
| `email_notifs.json` | Notificações do intake worker (documentos recebidos) |
| `intake_lancamentos.json` | Fila de lançamentos financeiros para aprovação |
| `mensagens.json` | Mensagens padrão WhatsApp |
| `manuals.json` | Manuais / trilha de conhecimento |
| `push_subs.json` | Assinaturas Web Push |
| `backups/YYYY-MM-DD/` | Backups diários automáticos (30 dias) |
| `contas/AAAAMM.json` | Contas a pagar por mês |

---

## 3. ARQUITETURA — CONSTANTES CHAVE

```js
// Autenticação webhooks Railway → Oracle
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'staffbot_email_2024';
const CA_API_URL     = process.env.CA_API_URL     || 'https://app.staffconsult.com.br';
const CA_API_SECRET  = process.env.CA_API_SECRET  || 'staffbot_email_2024';

// Mapeamento cliente_id → company_id CA (no frontend)
const CLIENT_COMPANY_ID = {
  'body': 2, 'kimberly': 3, 'guimoo': 13, 'agro': 15,
  'jsa': 16, 'galiza': 17, 'up': 18, 'matsu': 19, 'ecofi': 20, 'makinsthall': 21
};

// Blocos diários por operador
task.bloco1       // Op1 — manhã
task.bloco1b      // Op1b (terceiro operador, opcional)
task.bloco2       // Op2 (Lídia) — tarde
task.bloco_tarde  // Rotina da tarde
task.fullyDone    // true quando ambos Op1 e Op2 concluíram
```

---

## 4. FUNCIONALIDADES — STATUS COMPLETO

### 4.1 Fila do Dia
**Status:** ✅ Funcional

- Dois blocos por cliente: Op1 (manhã) e Op2 (Lídia) com modelos independentes
- Op2 escolhe modelo no dia via botão ⇄ — altera apenas `bloco2`, sem afetar Op1
- **5 seções:** 🌅 Rotina da Manhã · 🌆 Rotina da Tarde · ⏰ Tarefas Atrasadas · 🟡 Tarefas do Dia · 🔴 Aguardando Resposta
- Visão padrão: todos os usuários abrem na própria fila; admin tem botão "Todos"
- Op1 some da fila ao concluir `bloco1`; Op2 ao concluir `bloco2` — independentes
- Tarefas atrasadas com cards interativos completos (Iniciar, Concluir, Anotar, Travar)
- Histórico 14 dias colapsável (✓/✗ por cliente por dia)

### 4.2 Modelos de Rotina (7 modelos)
**Status:** ✅ Funcional

| ID | Nome | Passos | Uso |
|---|---|---|---|
| `padrao` | Padrão | BLOCO1 padrão | Op1 legado |
| `completo` | Conciliação Completa | 13 | Op1 |
| `bancos_rev` | Bancos + Revisão | 5 | Op1 |
| `conc_rel` | Conciliação + Relatórios | 8 | Op1 |
| `sem_cap` | Rotina sem Contas a Pagar | 7 | Op2 |
| `com_cap` | Rotina com Contas a Pagar | 10 | Op2 |
| `auditoria` | Organização e Auditoria | 6 | Tarde |

### 4.3 Aba 📧 E-mails (Notificações do Intake)
**Status:** ✅ Funcional (reescrito em 2026-05-30)

**O que exibe:** documentos recebidos pelo intake worker — confiança média/baixa, falhas de download, e solicitações operacionais.

**Fluxo por tipo:**
- `nf/boleto/fatura` → sempre vai para Lançamentos; vai para E-mails também se confiança não for `alta`
- `operacional` → vai **apenas** para E-mails (nunca cria tarefa, nunca vai para Lançamentos)
- `outros/extrato` → vai para E-mails se confiança não for `alta`
- confiança `alta` + arquivo salvo → silencioso (exceto nf/boleto/fatura que sempre vai para Lançamentos)

**Campos exibidos (campo real do JSON):**
- `n.assunto` / `n.subject` — assunto do e-mail
- `n.remetente` / `n.from` — quem enviou
- `n.cliente` — nome do cliente
- `n.fornecedor` — nome do fornecedor
- `n.classificacao` — tipo: `nf | boleto | fatura | extrato | operacional | outros`
- `n.confianca` — `alta | media | baixa` (colorido: verde/âmbar/vermelho)
- `n.critico` — `true` para e-mails de contabilidades (exibe badge 🔴 CRÍTICO, fundo e borda vermelho)
- `n.descricao` — descrição da solicitação (exibida para tipo `operacional`)
- `n.nome_arquivo` — nome do arquivo salvo no Drive
- `n.motivo_falha` — `sem_anexo` | `link_quebrado` | `protegido` | null
- `n.link_original` — botão âmbar "🔗 Abrir link original" (quando download falhou)
- `n.drive_url` — botão azul "📄 Rastro no Drive" (no bloco de erro) ou link normal (sem erro)

**UI — filtros e badges (sessão 2026-05-30):**
- Chips de filtro: Todos · 🔴 Críticos · ⚠ Erros · 📋 Operacionais · 📄 Documentos
- Borda colorida: vermelho-escuro (crítico) · âmbar (erro) · laranja (operacional) · azul (documento)
- Badge 🔴 CRÍTICO (fundo vermelho-escuro) para `n.critico === true`
- Bloco de erro: texto amigável do `MOTIVO_LABEL` + botões de ação
- Bloco operacional: mostra `n.descricao` com fundo laranja-suave
- Badge ⚠ Não baixado quando há `motivo_falha`

**MOTIVO_LABEL (textos amigáveis):**
```js
sem_anexo:    'E-mail sem anexo PDF — nenhum arquivo para baixar'
link_quebrado:'Link encontrado no e-mail, mas download falhou'
protegido:    'Arquivo protegido ou acesso negado — baixar manualmente'
```

**Endpoints backend:**
| Endpoint | Auth | Função |
|---|---|---|
| `GET /api/email-notifs` | JWT | Lista todas as notificações |
| `POST /api/email-notifs` | JWT admin | Cria notificação manualmente |
| `PATCH /api/email-notifs/:id/read` | JWT | Marca como lida pelo operador |
| `DELETE /api/email-notifs/:id` | JWT admin | Remove notificação |

**Webhooks de entrada (Railway → Oracle, auth por `secret` no body):**
| Endpoint | Função |
|---|---|
| `POST /api/webhook/intake-notify` | Recebe documento processado (baixa confiança ou falha) — salva em `email_notifs.json` |
| `POST /api/webhook/intake-operacional` | Recebe tarefa operacional — salva em `email_notifs.json`, **NÃO cria tarefa** |
| `POST /api/webhook/email-notify` | Endpoint legado — intake ainda usa como fallback |

### 4.4 Aba 🧾 Lançamentos (Fila de Aprovação → Conta Azul)
**Status:** ✅ Funcional em produção

**Fluxo completo:**
```
Intake Worker (Railway)
  → classifica e-mail como nf/boleto/fatura
  → POST /api/webhook/intake-lancamento
  → item entra na fila com status "pendente"
  → operador revisa no Gestor
  → clica Aprovar → Gestor chama CA API
  → POST https://app.staffconsult.com.br/api/internal/create-payable
  → lançamento criado no Conta Azul Mais
```

**Campos do lançamento (`intake_lancamentos.json`):**
```json
{
  "id": "timestamp",
  "intake_id": "id original do intake",
  "cliente": "Nome do cliente",
  "cliente_id": "agro | jsa | body | ...",
  "fornecedor": "Nome do fornecedor",
  "classificacao": "nf | boleto | fatura | outros",
  "drive_url": "link do arquivo no Drive",
  "nome_arquivo": "nome do arquivo",
  "data_recebido": "ISO timestamp",
  "sugestao_ia": { "valor": 0.0, "vencimento": "DD/MM/YYYY", "descricao": "", "confianca": "" },
  "status": "pendente | aprovado | rejeitado",
  "ca_id": "UUID retornado pelo CA (ou null)",
  "ca_erro": "mensagem de erro CA (ou null)",
  "lancamento_final": { "fornecedor", "valor", "vencimento", "descricao", "categoria_id", "conta_financeira_id" },
  "resolvedAt": "ISO timestamp",
  "resolvedBy": "nome do operador",
  "rejeicao_motivo": "texto ou null"
}
```

**Endpoints backend:**
| Endpoint | Auth | Função |
|---|---|---|
| `POST /api/webhook/intake-lancamento` | secret body | Recebe lançamento do Railway |
| `GET /api/intake-lancamentos` | JWT | Lista com filtro `?status=pendente|aprovado|rejeitado|ca_pendente` |
| `POST /api/intake/aprovar/:id` | JWT | Aprova + chama CA API automaticamente |
| `POST /api/intake/rejeitar/:id` | JWT | Rejeita com motivo |
| `POST /api/intake/retentar-ca/:id` | JWT | Retenta criação CA (sem reaprovar) |
| `DELETE /api/intake/lancamento/:id` | JWT | Exclui da fila (só se `ca_id` for null) |

**UI implementada:**
- Badges: ⏳ Pendente / ✅ Lançado / ⚠ CA pendente / ❌ Rejeitado
- Filtro por status
- Modal de aprovação com campos editáveis (fornecedor, valor, vencimento, descrição, categoria_id, conta_financeira_id)
- Botão "🔄 Retentar CA" para aprovados sem `ca_id`
- Exibe `ca_erro` com detalhe do erro
- Link "Reautorizar" aponta para `https://app.staffconsult.com.br/api/contaazul/start?company_id=X` (mapeado por `cliente_id`)
- Botão 🗑️ excluir (só para itens sem `ca_id`)

### 4.5 Tarefas Extras
**Status:** ✅ Funcional

- CRUD completo com recorrência: diária, semanal, mensal
- Geração automática diária via `generateRecurring()` (roda a cada 30min no server.js)
- Checklist de passos + "Do Manual"
- Filtros por status, operador, prazo

### 4.6 Clientes
**Status:** ✅ Funcional

- Cadastro completo: CNPJ, contato, WhatsApp, e-mail, ERP, bancos, observações
- Senhas e acessos, Op1 / Op1b / Op2, modelos de rotina por bloco

### 4.7 Chat Interno
**Status:** ✅ Funcional

- Polling a cada 3s, badge com contador
- Upload de imagens inline (base64 → `public/uploads/chat/`), limpeza automática 10 dias
- Mensagens automáticas do sistema

### 4.8 Notificações Push
**Status:** ✅ Funcional

- Service Worker + notificação nativa do SO
- Disparadas para: mensagens diretas no chat + lançamentos novos na fila

### 4.9 Trilha do Conhecimento / Mensagens
**Status:** ✅ Funcional

- Manuais com passos, categorias, reordenação
- Mensagens padrão WhatsApp

### 4.10 Autenticação
**Status:** ✅ Funcional

- JWT (`sc_token`), roles `admin` e `operador`
- Setup flow no primeiro acesso

---

## 5. INTEGRAÇÕES COM OUTROS PROJETOS

| Origem | Endpoint no Gestor | Dados |
|---|---|---|
| **Intake Worker** (Railway) | `POST /api/webhook/intake-notify` | Documento recebido com baixa confiança ou falha |
| **Intake Worker** (Railway) | `POST /api/webhook/intake-operacional` | Tarefa operacional (e-mail de sócios etc.) |
| **Intake Worker** (Railway) | `POST /api/webhook/intake-lancamento` | Lançamento financeiro para fila de aprovação |
| **Gestor** (Oracle) | `POST https://app.staffconsult.com.br/api/internal/create-payable` | Cria conta a pagar no Conta Azul (ao aprovar) |

**Autenticação:** todos os webhooks Railway → Oracle usam `{ "secret": "staffbot_email_2024" }` no body.

---

## 6. PENDÊNCIAS ABERTAS

### 🔴 Crítico
| # | Item | Detalhe |
|---|---|---|
| 1 | `ca_id` retorna `null` mesmo com lançamento criado no CA | Debug logging deployado no CA Project (commit `867c73a`). Checar Railway logs após próxima aprovação para identificar campo correto na resposta da API CA Mais |

### 🟡 Importante
| # | Item | Detalhe |
|---|---|---|
| 2 | Tokens Gmail revogados: BODY, GUIMOO, JSA, KIMBERLY, UP | `invalid_grant` no Railway. Reautorizar OAuth localmente e re-exportar para Railway via `export_tokens_railway.py` |
| 3 | Limpeza Oracle | `rm ~/gestor/server.js.bak_* ~/gestor/patch_*.js` |
| 4 | Versionar no GitHub | `server.js` e `index.html` nunca foram commitados |
| 5 | Migrar Gestor para Railway | Oracle difícil de manter — Railway Volume para persistir JSON |

### 🟢 Melhorias
| # | Item | Detalhe |
|---|---|---|
| 6 | Seletor de categoria CA no modal de aprovação | Buscar categorias via `/v1/categorias` e exibir dropdown |
| 7 | PATCH para lançamento já existente no CA | Evitar duplicatas se operador aprovar duas vezes |
| 8 | Arquivamento de `extra_tasks.json` | Sem paginação — tasks `done` antigas acumulam |
| 9 | App mobile / PWA instalável | Manifesto + ícone |
| 10 | Relatórios de produtividade por operador | Painel/relatório de conclusões |

---

## 7. HISTÓRICO DE BUGS CORRIGIDOS

### Sessão 2026-05-30

#### Arquivos alterados
| Arquivo | O que mudou |
|---|---|
| `public/index.html` | Componente `EmailNotificacoes` completamente reescrito (return/render) |
| `.claude/settings.local.json` | Adicionados hooks `SessionEnd` e `PreCompact` para auto-atualizar MASTER_LOG.md |

#### Funcionalidades implementadas

**`EmailNotificacoes` — reescrita completa do componente React:**
- Chips de filtro no topo: Todos / 🔴 Críticos / ⚠ Erros / 📋 Operacionais / 📄 Documentos (só aparecem quando há notificações)
- `filtrados` = `notifs` filtrado pelo chip ativo; contador por categoria (`cnt`)
- Borda colorida via `borderColorFn`: vermelho-escuro (`critico`) · âmbar (`motivo_falha`) · laranja (`operacional`) · azul (documento normal)
- Background levemente vermelho em cards críticos não lidos
- Badge **🔴 CRÍTICO** no assunto quando `n.critico === true`
- Badge de classificação com ícone (`ICON_CLASSIF`)
- Badge de confiança colorido (verde=alta, âmbar=média, vermelho=baixa)
- Badge **⚠ Não baixado** quando há `motivo_falha`
- **Bloco operacional** (fundo laranja-suave): exibe `n.descricao` completo
- **Bloco de erro** (fundo âmbar-suave): texto do `MOTIVO_LABEL` + botão amber "🔗 Abrir link original" + botão azul "📄 Rastro no Drive" + nome do arquivo
- Drive URL normal (sem erro): link simples com 📎
- Estratégia de deploy: patch via Python script para contornar problema de encoding de emojis no Edit tool

**Hooks de auto-documentação:**
- `SessionEnd` (agent) → atualiza `MASTER_LOG.md` ao fechar com `/exit` ou Ctrl+C
- `PreCompact` matcher `auto` (agent) → atualiza `MASTER_LOG.md` antes de compactação automática
- Arquivo: `C:\Gestor de tarefas\.claude\settings.local.json`

### Sessão 2026-05-27

| Bug | Causa | Fix |
|---|---|---|
| Aba E-mails mostrava cards vazios | `EmailNotificacoes` usava nomes de campos em inglês (`n.subject`, `n.from`, `n.summary`) mas JSON tem campos em português (`n.assunto`, `n.remetente`, `n.classificacao`) | Corrigido mapeamento de campos no componente React |
| Link "Reautorizar" apontava para root do app (`https://app.staffconsult.com.br`) | URL hardcoded incorreta | Corrigido para `https://app.staffconsult.com.br/api/contaazul/start?company_id=${CLIENT_COMPANY_ID[...]}` |
| Botão excluir chamava `API.delete()` inexistente | Objeto `API` não tem método `delete()`, usa `del()` | Corrigido para `API.del()` |

### Sessão 2026-05-15

| Bug | Causa | Fix |
|---|---|---|
| CA payload com campos em inglês (camelCase) | Commit anterior baseado em erro antigo | Revertido para campos em português conforme CA Mais API |
| Parcelas do CA sem `descricao` e sem `detalhe_valor` | Campos obrigatórios não incluídos | Adicionados `descricao` e `detalhe_valor.{valor_bruto, valor_liquido}` |
| `ca_id` null após criação bem-sucedida | CA API retorna campo com nome diferente de `"id"` | Debug logging adicionado para identificar campo correto |

### Sessão 2026-05-14

| Bug | Causa | Fix |
|---|---|---|
| ⇄ Modelo alterava bloco1 do Op1 | `onUpdate` sobrescrevia `bloco1.steps` | Alterado para atualizar apenas `task.bloco2` |
| RBJ não aparecia na Fila do Dia | `outrosCli` exigia `op1_id` no cliente | Filtro usa `operator_id` da tarefa |
| Op1 via cliente na fila após concluir | `fullyDone` dependia de ambos os blocos | Op1 some quando `bloco1.status==='done'` |
| Mesmo cliente 2x no admin "Aguardando" | `waitingSantos` filtrava `op1_id OR op2_id` | Corrigido para apenas `op1_id` |

---

## 8. PRÓXIMA SESSÃO — COMEÇAR AQUI

```
1. Verificar Railway logs do CA Project → descobrir campo correto do ca_id na resposta
   Buscar: "[INTAKE] ✅ Resposta CA:" e "[INTAKE] ca_id extraído:"

2. Corrigir ca_id em routes_intake.py (CA Project) com campo correto

3. Reautorizar tokens Gmail revogados:
   Contas: bodyefacebpofinanceirosantosif, guimoobpofinanceirosantosif,
           jsabpofinanceiroawn, kimberlybpofinanceirosantosif, upbpofinanceirosantosif
   → Rodar OAuth local → atualizar GMAIL_TOKEN_* no Railway

4. Limpeza Oracle:
   ssh oracle "rm ~/gestor/server.js.bak_* ~/gestor/patch_*.js"

5. Versionar Gestor no GitHub — server.js e index.html nunca foram commitados
```
