# Gestor de Tarefas Staff Conect — Instruções do Projeto

## Projetos relacionados

- **Intake bot:** `C:\StaffConsult-Bot\intake`
  Railway (Python). Classifica emails/documentos e notifica o Gestor via webhooks.
  Spec de integração: `C:\StaffConsult-Bot\intake\GESTOR_API_SPEC.md`

- **Integração Conta Azul / DRE:** `C:\Automatizar input vendas - CA`
  Railway (Python/Node). Multi-tenant já em produção — referência de arquitetura para master CRUD, gestão de tenants, reset de senha.

## Stack

- `server.js` — API REST Express (Node.js)
- `public/index.html` — React 18 CDN/Babel SPA (arquivo único)
- `data/` — JSONs locais (migrando para `data/{tenant}/` no Railway)

## Contexto

App BPO da Staff Conect. Em migração de Oracle Cloud → Railway com suporte multi-tenant.
Scope completo documentado na memória do projeto.
