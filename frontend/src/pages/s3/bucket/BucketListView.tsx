import { Center, Loader, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckBucketAccess, GetListBucket, SearchBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionProfileOutput } from '@wails/S3Browser/models';
import { Bucket } from '@wails/S3Browser/models/bucket';
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
import BucketItem, { BucketItemLabels } from '@/pages/s3/bucket/BucketItem';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { isAnonymous } from '@/pages/s3/utils/authUtils';
import { onTabGone } from '@/pages/s3/utils/tabUtils';

// Số bucket lấy trong mỗi trang.
const BUCKET_PAGE_SIZE = 1000;
// Chờ vùng hiển thị ổn định rồi mới kiểm tra quyền truy cập của các bucket trên màn hình.
const ACCESS_CHECK_DELAY_MS = 150;
// Tải trang tiếp theo khi còn không quá số hàng này bên dưới viewport.
const PREFETCH_ROWS = 2;

export type BucketListViewRef = {
  onRefresh?: () => Promise<void>;
  // Cập nhật policy mode của một bucket, ví dụ ngay sau khi người dùng lưu policy.
  setPolicyMode?: (bucket: string, mode: string) => void;
};

type BucketListViewProps = {
  tabId: string;
  profile?: ConnectionProfileOutput | null;
  active: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  // Từ khóa tìm kiếm đang áp dụng; rỗng nghĩa là danh sách lazy-load thông thường.
  keyword?: string;
  onSelectBucket?: (bucketName: string | undefined) => void;
  onEditPolicy?: (bucketName: string | undefined) => void;
  onDeleteBucket?: (bucketName: string | undefined) => void;
  ref?: Ref<BucketListViewRef>;
};

