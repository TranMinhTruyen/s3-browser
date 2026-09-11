-- name: SelectAllConnectionProfile :many
SELECT
    cp.id AS connection_id
    , cp.NAME AS connection_name
    , cp.color
    , cp.endpoint
    , cp.access_key
    , cp.secret_key
    , cp.region
    , cp.path_style
    , cp.save_password
    , cp.auto_connect
    , cp.created_at
    , cp.updated_at
    , cp.version
FROM
    connection_profiles cp
ORDER BY
    cp.created_at;

