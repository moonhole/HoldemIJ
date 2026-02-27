-- 004_story_progress.sql
-- Story mode progression persistence.

BEGIN;

CREATE TABLE IF NOT EXISTS story_progress (
    user_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    highest_completed_chapter INT NOT NULL DEFAULT 0 CHECK (highest_completed_chapter >= 0),
    completed_chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
    unlocked_features JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_story_progress_updated_at ON story_progress;
CREATE TRIGGER trg_story_progress_updated_at
BEFORE UPDATE ON story_progress
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
