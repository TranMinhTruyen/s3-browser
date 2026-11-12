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
  /** The panel puts its counter refresh here while mounted; the editor calls it after every text change. */
  docChangeRef: RefObject<(() => void) | null>;
  /** Changes every time Ctrl+F is pressed, so the Find box is focused again even when already open. */
  focusKey: number;
  onChangeFind: (value: string) => void;
  onChangeReplace: (value: string) => void;
  onChangeOptions: (options: FindOptions) => void;
  onClose: () => void;
};

type MatchInfo = { index: number; total: number };

const OPTION_ICONS = [
  { key: 'caseSensitive', Icon: CaseSensitive, label: 'find.matchCase' },
  { key: 'wholeWord', Icon: WholeWord, label: 'find.matchWholeWord' },
  { key: 'regexp', Icon: Regex, label: 'find.useRegex' },
] as const;

/** Find / Replace box floating over the editor. It is not a modal, so the editor stays usable while it is open. */
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

  // Runs on open and on every later Ctrl+F (`focusKey` changes).
  useEffect(focusFind, [focusKey, focusFind]);

  const query = useMemo(() => createQuery(find, options), [find, options]);
  const isInvalid = !!find && !query.valid;

  // Keeps a shown "i/n" counter up to date; a hidden one (null) is left alone, so typing does not re-render.
  const updateInfo = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    setInfo(prev => {
      if (!prev) return prev;
      const next = getMatchInfo(view.state, query);
      return next.index === prev.index && next.total === prev.total ? prev : next;
    });
  }, [viewRef, query]);

  // Runs on mount and when the query or an option changes; the editor calls it on every text change.
  useEffect(() => {
    updateInfo();
    docChangeRef.current = updateInfo;
    return () => {
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

  // The editor is the source of truth: read the selection back to show "i/n".
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
        // Keep the WebView's own find bar away; just re-focus the Find box.
        e.preventDefault();
        focusFind();
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
      w={360}
      onKeyDown={onKeyDownPanel}
      style={{ position: 'absolute', top: 8, right: 16, zIndex: 10 }}
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
          rightSectionWidth={84}
          rightSectionPointerEvents="all"
          rightSection={
            <Group gap={2} wrap="nowrap">
              {OPTION_ICONS.map(({ key, Icon, label }) => (
                <ActionIcon
                  key={key}
                  size="sm"
                  variant={options[key] ? 'filled' : 'subtle'}
                  color={options[key] ? undefined : 'gray'}
                  aria-pressed={options[key]}
                  data-option={key}
                  tooltip={t(label)}
                  onClick={onClickToggleOption}
                >
                  <Icon size={16} />
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
        <Group p="8px" justify="flex-end" gap="xs" wrap="nowrap">
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
