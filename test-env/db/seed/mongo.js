// Dữ liệu mẫu cho MongoDB (database demo), nạp bằng `sh scripts/test-env.sh seed` qua mongosh.
// Cùng nội dung với dữ liệu SQL nhưng theo cấu trúc document: sản phẩm được nhúng trong từng đơn hàng.
// Các giá trị được tạo có thể lặp lại và không phải dữ liệu thật.
const d = db.getSiblingDB('demo');
const pick = (list, i) => list[i % list.length];
const hours = h => new Date(Date.UTC(2025, 0, 1) + h * 3600e3);

d.customers.insertMany(
  Array.from({ length: 200 }, (_, k) => {
    const i = k + 1;
    return {
      _id: i,
      name: `Customer ${i}`,
      email: `customer${i}@example.com`,
      country: pick(['VN', 'US', 'JP', 'DE', 'FR', 'GB'], i),
      isActive: i % 7 !== 0,
      ...(i % 5 === 0 ? { note: `Note for customer ${i}` } : {}),
      createdAt: hours(i * 13),
    };
  })
);
d.customers.createIndex({ email: 1 }, { unique: true });

const products = Array.from({ length: 50 }, (_, k) => {
  const i = k + 1;
  const price = 5 + ((i * 37) % 500) + (i % 100) / 100;
  return {
    _id: i,
    sku: `SKU-${String(i).padStart(4, '0')}`,
    name: `Product ${i}`,
    price: Decimal128(price.toFixed(2)),
    stock: (i * 7) % 120,
    ...(i % 4 !== 0 ? { attrs: { color: pick(['red', 'green', 'blue'], i), weightKg: i / 10 } } : {}),
    thumbnail: BinData(0, Buffer.from([0, 0, 0, i]).toString('base64')),
    _price: price,
  };
});
d.products.insertMany(products.map(({ _price, ...p }) => p));

d.orders.insertMany(
  Array.from({ length: 2000 }, (_, k) => {
    const i = k + 1;
    // Mỗi đơn hàng có từ 1 đến 3 sản phẩm khác nhau, giống cách chọn trong dữ liệu SQL.
    const items = Array.from({ length: 1 + (i % 3) }, (_, j) => {
      const p = products[(i + (j + 1) * 17) % 50];
      return { productId: p._id, qty: 1 + ((i + j + 1) % 5), unitPrice: p.price, _line: (1 + ((i + j + 1) % 5)) * p._price };
    });
    return {
      _id: i,
      customerId: 1 + ((i * 7) % 200),
      status: pick(['new', 'paid', 'shipped', 'cancelled'], i),
      orderedAt: new Date(Date.UTC(2025, 5, 1) + i * 3 * 3600e3),
      items: items.map(({ _line, ...it }) => it),
      total: Decimal128(items.reduce((s, it) => s + it._line, 0).toFixed(2)),
    };
  })
);
d.orders.createIndex({ customerId: 1 });

d.events.insertMany(
  Array.from({ length: 10000 }, (_, k) => {
    const i = k + 1;
    return {
      _id: i,
      kind: pick(['login', 'logout', 'view', 'click', 'purchase'], i),
      payload: { seq: i },
      createdAt: new Date(Date.UTC(2025, 0, 1) + i * 60e3),
    };
  })
);

print('demo: ' + d.getCollectionNames().sort().join(', '));
