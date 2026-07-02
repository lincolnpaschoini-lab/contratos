# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                      # ts-node dev server w/ hot-reload, http://localhost:3000
npm run build                    # tsc → dist/
npm start                        # runs compiled dist/src/server.js

npm run prisma:generate          # regenerate Prisma client after schema.prisma changes
npm run prisma:migrate           # create/apply migration in dev (prompts for name)
npm run prisma:migrate:deploy    # apply migrations, no prompt (prod/docker)
npm run prisma:seed              # admin+operador users, SLA rules, dev mocks
npm run prisma:studio            # visual DB browser
npm run prisma:reset             # DESTRUCTIVE: drops + reapplies + reseeds

npm run setup                    # install + generate + migrate + seed, one shot
```

No lint or test script exists in this repo — do not invent one; verify changes by running `npm run build` (tsc strict mode) and manually exercising the flow via `npm run dev`.

Default logins after seed: `admin@empresa.com.br` / `admin123`, `operador@empresa.com.br` / `operador123`.

Path aliases (tsconfig + tsconfig-paths, used at runtime by ts-node): `@/*`→`src/*`, `@config/*`, `@modules/*`, `@shared/*`, `@jobs/*`.

## Architecture

Internal tool tracking a contract's lifecycle from accepted Pipedrive proposal through billing. Express + EJS (server-rendered, not an SPA) + Prisma/PostgreSQL.

### Module layout

`src/modules/<name>/<name>.routes.ts` → `.controller.ts` → `.service.ts` (→ `.repository.ts` where present, e.g. `contracts`). Simpler modules (`users`, `settings`, `notifications`) call `prisma` directly from the service, skipping a repository layer — follow whichever pattern the module you're editing already uses, don't retrofit repositories everywhere.

`src/app.ts` wires global middleware order: helmet → cors → compression → body parsers → cookie-parser → morgan → correlation-id → flash → EJS/layouts setup → format helpers on `res.locals.h` → static → `authContextMiddleware` (non-blocking, just populates `res.locals.currentUser` from JWT cookie) → unread-notification-count lookup → `/health`, `/events` (SSE), `/acoes` (email actions) and `/notifications` mounted *before* `defaultRateLimit` → rate limit → the rest of the module routers.

### Contract state machine (core domain)

`contracts.service.ts` drives 5 sequential `StepName`s: `PROPOSAL_ACCEPTED → CONTRACT_PREPARATION → CONTRACT_SIGNING → CONTRACT_REGISTRATION → CONTRACT_BILLING`. Each `ContractStep` has its own `StepStatus` (PENDING/IN_PROGRESS/COMPLETED/DELAYED) and `dueAt` computed via `addBusinessDays` against a per-`StepName` SLA (`SlaRule`, optionally overridden per `companyId`, see `getSlaMap`). `completeStep` auto-starts the next PENDING step; `recalculateOverallStatus` derives `ContractTracking.overallStatus`/`currentStep` from step state and is what marks steps DELAYED when `dueAt` has passed. The 30-min cron in `src/jobs/sla-recalculate.job.ts` calls `recalculateAllDelays` to sweep all trackings.

`userId` strings prefixed `system-` (e.g. `system-pipedrive`) mark automated actors — `StepHistory.changedByUserId` is left null for these, and notification/email side effects branch on `isSystemActor`/`isSystemCompleter`.

Every step transition triggers, best-effort (`.catch(() => {})`, never blocking the main flow): an SSE `broadcastEvent('pipeline-updated', ...)`, an in-app `Notification` row, and sometimes a transactional email (`email.service.ts`, e.g. `sendRegistrationActionEmail` on entering `CONTRACT_REGISTRATION`).

### Multi-tenant Pipedrive

One deployment serves three separate Pipedrive accounts (Paschoini/Attivos/Focus), distinguished by the numeric `company_id` in the webhook's `meta`. `pipedrive.service.ts`'s `resolveCompanyConfig` maps `company_id` → `{apiToken, domain, proposalStageId, preparationStageId, signingStageId}` from per-company env vars (`PIPEDRIVE_<COMPANY>_*`). If `company_id` doesn't match any configured company *and* at least one non-legacy company is configured, the webhook is rejected outright (logged, not silently misfiled) rather than falling back — this is intentional to avoid cross-tenant data mixing. `getCompanyInfo` (exposed to all views via `res.locals.h`) resolves a company_id to a display name/CSS class for the UI.

Webhooks accept both v1 (`event`/`current`) and v2 (`meta.action`/`data`) Pipedrive payload shapes; `normalizePipedrivePayload` unifies them. `WebhookEvent` rows dedupe by `externalEventId` and record processing errors — check this table when debugging a webhook that "didn't fire."

Pipedrive custom fields (CPF, CNPJ, vigência, etc.) are read by **hardcoded field-hash keys** (the long hex strings in `extractPersonFields`/`extractOrgFields`/`extractDealFields` in `pipedrive.service.ts`) — these hashes are specific to the Pipedrive account's custom field configuration and will need updating if fields are added/changed in Pipedrive itself. `resolveDealEnumValue` (in `pipedrive.api.ts`) resolves v2 webhook enum fields that arrive as `{id, type}` or a bare numeric ID back to their human label using the account's field metadata — needed because v1 and v2 webhook payloads represent the same enum differently.

### Clicksign integration

`clicksign.service.ts`'s `TEMPLATE_MAP` picks a Clicksign template UUID by the deal's `tipoServico` (PF/PJ × continuado/descontinuado × beneficiários). Which contract fields fill which template placeholder is *not* hardcoded — it's data-driven via the `ClicksignFieldMapping` table (editable in Settings), resolved at send time by `placeholder.service.ts`'s `resolveSourceField`/`SOURCE_FIELDS`. When adding a new fillable field, register it in `SOURCE_FIELDS` (`placeholder.service.ts`) so it's selectable in the mapping UI, rather than reading it ad hoc in `clicksign.service.ts`.

Signature completion arrives via two paths: the polling `refreshClicksignStatus` and the `processClicksignWebhook` push handler — both eventually call `markSigningComplete`, which completes `CONTRACT_SIGNING` and auto-starts `CONTRACT_REGISTRATION`.

### Auth

JWT in an httpOnly cookie (`signToken`/`verifyToken` in `auth.middleware.ts`), not sessions. `authContextMiddleware` is always non-blocking (populates `res.locals.currentUser` if present); `requireAuth`/`requireAdmin` are the actual gates, applied per-route. Both branch behavior on `isApiRequest` (JSON 401/403 vs. redirect/rendered error page) — routes that serve both HTML and are called from fetch/JSON need to handle both.

### Email

Sent via Microsoft Graph API (`email/graph-mailer.ts`), not SMTP — requires `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`. `email/email-action.*` implements one-click actions from email links using single-use, expiring `ActionToken` rows (not auth-gated — token in the URL is the credential), mounted at `/acoes` ahead of the global rate limiter.
