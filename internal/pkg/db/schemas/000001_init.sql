-- internal/db/schemas/000001_init.sql
-- +goose Up
CREATE TABLE 
IF NOT EXISTS connection_profiles( 
    id TEXT PRIMARY KEY
    , name TEXT CHECK (name IS NULL OR length(name) <= 100)
    , color TEXT CHECK (color IS NULL OR length(color) <= 20)
    , endpoint TEXT NOT NULL
    , region TEXT NOT NULL
    , access_key TEXT NOT NULL
    , secret_key TEXT NOT NULL
    , path_style BOOLEAN DEFAULT 1
    , save_password BOOLEAN DEFAULT 1
    , auto_connect BOOLEAN DEFAULT 0
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_connection_profiles_name ON connection_profiles(name);

-- +goose Down
DROP INDEX idx_connection_profiles_name;
DROP TABLE connection_profiles;