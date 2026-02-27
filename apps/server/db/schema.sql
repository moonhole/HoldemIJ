-- holdem-lite PostgreSQL schema (single-database deployment).
-- Target database: holdem_lite

BEGIN;

-- ============================================================================
-- enum types
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auth_provider') THEN
        CREATE TYPE auth_provider AS ENUM ('local', 'steam', 'guest');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_status') THEN
        CREATE TYPE table_status AS ENUM ('active', 'paused', 'closed');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_state') THEN
        CREATE TYPE membership_state AS ENUM ('standing', 'seated', 'left');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hand_phase') THEN
        CREATE TYPE hand_phase AS ENUM ('ante', 'preflop', 'flop', 'turn', 'river', 'showdown', 'ended');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_kind') THEN
        CREATE TYPE action_kind AS ENUM (
            'check', 'bet', 'call', 'raise', 'fold', 'allin',
            'post_ante', 'post_sb', 'post_bb',
            'timeout_check', 'timeout_fold'
        );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_reason') THEN
        CREATE TYPE ledger_reason AS ENUM (
            'buy_in', 'cash_out', 'rebuy',
            'hand_settlement', 'excess_refund',
            'admin_adjust'
        );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_source') THEN
        CREATE TYPE ledger_source AS ENUM ('live', 'replay', 'sandbox');
    END IF;
END
$$;

-- ============================================================================
-- generic trigger helper
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- accounts / auth
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL CHECK (char_length(username) BETWEEN 3 AND 32),
    display_name TEXT NOT NULL DEFAULT '',
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_username_ci
    ON accounts ((lower(username)));

