-- Dữ liệu mẫu cho PostgreSQL (database demo được script tạo), nạp bằng `sh scripts/test-env.sh seed`.
-- Cùng cấu trúc với mysql.sql; các giá trị được tạo có thể lặp lại và không phải dữ liệu thật.
CREATE TABLE customers (
    id         int PRIMARY KEY
  , name       varchar(100) NOT NULL
  , email      varchar(150) NOT NULL UNIQUE
  , country    char(2)      NOT NULL
  , is_active  boolean      NOT NULL
  , note       text
  , created_at timestamp    NOT NULL
);

CREATE TABLE products (
    id        int PRIMARY KEY
  , sku       varchar(20)   NOT NULL UNIQUE
  , name      varchar(100)  NOT NULL
  , price     numeric(10,2) NOT NULL
  , stock     int           NOT NULL
  , attrs     jsonb
  , thumbnail bytea
);

CREATE TABLE orders (
    id          int PRIMARY KEY
  , customer_id int           NOT NULL REFERENCES customers (id)
  , status      varchar(20)   NOT NULL
  , ordered_at  timestamp     NOT NULL
  , total       numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);

CREATE TABLE order_items (
    order_id   int           NOT NULL REFERENCES orders (id)
  , product_id int           NOT NULL REFERENCES products (id)
  , qty        int           NOT NULL
  , unit_price numeric(10,2) NOT NULL
  , PRIMARY KEY (order_id, product_id)
);

CREATE TABLE events (
    id         bigint PRIMARY KEY
  , kind       varchar(20) NOT NULL
  , payload    jsonb       NOT NULL
  , created_at timestamptz NOT NULL
);

INSERT INTO customers
SELECT i
     , 'Customer ' || i
     , 'customer' || i || '@example.com'
     , (ARRAY['VN', 'US', 'JP', 'DE', 'FR', 'GB'])[1 + i % 6]
     , i % 7 <> 0
     , CASE WHEN i % 5 = 0 THEN 'Note for customer ' || i END
     , timestamp '2025-01-01' + i * interval '13 hours'
FROM generate_series(1, 200) i;

INSERT INTO products
SELECT i
     , 'SKU-' || lpad(i::text, 4, '0')
     , 'Product ' || i
     , 5 + i * 37 % 500 + (i % 100) / 100.0
     , i * 7 % 120
     , CASE WHEN i % 4 <> 0 THEN jsonb_build_object('color', (ARRAY['red', 'green', 'blue'])[1 + i % 3], 'weightKg', i / 10.0) END
     , int4send(i)
FROM generate_series(1, 50) i;

INSERT INTO orders (id, customer_id, status, ordered_at)
SELECT i
     , 1 + i * 7 % 200
     , (ARRAY['new', 'paid', 'shipped', 'cancelled'])[1 + i % 4]
     , timestamp '2025-06-01' + i * interval '3 hours'
FROM generate_series(1, 2000) i;

-- Mỗi đơn hàng có từ 1 đến 3 sản phẩm khác nhau.
INSERT INTO order_items
SELECT o, p.id, 1 + (o + k) % 5, p.price
FROM generate_series(1, 2000) o
CROSS JOIN generate_series(1, 3) k
JOIN products p ON p.id = 1 + (o + k * 17) % 50
WHERE k <= 1 + o % 3;

UPDATE orders o
SET total = s.total
FROM (SELECT order_id, sum(qty * unit_price) AS total FROM order_items GROUP BY order_id) s
WHERE s.order_id = o.id;

INSERT INTO events
SELECT i
     , (ARRAY['login', 'logout', 'view', 'click', 'purchase'])[1 + i % 5]
     , jsonb_build_object('seq', i)
     , timestamptz '2025-01-01 00:00:00+00' + i * interval '1 minute'
FROM generate_series(1, 10000) i;

CREATE VIEW v_order_summary AS
SELECT o.id
     , c.name AS customer
     , o.status
     , o.ordered_at
     , count(oi.product_id) AS items
     , o.total
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name;
