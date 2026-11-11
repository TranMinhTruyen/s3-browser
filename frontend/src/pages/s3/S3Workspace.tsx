import { Splitter } from '@mantine/core';
import S3Navbar from '@/pages/s3/navbar/S3Navbar';
import S3TabPage from '@/pages/s3/S3TabPage';

/** S3 mode body: navbar (profiles) + tab page, same split ratio and padding as SQL mode. */
function S3Workspace() {
  return (
    <Splitter h="100%">
      <Splitter.Pane defaultSize="18%" min="18%" p="4px">
        <S3Navbar />
      </Splitter.Pane>
      <Splitter.Pane defaultSize="85%" min="50%" p="4px">
        <S3TabPage />
      </Splitter.Pane>
    </Splitter>
  );
}

export default S3Workspace;
