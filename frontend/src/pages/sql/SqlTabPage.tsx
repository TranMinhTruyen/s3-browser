import { memo, useCallback } from 'react';
import TabStrip from '@/components/tabs/TabStrip';
import SqlTabDetail from '@/pages/sql/components/SqlTabDetail';
import SqlTabLabel from '@/pages/sql/components/SqlTabLabel';
import TableStructureDetail from '@/pages/sql/components/tableStructure/TableStructureDetail';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

/** Nội dung của tab: cấu trúc bảng với tab TableStructure, editor với tab SQL. */
const TabDetail = memo(function TabDetail({ tabId }: { tabId: string }) {
  // Có giá trị `undefined` sau khi tab đóng cho đến khi dải tab unmount nó.
  const isTable = useSqlTabStore(s => (s.tabList[tabId] ? !!s.tabList[tabId].table : undefined));
  if (isTable === undefined) return null;
  return isTable ? <TableStructureDetail tabId={tabId} /> : <SqlTabDetail tabId={tabId} />;
});

/** Trang tab SQL. Không dùng Activity ở đây vì nó sẽ gỡ effect và làm mất EditorView; SqlTabDetail tự ẩn nội dung. */
function SqlTabPage() {
  const renderLabel = useCallback((tabId: string) => <SqlTabLabel tabId={tabId} />, []);
  const renderDetail = useCallback((tabId: string) => <TabDetail tabId={tabId} />, []);
  return <TabStrip useTabStore={useSqlTabStore} renderLabel={renderLabel} renderDetail={renderDetail} />;
}
export default SqlTabPage;
