import { Divider, Paper } from '@mantine/core';
import ConnectionProfiles from '@/pages/s3/navbar/ConnectionProfiles';
import S3HeaderButtonGroup from '@/pages/s3/navbar/S3HeaderButtonGroup';

function S3Navbar() {
  // Cột flex: danh sách hồ sơ chiếm phần chiều cao còn lại và tự cuộn (dùng virtualizer).
  return (
    <Paper withBorder h="100%" style={{ overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <S3HeaderButtonGroup />
      <Divider />
      <ConnectionProfiles />
    </Paper>
  );
}
export default S3Navbar;
