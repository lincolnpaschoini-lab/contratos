# Exemplos de Payload — Webhooks

## Pipedrive

### Evento: deal atualizado para "Proposta aceita"

**Endpoint:** `POST /integrations/pipedrive/webhook`

```json
{
  "event": "updated.deal",
  "meta": {
    "id": 12345,
    "action": "updated",
    "object": "deal"
  },
  "current": {
    "id": 12345,
    "title": "Contrato de Serviços — Empresa XYZ",
    "value": 48000.00,
    "currency": "BRL",
    "stage_id": 1,
    "stage_name": "Proposta aceita",
    "person_name": "João Silva",
    "org_name": "Empresa XYZ Ltda",
    "person_id": 100,
    "org_id": 200,
    "pipeline_id": 1,
    "status": "open"
  },
  "previous": {
    "stage_id": 5,
    "stage_name": "Negociação"
  }
}
```

**Como testar localmente (curl):**
```bash
curl -X POST http://localhost:3000/integrations/pipedrive/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "updated.deal",
    "meta": { "id": 99999, "action": "updated", "object": "deal" },
    "current": {
      "id": 99999,
      "title": "Teste de Webhook — Cliente Novo",
      "value": 25000,
      "currency": "BRL",
      "stage_id": "1",
      "stage_name": "Proposta aceita",
      "org_name": "Cliente Novo Ltda"
    },
    "previous": { "stage_id": "3", "stage_name": "Proposta enviada" }
  }'
```

**Obs.:** Defina `PIPEDRIVE_PROPOSAL_ACCEPTED_STAGE_ID` no `.env` com o ID real do estágio no Pipedrive.

---

## Clicksign

### Evento: documento assinado por todos os signatários

**Endpoint:** `POST /integrations/clicksign/webhook`

**Header:** `X-Clicksign-Token: <CLICKSIGN_WEBHOOK_TOKEN>` (se configurado)

```json
{
  "event": {
    "name": "sign",
    "data": {
      "document": {
        "key": "abc123-documento-key-clicksign",
        "status": "signed",
        "filename": "contrato-empresa-xyz.pdf"
      },
      "signer": {
        "key": "signer-uuid-aqui",
        "email": "joao@empresaxyz.com.br",
        "name": "João Silva"
      }
    }
  }
}
```

**Evento de conclusão total (todos assinaram):**
```json
{
  "event": {
    "name": "all_signed",
    "data": {
      "document": {
        "key": "abc123-documento-key-clicksign",
        "status": "finalized",
        "filename": "contrato-empresa-xyz.pdf"
      }
    }
  }
}
```

**Como testar localmente (curl):**
```bash
curl -X POST http://localhost:3000/integrations/clicksign/webhook \
  -H "Content-Type: application/json" \
  -H "X-Clicksign-Token: seu_token_aqui" \
  -d '{
    "event": {
      "name": "all_signed",
      "data": {
        "document": {
          "key": "abc123-documento-key-clicksign",
          "status": "signed"
        }
      }
    }
  }'
```

**Pré-requisito:** O documento deve estar cadastrado na tabela `clicksign_documents` com o `externalDocumentId` correspondente ao `key` do payload.

---

## Testar webhooks com ngrok (desenvolvimento local)

```bash
# Instale ngrok: https://ngrok.com/download
ngrok http 3000

# Use a URL gerada (ex: https://abc123.ngrok.io) no painel do Pipedrive/Clicksign:
# Pipedrive: https://abc123.ngrok.io/integrations/pipedrive/webhook
# Clicksign: https://abc123.ngrok.io/integrations/clicksign/webhook
```
