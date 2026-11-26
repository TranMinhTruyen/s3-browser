import { Center, Loader, Splitter } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useSqlTabPersistence } from '@/pages/sql/hooks/useSqlTabPersistence';
import SqlNavbar from '@/pages/sql/navbar/SqlNavbar';
import SqlTabPage from '@/pages/sql/SqlTabPage';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { normalizeSqlTabProfiles, restoreSqlTabsFromDisk, saveSqlTabState } from '@/pages/sql/utils/sqlTabPersistence';

/**
 * Nội dung chế độ SQL: thanh điều hướng (profile) và trang tab, dùng cùng tỷ lệ chia và padding như chế độ S3.
 * Tải các profile database đã lưu khi mount.
 */
function SqlWorkspace() {
  const loadDbProfiles = useDbProfileStore(s => s.loadDbProfiles);
  const [tabsReady, setTabsReady] = useState(false);

  useSqlTabPersistence(tabsReady);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [profilesLoaded, tabsLoaded] = await Promise.all([loadDbProfiles(), restoreSqlTabsFromDisk()]);
      if (cancelled) return;
      if (
        profilesLoaded &&
        normalizeSqlTabProfiles(Object.keys(useDbProfileStore.getState().dbProfiles)) &&
        tabsLoaded
      ) {
        void saveSqlTabState(useSqlTabStore.getState().serializeTabs());
      }
      setTabsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDbProfiles]);

  return (
    <Splitter h="100%">
      <Splitter.Pane defaultSize="18%" min="18%" p="0.25rem">
        <SqlNavbar />
      </Splitter.Pane>
      <Splitter.Pane defaultSize="85%" min="50%" p="0.25rem">
        {tabsReady ? (
          <SqlTabPage />
        ) : (
          <Center h="100%">
            <Loader />
          </Center>
        )}
      </Splitter.Pane>
    </Splitter>
  );
}

export default SqlWorkspace;
