-- name: UpdateConnectionProfileById :one
UPDATE connection_profiles 
SET
    name = ? 
    , color = ? 
    , endpoint = ? 
    , region = ? 
    , access_key = ? 
    , secret_key = ? 
    , save_password = ? 
    , path_style = ? 
    , auto_connect = ? 
    , updated_at = ?
    , version = version + 1 
WHERE
    id = ? 
    AND version = ? RETURNING *;
