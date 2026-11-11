import { Splitter } from '@mantine/core';
import SqlNavbar from '@/pages/sql/navbar/SqlNavbar';
import SqlTabPage from '@/pages/sql/SqlTabPage';

/** SQL mode body: navbar (profiles) + tab page, same split ratio and padding as S3 mode. */
function SqlWorkspace() {
  return (
    <Splitter h="100%">
      <Splitter.Pane defaultSize="18%" min="18%" p="4px">
        <SqlNavbar />
      </Splitter.Pane>
      <Splitter.Pane defaultSize="85%" min="50%" p="4px">
        <SqlTabPage />
      </Splitter.Pane>
    </Splitter>
  );
}

export default SqlWorkspace;
