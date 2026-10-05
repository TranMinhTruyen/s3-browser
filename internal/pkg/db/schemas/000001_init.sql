-- internal/db/schemas/000001_init.sql
-- +goose Up
CREATE TABLE IF NOT EXISTS connection_profiles(
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

CREATE INDEX idx_connection_profiles_name ON connection_profiles(name);

CREATE TABLE IF NOT EXISTS master(
    id INTEGER PRIMARY KEY
    , code TEXT NOT NULL
    , name TEXT NOT NULL
    , sort_order INTEGER NOT NULL
    , value1 TEXT NOT NULL
    , value2 TEXT
    , value3 TEXT
    , value4 TEXT
    , value5 TEXT
    , value6 TEXT
    , value7 TEXT
    , value8 TEXT
    , value9 TEXT
    , value10 TEXT
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_master_code ON master(code); 

INSERT 
INTO master(code, name, value1, value2, sort_order)
VALUES ('REGION', 'Singapore', 'ap-southeast-1', '01', 1)
, ('REGION', 'Tokyo', 'ap-northeast-1', '01', 2)
, ('REGION', 'Sydney ', 'ap-southeast-2', '01', 3)
, ('REGION', 'Hong Kong', 'ap-east-1', '01', 4)
, ('REGION', 'North Virginia', 'us-east-1', '02', 1)
, ('REGION', 'Oregon', 'us-west-2', '02', 2)
, ('REGION', 'Ireland', 'eu-west-1', '03', 1)
, ('REGION', 'São Paulo', 'sa-east-1', '04', 1);

CREATE TABLE IF NOT EXISTS download_history(
    id TEXT PRIMARY KEY
    , file_name TEXT NOT NULL
    , dest_path TEXT NOT NULL
    , status TEXT NOT NULL
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_download_file_name ON download_history(file_name); 

-- +goose Down
DROP INDEX idx_connection_profiles_name;
DROP TABLE connection_profiles;

DROP INDEX idx_master_code;
DROP TABLE master;

DROP INDEX idx_download_file_name;
DROP TABLE download_history;