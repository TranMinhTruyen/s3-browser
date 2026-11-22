-- name: SelectDbProfileById :one
SELECT
    dp.*
FROM
    db_profiles dp
WHERE
    dp.id = ?;
