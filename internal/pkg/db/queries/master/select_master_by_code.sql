-- name: SelectMasterByCode :many
SELECT
    m.code
    , m.name
    , m.sort_order
    , m.value1
    , m.value2
    , m.value3
    , m.value4
    , m.value5
    , m.value6
    , m.value7
    , m.value8
    , m.value9
    , m.value10
FROM
    master m
WHERE
    m.code = ?
ORDER BY
    m.value2
    , m.sort_order;
