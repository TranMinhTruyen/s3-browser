import { Paper, Scroller, Tabs } from '@mantine/core';
import { Plus } from 'lucide-react';
import ActionIcon from '@/components/buttons/AcctionIcon';

function Page() {
  return (
    <Tabs variant="outline" defaultValue="tab-1" h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      <Tabs.List style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        <Scroller style={{ flexShrink: 1, minWidth: 0 }}>
          <Tabs.Tab value="tab-1">First tab</Tabs.Tab>
          <Tabs.Tab value="tab-2">Second tab</Tabs.Tab>
          <Tabs.Tab value="tab-3">Third tab</Tabs.Tab>
          <Tabs.Tab value="tab-4">Fourth tab</Tabs.Tab>
          <Tabs.Tab value="tab-5">Fifth tab</Tabs.Tab>
          <Tabs.Tab value="tab-6">Sixth tab</Tabs.Tab>
          <Tabs.Tab value="tab-7">Seventh tab</Tabs.Tab>
          <Tabs.Tab value="tab-8">Eighth tab</Tabs.Tab>
          <Tabs.Tab value="tab-9">Ninth tab</Tabs.Tab>
          <Tabs.Tab value="tab-10">Tenth tab</Tabs.Tab>
        </Scroller>
        <ActionIcon style={{ flexShrink: 0 }}>
          <Plus />
        </ActionIcon>
      </Tabs.List>

      <Tabs.Panel value="tab-1" style={{ flex: 1, minHeight: 0 }}>
        <Paper
          withBorder
          h="100%"
          style={{ overflow: 'auto', borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
        >
          First
        </Paper>
      </Tabs.Panel>
    </Tabs>
  );
}
export default Page;
