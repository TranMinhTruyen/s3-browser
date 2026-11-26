import { Divider, Paper } from '@mantine/core';
import DbProfiles from '@/pages/sql/navbar/DbProfiles';
import SqlHeaderButtonGroup from '@/pages/sql/navbar/SqlHeaderButtonGroup';

/** Thanh điều hướng bên trái của chế độ SQL, có cùng bố cục với `S3Navbar` của S3. */
function SqlNavbar() {
  return (
    <Paper withBorder h="100%" style={{ overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <SqlHeaderButtonGroup />
      <Divider />
      <DbProfiles />
    </Paper>
  );
}
export default SqlNavbar;
