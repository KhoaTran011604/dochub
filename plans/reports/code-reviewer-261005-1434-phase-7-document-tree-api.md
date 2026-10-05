# Code review: phase 7 document tree API (approach a)

Scope: uncommitted diff plus the untracked document-tree/ files and migration 0006. No code was edited. Typecheck and vitest were taken as passing per the caller.

## Critical
None found. The security-focused checks that held:
- Response mapping copies only id, title, url and parentDocumentId, so no content leaks.
- The wrong-user check in the callback runs before the grant upsert and applies to consent-only requests as well.
- 404 on a missing parent is indistinguishable from a parent the user cannot see.
- The token-scope gate does not delete or refresh the grant.

## Important
1. **`tree:read` is not an allowed scope in the service-key CLI.** `apps/outline-permission-api/scripts/manage-service-client-key-cli.ts:9` has `VALID_SCOPES = {users:write, permissions:write, documents:create}`. No key can be minted with `tree:read`, so the endpoint always returns 403 in practice. Add the scope there and to `tests/e2e/*` and `docs/erp-integration-api-guide.md` (sections 2, 3, 6, 8). Also update `infra/.env.example:161`, which still says the default scope is "documents:create auth:read".
2. **The consent-only idempotency key can collide with a client-supplied key.** `createConsentOnly` uses the key `consent:<erpUserId>` in the same `(service_client_id, idempotency_key)` unique space as `POST /documents`. That key is client-controlled, 1-200 printable ASCII.
   - If a client sends `Idempotency-Key: consent:<uuid>`, `create()` hits `ON CONFLICT DO NOTHING` and returns the consent row. The response carries a pendingUrl, but no document is ever created, because payload and documentId are null. It is silent data loss.
   - The reverse also happens: `createConsentOnly` on an existing document-create row resets its status to pending and clears documentUrl.
   - Fix: add a `kind` column or a partial unique index. Alternatively, reject the reserved `consent:` prefix in `idempotencyKeySchema`, and add `WHERE payload IS NULL` to the DO UPDATE branch. The CHECK-free design currently allows rows that mix kinds.
3. **A missing or empty `scope` in the token response locks the user in a 409 loop.** `oauth-token-api.ts:82` maps an absent `scope` to `""`. `hasScope("", "read")` is then false, so after consent the tree call returns 409 again, forever. This is probably fine on Outline 1.10.1, since the caller verified it. A defensive fix: on callback, if `tokens.scope` is empty, store the requested scope. Alternatively, fall back to attempting the call and treating 403 as a re-grant.
4. **Outline 403 on an insufficient token scope is reported as ACTING_USER_FORBIDDEN.** If the stored scope claims `read` but Outline rejects the token with 403, the user is stuck. They get 403 with no grantUrl and the grant is never cleared. Consider treating a 403 body with an authorization/scope error code as grant-required. Only a membership-type 403 should map to ACTING_USER_FORBIDDEN.
5. **Migration down is destructive.** It deletes every consent-only row, which is acceptable for rollback. It does not touch `oauth_state`. It should note that data is lost. The DOWN is otherwise correct and ordered correctly.

## Medium
- **Existing grants are not migrated.** A user whose grant has `documents:create auth:read` but no `read` gets a 409 on the first tree call and must consent again. That matches the spec. It means `/pending/:id` re-authorizes with the new default scope only, so a deployment that sets `OUTLINE_OAUTH_SCOPE` explicitly is covered by `withScope`.
- **The consent-only row is shared per (service client, user).** If two browsers open the same grantUrl, the second `startAuthorization` overwrites the first state and the first callback gets STATE_INVALID. This is the same as the existing behavior.
- **Broader stored token.** The `read` scope lets the sealed token read everything the user can see in Outline, not just the collection. The blast radius of a TOKEN_SEAL_PASSWORD leak is larger than before. Document it.
- **Project existence is revealed before the grant check.** An unknown project returns 404 and a known one returns 409 or 403. The caller is restricted by `assertProjectKeyAllowed` for non-allowed keys, so this is acceptable.
- **`findNode` is recursive with no depth cap.** Outline nesting is bounded in practice. `MAX_TREE_NODES` caps output size but not the traversal. Low risk.
- **An unrelated `errors` subtype passes through.** Non-401/403/404 errors (429, 5xx) are rethrown, which is correct.

## Regressions to the create-document flow
- `replayPending` correctly guards `documentId` being null.
- `complete-pending-request-after-consent` handles null payload and documentId before use.
- `/pending/:id` for a completed consent-only row renders "Access granted". The create-flow redirect is unchanged.
- No regression found apart from item 2.

## Open questions
- Is `read` a valid scope for `collections.documents` and also sufficient for `auth.info`, which already goes through `auth:read`? The caller says it was verified on Outline 1.10.1.
- Should `createConsentOnly` re-open a completed row, given that the only case is a deleted or stale grant? Re-opening also keeps old links usable, which is the intended behavior.
