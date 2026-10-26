import { Box, Card, Group, Menu, Stack, Text } from '@mantine/core';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Download, Ellipsis, Folder, Trash } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT } from '@/common/cnst/commonConst';
import { useTabListStore } from '@/common/stores/tabListStore';
import { formatFileSize } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import classes from '@/pages/object/page.module.css';

type ObjectItemProps = {
  tabId: string;
  item: ObjectItemData;
  onToggleSelect: (key: string, checked: boolean) => void;
  onClickMenuButton: (objects: string[], action: 'download' | 'delete') => Promise<void>;
  onClickDeleteFolder: (prefix: string, name: string) => Promise<void>;
  onOpenFolder: (prefix: string) => void;
};

function ObjectItem(props: ObjectItemProps) {
  const { tabId, item, onToggleSelect, onClickMenuButton, onClickDeleteFolder, onOpenFolder } = props;

  const { t } = useTranslation('object', { keyPrefix: 'page' });

  // Subscribe to this row's own selection only (a boolean), so toggling one row
  // does not re-render the others.
  const isSelected = useTabListStore(s => s.tabList[tabId]?.selectionItem.includes(item.key) ?? false);
  const isDeleting = useTabListStore(s => s.tabList[tabId]?.deletingItems.includes(item.key) ?? false);

  // The confirmation is asked once, by ObjectListView.
  const onClickDeleteButton = useCallback(() => {
    onClickMenuButton([item.key], 'delete');
  }, [onClickMenuButton, item.key]);

  const onClickDeleteFolderButton = useCallback(() => {
    onClickDeleteFolder(item.key, item.name);
  }, [onClickDeleteFolder, item.key, item.name]);

  const onClickFolder = useCallback(() => {
    onOpenFolder(item.key);
  }, [onOpenFolder, item.key]);

  const onClickCard = useCallback(() => {
    onToggleSelect(item.key, !isSelected);
  }, [onToggleSelect, item.key, isSelected]);

  const onChangeCheckbox = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onToggleSelect(item.key, e.currentTarget.checked);
    },
    [onToggleSelect, item.key]
  );

  const onClickMenuSection = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const onClickDownloadButton = useCallback(() => {
    onClickMenuButton([item.key], 'download');
  }, [onClickMenuButton, item.key]);

  // A folder is only a key prefix: it can be opened or deleted (with all its content), but not selected or downloaded.
  if (item.isFolder) {
    return (
      <Card padding="8px" orientation="horizontal" onClick={onClickFolder} className={classes.card}>
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
          <Folder size="20px" />
        </Card.Section>
        <Card.Section
          inheritPadding
          px="md"
          py="md"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* A key like "a//b" has a folder with an empty name. */}
          <Text size="xl" truncate="end" fw={500}>
            {item.name || '/'}
          </Text>
        </Card.Section>
        <Card.Section
          onClick={onClickMenuSection}
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
              <ActionIcon loading={isDeleting}>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item leftSection={<Trash size="16px" />} color="red" onClick={onClickDeleteFolderButton}>
                {t('action.delete')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Card.Section>
      </Card>
    );
  }

  return (
    <Card padding="8px" orientation="horizontal" onClick={onClickCard} className={classes.card}>
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
        <CheckBoxInput styles={{ input: { cursor: 'pointer' } }} checked={isSelected} onChange={onChangeCheckbox} />
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
                {t('label.size')}
              </Text>
              <Text>{formatFileSize(item.size)}</Text>
            </Box>

            <Box miw="100px">
              <Text span className={classes.label}>
                {t('label.lastModified')}
              </Text>
              <Text>{dayjs(item.lastModified).format(FULL_DATE_TIME_FORMAT)}</Text>
            </Box>
          </Group>
        </Stack>
      </Card.Section>

      <Card.Section
        onClick={onClickMenuSection}
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
            <ActionIcon loading={isDeleting}>
              <Ellipsis />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Item leftSection={<Download size="16px" />} onClick={onClickDownloadButton}>
              {t('action.download')}
            </Menu.Item>
            <Menu.Item leftSection={<Trash size="16px" />} color="red" onClick={onClickDeleteButton}>
              {t('action.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Card.Section>
    </Card>
  );
}
export default memo(ObjectItem);
