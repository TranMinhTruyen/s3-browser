import { Divider, Paper } from '@mantine/core';
import ConnectionProfiles from '@/components/layouts/navbar/components/ConnectionProfiles';
import HeaderButtonGroup from '@/components/layouts/navbar/components/HeaderButtonGroup';

function LeftNavbar() {
  // Flex column: the profile list takes the remaining height and scrolls (virtualized) on its own.
  return (
    <Paper withBorder h="100%" style={{ overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <HeaderButtonGroup />
      <Divider />
      <ConnectionProfiles />
    </Paper>
  );
}
export default LeftNavbar;