CREATE TABLE IF NOT EXISTS auth_identities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider auth_provider NOT NULL,
    provider_subject TEXT NOT NULL,
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_auth_password_local
        CHECK (
            (provider = 'local' AND password_hash IS NOT NULL)
            OR (provider <> 'local')
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_provider_subject
    ON auth_identities (provider, provider_subject);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_account_provider
    ON auth_identities (account_id, provider);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip INET
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_account
    ON auth_sessions (account_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON auth_sessions (expires_at)
    WHERE revoked_at IS NULL;

-- ============================================================================
-- wallets
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_accounts (
    account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    locked_balance BIGINT NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    reason ledger_reason NOT NULL,
    amount_delta BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    table_id BIGINT,
    hand_id BIGINT,
    idempotency_key TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_idempotency
    ON wallet_ledger (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_account_time
    ON wallet_ledger (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_hand
    ON wallet_ledger (hand_id)
    WHERE hand_id IS NOT NULL;

-- ============================================================================
-- table / hand domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS poker_tables (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_code TEXT NOT NULL,
    name TEXT NOT NULL,
    max_players SMALLINT NOT NULL CHECK (max_players BETWEEN 2 AND 10),
    small_blind BIGINT NOT NULL CHECK (small_blind > 0),
    big_blind BIGINT NOT NULL CHECK (big_blind >= small_blind),
    ante BIGINT NOT NULL DEFAULT 0 CHECK (ante >= 0),
    min_buy_in BIGINT NOT NULL CHECK (min_buy_in > 0),
    max_buy_in BIGINT NOT NULL CHECK (max_buy_in >= min_buy_in),
    status table_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_poker_tables_code
    ON poker_tables (table_code);

CREATE TABLE IF NOT EXISTS table_memberships (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_id BIGINT NOT NULL REFERENCES poker_tables(id) ON DELETE RESTRICT,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    current_seat SMALLINT CHECK (current_seat BETWEEN 0 AND 9),
    state membership_state NOT NULL DEFAULT 'standing',
    stack BIGINT NOT NULL DEFAULT 0 CHECK (stack >= 0),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_membership_active_account
    ON table_memberships (table_id, account_id)
    WHERE left_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_membership_active_seat
    ON table_memberships (table_id, current_seat)
    WHERE left_at IS NULL AND current_seat IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_table_membership_table_state
    ON table_memberships (table_id, state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS hands (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_id BIGINT NOT NULL REFERENCES poker_tables(id) ON DELETE RESTRICT,
    round_no BIGINT NOT NULL,
    phase hand_phase NOT NULL DEFAULT 'preflop',
    dealer_seat SMALLINT CHECK (dealer_seat BETWEEN 0 AND 9),
    small_blind_seat SMALLINT CHECK (small_blind_seat BETWEEN 0 AND 9),
    big_blind_seat SMALLINT CHECK (big_blind_seat BETWEEN 0 AND 9),
    board_cards TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    CONSTRAINT uq_hands_table_round UNIQUE (table_id, round_no)
);

CREATE INDEX IF NOT EXISTS idx_hands_table_started
    ON hands (table_id, started_at DESC);

CREATE TABLE IF NOT EXISTS hand_participants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hand_id BIGINT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    seat SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 9),
    stack_start BIGINT NOT NULL CHECK (stack_start >= 0),
    stack_end BIGINT CHECK (stack_end >= 0),
    hole_cards TEXT NOT NULL DEFAULT '',
    has_cards BOOLEAN NOT NULL DEFAULT FALSE,
    folded BOOLEAN NOT NULL DEFAULT FALSE,
    all_in BOOLEAN NOT NULL DEFAULT FALSE,
    best_five_cards TEXT NOT NULL DEFAULT '',
    hand_rank SMALLINT,
    hand_value INTEGER,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    win_amount BIGINT NOT NULL DEFAULT 0,
    revealed_at_showdown BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_hand_participants_hand_account UNIQUE (hand_id, account_id),
    CONSTRAINT uq_hand_participants_hand_seat UNIQUE (hand_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_hand_participants_hand_winner
    ON hand_participants (hand_id, is_winner);

CREATE TABLE IF NOT EXISTS hand_actions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hand_id BIGINT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
    seq INT NOT NULL CHECK (seq > 0),
    phase hand_phase NOT NULL,
    actor_account_id BIGINT REFERENCES accounts(id) ON DELETE RESTRICT,
    seat SMALLINT CHECK (seat BETWEEN 0 AND 9),
    action action_kind NOT NULL,
    amount_to BIGINT NOT NULL DEFAULT 0,
    delta BIGINT NOT NULL DEFAULT 0,
    pot_total_after BIGINT NOT NULL DEFAULT 0,
    server_ts_ms BIGINT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hand_actions_seq UNIQUE (hand_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_hand_actions_actor
    ON hand_actions (actor_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hand_pots (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hand_id BIGINT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
    pot_index INT NOT NULL CHECK (pot_index >= 0),
    amount BIGINT NOT NULL CHECK (amount >= 0),
    eligible_seats SMALLINT[] NOT NULL DEFAULT '{}'::smallint[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_hand_pots_index UNIQUE (hand_id, pot_index)
);

CREATE TABLE IF NOT EXISTS hand_pot_winners (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hand_pot_id BIGINT NOT NULL REFERENCES hand_pots(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    seat SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 9),
    win_amount BIGINT NOT NULL CHECK (win_amount >= 0),
    CONSTRAINT uq_hand_pot_winners_unique UNIQUE (hand_pot_id, account_id)
);

CREATE TABLE IF NOT EXISTS table_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_id BIGINT NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
    hand_id BIGINT REFERENCES hands(id) ON DELETE SET NULL,
    server_seq BIGINT NOT NULL CHECK (server_seq >= 0),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    server_ts_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_table_events_seq UNIQUE (table_id, server_seq)
);

CREATE INDEX IF NOT EXISTS idx_table_events_hand
    ON table_events (hand_id, server_seq);

-- ============================================================================
-- ledger / audit domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS ledger_event_stream (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source ledger_source NOT NULL,
    scenario_id TEXT NOT NULL DEFAULT '',
    hand_id TEXT NOT NULL,
    seq BIGINT NOT NULL CHECK (seq >= 0),
    event_type TEXT NOT NULL,
    envelope_b64 TEXT NOT NULL DEFAULT '',
    server_ts_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_ledger_event_stream_scenario
        CHECK (
            (source = 'sandbox' AND char_length(scenario_id) > 0)
            OR
            (source <> 'sandbox' AND scenario_id = '')
        ),
    CONSTRAINT uq_ledger_event_stream_unique
        UNIQUE (source, scenario_id, hand_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ledger_event_stream_hand_seq
    ON ledger_event_stream (source, hand_id, seq);

CREATE INDEX IF NOT EXISTS idx_ledger_event_stream_created_at
    ON ledger_event_stream (created_at);

CREATE TABLE IF NOT EXISTS audit_user_hand_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source ledger_source NOT NULL,
    hand_id TEXT NOT NULL,
    played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    tape_blob BYTEA,
    is_saved BOOLEAN NOT NULL DEFAULT FALSE,
    saved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_audit_user_hand_history_source
        CHECK (source IN ('live', 'replay')),
    CONSTRAINT ck_audit_user_hand_history_saved_at
        CHECK (
            (is_saved = TRUE AND saved_at IS NOT NULL)
            OR
            (is_saved = FALSE AND saved_at IS NULL)
        ),
    CONSTRAINT uq_audit_user_hand_history_user_source_hand
        UNIQUE (user_id, source, hand_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_user_hand_history_recent
    ON audit_user_hand_history (user_id, source, played_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_hand_history_saved
    ON audit_user_hand_history (user_id, source, is_saved, saved_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_hand_history_trim
    ON audit_user_hand_history (user_id, source, played_at ASC)
    WHERE is_saved = FALSE;

CREATE TABLE IF NOT EXISTS ledger_projection_checkpoints (
    projection_name TEXT PRIMARY KEY,
    last_event_id BIGINT NOT NULL DEFAULT 0 CHECK (last_event_id >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- story progression
-- ============================================================================

CREATE TABLE IF NOT EXISTS story_progress (
    user_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    highest_completed_chapter INT NOT NULL DEFAULT 0 CHECK (highest_completed_chapter >= 0),
    completed_chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
    unlocked_features JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;
CREATE TRIGGER trg_accounts_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_auth_identities_updated_at ON auth_identities;
CREATE TRIGGER trg_auth_identities_updated_at
BEFORE UPDATE ON auth_identities
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_wallet_accounts_updated_at ON wallet_accounts;
CREATE TRIGGER trg_wallet_accounts_updated_at
BEFORE UPDATE ON wallet_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_poker_tables_updated_at ON poker_tables;
CREATE TRIGGER trg_poker_tables_updated_at
BEFORE UPDATE ON poker_tables
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_user_hand_history_updated_at ON audit_user_hand_history;
CREATE TRIGGER trg_audit_user_hand_history_updated_at
BEFORE UPDATE ON audit_user_hand_history
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ledger_projection_checkpoints_updated_at ON ledger_projection_checkpoints;
CREATE TRIGGER trg_ledger_projection_checkpoints_updated_at
BEFORE UPDATE ON ledger_projection_checkpoints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_story_progress_updated_at ON story_progress;
CREATE TRIGGER trg_story_progress_updated_at
BEFORE UPDATE ON story_progress
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