/** Danh sách bucket virtualized của kết nối đang hoạt động; cung cấp các thao tác bắt buộc qua `BucketListViewRef`. */
function BucketListView(props: BucketListViewProps) {
  const { tabId, profile, active, scrollRef, keyword = '', onSelectBucket, onEditPolicy, onDeleteBucket, ref } = props;

  const { t } = useTranslation('bucket', { keyPrefix: 'page' });

  // Hàng lấy nội dung chữ từ đây nên không tự đăng ký i18n.
  const labels = useMemo<BucketItemLabels>(
    () => ({
      inaccessible: t('tooltip.inaccessible'),
      moreActions: t('tooltip.moreActions'),
      createDate: t('label.createDate'),
      detail: t('menu.detail'),
      editPolicy: t('menu.editPolicy'),
      delete: t('menu.delete'),
    }),
    [t]
  );

  const [bucketDatas, setBucketDatas] = useState<Bucket[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  // Danh sách mà cursor thuộc về. Ngay sau khi source thay đổi, nextCursor vẫn giữ cursor của danh sách cũ
  // cho đến khi nhận được trang đầu mới; gửi cursor đó sang source mới sẽ làm hỏng yêu cầu.
  const [cursorKey, setCursorKey] = useState('');
  const [isLoadingFirst, setIsLoadingFirst] = useState(false);
  // Là true khi đã tải trang đầu của danh sách hiện tại, để phân biệt kết quả tìm kiếm rỗng với trạng thái đang tải.
  const [isLoaded, setIsLoaded] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const scale = useUiScale();

  const openBucketDetail = useTabListStore(s => s.openBucketDetail);

  const connectionId = profile?.id;
  const canEdit = !!profile && !isAnonymous(profile);
  const profileName = profile?.name;
  const listKey = `${connectionId}|${keyword}`;
  const requestCtrl = useRef<AbortController>(null);
  // Lần loadFirstPage gần nhất của danh sách: hiển thị lại tab đã ẩn không được tải lại danh sách.
  const loadedFor = useRef<unknown>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Kiểm tra quyền truy cập của bucket đang hiển thị: controller riêng và tên đã gửi trong danh sách hiện tại.
  const checkCtrl = useRef<AbortController>(null);
  const checkedNames = useRef(new Set<string>());
  // Các bucket được cập nhật policy mode thủ công (setPolicyMode): phản hồi quyền truy cập cũ không được ghi đè giá trị đó.
  const patchedNames = useRef(new Set<string>());

  const resetAccessCheck = useCallback(() => {
    checkCtrl.current?.abort();
    checkCtrl.current = null;
    checkedNames.current.clear();
    patchedNames.current.clear();
  }, []);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  // Liệt kê bucket hoặc tìm kiếm nếu có từ khóa. Cả hai đều trả về cùng cấu trúc dữ liệu.
  const handleGetListBucket = useCallback(
    (cursor: string, signal?: AbortSignal) => {
      if (!connectionId) return Promise.resolve(undefined);
      if (keyword) {
        return callIPC(SearchBucket, [{ connectionId, profileName, keyword, nextCursor: cursor, lazyAccess: true }], {
          signal,
        });
      }
      return callIPC(
        GetListBucket,
        [{ connectionId, profileName, nextCursor: cursor, limit: BUCKET_PAGE_SIZE, lazyAccess: true }],
        { signal }
      );
    },
    [profileName, connectionId, keyword]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    resetAccessCheck();
    setNextCursor('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    setIsLoaded(false);
    setIsLoadingFirst(true);
    // Hủy thao tác cũng hủy yêu cầu ở phía Go, không chỉ bỏ cập nhật state.
    const output = await handleGetListBucket('', ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setBucketDatas(output.bucketList ?? []);
      setNextCursor(output.nextCursor ?? '');
      setCursorKey(listKey);
      setIsLoaded(true);
    }
    setIsLoadingFirst(false);
  }, [handleGetListBucket, startRequest, resetAccessCheck, listKey]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListBucket(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      // Trang tìm kiếm có thể trùng kết quả với trang trước nên bỏ tên đã hiển thị.
      setBucketDatas(prev => {
        const seen = new Set(prev.map(item => item.name));
        const added = (output.bucketList ?? []).filter(item => !seen.has(item.name));
        // Không có dữ liệu mới: giữ nguyên mảng để danh sách không render lại.
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      // Cursor trùng với cursor vừa gửi sẽ khiến tự động tải lặp vô hạn: xem như đã đến cuối.
      setNextCursor(output.nextCursor === nextCursor ? '' : (output.nextCursor ?? ''));
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, handleGetListBucket, startRequest]);

  // Cũng chạy khi từ khóa đổi vì loadFirstPage phụ thuộc vào giá trị này.
  useEffect(() => {
    if (!connectionId) {
      // Đã ngắt kết nối: khi kết nối lại cùng hồ sơ phải tải lại danh sách.
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === loadFirstPage) return;
    loadedFor.current = loadFirstPage;
    setBucketDatas([]);
    loadFirstPage();
  }, [connectionId, loadFirstPage]);

  // Hủy mọi yêu cầu đang chạy khi view unmount. Tab bị ẩn (Activity) vẫn giữ yêu cầu và danh sách.
  useEffect(
    () =>
      onTabGone(tabId, () => {
        requestCtrl.current?.abort();
        resetAccessCheck();
        loadedFor.current = null;
      }),
    [tabId, resetAccessCheck]
  );

  const onRefresh = useCallback(async () => {
    setBucketDatas([]);
    await loadFirstPage();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef, loadFirstPage]);

  const onOpenDetail = useCallback((item: Bucket) => openBucketDetail(tabId, item), [openBucketDetail, tabId]);

  const onClickLoadMore = useCallback(() => {
    setLoadMoreError(false);
    return loadNextPage();
  }, [loadNextPage]);

  const setPolicyMode = useCallback((bucket: string, mode: string) => {
    patchedNames.current.add(bucket);
    setBucketDatas(prev => {
      const idx = prev.findIndex(item => item.name === bucket);
      if (idx < 0) return prev;
      return prev.map((item, i) => (i === idx ? { ...item, policyMode: mode } : item));
    });
  }, []);

  useImperativeHandle(ref, () => ({ onRefresh, setPolicyMode }), [onRefresh, setPolicyMode]);

  const bucketList = connectionId ? bucketDatas : [];

  // Danh sách nằm dưới padding của vùng cuộn nên virtualizer cần biết độ lệch đó.
  // Đo lại khi view được hiển thị vì offsetTop bằng 0 trong lúc bị ẩn.
  useLayoutEffect(() => {
    if (active) setScrollMargin(listRef.current?.offsetTop ?? 0);
    // Padding phía trên danh sách dùng rem nên độ lệch cũng đổi theo kích thước.
  }, [active, scale]);

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: bucketList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT * scale,
    getItemKey: idx => bucketList[idx].name ?? idx,
    gap: LIST_ROW_GAP * scale,
    overscan: 5,
    scrollMargin,
    enabled: active,
  });

  useRemeasureOnScale(virtualizer, scale);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;
  const firstVisibleIndex = virtualizer.range?.startIndex ?? 0;

  // Gộp bucket đã kiểm tra theo tên; giữ nguyên tham chiếu của bucket không đổi để hàng đã memo không render lại.
  const mergeAccess = useCallback((checked: Bucket[]) => {
    const byName = new Map(checked.map(item => [item.name ?? '', item]));
    setBucketDatas(prev => {
      let changed = false;
      const next = prev.map(item => {
        const result = byName.get(item.name ?? '');
        if (!result) return item;
        changed = true;
        return {
          ...item,
          inaccessible: result.inaccessible,
          readOnly: result.readOnly,
          deleteDenied: result.deleteDenied,
          accessPending: result.accessPending,
          policyMode: patchedNames.current.has(item.name ?? '')
            ? item.policyMode
            : result.policyMode || item.policyMode,
        };
      });
      return changed ? next : prev;
    });
  }, []);

  // Kiểm tra thất bại: ẩn skeleton huy hiệu của các bucket đã gửi để nó không hiển thị mãi.
  const markPolicyUnknown = useCallback((names: string[]) => {
    const failed = new Set(names);
    setBucketDatas(prev =>
      prev.map(item => (failed.has(item.name ?? '') && !item.policyMode ? { ...item, policyMode: 'unknown' } : item))
    );
  }, []);

  // Kiểm tra quyền truy cập (và policy mode nếu không ẩn danh) của các bucket đang hiển thị nhưng chưa rõ trạng thái,
  // sau khi vùng hiển thị ngừng dịch chuyển. Mỗi tên chỉ gửi một lần cho mỗi danh sách.
  useEffect(() => {
    if (!active || !connectionId) return;
    const timer = setTimeout(async () => {
      const names = bucketDatas
        .slice(firstVisibleIndex, lastVisibleIndex + 1)
        .flatMap(item =>
          (item.accessPending || (canEdit && !item.policyMode)) && item.name && !checkedNames.current.has(item.name)
            ? [item.name]
            : []
        );
      if (names.length === 0) return;
      names.forEach(name => checkedNames.current.add(name));
      checkCtrl.current ??= new AbortController();
      const { signal } = checkCtrl.current;
      const output = await callIPC(
        CheckBucketAccess,
        [{ connectionId, profileName, bucketNames: names, withPolicy: canEdit }],
        { signal }
      );
      if (signal.aborted) return;
      if (output?.bucketList) mergeAccess(output.bucketList);
      else if (!output) markPolicyUnknown(names);
    }, ACCESS_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    active,
    connectionId,
    profileName,
    canEdit,
    bucketDatas,
    firstVisibleIndex,
    lastVisibleIndex,
    mergeAccess,
    markPolicyUnknown,
  ]);

  useEffect(() => {
    // Sau khi tải trang thất bại, chờ người dùng nhấn Refresh thay vì tự thử lại liên tục.
    if (!active || !nextCursor || isLoadingMore || loadMoreError || cursorKey !== listKey) return;
    // Tìm kiếm rỗng không có nội dung để cuộn: người dùng tiếp tục bằng nút "load more".
    if (keyword && bucketList.length === 0) return;
    if (lastVisibleIndex >= bucketList.length - 1 - PREFETCH_ROWS) {
      loadNextPage();
    }
  }, [
    active,
    lastVisibleIndex,
    bucketList.length,
    nextCursor,
    isLoadingMore,
    loadMoreError,
    keyword,
    cursorKey,
    listKey,
    loadNextPage,
  ]);

  const isEmpty = bucketList.length === 0;
  // Chỉ bật sau khi chính danh sách này tải xong (không bật khi đang tải, sau lỗi hoặc khi còn dữ liệu cũ).
  const showEmpty = !!connectionId && isLoaded && cursorKey === listKey && isEmpty && !nextCursor;
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
          <BucketItem
            item={bucketList[row.index]}
            labels={labels}
            canEdit={canEdit}
            onSelectBucket={onSelectBucket}
            onOpenDetail={onOpenDetail}
            onEditPolicy={onEditPolicy}
            onDeleteBucket={onDeleteBucket}
          />
        </div>
      ))}
      {isLoadingMore || (isLoadingFirst && keyword && connectionId) ? (
        <Center style={footerStyle} py="0.5rem">
          <Loader size="sm" />
        </Center>
      ) : null}
      {showEmpty ? (
        <Center style={footerStyle} py="0.5rem">
          <Text c="dimmed">{keyword ? t('search.empty') : t('empty')}</Text>
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
export default BucketListView;
