-- name: SelectAllConnectionProfile :many
SELECT
    cp.*
FROM
    connection_profiles cp
ORDER BY
    cp.created_at;
