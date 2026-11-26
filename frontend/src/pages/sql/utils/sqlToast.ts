import { createElement } from 'react';
import { toast } from 'sonner';
import i18n from '@/locales/i18n';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';

// TODO(sprint PostgreSQL backend): xóa notifyNoBackend khi connect/import/export gọi backend thật.
/** Toast cho các thao tác cần backend DB hiện chưa được triển khai. */
export const notifyNoBackend = () => {
  toast.info(i18n.t('sqlNavbar:toast.noBackend'));
};

const MAX_SQL_LENGTH = 500;

/** Rút gọn câu SQL dài để đưa vào toast, thêm dấu ba chấm nếu có nội dung bị lược bỏ. */
export const truncateSql = (sql: string) => (sql.length > MAX_SQL_LENGTH ? `${sql.slice(0, MAX_SQL_LENGTH)}…` : sql);

// TODO(sprint PostgreSQL backend): thay lượt chạy giả này. SQLite chạy thật trong `useSqlRunner`.
/**
 * Giả lập chạy PostgreSQL cho Execute / Ctrl+E: hiện toast tên profile và câu SQL (đã rút gọn).
 * Cảnh báo nếu không thể chạy.
 */
export const runSql = (profileId: string | null | undefined, sql: string) => {
  const profile = useDbProfileStore.getState().getDbProfileById(profileId);
  if (!profile) {
    toast.warning(i18n.t('sqlTab:toast.noProfile'));
    return;
  }
  if (!sql.trim()) {
    toast.warning(i18n.t('sqlTab:toast.emptySql'));
    return;
  }
  // Cố ý dùng monospace (khác editor): khối code trích dẫn ngắn dễ đọc hơn khi các cột đều nhau.
  toast.info(profile.name, {
    description: createElement(
      'span',
      {
        style: {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 10,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--mantine-font-family-monospace)',
        },
      },
      truncateSql(sql)
    ),
  });
};
