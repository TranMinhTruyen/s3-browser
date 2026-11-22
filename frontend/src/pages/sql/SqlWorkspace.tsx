import { Splitter } from '@mantine/core';
import { useEffect } from 'react';
import SqlNavbar from '@/pages/sql/navbar/SqlNavbar';
import SqlTabPage from '@/pages/sql/SqlTabPage';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';

/**
 * SQL mode body: navbar (profiles) + tab page, same split ratio and padding as S3 mode.
 * Loads the saved database profiles on mount.
 */
function SqlWorkspace() {
  const loadDbProfiles = useDbProfileStore(s => s.loadDbProfiles);

  useEffect(() => {
    void loadDbProfiles();
  }, [loadDbProfiles]);

  return (
    <Splitter h="100%">
      <Splitter.Pane defaultSize="18%" min="18%" p="0.25rem">
        <SqlNavbar />
      </Splitter.Pane>
      <Splitter.Pane defaultSize="85%" min="50%" p="0.25rem">
        <SqlTabPage />
      </Splitter.Pane>
    </Splitter>
  );
}

export default SqlWorkspace;
