import { Card, Menu, Text } from '@mantine/core';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { Download, Ellipsis, Folder, Trash } from 'lucide-react';
import { memo, ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabListStore } from '@/common/stores/tabListStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import classes from '@/pages/object/page.module.css';

// Section layouts shared by the folder and file rows.
const ICON_SECTION_STYLE = { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
const NAME_SECTION_STYLE = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' } as const;
const MENU_SECTION_STYLE = { ...ICON_SECTION_STYLE, minWidth: '56px' } as const;

type ObjectItemProps = {
  tabId: string;
  item: ObjectItemData;
  onOpenDetail: (item: ObjectItemData) => void;
  onToggleSelect: (key: string, checked: boolean) => void;
  onClickMenuButton: (objects: string[], action: 'download' | 'delete') => Promise<void>;
  onClickDeleteFolder: (prefix: string, name: string) => Promise<void>;
  onOpenFolder: (prefix: string) => void;
};

type ObjectRowProps = {
  onClick: () => void;
  // Leading section (folder icon or selection checkbox).
  icon: ReactNode;
  onClickIcon?: (e: React.MouseEvent) => void;
  name: string;
  // Items of the "more actions" menu.
  menuItems: ReactNode;
  isDeleting: boolean;
  moreActionsLabel: string;
};

/** Card layout of a row: leading icon section, truncated name and the "more actions" menu. */
function ObjectRow(props: ObjectRowProps) {
  const { onClick, icon, onClickIcon, name, menuItems, isDeleting, moreActionsLabel } = props;

  // The menu area must not trigger the row click.
  const onClickMenuSection = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <Card padding="8px" orientation="horizontal" onClick={onClick} className={classes.card}>
      <Card.Section
        inheritPadding
        px="8px"
        withBorder
        className={classes.iconSection}
        style={ICON_SECTION_STYLE}
        onClick={onClickIcon}
      >
        {icon}
      </Card.Section>
      <Card.Section inheritPadding px="md" py="md" style={NAME_SECTION_STYLE}>
        <Text size="xl" truncate="end" fw={500}>
          {name}
        </Text>
      </Card.Section>
      <Card.Section onClick={onClickMenuSection} style={MENU_SECTION_STYLE}>
        <Menu width={200}>
          <Menu.Target>
            <ActionIcon loading={isDeleting} aria-label={moreActionsLabel}>
              <Ellipsis />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>{menuItems}</Menu.Dropdown>
        </Menu>
      </Card.Section>
    </Card>
  );
}

/** One row of the object list: folder or file with selection and context actions. */
function ObjectItem(props: ObjectItemProps) {
  const { tabId, item, onOpenDetail, onToggleSelect, onClickMenuButton, onClickDeleteFolder, onOpenFolder } = props;

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
    onOpenDetail(item);
  }, [onOpenDetail, item]);

  const onChangeCheckbox = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onToggleSelect(item.key, e.currentTarget.checked);
    },
    [onToggleSelect, item.key]
  );

  // Clicking the checkbox area must not open the detail drawer.
  const onClickIconSection = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const onClickDownloadButton = useCallback(() => {
    onClickMenuButton([item.key], 'download');
  }, [onClickMenuButton, item.key]);

  // A folder is only a key prefix: it can be opened or deleted (with all its content), but not selected or downloaded.
  if (item.isFolder) {
    return (
      <ObjectRow
        onClick={onClickFolder}
        icon={<Folder size="20px" />}
        name={item.name || '/'}
        isDeleting={isDeleting}
        moreActionsLabel={t('tooltip.moreActions')}
        menuItems={
          <Menu.Item
            leftSection={<Trash size="16px" />}
            color="var(--mantine-color-red-6)"
            onClick={onClickDeleteFolderButton}
          >
            {t('action.delete')}
          </Menu.Item>
        }
      />
    );
  }

  return (
    <ObjectRow
      onClick={onClickCard}
      icon={
        <CheckBoxInput styles={{ input: { cursor: 'pointer' } }} checked={isSelected} onChange={onChangeCheckbox} />
      }
      onClickIcon={onClickIconSection}
      name={item.name}
      isDeleting={isDeleting}
      moreActionsLabel={t('tooltip.moreActions')}
      menuItems={
        <>
          <Menu.Item leftSection={<Download size="16px" />} onClick={onClickDownloadButton}>
            {t('action.download')}
          </Menu.Item>
          <Menu.Item
            leftSection={<Trash size="16px" />}
            color="var(--mantine-color-red-6)"
            onClick={onClickDeleteButton}
          >
            {t('action.delete')}
          </Menu.Item>
        </>
      }
    />
  );
}
export default memo(ObjectItem);
