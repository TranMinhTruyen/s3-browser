-- name: UpdateDbProfileById :one
UPDATE db_profiles
SET
    name = ?
    , color = ?
    , provider = ?
    , config = ?
    , secret = ?
    , updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE
    id = ? RETURNING *;
