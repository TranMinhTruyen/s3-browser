import type { EditorView } from '@codemirror/view';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { type KeyboardEvent, memo, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import Button from '@/components/buttons/Button';
import FieldInput from '@/components/inputs/FieldInput';
import { getMatchInfo, replaceAll, replaceCurrent, selectNext } from '@/pages/sql/utils/findReplace';

type FindReplacePanelProps = {
  viewRef: RefObject<EditorView | null>;
  find: string;
  replace: string;
  showReplace: boolean;
  /** Changes every time Ctrl+F is pressed, so the Find box is focused again even when already open. */
  focusKey: number;
  onChangeFind: (value: string) => void;
  onChangeReplace: (value: string) => void;
  onShowReplace: () => void;
  onClose: () => void;
};

type MatchInfo = { index: number; total: number };

/** Find / Replace box floating over the editor. It is not a modal, so the editor stays usable while it is open. */
function FindReplacePanel(props: FindReplacePanelProps) {
  const { viewRef, find, replace, showReplace, focusKey, onChangeFind, onChangeReplace, onShowReplace, onClose } =
    props;
  const { t } = useTranslation('sqlTab');
  const findInputRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<MatchInfo | null>(null);

  const focusFind = useCallback(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  // Runs on open and on every later Ctrl+F (`focusKey` changes).
  useEffect(focusFind, [focusKey, focusFind]);

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
  const refreshInfo = useCallback((view: EditorView) => setInfo(getMatchInfo(view.state, find)), [find]);

  const onClickFind = useCallback(() => {
    const view = viewRef.current;
    if (!view || !find) return;
    selectNext(view, find);
    refreshInfo(view);
  }, [viewRef, find, refreshInfo]);

  const onClickReplace = useCallback(() => {
    const view = viewRef.current;
    if (!showReplace) return onShowReplace();
    if (!view || !find) return;
    replaceCurrent(view, find, replace);
    refreshInfo(view);
  }, [viewRef, find, replace, showReplace, onShowReplace, refreshInfo]);

  const onClickReplaceAll = useCallback(() => {
    const view = viewRef.current;
    if (!view || !find) return;
    const count = replaceAll(view, find, replace);
    refreshInfo(view);
    toast.info(t('find.replacedCount', { n: count }));
  }, [viewRef, find, replace, refreshInfo, t]);

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

  const hasFind = !!find;

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
        <Text size="sm" fw={500}>
          {t('find.title')}
        </Text>
        <FieldInput
          ref={findInputRef}
          value={find}
          onChange={onChangeFindText}
          placeholder={t('find.placeholderFind')}
        />
        {showReplace && (
          <FieldInput value={replace} onChange={onChangeReplaceText} placeholder={t('find.placeholderReplace')} />
        )}
        {info && (
          <Text size="xs" c="dimmed">
            {info.total === 0 ? t('find.notFound') : t('find.count', { index: info.index, total: info.total })}
          </Text>
        )}
        <Group p="8px" justify="space-between" wrap="nowrap">
          <Button color="red" onClick={onClickCancel}>
            {t('find.cancel')}
          </Button>
          <Group gap="xs" wrap="nowrap">
            <Button onClick={onClickFind} disabled={!hasFind}>
              {t('find.find')}
            </Button>
            <Button onClick={onClickReplace} disabled={showReplace && !hasFind}>
              {t('find.replace')}
            </Button>
            {showReplace && (
              <Button onClick={onClickReplaceAll} disabled={!hasFind}>
                {t('find.replaceAll')}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}
export default memo(FindReplacePanel);
