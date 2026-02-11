-- 002_seed.sql
-- Development seed data for local debugging.
-- Default password for all seeded local accounts: password

BEGIN;

-- ---------------------------------------------------------------------------
-- Seed accounts + local identities
-- ---------------------------------------------------------------------------

WITH upsert AS (
    INSERT INTO accounts (username, display_name, status)
    VALUES
        ('dev_admin', 'Dev Admin', 1),
        ('dev_player1', 'Dev Player 1', 1)
    ON CONFLICT ((lower(username))) DO UPDATE
    SET
        display_name = EXCLUDED.display_name,
        status = EXCLUDED.status,
        updated_at = NOW()
    RETURNING id, username
)
INSERT INTO auth_identities (account_id, provider, provider_subject, password_hash)
SELECT
    id,
    'local'::auth_provider,
    lower(username),
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
FROM upsert
ON CONFLICT (provider, provider_subject) DO UPDATE
SET
    account_id = EXCLUDED.account_id,
    password_hash = EXCLUDED.password_hash,
    updated_at = NOW();

-- ---------------------------------------------------------------------------
-- Seed wallet state (overwrite to fixed debug balances)
-- ---------------------------------------------------------------------------

WITH seed_wallet AS (
    SELECT id AS account_id, lower(username) AS uname
    FROM accounts
    WHERE lower(username) IN ('dev_admin', 'dev_player1')
)
INSERT INTO wallet_accounts (account_id, currency, balance, locked_balance, version)
SELECT
    account_id,
    'USD',
    CASE WHEN uname = 'dev_admin' THEN 5000000 ELSE 1000000 END,
    0,
    0
FROM seed_wallet
ON CONFLICT (account_id) DO UPDATE
SET
    currency = EXCLUDED.currency,
    balance = EXCLUDED.balance,
    locked_balance = EXCLUDED.locked_balance,
    version = wallet_accounts.version + 1,
    updated_at = NOW();

-- Ledger baseline (idempotent by unique idempotency_key).
INSERT INTO wallet_ledger (account_id, reason, amount_delta, balance_after, idempotency_key, meta)
SELECT
    wa.account_id,
    'admin_adjust'::ledger_reason,
    wa.balance,
    wa.balance,
    'seed:wallet:' || a.username || ':v1',
    jsonb_build_object('source', '002_seed.sql', 'note', 'baseline debug funding')
FROM wallet_accounts wa
JOIN accounts a ON a.id = wa.account_id
WHERE lower(a.username) IN ('dev_admin', 'dev_player1')
AND NOT EXISTS (
    SELECT 1
    FROM wallet_ledger wl
    WHERE wl.idempotency_key = 'seed:wallet:' || a.username || ':v1'
);

-- ---------------------------------------------------------------------------
-- Seed poker tables
-- ---------------------------------------------------------------------------

INSERT INTO poker_tables (
    table_code,
    name,
    max_players,
    small_blind,
    big_blind,
    ante,
    min_buy_in,
    max_buy_in,
    status
)
VALUES
    ('DEV-50-100', 'Dev Table 50/100', 6, 50, 100, 0, 2000, 20000, 'active'),
    ('DEV-200-400', 'Dev Table 200/400', 6, 200, 400, 0, 8000, 80000, 'active')
ON CONFLICT (table_code) DO UPDATE
SET
    name = EXCLUDED.name,
    max_players = EXCLUDED.max_players,
    small_blind = EXCLUDED.small_blind,
    big_blind = EXCLUDED.big_blind,
    ante = EXCLUDED.ante,
    min_buy_in = EXCLUDED.min_buy_in,
    max_buy_in = EXCLUDED.max_buy_in,
    status = EXCLUDED.status,
    updated_at = NOW(),
    closed_at = NULL;

COMMIT;
