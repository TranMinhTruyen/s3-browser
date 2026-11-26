import { Card, Group, Menu, Stack, Text } from '@mantine/core';
import { Bucket } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Ellipsis, Folder, Info, ShieldCheck, Trash2 } from 'lucide-react';
import { type CSSProperties, type MouseEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { FULL_DATE_TIME_FORMAT, LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import ActionIcon from '@/components/buttons/ActionIcon';
import TruncatedText from '@/components/display/TruncatedText';
import WarningIcon from '@/components/display/WarningIcon';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import classes from '@/pages/s3/bucket/page.module.css';
import PolicyBadge from '@/pages/s3/components/PolicyBadge';

/** Nội dung của một hàng, được danh sách dịch một lần để các hàng không phải đăng ký i18n. */
export type BucketItemLabels = {
  inaccessible: string;
  moreActions: string;
  createDate: string;
  detail: string;
  editPolicy: string;
  delete: string;
};

type BucketItemProps = {
  item: Bucket;
  labels: BucketItemLabels;
  // Kết nối ẩn danh không thể thay đổi bucket nên menu không có mục "Quyền truy cập".
  canEdit?: boolean;
  onSelectBucket?: (bucketName: string | undefined) => void;
  onOpenDetail?: (item: Bucket) => void;
  onEditPolicy?: (bucketName: string | undefined) => void;
  onDeleteBucket?: (bucketName: string | undefined) => void;
};

// Dùng cùng phần biểu tượng với hàng thư mục trong ObjectItem.
const ICON_SECTION_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const CONTENT_SECTION_STYLE: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' };
const MENU_SECTION_STYLE: CSSProperties = { ...ICON_SECTION_STYLE, minWidth: '3.5rem' };

const stopPropagation = (e: MouseEvent) => e.stopPropagation();

/**
 * Một hàng trong danh sách bucket: tên, ngày tạo (không rõ với bucket ẩn danh), cảnh báo nếu không truy cập được,
 * cùng menu chứa thao tác xem chi tiết và quyền. Nhấn vào hàng sẽ mở bucket, sau khi xác nhận nếu bucket có thể không truy cập được.
 */
function BucketItem(props: BucketItemProps) {
  const { item, labels, canEdit, onSelectBucket, onOpenDetail, onEditPolicy, onDeleteBucket } = props;
  // Kết nối ẩn danh không đọc được ngày tạo nên backend gửi ngày zero (năm 1).
  const hasCreationDate = dayjs(item.creationDate).year() > 1;

  // Menu khá nặng và danh sách có thể có nhiều hàng: chỉ mount menu khi người dùng mở.
  const [menuOpened, setMenuOpened] = useState(false);

  const onClickMoreActions = useCallback(() => setMenuOpened(true), []);
  const onClickDetail = useCallback(() => onOpenDetail?.(item), [onOpenDetail, item]);
  const onClickEditPolicy = useCallback(() => onEditPolicy?.(item.name), [onEditPolicy, item.name]);

  // Nút được mount lại khi menu đóng: trả tiêu điểm về nút (không chuyển sang body).
  // Khi mở, Menu tự chuyển tiêu điểm vào danh sách thả xuống.
  const menuSectionRef = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);
  useEffect(() => {
    if (wasOpened.current && !menuOpened) menuSectionRef.current?.querySelector('button')?.focus();
    wasOpened.current = menuOpened;
  }, [menuOpened]);

  const onClickDelete = useCallback(() => onDeleteBucket?.(item.name), [onDeleteBucket, item.name]);

  const onClickBucket = useCallback(async () => {
    // Kiểm tra quyền truy cập có thể sai (ví dụ policy giới hạn theo tiền tố), nên cảnh báo để người dùng tự quyết định.
    if (item.inaccessible) {
      const confirmed = await ConfirmModal.show({
        type: 'warning',
        confirmCode: 'C000007',
        params: { bucket: item.name },
      });
      if (!confirmed) return;
    }
    onSelectBucket?.(item.name);
  }, [onSelectBucket, item.name, item.inaccessible]);

  return (
    <Card
      padding="0.5rem"
      orientation="horizontal"
      h={LIST_ROW_HEIGHT}
      onClick={onClickBucket}
      className={classes.card}
    >
      <Card.Section inheritPadding px="0.5rem" withBorder className={classes.iconSection} style={ICON_SECTION_STYLE}>
        <Folder size="1.25rem" />
      </Card.Section>
      <Card.Section inheritPadding px="xs" style={CONTENT_SECTION_STYLE}>
        {/* miw=0 lets the flex item shrink, so a long bucket name is truncated instead of overflowing. */}
        <Stack miw={0} gap="0.25rem">
          <Group gap="xs" wrap="nowrap">
            <TruncatedText size="xl" fw="bold">
              {item.name}
            </TruncatedText>
            {item.inaccessible ? <WarningIcon label={labels.inaccessible} size={18} /> : null}
          </Group>
          {hasCreationDate ? (
            <Group gap="xs" wrap="nowrap">
              <Text>
                <Text span fw={500}>
                  {labels.createDate}
                </Text>{' '}
                {dayjs(item.creationDate).format(FULL_DATE_TIME_FORMAT)}
              </Text>
              {canEdit ? <PolicyBadge mode={item.policyMode} /> : null}
            </Group>
          ) : null}
        </Stack>
      </Card.Section>
      {/* The menu area must not trigger the row click. */}
      <Card.Section ref={menuSectionRef} onClick={stopPropagation} style={MENU_SECTION_STYLE}>
        {menuOpened ? (
          <Menu width="12.5rem" opened onChange={setMenuOpened}>
            <Menu.Target>
              <ActionIcon key="menu" tooltip={labels.moreActions}>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Info size="1rem" />} onClick={onClickDetail}>
                {labels.detail}
              </Menu.Item>
              {canEdit ? (
                <Menu.Item leftSection={<ShieldCheck size="1rem" />} onClick={onClickEditPolicy}>
                  {labels.editPolicy}
                </Menu.Item>
              ) : null}
              {canEdit && !item.deleteDenied ? (
                <>
                  <Menu.Divider />
                  <Menu.Item color="red" leftSection={<Trash2 size="1rem" />} onClick={onClickDelete}>
                    {labels.delete}
                  </Menu.Item>
                </>
              ) : null}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <ActionIcon key="button" tooltip={labels.moreActions} onClick={onClickMoreActions}>
            <Ellipsis />
          </ActionIcon>
        )}
      </Card.Section>
    </Card>
  );
}
export default memo(BucketItem);
