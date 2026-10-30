-- internal/pkg/db/schemas/000002_auth_methods.sql
-- SQLite cannot drop NOT NULL with ALTER, so connection_profiles is rebuilt (goose runs this in one transaction).
-- +goose Up
CREATE TABLE connection_profiles_new(
    id TEXT PRIMARY KEY
    , name TEXT CHECK (name IS NULL OR length(name) <= 100)
    , color TEXT CHECK (color IS NULL OR length(color) <= 20)
    , provider TEXT NOT NULL
    , endpoint TEXT NOT NULL
    , region TEXT NOT NULL
    , access_key TEXT
    , secret_key TEXT
    , path_style BOOLEAN DEFAULT 1
    , auto_connect BOOLEAN DEFAULT 0
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
    , auth_type TEXT NOT NULL DEFAULT 'static' CHECK (auth_type IN (
        'static'
        , 'sharedProfile'
        , 'assumeRole'
        , 'sso'
        , 'defaultChain'
        , 'anonymous'
        , 'minioAssumeRole'
        , 'minioLdap'
        , 'minioOidc'
        , 'minioCert'
    ))
    , auth_config TEXT
    , auth_secret TEXT
);

INSERT
INTO connection_profiles_new(
    id
    , name
    , color
    , provider
    , endpoint
    , region
    , access_key
    , secret_key
    , path_style
    , auto_connect
    , created_at
    , updated_at
    , version
)
SELECT
    id
    , name
    , color
    , provider
    , endpoint
    , region
    , access_key
    , secret_key
    , path_style
    , auto_connect
    , created_at
    , updated_at
    , version
FROM
    connection_profiles;

DROP INDEX idx_connection_profiles_name;
DROP TABLE connection_profiles;
ALTER TABLE connection_profiles_new RENAME TO connection_profiles;
CREATE INDEX idx_connection_profiles_name ON connection_profiles(name);

-- +goose Down
CREATE TABLE connection_profiles_old(
    id TEXT PRIMARY KEY
    , name TEXT CHECK (name IS NULL OR length(name) <= 100)
    , color TEXT CHECK (color IS NULL OR length(color) <= 20)
    , provider TEXT NOT NULL
    , endpoint TEXT NOT NULL
    , region TEXT NOT NULL
    , access_key TEXT NOT NULL
    , secret_key TEXT
    , path_style BOOLEAN DEFAULT 1
    , auto_connect BOOLEAN DEFAULT 0
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
);

INSERT
INTO connection_profiles_old(
    id
    , name
    , color
    , provider
    , endpoint
    , region
    , access_key
    , secret_key
    , path_style
    , auto_connect
    , created_at
    , updated_at
    , version
)
SELECT
    id
    , name
    , color
    , provider
    , endpoint
    , region
    , COALESCE(access_key, '')
    , secret_key
    , path_style
    , auto_connect
    , created_at
    , updated_at
    , version
FROM
    connection_profiles;

DROP INDEX idx_connection_profiles_name;
DROP TABLE connection_profiles;
ALTER TABLE connection_profiles_old RENAME TO connection_profiles;
CREATE INDEX idx_connection_profiles_name ON connection_profiles(name);
