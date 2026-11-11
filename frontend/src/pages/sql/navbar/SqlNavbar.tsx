import { Divider, Paper } from '@mantine/core';
import DbProfiles from '@/pages/sql/navbar/DbProfiles';
import SqlHeaderButtonGroup from '@/pages/sql/navbar/SqlHeaderButtonGroup';

/** Left navbar of SQL mode: same layout as the S3 `S3Navbar`. */
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
