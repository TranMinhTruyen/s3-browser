-- name: SelectAllProfile :many
SELECT
    cp.id AS connection_id
    , cp.name AS connection_name 
FROM
    connection_profiles cp 
ORDER BY
    cp.created_at;
    