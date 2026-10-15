import { Box, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Ellipsis } from 'lucide-react';
import { memo } from 'react';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { useTabListStore } from '@/common/stores/tabListStore';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import classes from '@/pages/bucket/page.module.css';

type ObjectItemProps = {
  tabId: string;
  item: ObjectItemData;
  onToggleSelect: (key: string, checked: boolean) => void;
  onClickDownload: (key: string) => void;
};

function ObjectItem(props: ObjectItemProps) {
  const { tabId, item, onToggleSelect, onClickDownload } = props;

  // Subscribe to this row's own selection only (a boolean), so toggling one row
  // does not re-render the others.
  const isSelected = useTabListStore(s => s.tabList[tabId]?.selectionItem.includes(item.key) ?? false);

  return (
    <Card
      padding="8px"
      orientation="horizontal"
      onClick={() => onToggleSelect(item.key, !isSelected)}
      className={classes.card}
    >
      <Card.Section
        inheritPadding
        px="8px"
        withBorder
        className={classes.iconSection}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckBoxInput
          styles={{ input: { cursor: 'pointer' } }}
          checked={isSelected}
          onChange={e => onToggleSelect(item.key, e.currentTarget.checked)}
        />
      </Card.Section>
      <Card.Section
        inheritPadding
        px="md"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Stack>
          <Text size="xl" truncate="end" fw={500}>
            {item.name}
          </Text>
          <Group gap="xl">
            <Box miw="100px">
              <Text span className={classes.label}>
                Size
              </Text>
              <Text>{formatFileSize(item.size)}</Text>
            </Box>

            <Box miw="100px">
              <Text span className={classes.label}>
                Last Modified
              </Text>
              <Text>{dayjs(item.lastModified).format(FULL_DATE_TIME_FORMAT)}</Text>
            </Box>
          </Group>
        </Stack>
      </Card.Section>

      <Card.Section
        onClick={e => e.stopPropagation()}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          minWidth: '56px',
          justifyContent: 'center',
        }}
      >
        <Menu width={200}>
          <Menu.Target>
            <ActionIcon>
              <Ellipsis />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Item onClick={() => onClickDownload(item.key)}>Download</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Card.Section>
    </Card>
  );
}
export default memo(ObjectItem);
