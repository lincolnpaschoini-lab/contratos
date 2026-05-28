# Sistema de Acompanhamento de Contratos

Sistema interno para rastrear o ciclo de vida de contratos, desde a proposta aceita no Pipedrive até o faturamento final. Integrado com Pipedrive (webhook) e Clicksign (webhook).

---

## Visão Geral

O sistema mapeia 5 etapas do ciclo contratual:

```
Proposta Aceita → Preparação → Assinatura → Cadastro → Faturamento
     (auto)         (manual)    (auto/manual)  (manual)    (manual)
```

Cada etapa tem status visual **verde** (concluído), **amarelo** (em andamento) ou **vermelho** (atrasado), com base em regras de SLA configuráveis.

### Fluxo operacional

1. Um negócio entra em "Proposta aceita" no Pipedrive.
2. O webhook do Pipedrive dispara e cria automaticamente o tracking no sistema.
3. A etapa "Proposta aceita" é marcada como concluída e "Preparação" é iniciada.
4. Operadores avançam as etapas manualmente (ou a Clicksign avança "Assinatura" automaticamente).
5. O job de SLA (a cada 30min) recalcula atrasos.
6. O gestor acompanha pelo Dashboard e na lista de contratos.

---

## Modelagem resumida

| Tabela | Propósito |
|--------|-----------|
| `users` | Usuários do sistema (admin/operador) |
| `customers` | Dados dos clientes |
| `pipedrive_deals` | Negócios importados do Pipedrive |
| `contract_trackings` | Registro principal de acompanhamento |
| `contract_steps` | As 5 etapas de cada contrato |
| `step_histories` | Auditoria completa de mudanças |
| `clicksign_documents` | Documentos enviados para assinatura |
| `webhook_events` | Log de todos os webhooks recebidos |
| `sla_rules` | Prazos configuráveis por etapa |

---

## Pré-requisitos

- Node.js 18+
- PostgreSQL 14+
- npm 9+

---

## Configuração inicial

### 1. Clone e instale dependências

```bash
git clone <repo>
cd contratos
npm install
```

### 2. Configure o ambiente

```bash
cp .env.example .env
# Edite o .env com suas configurações
```

Variáveis obrigatórias:
- `DATABASE_URL` — string de conexão PostgreSQL
- `JWT_SECRET` — string aleatória longa (mín. 32 chars)
- `COOKIE_SECRET` — string aleatória (mín. 16 chars)

### 3. Configure o banco de dados

```bash
# Cria as tabelas (migrations)
npm run prisma:migrate

# Gera o client TypeScript do Prisma
npm run prisma:generate

# Popula com dados iniciais (admin + SLA + mocks em dev)
npm run prisma:seed
```

### 4. Inicie em desenvolvimento

```bash
npm run dev
```

Acesse: http://localhost:3000

**Login padrão:**
- Admin: `admin@empresa.com.br` / `admin123`
- Operador: `operador@empresa.com.br` / `operador123`

> **Altere as senhas após o primeiro acesso!**

---

## Subindo com Docker

```bash
# Copie o .env e configure
cp .env.example .env

# Sobe banco + aplicação
docker-compose up -d

# Executa as migrations e seed
docker-compose exec app npm run prisma:migrate:deploy
docker-compose exec app npm run prisma:seed
```

---

## Scripts disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia em desenvolvimento com hot-reload |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Inicia a versão compilada |
| `npm run prisma:migrate` | Cria/aplica novas migrations |
| `npm run prisma:migrate:deploy` | Aplica migrations (produção) |
| `npm run prisma:seed` | Popula dados iniciais |
| `npm run prisma:studio` | Abre interface visual do banco |
| `npm run prisma:reset` | **DESTRUTIVO**: reseta banco e reaplica |

---

## Testando webhooks localmente

Veja [`docs/webhook-examples.md`](docs/webhook-examples.md) para payloads completos.

### Com curl (Pipedrive simulado):

```bash
curl -X POST http://localhost:3000/integrations/pipedrive/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "updated.deal",
    "meta": { "id": 77777 },
    "current": {
      "id": 77777,
      "title": "Contrato de Teste",
      "value": 15000,
      "currency": "BRL",
      "stage_id": "1",
      "stage_name": "Proposta aceita",
      "org_name": "Empresa de Teste Ltda"
    },
    "previous": { "stage_id": "2" }
  }'
```

### Com ngrok (webhooks reais do Pipedrive/Clicksign):

```bash
npx ngrok http 3000
# Use a URL HTTPS gerada no painel do Pipedrive/Clicksign
```

---

## Configuração das integrações

### Pipedrive

1. Acesse: Configurações → Webhooks no Pipedrive
2. URL: `https://seu-dominio.com/integrations/pipedrive/webhook`
3. Evento: `updated.deal`
4. Configure `PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID` no `.env` com o ID do estágio "Proposta aceita"

### Clicksign

1. Acesse: Configurações → Webhooks na Clicksign
2. URL: `https://seu-dominio.com/integrations/clicksign/webhook`
3. Configure `CLICKSIGN_WEBHOOK_TOKEN` no `.env`
4. Ao criar um documento na Clicksign para um contrato, registre o documento na tabela `clicksign_documents` com o `externalDocumentId`

---

## Estrutura do projeto

```
src/
├── config/          # Env, logger, database
├── modules/
│   ├── auth/        # Login/logout
│   ├── contracts/   # Core: tracking + steps
│   ├── dashboard/   # Métricas gerenciais
│   ├── users/       # Gestão de usuários
│   ├── settings/    # SLA e webhooks
│   └── integrations/
│       ├── pipedrive/   # Webhook Pipedrive
│       └── clicksign/   # Webhook Clicksign
├── shared/
│   ├── middlewares/ # Auth, error, flash, rate-limit
│   ├── utils/       # Business days, formatação
│   └── types/       # Tipos TypeScript compartilhados
├── jobs/            # Cron de recálculo de SLA
├── app.ts
└── server.ts
views/               # Templates EJS
public/              # CSS, JS estático
prisma/              # Schema, migrations, seed
```

---

## Próximos passos para produção

- [ ] **HTTPS obrigatório** — configure SSL/TLS (Let's Encrypt + nginx)
- [ ] **Variáveis seguras** — use cofre de secrets (AWS SSM, Vault, etc.)
- [ ] **Senhas padrão** — altere imediatamente admin/operador
- [ ] **Sessão distribuída** — se múltiplos instances, use Redis para rate-limit
- [ ] **Fila de mensagens** — mova o processamento de webhooks para uma fila (BullMQ) para maior resiliência
- [ ] **Monitoramento** — adicione APM (Sentry, Datadog, New Relic)
- [ ] **Backup** — configure backup automático do PostgreSQL
- [ ] **Testes** — adicione testes unitários para `contracts.service.ts` e `pipedrive.service.ts`
- [ ] **Notificações** — integre e-mail/Slack para alertas de atraso
- [ ] **Feriados** — implemente tabela de feriados para cálculo preciso de dias úteis
- [ ] **API do Pipedrive** — use o token para enriquecer dados do cliente na criação
- [ ] **Exportação** — adicione exportação de relatórios em CSV/Excel
