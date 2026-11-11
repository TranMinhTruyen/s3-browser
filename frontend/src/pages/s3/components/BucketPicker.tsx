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

// Buckets fetched per page.
const BUCKET_PAGE_SIZE = 20;
// Wait this long after the last keystroke before searching.
const SEARCH_DEBOUNCE_MS = 300;

type BucketPickerProps = {
  connectionId?: string;
  profileName?: string;
  // Selected bucket name.
  value: string | null;
  label?: string;
  disabled?: boolean;
  error?: string;
  onChange: (bucketName: string | null) => void;
};

/**
 * Dropdown that lists the buckets of a connection with server-side search (debounced) and "load more" paging.
 * Data is fetched when the dropdown opens and in-flight requests are aborted on close or keyword change.
 */
function BucketPicker(props: BucketPickerProps) {
  const { connectionId, profileName, value, label, disabled, error, onChange } = props;

  const { t } = useTranslation('bucketPicker');

  const [opened, setOpened] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebouncedValue(keyword.trim(), SEARCH_DEBOUNCE_MS);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  // A bucket without a name cannot be picked (and has no React key), so it is not listed.
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

  // Lists the buckets, or searches them when a keyword is applied. Both return the same shape.
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

  // Loads the first page when the dropdown opens and again when the applied keyword changes.
  useEffect(() => {
    if (!opened) return;
    // Fetching is the external sync here; the loading flag only marks the request as started.
    // oxlint-disable-next-line react/set-state-in-effect
    loadFirstPage();
    return () => {
      requestCtrl.current?.abort();
      // An aborted request never reaches its own setIsLoading(false).
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
      // The access probe can be wrong (e.g. prefix-scoped policies), so warn and let the user decide.
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

      <Combobox.Dropdown miw={targetWidth}>
        <Combobox.Search value={keyword} onChange={onChangeKeyword} placeholder={t('searchPlaceholder')} />
        <ComboboxOptions>
          {namedBuckets.map(bucket => {
            const warning = bucket.inaccessible ? t('inaccessible') : bucket.readOnly ? t('readOnly') : null;
            return (
              <Combobox.Option key={bucket.name} value={bucket.name as string} active={bucket.name === value}>
                <Group gap="xs" wrap="nowrap">
                  {bucket.name === value && <CheckIcon size={12} />}
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
