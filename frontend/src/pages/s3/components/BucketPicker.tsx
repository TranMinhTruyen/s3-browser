import { Combobox, Group, Input, InputBase, Loader, useCombobox } from '@mantine/core';
import { useDebouncedValue, useElementSize } from '@mantine/hooks';
import { GetListBucket, SearchBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Bucket } from '@wails/S3Browser/models/bucket';
import { CheckIcon } from 'lucide-react';
import { ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import Button from '@/components/buttons/Button';
import TruncatedText from '@/components/display/TruncatedText';
import WarningIcon from '@/components/display/WarningIcon';
import ComboboxClearButton from '@/components/inputs/combobox/ComboboxClearButton';
import ComboboxOptions from '@/components/inputs/combobox/ComboboxOptions';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';

// Số bucket tải mỗi trang.
const BUCKET_PAGE_SIZE = 20;
// Chờ khoảng thời gian này sau lần nhấn phím cuối trước khi tìm kiếm.
const SEARCH_DEBOUNCE_MS = 300;

type BucketPickerProps = {
  connectionId?: string;
  profileName?: string;
  // Tên bucket đang chọn.
  value: string | null;
  label?: string;
  disabled?: boolean;
  error?: string;
  onChange: (bucketName: string | null) => void;
};

/**
 * Danh sách thả xuống hiển thị bucket của kết nối, hỗ trợ tìm kiếm phía máy chủ (có debounce) và phân trang "tải thêm".
 * Tải dữ liệu khi mở danh sách và hủy các yêu cầu đang chạy khi đóng danh sách hoặc đổi từ khóa.
 */
function BucketPicker(props: BucketPickerProps) {
  const { connectionId, profileName, value, label, disabled, error, onChange } = props;

  const { t } = useTranslation('bucketPicker');

  const [opened, setOpened] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebouncedValue(keyword.trim(), SEARCH_DEBOUNCE_MS);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  // Không thể chọn bucket không có tên (và cũng không có React key), nên không đưa vào danh sách.
  const namedBuckets = useMemo(() => buckets.filter(bucket => bucket.name), [buckets]);
  const [nextCursor, setNextCursor] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const requestCtrl = useRef<AbortController>(null);
  const { ref: targetRef, width: targetWidth } = useElementSize<HTMLButtonElement>();

  const combobox = useCombobox({
    onDropdownOpen: () => {
      setOpened(true);
      combobox.focusSearchInput();
    },
    onDropdownClose: () => setOpened(false),
  });

  const { closeDropdown, toggleDropdown } = combobox;

  const startRequest = useCallback(() => {
    requestCtrl.current?.abort();
    const ctrl = new AbortController();
    requestCtrl.current = ctrl;
    return ctrl;
  }, []);

  // Liệt kê bucket hoặc tìm kiếm khi có từ khóa. Cả hai đều trả về cùng một cấu trúc dữ liệu.
  const fetchPage = useCallback(
    (cursor: string, signal: AbortSignal) => {
      if (!connectionId) return Promise.resolve(undefined);
      if (debouncedKeyword) {
        return callIPC(
          SearchBucket,
          [{ connectionId, profileName, keyword: debouncedKeyword, nextCursor: cursor, checkWrite: true }],
          { signal }
        );
      }
      return callIPC(
        GetListBucket,
        [{ connectionId, profileName, nextCursor: cursor, limit: BUCKET_PAGE_SIZE, checkWrite: true }],
        { signal }
      );
    },
    [connectionId, profileName, debouncedKeyword]
  );

  const loadFirstPage = useCallback(async () => {
    const ctrl = startRequest();
    setIsLoading(true);
    const output = await fetchPage('', ctrl.signal);
    if (ctrl.signal.aborted) return;
    setBuckets(output?.bucketList ?? []);
    setNextCursor(output?.nextCursor ?? '');
    setIsLoading(false);
  }, [fetchPage, startRequest]);

  // Tải trang đầu khi danh sách mở và tải lại khi từ khóa đang áp dụng thay đổi.
  useEffect(() => {
    if (!opened) return;
    // Việc tải dữ liệu là thao tác đồng bộ bên ngoài; cờ loading chỉ đánh dấu yêu cầu đã bắt đầu.
    // oxlint-disable-next-line react/set-state-in-effect
    loadFirstPage();
    return () => {
      requestCtrl.current?.abort();
      // Yêu cầu bị hủy sẽ không chạy đến lệnh setIsLoading(false) của chính nó.
      setIsLoading(false);
    };
  }, [opened, loadFirstPage]);

  const onClickLoadMore = useCallback(async () => {
    const ctrl = startRequest();
    setIsLoading(true);
    const output = await fetchPage(nextCursor, ctrl.signal);
    if (ctrl.signal.aborted) return;
    if (output) {
      setBuckets(prev => [...prev, ...(output.bucketList ?? [])]);
      setNextCursor(output.nextCursor ?? '');
    }
    setIsLoading(false);
  }, [fetchPage, nextCursor, startRequest]);

  const onChangeKeyword = useCallback((e: ChangeEvent<HTMLInputElement>) => setKeyword(e.currentTarget.value), []);

  const onSubmitOption = useCallback(
    async (name: string) => {
      closeDropdown();
      // Kiểm tra quyền truy cập có thể không chính xác (ví dụ policy giới hạn theo tiền tố), nên cảnh báo để người dùng tự quyết định.
      const picked = namedBuckets.find(bucket => bucket.name === name);
      if (picked?.inaccessible || picked?.readOnly) {
        const confirmCode = picked.inaccessible ? 'C000007' : 'C000008';
        const confirmed = await ConfirmModal.show({ type: 'warning', confirmCode, params: { bucket: name } });
        if (!confirmed) return;
      }
      onChange(name);
    },
    [onChange, closeDropdown, namedBuckets]
  );

  const onClickToggle = useCallback(() => toggleDropdown(), [toggleDropdown]);

  const onClickClear = useCallback(() => onChange(null), [onChange]);

  const showClear = !!value && !disabled;

  return (
    <Combobox store={combobox} onOptionSubmit={onSubmitOption} disabled={disabled} withinPortal={false}>
      <Combobox.Target targetType="button">
        <InputBase
          ref={targetRef}
          component="button"
          type="button"
          pointer
          label={label}
          error={error}
          disabled={disabled}
          rightSection={showClear ? <ComboboxClearButton onClear={onClickClear} /> : <Combobox.Chevron />}
          rightSectionPointerEvents={showClear ? 'all' : 'none'}
          onClick={onClickToggle}
        >
          {value ? <TruncatedText>{value}</TruncatedText> : <Input.Placeholder>{t('placeholder')}</Input.Placeholder>}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown style={{ minWidth: targetWidth }}>
        <Combobox.Search value={keyword} onChange={onChangeKeyword} placeholder={t('searchPlaceholder')} />
        <ComboboxOptions>
          {namedBuckets.map(bucket => {
            const warning = bucket.inaccessible ? t('inaccessible') : bucket.readOnly ? t('readOnly') : null;
            return (
              <Combobox.Option key={bucket.name} value={bucket.name as string} active={bucket.name === value}>
                <Group gap="xs" wrap="nowrap">
                  {bucket.name === value && <CheckIcon size="0.75rem" />}
                  <TruncatedText>{bucket.name}</TruncatedText>
                  {warning ? <WarningIcon label={warning} /> : null}
                </Group>
              </Combobox.Option>
            );
          })}
          {!isLoading && namedBuckets.length === 0 && <Combobox.Empty>{t('empty')}</Combobox.Empty>}
          {isLoading && (
            <Group justify="center" p="xs">
              <Loader size="sm" />
            </Group>
          )}
          {!isLoading && nextCursor && (
            <Group justify="center" p="xs">
              <Button size="xs" onClick={onClickLoadMore}>
                {t('loadMore')}
              </Button>
            </Group>
          )}
        </ComboboxOptions>
      </Combobox.Dropdown>
    </Combobox>
  );
}
export default memo(BucketPicker);
