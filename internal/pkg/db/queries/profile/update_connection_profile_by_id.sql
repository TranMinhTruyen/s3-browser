-- name: UpdateConnectionProfileById :one
UPDATE connection_profiles 
SET
    name = ? 
    , color = ? 
    , provider = ? 
    , endpoint = ? 
    , region = ? 
    , access_key = ? 
    , secret_key = ? 
    , path_style = ? 
    , auto_connect = ? 
    , auth_type = ? 
    , auth_config = ? 
    , auth_secret = ? 
    , updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') 
    , version = version + 1 
WHERE
    id = ? 
    AND version = ? RETURNING *;
