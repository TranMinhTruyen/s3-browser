import { Card, Group, Menu, Stack, Text } from '@mantine/core';
import { Bucket } from '@wails/S3Browser/models/bucket';
import dayjs from 'dayjs';
import { Ellipsis, Folder, Info, ShieldCheck } from 'lucide-react';
import { type CSSProperties, type MouseEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_DATE_TIME_FORMAT, LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import ActionIcon from '@/components/buttons/ActionIcon';
import TruncatedText from '@/components/display/TruncatedText';
import WarningIcon from '@/components/display/WarningIcon';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import classes from '@/pages/tab/bucket/page.module.css';

type BucketItemProps = {
  item: Bucket;
  // An anonymous connection cannot change the bucket, so its menu has no "Access permission".
  canEdit?: boolean;
  onSelectBucket?: (bucketName: string | undefined) => void;
  onOpenDetail?: (item: Bucket) => void;
  onEditPolicy?: (bucketName: string | undefined) => void;
};

// Same icon section as ObjectItem's folder row.
const ICON_SECTION_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const CONTENT_SECTION_STYLE: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' };
const MENU_SECTION_STYLE: CSSProperties = { ...ICON_SECTION_STYLE, minWidth: '56px' };

const stopPropagation = (e: MouseEvent) => e.stopPropagation();

/**
 * One row of the bucket list: name, creation date (unknown for anonymous buckets) and a warning when the bucket
 * cannot be accessed, and a menu with the detail and permission actions. Clicking the row opens the bucket,
 * after a confirmation when it may be inaccessible.
 */
function BucketItem(props: BucketItemProps) {
  const { item, canEdit, onSelectBucket, onOpenDetail, onEditPolicy } = props;
  const { t } = useTranslation('bucket', { keyPrefix: 'page' });
  // An anonymous connection cannot read the creation date, so the backend sends the zero date (year 1).
  const hasCreationDate = dayjs(item.creationDate).year() > 1;

  // A Menu is heavy and a list shows many rows: it is mounted only once the user opens it.
  const [menuOpened, setMenuOpened] = useState(false);

  const onClickMoreActions = useCallback(() => setMenuOpened(true), []);
  const onClickDetail = useCallback(() => onOpenDetail?.(item), [onOpenDetail, item]);
  const onClickEditPolicy = useCallback(() => onEditPolicy?.(item.name), [onEditPolicy, item.name]);

  // The button is remounted when the menu closes: give the focus back to it (not to body).
  // On open the Menu moves the focus into its dropdown itself.
  const menuSectionRef = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);
  useEffect(() => {
    if (wasOpened.current && !menuOpened) menuSectionRef.current?.querySelector('button')?.focus();
    wasOpened.current = menuOpened;
  }, [menuOpened]);

  const onClickBucket = useCallback(async () => {
    // The access probe can be wrong (e.g. prefix-scoped policies), so warn and let the user decide.
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
    <Card padding="8px" orientation="horizontal" h={LIST_ROW_HEIGHT} onClick={onClickBucket} className={classes.card}>
      <Card.Section inheritPadding px="8px" withBorder className={classes.iconSection} style={ICON_SECTION_STYLE}>
        <Folder size="20px" />
      </Card.Section>
      <Card.Section inheritPadding px="xs" style={CONTENT_SECTION_STYLE}>
        {/* miw=0 lets the flex item shrink, so a long bucket name is truncated instead of overflowing. */}
        <Stack miw={0} gap="4px">
          <Group gap="xs" wrap="nowrap">
            <TruncatedText size="xl" fw="bold">
              {item.name}
            </TruncatedText>
            {item.inaccessible ? <WarningIcon label={t('tooltip.inaccessible')} size={18} /> : null}
          </Group>
          {hasCreationDate ? (
            <Text>
              <Text span fw={500}>
                {t('label.createDate')}
              </Text>{' '}
              {dayjs(item.creationDate).format(FULL_DATE_TIME_FORMAT)}
            </Text>
          ) : null}
        </Stack>
      </Card.Section>
      {/* The menu area must not trigger the row click. */}
      <Card.Section ref={menuSectionRef} onClick={stopPropagation} style={MENU_SECTION_STYLE}>
        {menuOpened ? (
          <Menu width={200} opened onChange={setMenuOpened}>
            <Menu.Target>
              <ActionIcon key="menu" tooltip={t('tooltip.moreActions')}>
                <Ellipsis />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Info size="16px" />} onClick={onClickDetail}>
                {t('menu.detail')}
              </Menu.Item>
              {canEdit ? (
                <Menu.Item leftSection={<ShieldCheck size="16px" />} onClick={onClickEditPolicy}>
                  {t('menu.editPolicy')}
                </Menu.Item>
              ) : null}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <ActionIcon key="button" tooltip={t('tooltip.moreActions')} onClick={onClickMoreActions}>
            <Ellipsis />
          </ActionIcon>
        )}
      </Card.Section>
    </Card>
  );
}
export default memo(BucketItem);
