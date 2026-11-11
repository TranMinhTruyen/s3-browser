import { useCallback } from 'react';
import TabStrip from '@/components/tabs/TabStrip';
import SqlTabDetail from '@/pages/sql/components/SqlTabDetail';
import SqlTabLabel from '@/pages/sql/components/SqlTabLabel';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';

/** SQL tab page. No Activity here: it would tear down effects and lose the EditorView, SqlTabDetail hides itself. */
function SqlTabPage() {
  const renderLabel = useCallback((tabId: string) => <SqlTabLabel tabId={tabId} />, []);
  const renderDetail = useCallback((tabId: string) => <SqlTabDetail tabId={tabId} />, []);
  return <TabStrip useTabStore={useSqlTabStore} renderLabel={renderLabel} renderDetail={renderDetail} />;
}
export default SqlTabPage;
