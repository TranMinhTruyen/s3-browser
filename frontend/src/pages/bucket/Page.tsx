import { CloseButton, Group, Paper, Scroller, Tabs } from '@mantine/core';
import { Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTabListStore } from '@/common/stores/tabListStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import TabDetail from '@/pages/bucket/components/TabDetail';
import TabLabel from '@/pages/bucket/components/TabLabel';

function Page() {
  const activeTab = useTabListStore(s => s.activeTab);
  const tabIds = useTabListStore(useShallow(s => Object.keys(s.tabList)));

  const addTab = useTabListStore(s => s.addTab);
  const closeTab = useTabListStore(s => s.closeTab);
  const setActiveTab = useTabListStore(s => s.setActiveTab);

  const handleCloseTab = (tabId: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollerRef.current?.querySelector<HTMLElement>('.mantine-Scroller-container');
    if (!container) return;

    container.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    container.dispatchEvent(new Event('scroll'));
  }, [tabIds, activeTab]);

  return (
    <Tabs
      variant="outline"
      value={activeTab}
      onChange={setActiveTab}
      keepMountedMode="display-none"
      h="100%"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <Tabs.List style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        <Scroller ref={scrollerRef} style={{ flexShrink: 1, minWidth: 0 }}>
          {tabIds.map(key => (
            <Tabs.Tab
              key={key}
              value={key}
              p="8px"
              h="38px"
              miw="200px"
              maw="200px"
              styles={{ tabLabel: { minWidth: 0, flex: 1 } }}
            >
              <Group gap="xs" wrap="nowrap" p="0" justify="space-between">
                <TabLabel tabId={key} />
                {tabIds.length > 1 && (
                  <CloseButton
                    component="span"
                    role="button"
                    aria-label="Close tab"
                    size="xs"
                    onClick={handleCloseTab(key)}
                    style={{ flexShrink: 0 }}
                  />
                )}
              </Group>
            </Tabs.Tab>
          ))}
        </Scroller>
        <ActionIcon style={{ flexShrink: 0, marginLeft: '2px' }} onClick={addTab}>
          <Plus />
        </ActionIcon>
      </Tabs.List>

      {tabIds.map(key => (
        <Tabs.Panel key={key} value={key} style={{ flex: 1, minHeight: 0 }}>
          <Paper
            withBorder
            h="100%"
            p="4px"
            style={{ overflow: 'hidden', borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
          >
            <TabDetail tabId={key} />
          </Paper>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
export default Page;
