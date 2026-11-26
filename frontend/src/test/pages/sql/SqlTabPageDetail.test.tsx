import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SqlTabPage from '@/pages/sql/SqlTabPage';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

// Thay strip bằng stub hiển thị chi tiết của mọi tab id, để chỉ kiểm tra logic chuyển tab của trang.
const strip = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('@/components/tabs/TabStrip', () => ({
  default: ({ renderDetail }: { renderDetail: (tabId: string) => React.ReactNode }) => (
    <>
      {strip.ids.map(id => (
        <div key={id}>{renderDetail(id)}</div>
      ))}
    </>
  ),
}));
vi.mock('@/pages/sql/components/SqlTabDetail', () => ({
  default: ({ tabId }: { tabId: string }) => <div data-testid={`sql-${tabId}`} />,
}));
vi.mock('@/pages/sql/components/tableStructure/TableStructureDetail', () => ({
  default: ({ tabId }: { tabId: string }) => <div data-testid={`table-${tabId}`} />,
}));
vi.mock('@/pages/sql/components/SqlTabLabel', () => ({ default: () => null }));

describe('SqlTabPage detail switch', () => {
  beforeEach(() => {
    useSqlTabStore.getState().reset();
  });

  it('renders the editor, the table structure, or nothing for a tab that no longer exists', () => {
    const [sql] = Object.keys(useSqlTabStore.getState().tabList);
    useSqlTabStore.getState().openTableTab('p1', 'main', 'users');
    const table = useSqlTabStore.getState().activeTab;
    strip.ids = [sql, table, 'closed'];

    render(<SqlTabPage />);

    expect(screen.getByTestId(`sql-${sql}`)).toBeInTheDocument();
    expect(screen.getByTestId(`table-${table}`)).toBeInTheDocument();
    expect(screen.queryByTestId('sql-closed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('table-closed')).not.toBeInTheDocument();
  });
});
