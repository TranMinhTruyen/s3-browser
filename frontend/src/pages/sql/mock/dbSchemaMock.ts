import type { SQLNamespace } from '@codemirror/lang-sql';

// TODO(sprint backend DB): xóa file này. Backend Go sẽ đọc lược đồ (bảng, cột) từ cơ sở dữ liệu đang kết nối.
// thay vì dùng dữ liệu mẫu tĩnh này.
const SAMPLE_SCHEMA: SQLNamespace = {
  users: ['id', 'name', 'email', 'created_at'],
  orders: ['id', 'user_id', 'total', 'status', 'created_at'],
  products: ['id', 'name', 'price', 'stock'],
};

/** Schema dùng để gợi ý tự động theo provider của profile; hiện chỉ PostgreSQL có dữ liệu. */
export const getMockSchema = (provider: string | null): SQLNamespace | undefined =>
  provider === 'postgres' ? SAMPLE_SCHEMA : undefined;
