import { Divider, Paper, Stack } from '@mantine/core';
import ConnectionProfiles from '@/components/layouts/navbar/components/ConnectionProfiles';
import HeaderButtonGroup from '@/components/layouts/navbar/components/HeaderButtonGroup';

function LeftNavbar() {
  return (
    <Paper withBorder h="100%" style={{ overflowX: 'hidden' }}>
      <HeaderButtonGroup />
      <Divider />
      <Stack p="8px">
        <ConnectionProfiles />
      </Stack>
    </Paper>
  );
}
export default LeftNavbar;
