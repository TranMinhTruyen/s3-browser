-- name: SelectAllDownloadHistory :many
SELECT
    dh.*
FROM
    download_history dh
ORDER BY
    dh.created_at;