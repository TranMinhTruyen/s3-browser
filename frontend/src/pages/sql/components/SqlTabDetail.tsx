import type { EditorView } from '@codemirror/view';
import { Divider, Paper } from '@mantine/core';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import FindReplacePanel from '@/pages/sql/components/FindReplacePanel';
import SqlTabActionBar from '@/pages/sql/components/SqlTabActionBar';
import SqlEditor from '@/pages/sql/components/sqlEditor/SqlEditor';
import { getMockSchema } from '@/pages/sql/mock/dbSchemaMock';
import { selectProfileNames, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { DEFAULT_FIND_OPTIONS, escapeRegExp, type FindOptions } from '@/pages/sql/utils/findReplace';
import { formatEditorSql } from '@/pages/sql/utils/sqlFormat';
import { runSql } from '@/pages/sql/utils/sqlToast';

type SqlTabDetailProps = {
  tabId: string;
};

/** Content of one SQL tab: toolbar over the editor area. */
function SqlTabDetail({ tabId }: SqlTabDetailProps) {
  const { t } = useTranslation('sqlNavbar');

  const selectedProfileId = useSqlTabStore(s => s.tabList[tabId]?.profileId ?? null);
  const setTabProfile = useSqlTabStore(s => s.setTabProfile);
  // Only id -> name, so a profile change that keeps its name does not re-render every tab.
  const profileNames = useDbProfileStore(useShallow(selectProfileNames));
  const isConnected = useDbProfileStore(s => !!(selectedProfileId && s.dbProfiles[selectedProfileId]?.isConnected));
  const setConnected = useDbProfileStore(s => s.setConnected);
  const dialect = useDbProfileStore(s => (selectedProfileId ? s.dbProfiles[selectedProfileId]?.dbType : null) ?? null);
  const schema = useMemo(() => getMockSchema(selectedProfileId), [selectedProfileId]);
  const editorRef = useRef<EditorView | null>(null);
  // Find state lives here (not in the panel) so it survives closing the panel and switching tabs.
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findOptions, setFindOptions] = useState<FindOptions>(DEFAULT_FIND_OPTIONS);
  // The open panel puts its counter refresh here; the editor calls it after every text change.
  const docChangeRef = useRef<(() => void) | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  const optionsData = useMemo(
    () => Object.entries(profileNames).map(([key, name]) => ({ name, value: key })),
    [profileNames]
  );

  const onChangeSelectProfile = useCallback(
    (value: string | null) => setTabProfile(tabId, value),
    [tabId, setTabProfile]
  );

  // Connecting is fake for now: it only flips the flag.
  const onClickConnect = useCallback(() => {
    if (!selectedProfileId || isConnected) return;
    setConnected(selectedProfileId, true);
    toast.success(t('toast.connected', { name: profileNames[selectedProfileId] }));
  }, [selectedProfileId, isConnected, setConnected, profileNames, t]);

  const onClickExecute = useCallback(
    () => runSql(selectedProfileId, editorRef.current?.state.doc.toString() ?? ''),
    [selectedProfileId]
  );

  // Ctrl+E: run the selection, or the whole text when nothing is selected.
  const onExecuteShortcut = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    runSql(selectedProfileId, from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to));
  }, [selectedProfileId]);

  // Ctrl+Q: format the selection or the whole text. An empty text does nothing.
  const onFormatShortcut = useCallback(async () => {
    const view = editorRef.current;
    if (!view) return;
    const result = await formatEditorSql(view, dialect);
    if (!result) return;
    if (result.ok)
      toast.success(t(result.scope === 'all' ? 'toast.formatAll' : 'toast.formatSelection', { ns: 'sqlTab' }));
    else toast.error(t('toast.formatError', { ns: 'sqlTab', message: result.message }));
  }, [dialect, t]);

  // Ctrl+F: a single-line selection becomes the search text (escaped when regex is on); again just re-focuses the Find box.
  const onFindShortcut = useCallback(() => {
    const view = editorRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      if (selected && !selected.includes('\n')) setFindText(findOptions.regexp ? escapeRegExp(selected) : selected);
    }
    setFindOpen(true);
    setFocusKey(key => key + 1);
  }, [findOptions.regexp]);

  const onCloseFind = useCallback(() => setFindOpen(false), []);

  const onDocChange = useCallback(() => docChangeRef.current?.(), []);

  return (
    <Paper withBorder h="100%" display="flex" style={{ flexDirection: 'column', overflow: 'hidden' }}>
      <SqlTabActionBar
        isConnected={isConnected}
        selectedProfileId={selectedProfileId}
        profileOptions={optionsData}
        onChangeSelectProfile={onChangeSelectProfile}
        onClickConnect={onClickConnect}
        onClickExecute={onClickExecute}
      />

      <Divider />

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <SqlEditor
          viewRef={editorRef}
          dialect={dialect}
          schema={schema}
          onFormat={onFormatShortcut}
          onFind={onFindShortcut}
          onExecute={onExecuteShortcut}
          onDocChange={onDocChange}
        />
        {findOpen && (
          <FindReplacePanel
            viewRef={editorRef}
            find={findText}
            replace={replaceText}
            options={findOptions}
            docChangeRef={docChangeRef}
            focusKey={focusKey}
            onChangeFind={setFindText}
            onChangeReplace={setReplaceText}
            onChangeOptions={setFindOptions}
            onClose={onCloseFind}
          />
        )}
      </div>
    </Paper>
  );
}
export default memo(SqlTabDetail);
