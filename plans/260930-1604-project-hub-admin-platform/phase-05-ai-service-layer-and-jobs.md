# Phase 05 - AI Service Layer + BullMQ Jobs

## Context Links
- [plan.md](plan.md) | [phase-03](phase-03-document-editor-blocknote.md) (markdown converter) | [phase-04](phase-04-dynamic-template-system.md) | [research-02 Topic 3](research/researcher-02-fastify-jsonschema-queue.md)

## Overview
- Priority: P2 | Status: pending | Effort: 20h
- Provider-agnostic `AiProvider` interface, first impl = internal Claude proxy (**confirmed Anthropic Messages API-compatible**: `ANTHROPIC_BASE_URL=https://proxy-api.hdwebsoft.co/`, `ANTHROPIC_AUTH_TOKEN=<secret, ops-provided via gitignored .env>`). Two async jobs on BullMQ: (1) generate page draft from form doc (template fields + data) + project context; (2) summarize N docs → one overview page. Polling status endpoint; frontend triggers + progress UI.

## Key Insights
- Worker = separate process (`worker.ts`) from same codebase → API latency unaffected, scale independently.
- LLM outputs **Markdown**; server converts to BlockNote blocks via `@blocknote/server-util` (Phase 3 converter). Inputs: page blocks → markdown; form data → markdown (labels from schema `title`s). Avoids asking LLM for BlockNote JSON (brittle).
- No RAG: concatenate within token budget; estimate tokens = chars/3.5 (conservative); proportional truncation per doc with marker.
- Permission re-checked **inside worker** at execution (access may be revoked between enqueue and run); job records `userId`.
- Proxy confirmed Anthropic-compatible → use official `@anthropic-ai/sdk` with `baseURL: ANTHROPIC_BASE_URL`, `apiKey: ANTHROPIC_AUTH_TOKEN`. Model id from env (`AI_MODEL`), never hardcoded. Adapter still wraps the SDK behind `AiProvider` so swapping vendor later stays a new class + env change.

## Requirements
- Functional:
  - `POST /api/ai/generate-draft {sourceDocumentId, targetParentId, title?, instructions?}` → requires viewer on source, editor on target parent → `{jobId}`.
  - `POST /api/ai/summarize {documentIds[≤20], targetParentId, title?}` → viewer on all docs (same project), editor on target; **403 `FEATURE_DISABLED` when `AI_SUMMARIZE_ENABLED=false`** (env-gated, checked before queueing).
  - `GET /api/ai/jobs/:id` → `{status: queued|active|completed|failed, progress, resultNodeId?, error?}`; only job owner.
  - Result = new page doc; first block = callout "AI-generated draft — review before sharing".
- Non-functional: draft < 30s p90; retries on 429/5xx/timeout (3 attempts, exp backoff); per-call timeout 60s; queue limiter (env `AI_MAX_JOBS_PER_MINUTE`); enqueue rate-limit 5/min/user; completed jobs kept 24h.

## Architecture
```
web ──POST /ai/generate-draft──> api: guards → queue.add('generate-draft', {userId, ...}) → {jobId}
web ──poll GET /ai/jobs/:id (2s)──> api: queue.getJob → owner check → status
worker.ts: Worker('ai-jobs') → handler by job.name
   → re-check permissions → load content → context-builder (budget) → prompt-builder
   → AiProvider.complete({system, prompt, maxTokens}) → markdownToBlocks → create page doc (tree-repo tx) → return {resultNodeId}
```
```ts
interface AiProvider { complete(req: { system: string; prompt: string; maxOutputTokens: number }): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> }
```
Env: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `AI_MODEL`, `AI_MAX_INPUT_TOKENS` (default 60000), `AI_MAX_OUTPUT_TOKENS` (4000), `AI_JOB_CONCURRENCY` (2), `AI_MAX_JOBS_PER_MINUTE`, **`AI_SUMMARIZE_ENABLED` (default `false`)**.

**Rollout gate (confirmed):** both jobs are fully built now; `summarize` stays behind `AI_SUMMARIZE_ENABLED=false` by default — route returns 403 `FEATURE_DISABLED` and web hides the "Summarize" entry point when off. Flip to `true` only after ops confirms proxy rate-limit/cost for ≤20-doc batches. `generate-draft` ships enabled (lower, single-doc cost).

