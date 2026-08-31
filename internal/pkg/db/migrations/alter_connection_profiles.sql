PRAGMA foreign_keys = OFF; 

PRAGMA legacy_alter_table = 
    ON; 

BEGIN IMMEDIATE; 

CREATE TABLE IF NOT EXISTS connection_profiles( 
    id TEXT PRIMARY KEY
    , name TEXT CHECK (name IS NULL OR length(name) <= 100)
    , color TEXT CHECK (color IS NULL OR length(color) <= 20)
    , endpoint TEXT NOT NULL
    , region TEXT NOT NULL
    , access_key TEXT NOT NULL
    , secret_key TEXT NOT NULL
    , path_style BOOLEAN DEFAULT 1
    , save_password BOOLEAN DEFAULT 1
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
); 

DROP TABLE IF EXISTS connection_profiles_new; 

CREATE TABLE connection_profiles_new( 
    id TEXT PRIMARY KEY
    , name TEXT CHECK (name IS NULL OR length(name) <= 100)
    , color TEXT CHECK (color IS NULL OR length(color) <= 20)
    , endpoint TEXT NOT NULL
    , region TEXT NOT NULL
    , access_key TEXT NOT NULL
    , secret_key TEXT NOT NULL
    , path_style BOOLEAN DEFAULT 1
    , save_password BOOLEAN DEFAULT 1
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , version INTEGER NOT NULL DEFAULT 1
); 

INSERT 
INTO connection_profiles_new( 
    id
    , name
    , color
    , endpoint
    , region
    , access_key
    , secret_key
    , path_style
    , save_password
    , created_at
    , updated_at
    , version
) 
SELECT
    id
    , name
    , collor
    , endpoint
    , access_key
    , secret_key
    , use_ssl
    , save_password
    , created_at
    , updated_at
    , version 
FROM
    connection_profiles; 

DROP TABLE connection_profiles; 

ALTER TABLE connection_profiles_new RENAME TO connection_profiles; 

PRAGMA foreign_key_check; 

COMMIT; 

PRAGMA legacy_alter_table = OFF; 

PRAGMA foreign_keys = 
    ON;
