# Zachi Smart-POS — Transaction Sync Engine

Status: **shipped (Task #2 — April 2026)**
Migration: `db/migrations/014_sync_engine.sql`
Code:     `controllers/syncController.js`, `controllers/deviceController.js`,
          `middleware/idempotency.js`, `utils/saleNumber.js`, `utils/atomicStock.js`,
          `public/js/sync.js`, `public/js/sync-ui.js`, `public/js/db.js`, `public/js/api.js`

This document describes the wire protocol, server-side guarantees, and
client behaviour that allow multiple POS terminals (cashier registers,
backoffice, mobile) to share a single PostgreSQL database without
duplicate sales, lost stock decrements, double-spent loyalty points, or
duplicate sale numbers — even when they go offline, fail mid-request,
or race each other on the same SKU.

---

## 1. Goals & non-goals

**Goals**

1. **No duplicate sales.** A retried `POST /api/sales` from the cashier (after
   a flaky network) must produce *exactly one* row in `sales`.
2. **No phantom stock.** Two registers selling the last unit of a SKU at
   the same moment must result in *one* sale + *one* stock-out error,
   not two oversold sales.
3. **No double-redeem of loyalty points.** Same guarantee for credit
   payments against an outstanding balance.
4. **No duplicate sale numbers.** Server is the only minter of
   `ZC-YYYYMMDD-NNN`. Clients never invent one.
5. **Eventual consistency for offline operation.** Cashier can keep
   ringing up sales while the upstream link is down; everything backfills
   when it returns.
6. **Replayable failures.** Server-side rejections (out of stock,
   negative loyalty balance, validation errors) are captured per-op so
   the operator can review, edit, and retry — they are *not* silently
   dropped.

**Non-goals (today)**

* Multi-master / peer-to-peer sync. There is exactly one PostgreSQL
  instance; clients are thin replicas of it. No CRDTs, no vector clocks.
* Real-time push from server → client. Pull is polled; push is on demand.
* Schema migrations propagated to the cache (clients re-fetch on bump).

---

## 2. Identifiers

Every mutating request from a POS terminal carries three identifiers:

| Header              | Source              | Purpose                                                                              |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `X-Device-Id`       | server, on register | UUID for this physical install. Stamped on `audit_logs.device_id` and on each row.   |
| `X-Client-Op-Id`    | client, per op      | UUID-v4 the client mints once, per business operation (one sale = one op id).        |
| `Idempotency-Key`   | client, per op      | UUID-v4 the client mints once, per *attempt at* the operation.                       |

`X-Client-Op-Id` is what the *client* uses to recognise its own row in
the pulled deltas (so a sale rung up offline gets reconciled with its
server-issued `sale_number`). `Idempotency-Key` is what the *server* uses
to cheaply replay a cached response when the client retries the exact
same payload.

These three are independent on purpose:

* If the client retries a request because it never saw the response,
  the **same** `Idempotency-Key` is reused → server returns the cached
  201 with the same `sale_id` and `sale_number`.
* If the operator deliberately re-submits a previously-rejected op
  from the **Pending sync** panel, a **new** `Idempotency-Key` is
  minted (the cached 4xx is no longer relevant) but the same
  `X-Client-Op-Id` so reconciliation still works.

---

## 3. Server-side guarantees

### 3.1 Sale-number minting (`utils/saleNumber.js`)

Sale numbers are `ZC-YYYYMMDD-NNN` (sequence resets each calendar day).
Two registers selling at the same instant must not get the same number.

We acquire a Postgres advisory lock keyed by *(domain tag · date)*:

```sql
SELECT pg_advisory_xact_lock($lockKey);
SELECT COALESCE(MAX(seq), 0) + 1 ...
INSERT INTO sales (sale_number, ...) VALUES ('ZC-20260426-014', ...);
```

The lock is **transaction-scoped** (`pg_advisory_xact_lock`) so it is
released automatically when the surrounding transaction commits or
rolls back; no explicit unlock is needed and crashed clients can't
strand the lock.

`$lockKey` is the FNV-1a hash of `'sale_number:YYYY-MM-DD'` XOR'd with a
domain tag (`0x5300_0000_0000_0000`) so it can never collide with other
advisory locks elsewhere in the codebase.

### 3.2 Atomic stock / loyalty / credit (`utils/atomicStock.js` + `controllers/loyaltyController.js`)

Each guarded mutation is a single `UPDATE ... WHERE balance >= $needed
RETURNING balance` inside the existing sale transaction:

```js
// utils/atomicStock.js
const r = await client.query(
    `UPDATE products SET stock_quantity = stock_quantity - $2
       WHERE product_id = $1 AND stock_quantity >= $2
       RETURNING stock_quantity`,
    [productId, qty]
);
if (r.rowCount === 0) throw new StockGuardError(productId, qty);
```

If two transactions race for the last unit, exactly one will get
`rowCount === 1` and the other will get `rowCount === 0` and throw
`StockGuardError` — which the controller maps to **409 Conflict**:

```json
{ "error": "Insufficient stock", "code": "STOCK_CONFLICT", "product_id": 42, "requested": 1 }
```

Identical pattern for `redeemLoyaltyPoints` (loyalty balance) and
`applyCreditPayment` (outstanding credit-sale balance) — each one fails
fast with `LoyaltyGuardError` / `CreditGuardError` → 409.

The standalone `POST /api/loyalty/earn` and `POST /api/loyalty/redeem`
endpoints (used outside a sale context, e.g. director-initiated point
adjustments) follow the same atomic shape inside their own
transaction:

```sql
-- earn
UPDATE customers SET loyalty_points = loyalty_points + $1
 WHERE customer_id = $2 RETURNING loyalty_points;

-- redeem (race-safe — concurrent redemptions can't double-spend)
UPDATE customers SET loyalty_points = loyalty_points - $1
 WHERE customer_id = $2 AND loyalty_points >= $1
RETURNING loyalty_points;
```

Zero-row return on redeem → 409 `INSUFFICIENT_POINTS`. The customer
balance update and the matching `loyalty_transactions` audit row commit
inside the same transaction so a crash mid-flow can never produce a
balance change without a paper trail (or vice versa).

`applyCreditPayment` deserves a callout because the obvious shortcut
is dangerous: a previous draft used
`SET amount_paid = LEAST(amount_paid + $1, total_amount)` with no
WHERE guard. That silently capped the increment when the payment
exceeded the balance — but the matching `INSERT INTO credit_payments`
row still recorded the full requested amount, leaving a phantom
surplus floating in the customer ledger forever. The current shape
is a guarded UPDATE:

```sql
UPDATE sales
   SET amount_paid    = amount_paid + $1,
       payment_status = ...
 WHERE sale_id = $2
   AND is_voided = FALSE
   AND amount_paid + $1 <= total_amount
RETURNING amount_paid, payment_status, total_amount;
```

A zero-row return triggers a `CreditGuardError` with `code: 'OVERPAYMENT'`
and details `{ requested, remaining, totalAmount, amountPaid }`,
which the controller surfaces as **409 Conflict** so the cashier can
correct the amount or apply the surplus to a different sale.

### 3.3 Idempotency (`middleware/idempotency.js`)

Mounted on every mutating route in scope. The full coverage matrix
(verifiable by `rg -n "idempotency\(\)" routes/`):

| Route                               | Method | Idempotency? | Notes                                                |
|-------------------------------------|--------|--------------|------------------------------------------------------|
| `/api/sales`                        | POST   | ✅            | New sale (cashier path)                              |
| `/api/sales/:id/void`               | PATCH  | ✅            | Void / refund                                        |
| `/api/sales/:id/payment`            | POST   | ✅            | Credit-order installment                             |
| `/api/sales/backlog`                | POST   | ✅            | Director backdated entry                             |
| `/api/sales/backlog/bulk`           | POST   | ✅            | Director CSV import                                  |
| `/api/sales/receipt/email`          | POST   | ✅            | E-mail receipt                                       |
| `/api/inventory/adjust`             | POST   | ✅            | Manual stock adjustment                              |
| `/api/inventory/stocktake`          | POST   | ✅            | Stocktake commit                                     |
| `/api/inventory/quick-receive`      | POST   | ✅            | Goods-received quick path                            |
| `/api/customers`                    | POST   | ✅            | Create customer                                      |
| `/api/customers/:id`                | PUT    | ✅            | Update customer                                      |
| `/api/customers/import`             | POST   | ⚠️ skipped   | multipart upload — body is a binary file we can't fingerprint |
| `/api/products`                     | POST/PUT/DELETE | ✅     | Catalog CRUD                                         |
| `/api/products/bulk-delete|update|merge` | POST | ✅          | Bulk catalog ops                                     |
| `/api/products/import`              | POST   | ⚠️ skipped   | multipart upload                                     |
| `/api/services` (CRUD + bulk)       | POST/PUT/DELETE | ✅     | Service catalog                                      |
| `/api/quotes`                       | POST/PATCH | ✅        | Create / status / convert                            |
| `/api/users`                        | POST/PUT/DELETE | ✅     | Director-only user mgmt                              |
| `/api/purchases`                    | POST/PUT/DELETE | ✅     | PO lifecycle + receive                               |
| `/api/loyalty/{earn,redeem,tiers}`  | POST   | ✅            | Points + tier mgmt                                   |
| `/api/suppliers` (CRUD + prices)    | POST/PUT/DELETE | ✅     | Supplier directory                                   |
| `/api/settings/:key`                | PUT    | ✅            | System settings                                      |
| `/api/jobCards` (CRUD + proofs/costs) | POST/PATCH/DELETE | ✅ | Job pipeline                                         |
| `/api/pricing/promotions`           | POST/DELETE | ✅       | Promotions; `/calculate` is a pure read              |
| `/api/returns`                      | POST/PATCH | ✅        | Returns + processing                                 |
| `/api/cash` (open/close/in/out)     | POST   | ✅            | Cash sessions                                        |
| `/api/payments`                     | POST/PUT/DELETE | ✅     | Payment-method mgmt                                  |
| `/api/permissions/role/:role`       | PUT    | ✅            | Role permissions matrix                              |
| `/api/approvals` (+ `/decide`)      | POST   | ✅            | Approval requests + decisions                        |
| `/api/auth/*`                       | POST   | ⚠️ skipped   | Login / token issuance — natural tokens already ensure single use |

For each request:

1. If no `Idempotency-Key` header → pass through. (Legacy clients still
   work; they just don't get replay protection.)
2. Validate the key is a UUID. **Malformed → 400 immediately**
   (`code: "IDEMPOTENCY_KEY_MALFORMED"`). A buggy client that thought
   it had retry protection must not silently double-write.
3. Compute a SHA-256 fingerprint of `(method, path, sorted-stringify(body))`.
4. Look up `idempotency_keys` row for `(idempotency_key, user_id)`
   — **the cache is tenant-scoped**. The same UUID posted by user A
   and user B yields two independent cache rows; user B can never
   see user A's response. Schema-level enforcement: a `UNIQUE
   (key, COALESCE(user_id, 0))` index from migration 014c, with the
   middleware lookup using `key = $1 AND user_id IS NOT DISTINCT FROM $2`.
   * **Hit + same fingerprint** → replay the cached response body and
     status. (No write happens twice.) Response carries
     `Idempotent-Replay: true`.
   * **Hit + different fingerprint** → 409 Conflict
     (`code: "IDEMPOTENCY_KEY_MISMATCH"`).
     Catches a buggy client that recycled a key.
   * **Miss** → continue to the controller. After the controller writes
     a successful response, the middleware caches `(status, body, fingerprint)`
     keyed by `(idempotency_key, user_id)` for **30 days**.

Replay is wired in by wrapping `res.json` / `res.send` so any controller
that issues a JSON or text body is captured automatically. Captures
**only** for status `< 400` so cached failures don't poison real retries
that might now succeed.

### 3.4 Per-row provenance

Every mutating insert / update writes:

* `device_id`     — taken from `X-Device-Id`
* `client_op_id`  — taken from `X-Client-Op-Id`

…on `sales`, `credit_payments`, `customers`, `loyalty_transactions`,
`inventory_movements`, `stock_adjustments`, and `goods_received`. This
is what the client uses to map server rows back to its local queue
entries during pull reconciliation.

---

## 4. Wire protocol

### 4.1 `POST /api/devices/register`

Called once on first login. Idempotent — a device with the same
`(device_id?)` simply has `last_seen_at` bumped.

Request:

```json
{ "device_id": "<existing uuid or null>", "name": "Front Counter", "platform": "web" }
```

Response 200:

```json
{ "device_id": "0c9a…d3", "name": "Front Counter", "platform": "web",
  "registered_at": "...", "last_seen_at": "..." }
```

The client persists `device_id` in `localStorage` (`zspos_device_id`).

### 4.2 `POST /api/sync/push`

Drain endpoint. Runs every queued op through the **same** controllers
the live API uses, via a short-circuit HTTP loopback to the same
listening port. (We initially tried in-process `app.handle()` with a
Readable/IncomingMessage shim; Express 5's body-parser relies on
stream events the shim couldn't faithfully emit, which hung the
inner request. Loopback costs ~1 ms locally and runs every middleware
— auth, idempotency, audit, atomic guards — exactly as a real client
would.) Results are returned in batch order.

Request:

```jsonc
{
  "deviceId": "0c9a…d3",
  "operations": [
    {
      "clientOpId":     "f1e8…",
      "idempotencyKey": "a8d2…",
      "method":         "POST",
      "endpoint":       "/api/sales",
      "body":           { ...sale payload... },
      "queuedAt":       "2026-04-26T17:54:11.123Z"
    },
    { "...up to 100 ops per batch..." }
  ]
}
```

Response 200:

```jsonc
{
  "serverTime": "2026-04-26T18:01:14.221Z",
  "results": [
    { "clientOpId": "f1e8…", "status": 201,
      "response": { "sale_id": 14, "sale_number": "ZC-20260426-014" } },
    { "clientOpId": "...",   "status": 409,
      "error":    { "error": "Insufficient stock", "code": "STOCK_CONFLICT" } }
  ]
}
```

The 2xx body is on `response`, the non-2xx body is on `error` — the
client uses `status` to decide which.

The endpoint **always** returns 200 with a per-op `status`; transport
errors only happen when the network really is down. The client uses
`results[i].status` to decide what to do with each op (success → drop
from queue; 4xx → move to `failed_ops_log`; 5xx → keep in queue, retry
later).

`/api/sync/*` is explicitly excluded from being wrapped this way — no
recursion is possible.

### 4.3 `GET /api/sync/pull?since=ISO`

Returns deltas since `?since`:

```json
{
  "serverTime": "2026-04-26T18:01:14.221Z",
  "cursor":     "2026-04-26T18:01:13.999Z",
  "scope":      { "role": "cashier", "sales": "own" },
  "sales":     [ { "sale_id": 14, "sale_number": "ZC-...", "updated_at": "...", "client_op_id": "f1e8…", ... } ],
  "products":  [ { "product_id": 42, "stock_quantity": 0, "updated_at": "..." } ],
  "customers": [ { "customer_id": 7, "client_op_id": "...", "updated_at": "..." } ]
}
```

The client stores `cursor` as the next `since`, applies products /
customers to its IndexedDB cache, and emits a
`zspos:sync:reconciled` event for each sale whose `client_op_id` matches
a queued offline receipt — POS UI then rewrites `OFF-…` → real
`ZC-YYYYMMDD-NNN`.

**Cursor semantics.** The pull filter is `updated_at > since`, **not**
`transaction_date > since`. `transaction_date` is set once at sale
creation and never changes, so a cursor based on it would never
deliver voids or credit-payment status changes to a tablet that had
already synced the original sale. Migration `014b_sync_engine_followups.sql`
adds `sales.updated_at` with a `BEFORE UPDATE` touch trigger so any
row mutation (void, payment, status change) bumps the cursor.

**Authorization scope.** The endpoint enforces a per-role projection
of the sales stream so that a cashier on tablet A doesn't pull
tablet B's transactions into their device's IndexedDB:

| Role        | Sales returned                       | Products / Customers |
|-------------|--------------------------------------|----------------------|
| director    | all (`updated_at > since`)           | full catalog         |
| manager     | all                                  | full catalog         |
| cashier     | own only (`AND staff_id = $user`)    | full catalog         |
| consultant  | none (consultant doesn't ring sales) | full catalog         |

The chosen projection is reflected back in `response.scope` so the
client can label the sync status (e.g. "synced your sales" vs
"synced all sales"). Products and customers are returned to every
signed-in role because every POS terminal needs the full catalog to
operate offline.

---

## 5. Client behaviour

### 5.1 Two queues + a dead-letter (`public/js/db.js` v3)

* `pendingSales`     — full sale payloads (one IDB row per sale)
* `pendingMutations` — generic `{method, endpoint, body}` for non-sales
* `failed_ops`       — server rejected (4xx) ops; **operator must act**

Every queue entry stores `clientOpId`, `idempotencyKey`, `deviceId`,
`queuedAt` so the same key is reused on every retry. Legacy queue
records (captured before the sync engine landed) get fresh IDs
**persisted back to IndexedDB** by `Sync._buildOps()` *before* the
push goes out — otherwise a retry following a dropped response would
mint a *new* idempotency key and the server would write the row twice.

### 5.2 `Sync` (`public/js/sync.js`)

* `Sync.flush()` — pops up to 50 pending ops, posts to
  `/api/sync/push`, removes successful ones, moves 4xx to `failed_ops`,
  leaves 5xx in place.
* `Sync.refresh()` — pulls deltas via `/api/sync/pull?since=<cursor>`,
  applies them to IndexedDB **before** advancing the cursor (so a
  crash mid-apply doesn't lose rows), reconciles any returned sales
  back to queued ops by `client_op_id` (covers the case where the
  push response was lost on the wire but the server actually wrote
  the row), then busts the in-memory `App.state` caches so the next
  page render reads fresh data. Cached entity slices are written
  under `GET:/api/<entity>?delta` keys in the IndexedDB `data` store.
* `Sync.syncNow()` — `flush()` + `refresh()` in sequence; manual
  trigger from the badge.
* `Sync.pendingCount()` — counts for the badge.
* `Sync.lastPushAt() / lastPullAt()` — last successful timestamps.

Auto-sync (`sync-ui.js`) every 30 s while online + signed in, plus on
the `online` window event.

### 5.3 Offline receipt format

When the connection is down, the cashier still gets a printable
receipt. The temporary number is:

```
ZC-OFF-<deviceId>-<n>
```

Where `<deviceId>` is the full device UUID and `<n>` is a per-device
monotonic counter (persisted in `localStorage` under
`zspos_offline_sale_counter` so it survives page reloads). This is
**only** stored client-side; on next pull, `client_op_id` matching
rewrites the on-screen / re-printable number to `ZC-YYYYMMDD-NNN`.

### 5.4 Status badge & pending panel

Top-header `#sync-status`:

| Dot colour | Meaning                                           |
| ---------- | ------------------------------------------------- |
| green      | online, queue empty, last push timestamp shown    |
| amber      | online + queue non-empty, *or* failed ops pending |
| red        | navigator.onLine === false                        |

Clicking the badge opens a modal listing queued sales, queued
mutations, and failed ops. Failed entries have **Retry** and **Discard**
buttons. Retry **preserves** the original `clientOpId` so the eventual
server row reconciles back to the same logical operation, and only
rotates the `Idempotency-Key` so the previous 4xx cache entry doesn't
hijack the fresh attempt.

---

## 6. Test coverage (`tests/sync.jest.test.js`)

* **Idempotency replay** — same `Idempotency-Key` posted twice returns
  the same `sale_id` / `sale_number`, and the DB shows exactly one row.
* **Idempotency-Key reuse with different payload** — 409.
* **Atomic stock contention** — two concurrent sales for 1 unit of a
  1-stock product → one 201, one 409 with `STOCK_CONFLICT`. DB stock
  ends at 0, never negative.
* **Sale-number minting under contention** — 8 concurrent sales →
  8 distinct `ZC-YYYYMMDD-NNN` numbers in monotonically-increasing
  sequence. No duplicates.
* **Sync push replay** — `POST /api/sync/push` with two ops, the
  second a duplicate `Idempotency-Key`, returns the same `sale_id`
  twice with `status: 201` for both.
* **Credit-payment overpayment** — POST `/api/sales/:id/payment` with
  `amount = 1.5 × total` returns 409 `OVERPAYMENT`, `sales.amount_paid`
  is unchanged, and zero rows are inserted into `credit_payments`.
* **Malformed Idempotency-Key** — `Idempotency-Key: not-a-uuid` →
  400 `IDEMPOTENCY_KEY_MALFORMED`; the controller is never invoked
  and stock is unaffected.
* **Cross-user idempotency isolation** — User A and user B POST the
  *same* `Idempotency-Key` with the same payload; the server creates
  two distinct sales (different `sale_id` and `sale_number`), and the
  cache table holds two rows scoped by `(key, user_id)`.
* **Customer-update provenance** — PUT `/api/customers/:id` with
  `X-Device-Id` + `X-Client-Op-Id` stamps both columns on the row.
* **Loyalty-earn provenance** — POST `/api/loyalty/earn` stamps
  `device_id` + `client_op_id` on the inserted `loyalty_transactions`
  row.
* **Atomic loyalty redemption** — two concurrent redemptions for the
  last 5 points → one 201, one 409 `INSUFFICIENT_POINTS`; final
  balance is exactly 0; exactly one `loyalty_transactions` row
  recorded. No double-spend.
* **Multi-device contention (offline-then-reconnect simulation)** —
  10 distinct `X-Device-Id` headers each push 1 sale against a 10-unit
  product. All 10 succeed (201), every `sale_number` is unique and
  matches `^ZC-\d{8}-\d+$`, and product stock lands at exactly 0.
  Mirrors the worst-case "10 tablets all reconnect at the same
  moment" scenario at the API contract layer.

The overpayment test additionally verifies that an exact-balance
follow-up payment then succeeds, marking the sale `Paid` and writing
exactly one `credit_payments` row with the full amount (no silent
capping).

---

## 7. Operational notes

* `idempotency_keys` is purged after **30 days**. Two paths run the
  same DELETE so the table never grows without bound:
    * `scripts/cleanup-idempotency.js` — cron-friendly nightly job
      (`30 02 * * * node scripts/cleanup-idempotency.js`); the
      retention can be overridden with `IDEMPOTENCY_RETENTION_DAYS`.
    * `controllers/syncController.js` — lazy cleanup that runs at
      most once per hour per process on `/api/sync/push`, so a
      deployment without a cron still stays bounded.
* `failed_ops_log` is kept indefinitely (compliance).
* Advisory-lock contention is bounded by transaction length; sale
  transactions are O(items) and complete in <50 ms typically, so
  cashier-perceived latency under contention is unchanged.
* The protocol is **additive**: legacy clients (no `Idempotency-Key`,
  no `X-Device-Id`) still work; they just lose retry protection and
  show as `device_id IS NULL` in audit logs.
