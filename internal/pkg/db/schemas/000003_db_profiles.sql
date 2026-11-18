-- internal/db/schemas/000003_db_profiles.sql
-- +goose Up
CREATE TABLE db_profiles(
    id TEXT PRIMARY KEY
    , name TEXT NOT NULL CHECK (length(name) <= 100)
    , color TEXT NOT NULL DEFAULT '' CHECK (length(color) <= 20)
    , provider TEXT NOT NULL
    , config TEXT NOT NULL
    , secret TEXT
    , created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    , updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_db_profiles_name ON db_profiles(name);

-- +goose Down
DROP TABLE db_profiles;
