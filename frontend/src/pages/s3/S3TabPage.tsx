import { Activity, useCallback } from 'react';
import TabStrip from '@/components/tabs/TabStrip';
import TabDetail from '@/pages/s3/components/TabDetail';
import TabLabel from '@/pages/s3/components/TabLabel';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

/** Trang tab S3. Tab bị ẩn vẫn giữ trạng thái nhưng ngừng render/chạy effect cho đến khi được hiện lại (Activity). */
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
