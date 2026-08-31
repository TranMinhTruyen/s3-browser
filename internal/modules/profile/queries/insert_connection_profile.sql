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
) 
VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? ) RETURNING *;
