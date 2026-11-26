import { Splitter } from '@mantine/core';
import S3Navbar from '@/pages/s3/navbar/S3Navbar';
import S3TabPage from '@/pages/s3/S3TabPage';

/** Nội dung chế độ S3: thanh điều hướng (profile) và trang tab, dùng cùng tỷ lệ chia và padding như chế độ SQL. */
function S3Workspace() {
  return (
    <Splitter h="100%">
      <Splitter.Pane defaultSize="18%" min="18%" p="0.25rem">
        <S3Navbar />
      </Splitter.Pane>
      <Splitter.Pane defaultSize="85%" min="50%" p="0.25rem">
        <S3TabPage />
      </Splitter.Pane>
    </Splitter>
  );
}

export default S3Workspace;