## Related Code Files (create)
- `apps/api/src/worker.ts`
- `apps/api/src/modules/ai/`: `ai-provider-interface.ts`, `claude-proxy-ai-provider.ts`, `ai-provider-factory.ts`, `ai-queue.ts` (queue + job names + default opts), `ai-routes.ts`, `ai-jobs-service.ts` (enqueue/status)
- `apps/api/src/modules/ai/jobs/`: `generate-draft-job-handler.ts`, `summarize-documents-job-handler.ts`, `ai-context-builder.ts` (budget/truncation), `ai-prompt-templates.ts`, `form-data-to-markdown.ts`
- `packages/shared/src/schemas/ai-schemas.ts`
- `apps/web/queries/ai/queries.ts` (`useAiJob` w/ refetchInterval until terminal), `apps/web/queries/ai/mutations.ts`
- `apps/web/components/ai/generate-draft-dialog.tsx`, `summarize-documents-dialog.tsx`, `ai-job-progress.tsx`
- Modify: `apps/web/queries/keys.ts` (`queryKeys.ai.job(id)`), `docker-compose.yml` (worker service), root scripts (`dev:worker`)

## Implementation Steps
1. Rate limit/cost budget on the proxy still TBD with ops — confirm before enabling `summarize` (20-doc) path in prod; generate-draft can ship regardless.
2. Interface + factory (select impl by env `AI_PROVIDER=claude-proxy`).
3. `claude-proxy-ai-provider.ts`: `@anthropic-ai/sdk` client (`baseURL`/`apiKey` from env); timeout via `AbortController`/SDK timeout; map 429/5xx → retryable error class; non-retryable → `UnrecoverableError` (BullMQ); log usage tokens (no content).
4. `ai-queue.ts`: single queue `ai-jobs`, opts `{attempts:3, backoff:{type:'exponential',delay:5000}, removeOnComplete:{age:86400}, removeOnFail:{age:604800}}`; limiter from env.
5. `form-data-to-markdown.ts` (schema titles, nested objects/arrays) + unit tests.
6. `ai-context-builder.ts`: project title/description + docs markdown; budget allocation (equal share, redistribute unused); truncation marker; unit tests.
7. `ai-prompt-templates.ts`: system prompts for draft + summary (output Markdown only, headings, no preamble; language = source language).
8. Handlers: permission re-check via resolver (no request cache → fresh resolver instance), `job.updateProgress` (10 loaded / 50 generating / 90 saving), create page via documents-service, return `{resultNodeId}`.
9. Routes + service: guards, enqueue, status w/ owner check (`job.data.userId`), rate-limit.
10. `worker.ts`: bootstrap db + provider + handlers; graceful shutdown (SIGTERM → worker.close()).
11. Web: dialogs (target folder picker from tree query), `useAiJob` polling 2s, on completed → callback navigates to new doc; failed → error UI w/ retry.
12. Tests: handlers against a **local stub HTTP server** implementing proxy contract (real HTTP path exercised; no module mocks); permission-revoked-before-run case; budget truncation.

## Todo List
- [ ] AiProvider interface + Claude proxy impl (`@anthropic-ai/sdk`)
- [ ] Queue config + worker process
- [ ] Form-data→markdown, context builder, prompts
- [ ] Generate-draft handler
- [ ] Summarize handler
- [ ] Routes (enqueue, status) + rate limits
- [ ] Web dialogs + polling
- [ ] Tests w/ stub proxy server

## Success Criteria
- Draft from form doc created as page in < 30s; summary of 10 docs created; revoked access mid-queue → job fails `FORBIDDEN`, no doc created.
- Swapping provider = new class + env change only.

## Risk Assessment
- Proxy cost/rate limits still TBD with ops → limiter + doc cap (20) + token budget env; confirm before enabling summarize in prod.
- Markdown→blocks lossy → acceptable (draft); user edits afterwards.
- Redis down → enqueue returns 503; API rest unaffected.
- Prompt injection from doc content → output only becomes a new draft doc (no tool calls, no actions) → low impact; callout marks AI origin.

## Security Considerations
- API key only in worker/api env; never sent to web.
- Job status endpoint owner-scoped; job data holds ids, not content.
- Only docs user can view enter context (checked at run time) → no cross-permission leakage via summaries.
- Don't log prompts/outputs (may contain client data); log token counts only.

## Next Steps
- Post-MVP: SSE progress, RAG if projects exceed budget, cost dashboard.
