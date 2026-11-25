-- Sample data for MySQL 8.4 and MariaDB 11.4 (database demo), loaded by `sh scripts/test-env.sh seed`.
-- Same shape in every SQL database: customers, products, orders, order_items, events (10,000 rows for paging)
-- and the view v_order_summary. Values are generated, deterministic and not real.
CREATE DATABASE demo CHARACTER SET utf8mb4;
USE demo;

CREATE TABLE customers (
    id         INT PRIMARY KEY
  , name       VARCHAR(100) NOT NULL
  , email      VARCHAR(150) NOT NULL UNIQUE
  , country    CHAR(2)      NOT NULL
  , is_active  BOOLEAN      NOT NULL
  , note       TEXT         NULL
  , created_at DATETIME     NOT NULL
);

CREATE TABLE products (
    id        INT PRIMARY KEY
  , sku       VARCHAR(20)   NOT NULL UNIQUE
  , name      VARCHAR(100)  NOT NULL
  , price     DECIMAL(10,2) NOT NULL
  , stock     INT           NOT NULL
  , attrs     JSON          NULL
  , thumbnail VARBINARY(16) NULL
);

CREATE TABLE orders (
    id          INT PRIMARY KEY
  , customer_id INT           NOT NULL
  , status      VARCHAR(20)   NOT NULL
  , ordered_at  DATETIME      NOT NULL
  , total       DECIMAL(12,2) NOT NULL DEFAULT 0
  , FOREIGN KEY (customer_id) REFERENCES customers (id)
);

CREATE TABLE order_items (
    order_id   INT           NOT NULL
  , product_id INT           NOT NULL
  , qty        INT           NOT NULL
  , unit_price DECIMAL(10,2) NOT NULL
  , PRIMARY KEY (order_id, product_id)
  , FOREIGN KEY (order_id) REFERENCES orders (id)
  , FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE events (
    id         BIGINT PRIMARY KEY
  , kind       VARCHAR(20)  NOT NULL
  , payload    VARCHAR(200) NOT NULL
  , created_at DATETIME     NOT NULL
);

-- Numbers 1..10000 (no recursive CTE: MySQL caps recursion at 1000 and MariaDB has no cte_max_recursion_depth).
CREATE TABLE _digits (v INT);
INSERT INTO _digits VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9);
CREATE TABLE _seq (i INT PRIMARY KEY);
INSERT INTO _seq
SELECT a.v + b.v * 10 + c.v * 100 + d.v * 1000 + 1
FROM _digits a, _digits b, _digits c, _digits d;

INSERT INTO customers
SELECT i
     , CONCAT('Customer ', i)
     , CONCAT('customer', i, '@example.com')
     , ELT(1 + i % 6, 'VN', 'US', 'JP', 'DE', 'FR', 'GB')
     , i % 7 <> 0
     , CASE WHEN i % 5 = 0 THEN CONCAT('Note for customer ', i) END
     , TIMESTAMP('2025-01-01') + INTERVAL i * 13 HOUR
FROM _seq WHERE i <= 200;

INSERT INTO products
SELECT i
     , CONCAT('SKU-', LPAD(i, 4, '0'))
     , CONCAT('Product ', i)
     , 5 + i * 37 % 500 + (i % 100) / 100
     , i * 7 % 120
     , CASE WHEN i % 4 <> 0 THEN JSON_OBJECT('color', ELT(1 + i % 3, 'red', 'green', 'blue'), 'weightKg', i / 10) END
     , UNHEX(LPAD(HEX(i), 8, '0'))
FROM _seq WHERE i <= 50;

INSERT INTO orders (id, customer_id, status, ordered_at)
SELECT i
     , 1 + i * 7 % 200
     , ELT(1 + i % 4, 'new', 'paid', 'shipped', 'cancelled')
     , TIMESTAMP('2025-06-01') + INTERVAL i * 3 HOUR
FROM _seq WHERE i <= 2000;

-- 1 to 3 different products per order.
INSERT INTO order_items
SELECT o.i, p.id, 1 + (o.i + k.i) % 5, p.price
FROM _seq o
JOIN _seq k ON k.i <= 1 + o.i % 3
JOIN products p ON p.id = 1 + (o.i + k.i * 17) % 50
WHERE o.i <= 2000;

UPDATE orders o SET total = (SELECT SUM(qty * unit_price) FROM order_items WHERE order_id = o.id);

INSERT INTO events
SELECT i
     , ELT(1 + i % 5, 'login', 'logout', 'view', 'click', 'purchase')
     , CONCAT('{"seq":', i, '}')
     , TIMESTAMP('2025-01-01') + INTERVAL i MINUTE
FROM _seq;

DROP TABLE _seq;
DROP TABLE _digits;

CREATE VIEW v_order_summary AS
SELECT o.id
     , c.name AS customer
     , o.status
     , o.ordered_at
     , COUNT(oi.product_id) AS items
     , o.total
FROM orders o
JOIN customers c ON c.id = o.customer_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, c.name, o.status, o.ordered_at, o.total;
