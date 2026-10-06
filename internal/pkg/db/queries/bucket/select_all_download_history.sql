-- name: SelectAllDownloadHistory :many
SELECT
    dh.*
FROM
    download_history dh
WHERE
    dh.id > sqlc.arg(after_id)
ORDER BY
    dh.id
LIMIT
    sqlc.arg(page_size);