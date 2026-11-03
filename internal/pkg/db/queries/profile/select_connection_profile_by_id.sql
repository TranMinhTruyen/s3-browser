-- name: SelectConnectionProfileById :one
SELECT
    cp.*
FROM
    connection_profiles cp 
WHERE
    cp.id = ?