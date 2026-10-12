-- name: CreateDownloadHistory :exec
INSERT
INTO download_history(
    id
    , file_name
    , dest_path
    , status
)
VALUES (? , ? , ? , ?) RETURNING *;