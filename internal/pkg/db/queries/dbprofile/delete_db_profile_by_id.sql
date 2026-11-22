-- name: DeleteDbProfileById :execrows
DELETE
FROM
    db_profiles
WHERE
    id = ?;
