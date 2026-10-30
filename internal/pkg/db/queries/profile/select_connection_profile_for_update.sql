-- name: SelectConnectionProfileForUpdate :one
SELECT
    cp.*
FROM
    connection_profiles cp
WHERE
    cp.id = ?
    AND cp.version = ?