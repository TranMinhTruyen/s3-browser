import { Card, Menu } from '@mantine/core';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { Download, Ellipsis, Folder, Trash } from 'lucide-react';
import { MouseEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTabListStore } from '@/common/stores/tabListStore';
import ActionIcon from '@/components/buttons/ActionIcon';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import TruncatedText from '@/components/TruncatedText';
import classes from '@/pages/object/page.module.css';

// Fixed row height: the virtualizer knows every row's position without measuring.
export const OBJECT_ROW_HEIGHT = 88;

// Section layouts shared by the folder and file rows.
const ICON_SECTION_STYLE = { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
const NAME_SECTION_STYLE = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' } as const;
const MENU_SECTION_STYLE = { ...ICON_SECTION_STYLE, minWidth: '56px' } as const;
const CHECKBOX_STYLES = { input: { cursor: 'pointer' } };
const CHECKBOX_SECTION_STYLE = { ...ICON_SECTION_STYLE, cursor: 'pointer' } as const;

/** Texts of a row, translated once by the list so rows do not subscribe to i18n. */
export type ObjectItemLabels = {
  moreActions: string;
  download: string;
  delete: string;
};

type ObjectItemProps = {
  tabId: string;
  item: ObjectItemData;
  labels: ObjectItemLabels;
  onOpenDetail: (item: ObjectItemData) => void;
  onToggleSelect: (key: string, checked: boolean) => void;
  onClickMenuButton: (objects: string[], action: 'download' | 'delete') => Promise<void>;
  onClickDeleteFolder: (prefix: string, name: string) => Promise<void>;
  onOpenFolder: (prefix: string) => void;
};

type ObjectRowProps = {
  isFolder: boolean;
  isSelected: boolean;
  isDeleting: boolean;
  name: string;
  labels: ObjectItemLabels;
  onClick: () => void;
  onToggle: () => void;
  onClickDownload: () => void;
  onClickDelete: () => void;
};

const stopPropagation = (e: MouseEvent) => e.stopPropagation();

/** Card layout of a row: leading icon section, truncated name and the "more actions" menu. */
const ObjectRow = memo(function ObjectRow(props: ObjectRowProps) {
  const { isFolder, isSelected, isDeleting, name, labels, onClick, onToggle, onClickDownload, onClickDelete } = props;

  // A Menu is heavy and a list shows hundreds of rows: it is mounted only once the user opens it.
  const [menuOpened, setMenuOpened] = useState(false);

  const onClickMoreActions = useCallback(() => setMenuOpened(true), []);

  // The whole section toggles the selection (a click or Space on the checkbox bubbles up to it, so it fires once)
  // and must not trigger the row click.
  const onClickSection = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onToggle();
    },
    [onToggle]
  );

  // The button is remounted when the menu closes: give the focus back to it (not to body).
  // On open the Menu moves the focus into its dropdown itself.
  const menuSectionRef = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);
  useEffect(() => {
    if (wasOpened.current && !menuOpened) menuSectionRef.current?.querySelector('button')?.focus();
    wasOpened.current = menuOpened;
  }, [menuOpened]);

  return (
    <Card padding="8px" orientation="horizontal" onClick={onClick} className={classes.card} h={OBJECT_ROW_HEIGHT}>
      <Card.Section
        inheritPadding
        px="8px"
        withBorder
        className={classes.iconSection}
        style={isFolder ? ICON_SECTION_STYLE : CHECKBOX_SECTION_STYLE}
        onClick={isFolder ? undefined : onClickSection}
      >
        {isFolder ? <Folder size="20px" /> : <CheckBoxInput styles={CHECKBOX_STYLES} checked={isSelected} readOnly />}
      </Card.Section>
      <Card.Section inheritPadding px="md" py="md" style={NAME_SECTION_STYLE}>
        <TruncatedText size="xl" fw={500}>
          {name}
        </TruncatedText>
      </Card.Section>
      {/* The menu area must not trigger the row click. */}
      <Card.Section ref={menuSectionRef} onClick={stopPropagation} style={MENU_SECTION_STYLE}>
        {menuOpened ? (
          <Menu width={200} opened onChange={setMenuOpened}>
            <Menu.Target>
              <ActionIcon key="menu" loading={isDeleting} aria-label={labels.moreActions}>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {/* A folder is only a key prefix: it can be opened or deleted (with all its content), not downloaded. */}
              {isFolder ? null : (
                <Menu.Item leftSection={<Download size="16px" />} onClick={onClickDownload}>
                  {labels.download}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<Trash size="16px" />} color="var(--mantine-color-red-6)" onClick={onClickDelete}>
                {labels.delete}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : (
          <ActionIcon key="button" loading={isDeleting} aria-label={labels.moreActions} onClick={onClickMoreActions}>
            <Ellipsis />
          </ActionIcon>
        )}
      </Card.Section>
    </Card>
  );
});

/** One row of the object list: folder or file with selection and context actions. */
function ObjectItem(props: ObjectItemProps) {
  const { tabId, item, labels, onOpenDetail, onToggleSelect, onClickMenuButton, onClickDeleteFolder, onOpenFolder } =
    props;

  // Subscribe to this row's own state only (a boolean), so toggling one row does not re-render the others.
  const isSelected = useTabListStore(s => s.tabList[tabId]?.selectionItem[item.key] === true);
  const isDeleting = useTabListStore(s => s.tabList[tabId]?.deletingItems[item.key] === true);

  // The confirmation is asked once, by ObjectListView.
  const onClickDelete = useCallback(() => {
    if (item.isFolder) onClickDeleteFolder(item.key, item.name);
    else onClickMenuButton([item.key], 'delete');
  }, [item, onClickMenuButton, onClickDeleteFolder]);

  const onClickDownload = useCallback(() => {
    onClickMenuButton([item.key], 'download');
  }, [onClickMenuButton, item.key]);

  const onClickRow = useCallback(() => {
    if (item.isFolder) onOpenFolder(item.key);
    else onOpenDetail(item);
  }, [item, onOpenFolder, onOpenDetail]);

  const onToggle = useCallback(() => onToggleSelect(item.key, !isSelected), [onToggleSelect, item.key, isSelected]);

  return (
    <ObjectRow
      isFolder={item.isFolder}
      isSelected={isSelected}
      isDeleting={isDeleting}
      name={item.isFolder ? item.name || '/' : item.name}
      labels={labels}
      onClick={onClickRow}
      onToggle={onToggle}
      onClickDownload={onClickDownload}
      onClickDelete={onClickDelete}
    />
  );
}
export default memo(ObjectItem);
