# Research Report: Fastify JSON Schema, RJSF, BullMQ

**Date:** 2026-09-30 | **Researcher:** Technical Research Agent

---

## Topic 1: Fastify Native JSON Schema Route Validation + Dynamic Templates

### Key Findings

**AJV Integration:** Fastify v5 uses AJV v8 internally. At server startup, Fastify compiles route schemas (body, querystring, params, headers, response) into AJV validator functions. Each schema is a JSON Schema Draft 7 object.

**Schema Reuse:** YES—the SAME JSON Schema object stored in Postgres JSONB can be reused directly as Fastify route validation schema. No separate definitions needed. Fastify accepts any valid JSON Schema object for the `schema` parameter in `fastify.route({schema: {...}})`.

**Direct AJV Usage:** AJV is callable directly. Fastify doesn't lock schemas behind an API; you can instantiate AJV independently and pass compiled validators to Fastify if needed for advanced templating workflows.

**Security Note:** Schemas are treated as application code. Never use `new Function()` with user-provided schemas; Fastify's validation uses compiled functions at startup, making it safe as long as schema definitions are controlled.

### Recommendation
Use Fastify's native route schema validation directly with JSONB-stored schemas. No template layer needed—schemas are compiled once at startup, providing zero-overhead reuse. If dynamic validation is needed per-request with runtime schema changes, call AJV directly in a middleware layer before route validation.

---

## Topic 2: react-jsonschema-form (RJSF) — Current State

### Key Findings

**Active Maintenance:** RJSF is actively maintained. Latest version @rjsf/core v6.10.1 (published 7 days ago as of Sept 2026).

**Version 6 Release:** v6 officially released by Halloween 2025. Modern packages under `@rjsf/*` scopes are actively developed; the legacy `react-jsonschema-form` package (v1.8.1) is 7 years stale.

**Nested Forms:** RJSF supports complex nested dynamic forms natively. Good fit for "project intake form" workflows with conditional fields, arrays, and custom widgets.

**Alternatives:** JSONForms (https://jsonforms.io) is a maintained alternative worth mentioning; supports Angular, React, Vue. No evidence of better alternatives specifically for React in 2025/2026.

### Recommendation
Use @rjsf/core v6.x for the project intake forms. Active maintenance, strong nested form support, and ecosystem of form renderers (@rjsf/material-ui, etc.) make it production-ready. JSONForms is a secondary option if you need multi-framework support or prefer declarative UI schemas.

---

## Topic 3: BullMQ for Async AI Generation Tasks

### Key Findings

**Standard Pattern:** Enqueue job → BullMQ worker processes async task → frontend receives result via:
- Polling endpoint (`GET /jobs/:id/status`)
- Webhooks (worker calls backend endpoint on completion)
- SSE/WebSocket (server pushes updates to client)

**BullMQ Status:** Still the standard choice for 2025/2026. TypeScript-first redesign of Bull, improved concurrency, reliable job state machine, native job flows (DAGs). Actively maintained.

**Alternatives for 2025/2026:**
- **Bee-Queue:** Lightweight, high-throughput, simple API; good for simple job processing without complex features.
- **pg-boss:** PostgreSQL-backed (no Redis), ACID guarantees, SKIP LOCKED for safe concurrency.
- **Temporal/Inngest:** Enterprise workflows (overkill for internal tool).

**For Small-Scale Tool (20-100 users):** BullMQ is still lightweight and appropriate. No need to consider alternatives unless you want to eliminate Redis dependency (then use pg-boss).

### Recommendation
Use BullMQ for AI generation jobs in Fastify. Pair with a polling endpoint + optional WebSocket for real-time progress. BullMQ's job persistence and error retry logic are critical for AI tasks. Only switch to pg-boss if operational complexity of running Redis becomes an issue.

---

## Unresolved Questions

1. Does Fastify's schema compilation support JSON Schema $ref pointers for schema modularization in JSONB templates? (Likely yes, but not explicitly confirmed.)
2. Does RJSF v6 have built-in support for conditional field rendering based on admin-defined schemas, or does it require custom widget development?
3. For BullMQ WebSocket updates, is there a standard pattern in Fastify (e.g., using @fastify/websocket) for pushing job progress, or is polling the simpler approach for 20-100 users?

---

## Sources

- [Fastify Validation & Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [RJSF GitHub Releases](https://github.com/rjsf-team/react-jsonschema-form/releases)
- [BullMQ Alternatives Guide 2026](https://imqueue.org/blog/bullmq-alternatives/)
