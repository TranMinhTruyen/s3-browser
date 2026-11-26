-- Dữ liệu mẫu cho SQL Server 2022 (database demo), nạp bằng `sh scripts/test-env.sh seed` qua sqlcmd.
-- Cùng cấu trúc với mysql.sql; các giá trị được tạo có thể lặp lại và không phải dữ liệu thật.
CREATE DATABASE demo;
GO
USE demo;
GO

CREATE TABLE customers (
    id         INT PRIMARY KEY
  , name       NVARCHAR(100) NOT NULL
  , email      NVARCHAR(150) NOT NULL UNIQUE
  , country    CHAR(2)       NOT NULL
  , is_active  BIT           NOT NULL
  , note       NVARCHAR(MAX) NULL
  , created_at DATETIME2(0)  NOT NULL
);

CREATE TABLE products (
    id        INT PRIMARY KEY
  , sku       VARCHAR(20)   NOT NULL UNIQUE
  , name      NVARCHAR(100) NOT NULL
  , price     DECIMAL(10,2) NOT NULL
  , stock     INT           NOT NULL
  , attrs     NVARCHAR(MAX) NULL CHECK (attrs IS NULL OR ISJSON(attrs) = 1)
  , thumbnail VARBINARY(16) NULL
);

CREATE TABLE orders (
    id          INT PRIMARY KEY
  , customer_id INT           NOT NULL REFERENCES customers (id)
  , status      VARCHAR(20)   NOT NULL
  , ordered_at  DATETIME2(0)  NOT NULL
  , total       DECIMAL(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);

CREATE TABLE order_items (
    order_id   INT           NOT NULL REFERENCES orders (id)
  , product_id INT           NOT NULL REFERENCES products (id)
  , qty        INT           NOT NULL
  , unit_price DECIMAL(10,2) NOT NULL
  , PRIMARY KEY (order_id, product_id)
);

CREATE TABLE events (
    id         BIGINT PRIMARY KEY
  , kind       VARCHAR(20)       NOT NULL
  , payload    NVARCHAR(200)     NOT NULL
  , created_at DATETIMEOFFSET(0) NOT NULL
);

-- Các số 1..10000 (bảng tạm của phiên, được giữ lại qua các batch GO bên dưới).
CREATE TABLE #seq (i INT PRIMARY KEY);
WITH d AS (SELECT v FROM (VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)) t (v))
INSERT INTO #seq
SELECT a.v + b.v * 10 + c.v * 100 + e.v * 1000 + 1
FROM d a CROSS JOIN d b CROSS JOIN d c CROSS JOIN d e;

INSERT INTO customers
SELECT i
     , CONCAT('Customer ', i)
     , CONCAT('customer', i, '@example.com')
     , CHOOSE(1 + i % 6, 'VN', 'US', 'JP', 'DE', 'FR', 'GB')
     , CASE WHEN i % 7 <> 0 THEN 1 ELSE 0 END
     , CASE WHEN i % 5 = 0 THEN CONCAT('Note for customer ', i) END
     , DATEADD(HOUR, i * 13, '2025-01-01')
FROM #seq WHERE i <= 200;

INSERT INTO products
SELECT i
     , CONCAT('SKU-', RIGHT(CONCAT('0000', i), 4))
     , CONCAT('Product ', i)
     , 5 + i * 37 % 500 + (i % 100) / 100.0
     , i * 7 % 120
     , CASE WHEN i % 4 <> 0
         THEN CONCAT('{"color":"', CHOOSE(1 + i % 3, 'red', 'green', 'blue'), '","weightKg":'
                   , CAST(i / 10.0 AS DECIMAL(5,1)), '}')
       END
     , CAST(i AS VARBINARY(4))
FROM #seq WHERE i <= 50;

INSERT INTO orders (id, customer_id, status, ordered_at)
SELECT i
     , 1 + i * 7 % 200
     , CHOOSE(1 + i % 4, 'new', 'paid', 'shipped', 'cancelled')
     , DATEADD(HOUR, i * 3, '2025-06-01')
FROM #seq WHERE i <= 2000;

-- Mỗi đơn hàng có từ 1 đến 3 sản phẩm khác nhau.
INSERT INTO order_items
SELECT o.i, p.id, 1 + (o.i + k.i) % 5, p.price
FROM #seq o
JOIN #seq k ON k.i <= 1 + o.i % 3
JOIN products p ON p.id = 1 + (o.i + k.i * 17) % 50
WHERE o.i <= 2000;

UPDATE o
SET total = s.total
FROM orders o
JOIN (SELECT order_id, SUM(qty * unit_price) AS total FROM order_items GROUP BY order_id) s ON s.order_id = o.id;

INSERT INTO events
SELECT i
     , CHOOSE(1 + i % 5, 'login', 'logout', 'view', 'click', 'purchase')
     , CONCAT('{"seq":', i, '}')
     , DATEADD(MINUTE, i, CAST('2025-01-01 00:00:00 +00:00' AS DATETIMEOFFSET(0)))
FROM #seq;

DROP TABLE #seq;
GO

-- CREATE VIEW phải là câu lệnh duy nhất trong batch.
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
GO
