import sqlite3, sys, os
p = sys.argv[1]
if os.path.exists(p): os.remove(p)
c = sqlite3.connect(p)
c.executescript("""
CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, age INTEGER CHECK(age >= 0), bio TEXT DEFAULT 'n/a');
CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION, total REAL, status TEXT, CHECK(total >= 0));
CREATE TABLE big_events(id INTEGER PRIMARY KEY, kind TEXT, payload TEXT, score REAL);
CREATE TABLE no_pk(a TEXT, b INTEGER, c BLOB);
CREATE TABLE wide(id INTEGER PRIMARY KEY, %s);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE UNIQUE INDEX idx_users_name_email ON users(name, email);
CREATE INDEX idx_orders_open ON orders(status) WHERE status = 'open';
CREATE VIEW v_user_orders AS SELECT u.name, o.total FROM users u JOIN orders o ON o.user_id = u.id;
CREATE TABLE audit(msg TEXT);
CREATE TRIGGER trg_orders_ai AFTER INSERT ON orders BEGIN INSERT INTO audit VALUES ('new order; ' || NEW.id); END;
""" % ", ".join("col_%d TEXT" % i for i in range(1, 41)))
c.executemany("INSERT INTO users VALUES(?,?,?,?,?)", [(i, "user%d" % i, None if i % 5 == 0 else "u%d@example.test" % i, i % 90, None if i % 7 == 0 else "bio %d" % i) for i in range(1, 201)])
c.executemany("INSERT INTO orders(user_id,total,status) VALUES(?,?,?)", [((i % 200) + 1, i * 1.5, 'open' if i % 3 else None) for i in range(1, 501)])
c.executemany("INSERT INTO big_events VALUES(?,?,?,?)", [(i, "k%d" % (i % 9), None if i % 11 == 0 else "payload-%d-" % i + "x" * (i % 60), i / 7) for i in range(1, 25001)])
c.executemany("INSERT INTO no_pk VALUES(?,?,?)", [("row%d" % i, i, None if i % 2 else b"\x01\x02") for i in range(1, 31)])
c.executemany("INSERT INTO wide VALUES(%s)" % ",".join("?"*41), [(i,) + tuple(None if j % 4 == 0 else "v%d_%d" % (i, j) for j in range(40)) for i in range(1, 301)])
c.commit(); c.close()
