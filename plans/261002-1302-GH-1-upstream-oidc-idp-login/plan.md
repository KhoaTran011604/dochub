# Đăng nhập qua IdP thật (idp.hdwebsoft.co) thay erp-fake

- Ngày: 2026-10-02 · Branch: `feat/phase-1-new` · Trạng thái: **Implemented — chờ thử thật với IdP**

## Phase

| # | File | Trạng thái |
|---|---|---|
| 01 | [phase-01-bridge-as-relying-party-of-upstream-idp.md](./phase-01-bridge-as-relying-party-of-upstream-idp.md) | **Complete (Step 1–7)** |

## Kết quả (2026-10-02)

- **Tests**: bridge 89 passed (7 integration tests upstream-login-routes với IdP giả), typecheck+lint clean.
- **Smoke thật**: container bridge đã 302 đúng sang `idp.hdwebsoft.co/connect/authorize` (PKCE S256, state, nonce, client `hd-dochub`).
- **Review**: W1/W2/W3 warnings fixed; solid by-the-book impl (PKCE S256, state, nonce, signed httpOnly cookie, openid-client v6).
- **Step 8**: Chờ user đăng ký `http://localhost:4001/upstream/callback` redirect_uri ở IdP + thử real login.

## Hướng B (chọn): Decisions

- Bridge → RP của IdP; `sub` từ IdP = `erp_user_id` ở ERP; consent Implicit.
- Public client (no secret); roles claim tạm bỏ (phase sau).
