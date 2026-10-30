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
    , auth_type
    , auth_config
    , auth_secret
) 
VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ? ) RETURNING *;
