import { Activity, useCallback } from 'react';
import TabStrip from '@/components/tabs/TabStrip';
import TabDetail from '@/pages/s3/components/TabDetail';
import TabLabel from '@/pages/s3/components/TabLabel';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/** S3 tab page. Hidden tabs keep their state but stop rendering/effects until shown again (Activity). */
function S3TabPage() {
  const renderLabel = useCallback((tabId: string) => <TabLabel tabId={tabId} />, []);
  const renderDetail = useCallback(
    (tabId: string, active: boolean) => (
      <Activity mode={active ? 'visible' : 'hidden'}>
        <TabDetail tabId={tabId} />
      </Activity>
    ),
    []
  );
  return <TabStrip useTabStore={useTabListStore} renderLabel={renderLabel} renderDetail={renderDetail} />;
}
export default S3TabPage;
