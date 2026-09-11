-- name: UpdateConnectionProfileById :one
UPDATE connection_profiles 
SET
    name = ? 
    , color = ? 
    , endpoint = ? 
    , region = ? 
    , access_key = ? 
    , secret_key = ? 
    , path_style = ? 
    , save_password = ? 
    , updated_at = ?
    , version = version + 1 
WHERE
    id = ? 
    AND version = ? RETURNING *;
