-- name: CreateDownloadHistory :one
INSERT
INTO download_history(
    id
    , file_name
    , dest_path
    , status
)
VALUES (? , ? , ? , ?) RETURNING *;