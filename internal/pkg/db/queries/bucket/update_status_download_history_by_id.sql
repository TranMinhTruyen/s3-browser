-- name: UpdateStatusDownloadHistoryById :one
UPDATE download_history 
SET
    status = ? 
    , updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    , version = version + 1 
WHERE
    id = ? 
    AND version = ? RETURNING *;
