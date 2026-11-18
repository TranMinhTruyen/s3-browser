-- name: InsertDbProfile :one
INSERT
INTO db_profiles(
    id
    , name
    , color
    , provider
    , config
    , secret
)
VALUES (? , ? , ? , ? , ? , ? ) RETURNING *;
