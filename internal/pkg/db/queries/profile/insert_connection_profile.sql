-- name: CreateProfile :one
INSERT 
INTO connection_profiles( 
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
) 
VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? ) RETURNING *;
