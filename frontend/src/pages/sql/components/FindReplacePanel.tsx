import type { EditorView } from '@codemirror/view';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { CaseSensitive, Regex, WholeWord } from 'lucide-react';
import { type KeyboardEvent, memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import {
  createQuery,
  type FindOptions,
  getMatchInfo,
  replaceAll,
  replaceCurrent,
  selectNext,
} from '@/pages/sql/utils/findReplace';

type FindReplacePanelProps = {
  viewRef: RefObject<EditorView | null>;
  find: string;
  replace: string;
  options: FindOptions;
  /** Khi panel đang mount, lưu hàm làm mới bộ đếm tại đây; editor gọi hàm sau mỗi lần văn bản thay đổi. */
  docChangeRef: RefObject<(() => void) | null>;
  /** Thay đổi mỗi lần nhấn Ctrl+F để ô Find được focus lại ngay cả khi panel đang mở. */
  focusKey: number;
  onChangeFind: (value: string) => void;
  onChangeReplace: (value: string) => void;
  onChangeOptions: (options: FindOptions) => void;
  onClose: () => void;
};

/** Thời gian chờ (ms) sau lần đổi văn bản cuối trước khi tính lại bộ đếm "i/n". */
const DOC_CHANGE_DELAY = 120;

type MatchInfo = { index: number; total: number };

const OPTION_ICONS = [
  { key: 'caseSensitive', Icon: CaseSensitive, label: 'find.matchCase' },
  { key: 'wholeWord', Icon: WholeWord, label: 'find.matchWholeWord' },
  { key: 'regexp', Icon: Regex, label: 'find.useRegex' },
] as const;

/** Hộp Find / Replace nổi trên editor. Đây không phải modal nên editor vẫn dùng được khi hộp đang mở. */
function FindReplacePanel(props: FindReplacePanelProps) {
  const {
    viewRef,
    find,
    replace,
    options,
    docChangeRef,
    focusKey,
    onChangeFind,
    onChangeReplace,
    onChangeOptions,
    onClose,
  } = props;
  const { t } = useTranslation('sqlTab');
  const findInputRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<MatchInfo | null>(null);

  const focusFind = useCallback(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  // Chạy khi mở và mỗi lần nhấn Ctrl+F sau đó (`focusKey` thay đổi).
  useEffect(focusFind, [focusKey, focusFind]);

  const query = useMemo(() => createQuery(find, options), [find, options]);
  const isInvalid = !!find && !query.valid;

  // Cập nhật bộ đếm "i/n" đang hiển thị; nếu bị ẩn (null) thì giữ nguyên để thao tác nhập không gây render lại.
  const updateInfo = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    setInfo(prev => {
      if (!prev) return prev;
      const next = getMatchInfo(view.state, query);
      return next.index === prev.index && next.total === prev.total ? prev : next;
    });
  }, [viewRef, query]);

  // Chạy khi mount và khi truy vấn hoặc tùy chọn thay đổi; các lần đổi văn bản được gom lại để nhập liệu không bị chậm.
  useEffect(() => {
    updateInfo();
    let timer: ReturnType<typeof setTimeout> | undefined;
    docChangeRef.current = () => {
      clearTimeout(timer);
      timer = setTimeout(updateInfo, DOC_CHANGE_DELAY);
    };
    return () => {
      clearTimeout(timer);
      docChangeRef.current = null;
    };
  }, [updateInfo, docChangeRef]);

  const onClickToggleOption = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const key = e.currentTarget.dataset.option as keyof FindOptions;
      onChangeOptions({ ...options, [key]: !options[key] });
    },
    [options, onChangeOptions]
  );

  const onChangeFindText = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChangeFind(e.currentTarget.value);
      setInfo(null);
    },
    [onChangeFind]
  );

  const onChangeReplaceText = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChangeReplace(e.currentTarget.value),
    [onChangeReplace]
  );

  // Editor là nguồn dữ liệu chính: đọc lại vùng chọn để hiển thị "i/n".
  const refreshInfo = useCallback((view: EditorView) => setInfo(getMatchInfo(view.state, query)), [query]);

  const onClickFind = useCallback(() => {
    const view = viewRef.current;
    if (!view || !query.valid) return;
    selectNext(view, query);
    refreshInfo(view);
  }, [viewRef, query, refreshInfo]);

  const onClickReplace = useCallback(() => {
    const view = viewRef.current;
    if (!view || !query.valid) return;
    replaceCurrent(view, query, replace);
    refreshInfo(view);
  }, [viewRef, query, replace, refreshInfo]);

  const onClickReplaceAll = useCallback(() => {
    const view = viewRef.current;
    if (!view || !query.valid) return;
    const count = replaceAll(view, query, replace);
    refreshInfo(view);
    toast.info(t('find.replacedCount', { n: count }));
  }, [viewRef, query, replace, refreshInfo, t]);

  const onClickCancel = useCallback(() => {
    onClose();
    viewRef.current?.focus();
  }, [onClose, viewRef]);

  const onKeyDownPanel = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClickCancel();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        // Tránh mở thanh tìm kiếm riêng của WebView; chỉ focus lại ô Find.
        e.preventDefault();
        focusFind();
      } else if ((e.ctrlKey || e.metaKey) && ['e', 'q'].includes(e.key.toLowerCase())) {
        // Phím tắt của editor (chạy, định dạng) không hoạt động khi nhập ở đây; WebView cũng không được xử lý chúng.
        e.preventDefault();
      } else if (e.key === 'Enter' && e.target === findInputRef.current) {
        onClickFind();
      }
    },
    [onClickCancel, onClickFind, focusFind]
  );

  const canSearch = query.valid;

  return (
    <Paper
      withBorder
      shadow="md"
      p="xs"
      w="22.5rem"
      onKeyDown={onKeyDownPanel}
      style={{ position: 'absolute', top: '0.5rem', right: '1rem', zIndex: 10 }}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={500}>
            {t('find.title')}
          </Text>
          <CloseButton tooltip={t('find.cancel')} onClick={onClickCancel} />
        </Group>
        <FieldInput
          ref={findInputRef}
          value={find}
          onChange={onChangeFindText}
          placeholder={t('find.placeholderFind')}
          error={isInvalid}
          rightSectionWidth="5.25rem"
          rightSectionPointerEvents="all"
          rightSection={
            <Group gap="0.125rem" wrap="nowrap">
              {OPTION_ICONS.map(({ key, Icon, label }) => (
                <ActionIcon
                  key={key}
                  size="sm"
                  variant={options[key] ? 'filled' : 'subtle'}
                  color={options[key] ? undefined : 'var(--mantine-color-gray-6)'}
                  aria-pressed={options[key]}
                  data-option={key}
                  tooltip={t(label)}
                  onClick={onClickToggleOption}
                >
                  <Icon size="1rem" />
                </ActionIcon>
              ))}
            </Group>
          }
        />
        {isInvalid && (
          <Text size="xs" c="var(--mantine-color-error)">
            {t('find.invalidRegex')}
          </Text>
        )}
        <FieldInput value={replace} onChange={onChangeReplaceText} placeholder={t('find.placeholderReplace')} />
        {info && !isInvalid && (
          <Text size="xs" c="dimmed">
            {info.total === 0 ? t('find.notFound') : t('find.count', { index: info.index, total: info.total })}
          </Text>
        )}
        <Group p="0.5rem" justify="flex-end" gap="xs" wrap="nowrap">
          <Button onClick={onClickFind} disabled={!canSearch}>
            {t('find.find')}
          </Button>
          <Button onClick={onClickReplace} disabled={!canSearch}>
            {t('find.replace')}
          </Button>
          <Button onClick={onClickReplaceAll} disabled={!canSearch}>
            {t('find.replaceAll')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
export default memo(FindReplacePanel);
