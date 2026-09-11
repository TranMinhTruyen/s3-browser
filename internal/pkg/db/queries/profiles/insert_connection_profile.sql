-- name: CreateProfile :one
INSERT 
INTO connection_profiles( 
    id
    , name
    , color
    , endpoint
    , region
    , access_key
    , secret_key
    , path_style
    , save_password
    , auto_connect
) 
VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? ) RETURNING *;
