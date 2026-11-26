import { GetListObject, SearchObject } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ObjectItem as ObjectItemData } from '@wails/S3Browser/models/bucket';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { callIPC } from '@/common/utils/ipcUtils';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';
import { onTabGone } from '@/pages/s3/utils/tabUtils';

// Số đối tượng tải mỗi trang: trang đầu nhỏ để hiển thị nhanh, các trang sau lớn hơn để cuộn mượt.
export const FIRST_PAGE_SIZE = 200;
export const NEXT_PAGE_SIZE = 1000;

type UseObjectPagingParams = {
  tabId: string;
  connectionId?: string;
  profileName?: string;
  bucket?: string;
  prefix: string;
  // Từ khóa tìm kiếm đang áp dụng; để trống nghĩa là liệt kê thư mục bình thường.
  keyword: string;
  // Định danh danh sách (kết nối, bucket, tiền tố, từ khóa) mà con trỏ thuộc về.
  listKey: string;
  scrollRef: RefObject<HTMLElement | null>;
};

/**
 * Phân trang danh sách đối tượng bằng con trỏ (liệt kê thư mục hoặc tìm kiếm), có thể hủy yêu cầu.
 * Tải trang đầu mỗi khi nguồn danh sách thay đổi và hủy yêu cầu đang chạy khi component bị gỡ.
 */
export function useObjectPaging(params: UseObjectPagingParams) {
  const { tabId, connectionId, profileName, bucket, prefix, keyword, listKey, scrollRef } = params;

  const [objectDatas, setObjectDatas] = useState<ObjectItemData[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  // Danh sách mà con trỏ thuộc về. Ngay sau khi nguồn thay đổi, nextCursor vẫn giữ con trỏ của danh sách cũ
  // cho đến khi trang đầu mới được tải xong; gửi nó sang nguồn mới sẽ làm yêu cầu thất bại.
  const [cursorKey, setCursorKey] = useState('');
  const [isLoadingFirst, setIsLoadingFirst] = useState(false);
  // Bật sau khi tải xong trang đầu của danh sách hiện tại, để phân biệt kết quả tìm kiếm rỗng với trạng thái đang tải.
  const [isLoaded, setIsLoaded] = useState(false);
  const changeCurrentView = useTabListStore(s => s.changeCurrentView);
  const requestCtrl = useRef<AbortController>(null);
  // loadFirstPage mà danh sách được tải lần gần nhất: hiện lại tab đang ẩn không cần tải lại.
  const loadedFor = useRef<unknown>(null);

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  // Liệt kê thư mục hoặc tìm kiếm trong đó khi có từ khóa. Cả hai đều trả về cùng một cấu trúc dữ liệu.
  const handleGetListObject = useCallback(
    (cursor: string, signal?: AbortSignal, onAccessDenied?: () => void) => {
      const limit = cursor ? NEXT_PAGE_SIZE : FIRST_PAGE_SIZE;
      if (!connectionId || !bucket) return Promise.resolve(undefined);
      if (keyword) {
        return callIPC(SearchObject, [{ connectionId, profileName, bucket, prefix, keyword, nextCursor: cursor }], {
          signal,
        });
      }
      return callIPC(GetListObject, [{ connectionId, profileName, bucket, prefix, nextCursor: cursor, limit }], {
        signal,
        rejectAction: output => {
          if (output?.body?.accessDenied && !signal?.aborted) onAccessDenied?.();
        },
      });
    },
    [bucket, prefix, profileName, connectionId, keyword]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    setNextCursor('');
    setIsLoadingMore(false);
    setLoadMoreError(false);
    setIsLoaded(false);
    setIsLoadingFirst(true);
    // Hủy ở đây cũng hủy yêu cầu phía Go, không chỉ ngăn cập nhật state.
    // Nếu bị từ chối truy cập, quay lại danh sách bucket thay vì ở lại bucket không thể đọc.
    const output = await handleGetListObject('', ctrl.signal, () => changeCurrentView(tabId, 'bucketList'));
    if (ctrl.signal.aborted) return;
    if (output) {
      setObjectDatas(output.objectList);
      setNextCursor(output.nextCursor ?? '');
      setCursorKey(listKey);
      setIsLoaded(true);
    }
    setIsLoadingFirst(false);
  }, [handleGetListObject, startRequest, listKey, changeCurrentView, tabId]);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor) return;
    const ctrl = startRequest();
    setIsLoadingMore(true);
    const output = await handleGetListObject(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setObjectDatas(prev => {
        // Con trỏ tìm kiếm có thể trùng với trang trước, nên loại các key đã hiển thị. Khi liệt kê thư mục thì không.
        const seen = new Set(keyword ? prev.map(item => item.key) : []);
        const added = keyword ? output.objectList.filter(item => !seen.has(item.key)) : output.objectList;
        // Không có mục mới: giữ nguyên mảng để danh sách không phải render lại.
        return added.length > 0 ? [...prev, ...added] : prev;
      });
      // Nếu con trỏ giống con trỏ vừa gửi, tự tải tiếp sẽ lặp vô hạn; xem đây là trang cuối.
      setNextCursor(output.nextCursor === nextCursor ? '' : (output.nextCursor ?? ''));
    } else {
      setLoadMoreError(true);
    }
    setIsLoadingMore(false);
  }, [nextCursor, keyword, handleGetListObject, startRequest]);

  // Cũng chạy khi tiền tố hoặc từ khóa thay đổi, vì loadFirstPage phụ thuộc vào chúng.
  useEffect(() => {
    if (!connectionId || !bucket) {
      // Khi ngắt kết nối, kết nối lại cùng nguồn vẫn phải tải lại danh sách.
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === loadFirstPage) return;
    loadedFor.current = loadFirstPage;
    // oxlint-disable-next-line react/set-state-in-effect -- đặt lại danh sách trước khi tải nguồn dữ liệu mới
    setObjectDatas([]);
    scrollRef.current?.scrollTo({ top: 0 });
    loadFirstPage();
  }, [connectionId, bucket, loadFirstPage, scrollRef]);

  // Hủy yêu cầu đang chạy khi view bị gỡ. Tab bị ẩn (Activity) vẫn giữ yêu cầu và danh sách.
  useEffect(
    () =>
      onTabGone(tabId, () => {
        requestCtrl.current?.abort();
        loadedFor.current = null;
      }),
    [tabId]
  );

  const onRefresh = useCallback(async () => {
    setObjectDatas([]);
    await loadFirstPage();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef, loadFirstPage]);

  // Thử lại sau khi tải trang thất bại hoặc tiếp tục tìm kiếm khi chưa tìm thấy kết quả.
  const onClickLoadMore = useCallback(() => {
    setLoadMoreError(false);
    return loadNextPage();
  }, [loadNextPage]);

  return {
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
  };
}
