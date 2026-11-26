import { Card, Menu } from '@mantine/core';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { Download, Ellipsis, Folder, Trash } from 'lucide-react';
import { MouseEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import ActionIcon from '@/components/buttons/ActionIcon';
import TruncatedText from '@/components/display/TruncatedText';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import classes from '@/pages/s3/object/page.module.css';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

// Bố cục phần dùng chung cho hàng thư mục và hàng file.
const ICON_SECTION_STYLE = { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
const NAME_SECTION_STYLE = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' } as const;
const MENU_SECTION_STYLE = { ...ICON_SECTION_STYLE, minWidth: '3.5rem' } as const;
const CHECKBOX_STYLES = { input: { cursor: 'pointer' } };
const CHECKBOX_SECTION_STYLE = { ...ICON_SECTION_STYLE, cursor: 'pointer' } as const;

/** Nội dung của một hàng, được danh sách dịch một lần để các hàng không phải đăng ký i18n. */
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

/** Bố cục thẻ của một hàng: phần biểu tượng đầu dòng, tên được cắt gọn và menu "thao tác khác". */
const ObjectRow = memo(function ObjectRow(props: ObjectRowProps) {
  const { isFolder, isSelected, isDeleting, name, labels, onClick, onToggle, onClickDownload, onClickDelete } = props;

  // Menu khá nặng và danh sách có thể có hàng trăm mục: chỉ mount menu khi người dùng mở.
  const [menuOpened, setMenuOpened] = useState(false);

  const onClickMoreActions = useCallback(() => setMenuOpened(true), []);

  // Toàn bộ phần này bật/tắt lựa chọn (click hoặc nhấn Space trên checkbox nổi bọt lên đây nên chỉ chạy một lần)
  // và không được kích hoạt thao tác click hàng.
  const onClickSection = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onToggle();
    },
    [onToggle]
  );

  // Nút được mount lại khi menu đóng: trả tiêu điểm về nút (không chuyển sang body).
  // Khi mở, Menu tự chuyển tiêu điểm vào danh sách thả xuống.
  const menuSectionRef = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);
  useEffect(() => {
    if (wasOpened.current && !menuOpened) menuSectionRef.current?.querySelector('button')?.focus();
    wasOpened.current = menuOpened;
  }, [menuOpened]);

  return (
    <Card padding="0.5rem" orientation="horizontal" onClick={onClick} className={classes.card} h={LIST_ROW_HEIGHT}>
      <Card.Section
        inheritPadding
        px="0.5rem"
        withBorder
        className={classes.iconSection}
        style={isFolder ? ICON_SECTION_STYLE : CHECKBOX_SECTION_STYLE}
        onClick={isFolder ? undefined : onClickSection}
      >
        {isFolder ? (
          <Folder size="1.25rem" />
        ) : (
          <CheckBoxInput styles={CHECKBOX_STYLES} checked={isSelected} readOnly />
        )}
      </Card.Section>
      <Card.Section inheritPadding px="md" py="md" style={NAME_SECTION_STYLE}>
        <TruncatedText size="xl" fw={500}>
          {name}
        </TruncatedText>
      </Card.Section>
      {/* The menu area must not trigger the row click. */}
      <Card.Section ref={menuSectionRef} onClick={stopPropagation} style={MENU_SECTION_STYLE}>
        {menuOpened ? (
          <Menu width="12.5rem" opened onChange={setMenuOpened}>
            <Menu.Target>
              <ActionIcon key="menu" loading={isDeleting} tooltip={labels.moreActions}>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {/* A folder is only a key prefix: it can be opened or deleted (with all its content), not downloaded. */}
              {isFolder ? null : (
                <Menu.Item leftSection={<Download size="1rem" />} onClick={onClickDownload}>
                  {labels.download}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<Trash size="1rem" />} color="var(--mantine-color-red-6)" onClick={onClickDelete}>
                {labels.delete}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : (
          <ActionIcon key="button" loading={isDeleting} tooltip={labels.moreActions} onClick={onClickMoreActions}>
            <Ellipsis />
          </ActionIcon>
        )}
      </Card.Section>
    </Card>
  );
});

/** Một hàng trong danh sách đối tượng: thư mục hoặc file, có lựa chọn và thao tác ngữ cảnh. */
function ObjectItem(props: ObjectItemProps) {
  const { tabId, item, labels, onOpenDetail, onToggleSelect, onClickMenuButton, onClickDeleteFolder, onOpenFolder } =
    props;

  // Chỉ theo dõi state riêng của hàng này (một giá trị boolean) để bật/tắt một hàng không làm các hàng khác render lại.
  const isSelected = useTabListStore(s => s.tabList[tabId]?.selectionItem[item.key] === true);
  const isDeleting = useTabListStore(s => s.tabList[tabId]?.deletingItems[item.key] === true);

  // ObjectListView là nơi duy nhất hỏi xác nhận.
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
