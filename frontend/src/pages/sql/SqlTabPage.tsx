import { memo, useCallback } from 'react';
import TabStrip from '@/components/tabs/TabStrip';
import SqlTabDetail from '@/pages/sql/components/SqlTabDetail';
import SqlTabLabel from '@/pages/sql/components/SqlTabLabel';
import TableStructureDetail from '@/pages/sql/components/tableStructure/TableStructureDetail';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

/** Content of a tab: the table structure for a TableStructure tab, the editor for a SQL tab. */
const TabDetail = memo(function TabDetail({ tabId }: { tabId: string }) {
  // `undefined` once the tab was closed, until the strip unmounts it.
  const isTable = useSqlTabStore(s => (s.tabList[tabId] ? !!s.tabList[tabId].table : undefined));
  if (isTable === undefined) return null;
  return isTable ? <TableStructureDetail tabId={tabId} /> : <SqlTabDetail tabId={tabId} />;
});

/** SQL tab page. No Activity here: it would tear down effects and lose the EditorView, SqlTabDetail hides itself. */
function SqlTabPage() {
  const renderLabel = useCallback((tabId: string) => <SqlTabLabel tabId={tabId} />, []);
  const renderDetail = useCallback((tabId: string) => <TabDetail tabId={tabId} />, []);
  return <TabStrip useTabStore={useSqlTabStore} renderLabel={renderLabel} renderDetail={renderDetail} />;
}
export default SqlTabPage;
