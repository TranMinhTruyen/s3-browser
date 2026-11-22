-- name: SelectAllDbProfile :many
SELECT
    dp.*
FROM
    db_profiles dp
ORDER BY
    dp.created_at
    , dp.rowid;
