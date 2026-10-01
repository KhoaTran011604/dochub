# OIDC Provider & Claude API Research Report

## Topic 1: oidc-provider (panva/node-oidc-provider)

### Current Version & Node Requirements
- **Version 9.12.2** (as of Oct 2026) — CONFIRMED
  - Source: [npmjs.com/package/oidc-provider](https://www.npmjs.com/package/oidc-provider), [GitHub Releases](https://github.com/panva/node-oidc-provider/releases)
- **Node requirements** — UNVERIFIED (check package.json in GitHub repo for exact version constraints)

### Mounting: Next.js App Router vs Separate Process
- **Recommendation: Run as separate Node process** (Koa/Express/Fastify mount)
  - oidc-provider is middleware-based; embedding in App Router complicates request routing
  - Separate process simplifies cookie/session management and OIDC redirects
  - Single dev can use `npm run dev` to start bridge on port 3000, app on 3001, proxy in development config
  - UNVERIFIED via docs; inferred from architecture

### Custom Login Interactions
- **interactionDetails / interactionFinished pattern exists** — UNVERIFIED (need GitHub docs/examples)
- Interactions handle login prompt (username/password), consent prompt (scope approval), and credential submission
- Can skip consent for first-party clients (Outline) — UNVERIFIED

### Storage Adapter & Postgres
- **Standard Adapter interface required** for models (Account, Client, Grant, Session, Token, Interaction)
- **Postgres adapter**: No maintained official adapter; **short custom adapter is normal practice** — UNVERIFIED
  - Example implementations exist in community; typical 100-200 lines per model
- Source: [GitHub Configuration Docs](https://github.com/destenson/panva--node-oidc-provider/blob/master/docs/configuration.md)

### JWKS, Signing Keys, Cookie Keys
- **JWKS endpoint** auto-generated; signing keys managed by oidc-provider
- **Rotation**: oidc-provider handles key lifecycle automatically — UNVERIFIED (need docs)
- **Cookie keys**: Pass via `cookies.keys` config (array of secrets) — UNVERIFIED

### Custom Claims (groups, findAccount)
- **Scope-to-claim mapping**: Configure via `claims` object in config; e.g., `{ groups: ['groups'] }` — PARTIALLY CONFIRMED
- **findAccount**: Implement to return `{ id, email, name, groups }` — PARTIALLY CONFIRMED
- **groups claim**: Supported as custom claim; not OIDC Core, but accepted per spec — PARTIALLY CONFIRMED
  - Source: [OWASP/OneUptime Blog](https://oneuptime.com/blog/post/2026-08-10-oidc-missing-group-role-claims/view), [Know Base](https://knowledgebase.6clicks.com/openid-connect-scopes-and-claims)

### Outline Client Config (Confidential, Authorization Code)
- **token_endpoint_auth_method**: `client_secret_basic` (or `client_secret_post`)
- **redirect_uris**: `["https://{outline-domain}/auth/oidc.callback"]`
- **response_types**: `["code"]`
- **grant_types**: `["authorization_code"]`
- **Scope**: Typically `openid email profile` plus custom `groups`
- **UNVERIFIED**: Exact Outline OIDC contract; confirm redirect_uri format with Outline docs

---

## Topic 2: Security for Local Admin Login

### Argon2id Parameters
- **OWASP 2025 Recommended (minimum)**:
  - `m=19456` (19 MiB), `t=2`, `p=1` — CONFIRMED
  - **OR** `m=47104` (46 MiB), `t=1`, `p=1`
  - **High security**: `m=131072` (128 MiB), `t=3`, `p=4`
- **Salt**: ≥16 bytes (use `crypto.randomBytes(16)`) — CONFIRMED
  - Source: [OWASP ASVS](https://github.com/OWASP/ASVS/issues/2535), [Guptadeepak.com 2026 Guide](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/)

### Rate Limiting & Lockout
- **Recommended**: 5 failed attempts → 15-min lockout (exponential backoff)
- **UNVERIFIED** (general best practice, not from docs)

### Audit Logging Fields
- Timestamp, username, success/failure, IP address, user agent
- **UNVERIFIED** (no source found; standard practice)

---

## Topic 3: Claude API (Anthropic TypeScript SDK)

### Current Model IDs (Oct 2026)
- **claude-fable-5-1** (newest; demanding reasoning, agentic work) — CONFIRMED
- **claude-opus-5-5** (long-running agents, coding) — CONFIRMED
- **claude-sonnet-5-5** (speed + intelligence balance) — CONFIRMED
- **claude-haiku-4-5** (fastest, lowest cost) — CONFIRMED
  - Source: [platform.claude.com/docs](https://platform.claude.com/docs/en/models/overview)

### Streaming Text Responses (Next.js Route Handler)
- **Pattern**: Use `stream: true` in API request; iterate `message.content[0].text` via async generator
- **SSE/ReadableStream**: Transform Claude stream to `ReadableStream` using Web Streams API or Node streams
- **UNVERIFIED**: Exact implementation patterns; docs available at [platform.claude.com/docs/en/build-with-claude/streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) (not fully fetched)

### Prompt Caching (cache_control)
- **Feature**: Add `cache_control: { type: "ephemeral" }` to system prompt or input blocks
- **Reduces cost** on repeated identical prompts (template + variable input)
- **UNVERIFIED**: Exact usage in TypeScript SDK; docs at [platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (not fully fetched)

---

## Topic 4: TypeScript Monorepo Layout

### Recommendation: pnpm + Optional Turborepo
- **For 2 apps + 1 shared package**: Use **pnpm workspaces alone** initially
  - Root `pnpm-workspace.yaml` defines packages (bridge, app, @shared/types)
  - TypeScript Project References for type checking across packages
  - **Add Turborepo only when build time becomes bottleneck** (task orchestration, caching)
- **Combined approach (production 2026 standard)**: pnpm handles install; Turborepo orchestrates build/lint/test tasks
- **Simpler than Nx** for this scale; Nx better for 10+ packages — CONFIRMED
  - Source: [DEV Community - How to Pick a Monorepo Tool 2026](https://dev.to/yobox/how-to-pick-a-monorepo-tool-in-2026-kko), [TypeScript Monorepo Best Practices 2026](https://hsb.horse/en/blog/typescript-monorepo-best-practice-2026/)

---

## Unresolved Questions

1. **oidc-provider**: Exact Node version requirement; complete examples for interactions (login/consent flows); Postgres adapter library or stub implementation size
2. **oidc-provider**: Outline's exact OIDC callback signature and required claims; whether consent can be skipped for Outline client
3. **Rate limiting**: Specific library recommendation (@koa/ratelimit, express-rate-limit) for bridge
4. **Claude API**: Exact TypeScript SDK streaming pattern in Next.js route handler; prompt cache pricing and cache TTL
5. **oidc-provider**: Cookie keys rotation strategy; storage of refresh tokens; session expiration policy
