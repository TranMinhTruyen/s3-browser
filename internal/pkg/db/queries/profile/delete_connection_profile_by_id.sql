-- name: DeleteConnectionProfileById :exec
DELETE 
FROM
    connection_profiles 
WHERE
    id = ? RETURNING *;
