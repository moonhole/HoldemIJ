-- 003_ledger_audit.sql
-- Add ledger core and audit history tables.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_source') THEN
        CREATE TYPE ledger_source AS ENUM ('live', 'replay', 'sandbox');
    END IF;
END
$$;

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

COMMIT;
