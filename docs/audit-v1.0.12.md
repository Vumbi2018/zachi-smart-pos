# v1.0.12 controller audit

## Bugs fixed

| Endpoint | Root cause | Fix |
| --- | --- | --- |
| `POST /api/pricing/promotions` | Empty/whitespace `applies_to_id` sent to a typed column (UUID prod, INT dev). | Coerce blanks → `null` for `applies_to_id`, `start_date`, `end_date`, `description`, `min_purchase`. Required-field guards (name, discount_type, discount_value) added. |
| `GET /api/permissions` | Frontend reads `perm.permission_id` but column is `id` — every checkbox got `data-perm="undefined"`. | `SELECT id AS permission_id` alias. |
| `PUT /api/permissions/role/:role` | (a) NaN/null ids reaching FK column; (b) `audit_logs` schema drift aborts the txn. | Validate role against allow-list; normalise ids (UUID or int); SAVEPOINT on the audit insert. |
| `public/js/permissions.js` | `parseInt(cb.dataset.perm)` truncates UUID strings. | Pass `dataset.perm` through as a string. |

## Audited and confirmed safe

No `""` → typed-column path found in the rest of the controllers
(`loyalty`, `jobCard`, `return`, `sales`, `payment`, `cash`,
`purchase`, `inventory`, `product`, `service`, `supplier`,
`customer`, `user`, `auth`, `notification`, `currency`, `settings`,
`report`, `audit`, `approval`, `sync`, `device`, `ai`, `receiptPdf`).
They either coerce blanks via `|| null`, parse numerics via
`Number()` with NaN guards, re-derive values server-side, or take
no nullable typed columns from the request body.

## Known schema drift (NOT fixed in v1.0.12)

1. `permissions.id` is UUID in dev/prod but `SERIAL` in
   migration 002. Realign in v1.0.13.
2. `idempotency_keys.user_id` is UUID in prod but INT in dev.
   Logs `COALESCE types uuid and integer cannot be matched` once
   per write request; request itself succeeds. Realign in a future
   migration.

## Cleanup for v1.0.13

- Realign migration 002 to UUID.
- Realign `role_permissions.permission_id` to UUID.
- Optionally drop the `permission_id` SQL alias once the frontend
  has stabilised on `id`.
