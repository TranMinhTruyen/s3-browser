import { Center, Loader, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DeleteObject, DeletePrefix, DownloadObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import {
  Ref,
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { LIST_ROW_GAP, LIST_ROW_HEIGHT } from '@/common/cnst/commonConst';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import { callIPC } from '@/common/utils/ipcUtils';
import Button from '@/components/buttons/Button';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { showDeleteConfirmModal, showDeleteResultModal } from '@/components/modals/lazyModals';
import { useFilesDroppedUpload } from '@/pages/s3/hooks/useFilesDroppedUpload';
import { useObjectPaging } from '@/pages/s3/hooks/useObjectPaging';
import ObjectItem, { ObjectItemLabels } from '@/pages/s3/object/ObjectItem';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { onTabGone } from '@/pages/s3/utils/tabUtils';

// Từ chối tải xuống nếu số object cùng lúc vượt quá giới hạn này (xóa không giới hạn).
const MAX_DOWNLOAD_OBJECTS = 5;
// Tải trang tiếp theo khi còn số màn hình hàng này bên dưới viewport (ít nhất PREFETCH_MIN_ROWS hàng).
const PREFETCH_SCREENS = 2;
const PREFETCH_MIN_ROWS = 2;

export type ObjectListViewRef = {
  onRefresh?: () => Promise<void>;
  onClickMenuButton?: (object: string[], action: 'download' | 'delete') => Promise<void>;
};

type ObjectListViewProps = {
  tabId: string;
  bucket?: string;
  profile?: ConnectionProfileOutput | null;
  scrollRef: RefObject<HTMLElement | null>;
  // Từ khóa tìm kiếm đang áp dụng; rỗng nghĩa là danh sách lazy-load thông thường.
  keyword?: string;
  ref?: Ref<ObjectListViewRef>;
};

/** Danh sách object (hoặc kết quả tìm kiếm) của thư mục hiện tại, được virtualize và tải theo trang. */
function ObjectListView(props: ObjectListViewProps) {
  const { tabId, bucket, profile, scrollRef, keyword = '', ref } = props;

  const { t } = useTranslation('object', { keyPrefix: 'page' });

  // Hàng lấy nội dung chữ từ đây nên không tự đăng ký i18n.
  const labels = useMemo<ObjectItemLabels>(
    () => ({
      moreActions: t('tooltip.moreActions'),
      download: t('action.download'),
      delete: t('action.delete'),
    }),
    [t]
  );

  const [scrollMargin, setScrollMargin] = useState(0);
  const scale = useUiScale();

  const connectionId = profile?.id;
  const profileName = profile?.name;
  const listRef = useRef<HTMLDivElement>(null);

  const prefix = useTabListStore(s => s.tabList[tabId]?.prefix ?? '');
  const listKey = `${connectionId}|${bucket}|${prefix}|${keyword}`;
  const {
    objectDatas,
    nextCursor,
    cursorKey,
    isLoadingFirst,
    isLoadingMore,
    isLoaded,
    loadMoreError,
    loadNextPage,
    onRefresh,
    onClickLoadMore,
  } = useObjectPaging({ tabId, connectionId, profileName, bucket, prefix, keyword, listKey, scrollRef });
  // Đọc giá trị tại thời điểm click để handler menu giữ nguyên identity khi tải trang.
  const objectDatasRef = useRef(objectDatas);
  objectDatasRef.current = objectDatas;
  const changePrefix = useTabListStore(s => s.changePrefix);
  const addSelectItem = useTabListStore(s => s.addSelectItem);
  const removeSelectItem = useTabListStore(s => s.removeSelectItem);
  const clearSelectItem = useTabListStore(s => s.clearSelectItem);
  const openDetail = useTabListStore(s => s.openDetail);
  const closeDetail = useTabListStore(s => s.closeDetail);
  const setDeleting = useTabListStore(s => s.setDeleting);

  // Đóng drawer nếu object đang hiển thị nằm trong các key bị xóa hoặc bên trong thư mục bị xóa.
  const closeDetailIfDeleted = useCallback(
    (deletedKeys: string[]) => {
      const detailKey = useTabListStore.getState().tabList[tabId]?.detailItem?.key;
      if (detailKey && deletedKeys.some(key => (key.endsWith('/') ? detailKey.startsWith(key) : detailKey === key))) {
        closeDetail(tabId);
      }
    },
    [closeDetail, tabId]
  );

  // Lựa chọn không tồn tại lâu hơn view nhưng vẫn được giữ khi tab bị ẩn (Activity).
  useEffect(() => onTabGone(tabId, () => clearSelectItem(tabId)), [clearSelectItem, tabId]);

  const onClickMenuButton = useCallback(
    async (keys: string[], action: 'download' | 'delete') => {
      if (!connectionId || !bucket) return;
      // Key thư mục kết thúc bằng "/". Tải thư mục sẽ thất bại; xóa thư mục chỉ xóa folder marker chứ không xóa file bên trong,
      // vì vậy không gửi các key này.
      const objects = keys.filter(key => !key.endsWith('/'));
      if (objects.length === 0) return;
      if (action === 'download' && objects.length > MAX_DOWNLOAD_OBJECTS) {
        ConfirmModal.show({
          type: 'warning',
          confirmCode: 'C000005',
        });
        return;
      }
      switch (action) {
        case 'download':
          await callIPC(DownloadObject, [{ connectionId, profileName, bucket, objects }]);
          break;
        case 'delete': {
          // Chỉ tra kích thước của các key đã chọn, từ danh sách hiện tại.
          const selectedKeys = new Set(objects);
          const sizes = new Map<string, number>();
          for (const o of objectDatasRef.current) if (selectedKeys.has(o.key)) sizes.set(o.key, o.size);
          const toDelete = await showDeleteConfirmModal({
            files: objects.map(key => ({ key, size: sizes.get(key) ?? 0 })),
          });
          // Đã hủy hoặc bỏ chọn tất cả file.
          if (toDelete?.length) {
            setDeleting(tabId, toDelete, true);
            try {
              const body = await callIPC(DeleteObject, [{ connectionId, profileName, bucket, objects: toDelete }]);
              if (body) {
                closeDetailIfDeleted(body.deleted ?? []);
                // Mở trước khi refresh để refresh thất bại không che mất kết quả. Không await: xóa lựa chọn và cho phép
                // tiếp tục dùng danh sách trong lúc hộp thoại đang mở.
                void showDeleteResultModal({
                  deleted: body.deleted?.length ?? 0,
                  failed: body.failed?.length ?? 0,
                  deletedKeys: body.deleted ?? [],
                  failures: body.failed ?? [],
                });
              }
              await onRefresh();
            } finally {
              setDeleting(tabId, toDelete, false);
            }
          }
          break;
        }
      }
      clearSelectItem(tabId);
    },
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId, clearSelectItem, closeDetailIfDeleted]
  );

  const onClickDeleteFolder = useCallback(
    async (folderKey: string, name: string) => {
      if (!connectionId || !bucket) return;
      // Đang được xóa: bỏ qua lần click lặp lại.
      if (useTabListStore.getState().tabList[tabId]?.deletingItems[folderKey] === true) return;
      const confirmed = await ConfirmModal.show({
        type: 'warning',
        confirmCode: 'C000006',
        params: {
          object: name || folderKey,
        },
        size: 'md',
      });
      if (!confirmed) return;
      setDeleting(tabId, [folderKey], true);
      try {
        const body = await callIPC(DeletePrefix, [{ connectionId, profileName, bucket, prefix: folderKey }]);
        // Giữ drawer nếu thất bại (kể cả khi chỉ xóa được một phần); object đang hiển thị có thể vẫn tồn tại.
        if (body?.failed === 0) closeDetailIfDeleted([folderKey]);
        // Mở trước khi refresh để refresh thất bại không che mất kết quả.
        if (body)
          void showDeleteResultModal({ deleted: body.deleted, failed: body.failed, failures: body.failures ?? [] });
        // Refresh ngay cả khi thất bại hoặc bị hủy vì một phần thư mục có thể đã bị xóa.
        await onRefresh();
      } finally {
        setDeleting(tabId, [folderKey], false);
      }
    },
    [bucket, profileName, connectionId, onRefresh, setDeleting, tabId, closeDetailIfDeleted]
  );

  const onToggleSelect = useCallback(
    (key: string, checked: boolean) => {
      if (checked) {
        addSelectItem(tabId, [key]);
      } else removeSelectItem(tabId, [key]);
    },
    [tabId, addSelectItem, removeSelectItem]
  );

  const onOpenDetail = useCallback((item: ObjectItemData) => openDetail(tabId, item), [openDetail, tabId]);

  const onOpenFolder = useCallback((folder: string) => changePrefix(tabId, folder), [changePrefix, tabId]);

  useFilesDroppedUpload({ tabId, connectionId, profileName, bucket, prefix, onRefresh });

  useImperativeHandle(
    ref,
    () => ({
      onRefresh,
      onClickMenuButton,
    }),
    [onClickMenuButton, onRefresh]
  );

  const objectList = connectionId ? objectDatas : [];

  // Danh sách nằm dưới padding của vùng cuộn nên virtualizer cần biết độ lệch đó.
  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
    // Padding phía trên danh sách dùng rem nên độ lệch cũng đổi theo kích thước.
  }, [scale]);

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: objectList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT * scale,
    getItemKey: idx => objectList[idx].key,
    gap: LIST_ROW_GAP * scale,
    overscan: 5,
    scrollMargin,
  });

  useRemeasureOnScale(virtualizer, scale);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;
  const prefetchRows = Math.max(
    PREFETCH_MIN_ROWS,
    Math.ceil((PREFETCH_SCREENS * (virtualizer.scrollRect?.height ?? 0)) / ((LIST_ROW_HEIGHT + LIST_ROW_GAP) * scale))
  );

  useEffect(() => {
    // Sau khi tải trang thất bại, chờ người dùng nhấn Refresh thay vì tự thử lại liên tục.
    if (!nextCursor || isLoadingMore || loadMoreError || cursorKey !== listKey) return;
    // Tìm kiếm rỗng không có nội dung để cuộn: người dùng tiếp tục bằng nút "load more".
    if (keyword && objectList.length === 0) return;
    if (lastVisibleIndex >= objectList.length - 1 - prefetchRows) {
      loadNextPage();
    }
  }, [
    lastVisibleIndex,
    prefetchRows,
    objectList.length,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    keyword,
    cursorKey,
    listKey,
    loadNextPage,
  ]);

  const isEmpty = objectList.length === 0;
  // Chỉ bật sau khi chính danh sách này tải xong (không bật khi đang tải, sau lỗi hoặc khi còn dữ liệu cũ).
  const showEmpty = !!connectionId && !!bucket && isLoaded && cursorKey === listKey && isEmpty && !nextCursor;
  // Thử lại sau khi tải trang thất bại hoặc tiếp tục tìm kiếm khi chưa tìm thấy kết quả.
  const showLoadMore = !!keyword && !!nextCursor && !isLoadingMore && (isEmpty || loadMoreError);
  // Khi không có hàng, danh sách không có chiều cao nên footer nằm đúng luồng thay vì bị đẩy xuống dưới các hàng.
  const footerStyle = isEmpty ? { width: '100%' } : { position: 'absolute' as const, top: '100%', width: '100%' };

  return (
    <div ref={listRef} style={{ position: 'relative', height: isEmpty ? undefined : virtualizer.getTotalSize() }}>
      {virtualItems.map(row => (
        <div
          key={row.key}
          style={{
            position: 'absolute',
            width: '100%',
            transform: `translateY(${row.start - scrollMargin}px)`,
          }}
        >
          <ObjectItem
            tabId={tabId}
            item={objectList[row.index]}
            labels={labels}
            onOpenDetail={onOpenDetail}
            onToggleSelect={onToggleSelect}
            onClickMenuButton={onClickMenuButton}
            onClickDeleteFolder={onClickDeleteFolder}
            onOpenFolder={onOpenFolder}
          />
        </div>
      ))}
      {isLoadingMore || (isLoadingFirst && keyword && connectionId && bucket) ? (
        <Center style={footerStyle} py="0.5rem">
          <Loader size="sm" />
        </Center>
      ) : null}
      {showEmpty ? (
        <Center style={footerStyle} py="0.5rem">
          <Text c="dimmed">{keyword ? t('search.empty') : t('emptyFolder')}</Text>
        </Center>
      ) : null}
      {showLoadMore ? (
        <Center style={footerStyle} py="0.5rem">
          <Button onClick={onClickLoadMore}>{t('search.loadMore')}</Button>
        </Center>
      ) : null}
    </div>
  );
}
export default ObjectListView;
