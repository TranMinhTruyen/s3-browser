import type { SQLNamespace } from '@codemirror/lang-sql';
import type { EditorView } from '@codemirror/view';
import { Divider, Paper, Splitter } from '@mantine/core';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import FindReplacePanel from '@/pages/sql/components/FindReplacePanel';
import SqlTabActionBar from '@/pages/sql/components/SqlTabActionBar';
import classes from '@/pages/sql/components/SqlTabDetail.module.css';
import SqlEditor, { type SqlDialect } from '@/pages/sql/components/sqlEditor/SqlEditor';
import SqlResultPanel from '@/pages/sql/components/sqlResult/SqlResultPanel';
import { useSqlRunner } from '@/pages/sql/hooks/useSqlRunner';
import { getMockSchema } from '@/pages/sql/mock/dbSchemaMock';
import { type Provider, selectProfileNames, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { useDbTreeStore } from '@/pages/sql/stores/dbTreeStore';
import { useSqlTabStore } from '@/pages/sql/stores/sqlTabStore';
import { DEFAULT_FIND_OPTIONS, escapeRegExp, type FindOptions } from '@/pages/sql/utils/findReplace';
import { formatEditorSql } from '@/pages/sql/utils/sqlFormat';

const PROVIDER_DIALECT: Record<Provider, SqlDialect> = { sqlite: 'sqlite', postgres: 'postgresql' };

/** Không gian gợi ý tự động của các bảng và view trong cây đối tượng (không gồm cột); undefined cho đến khi tải xong cây. */
const toNamespace = (names: string[] | undefined): SQLNamespace | undefined =>
  names && Object.fromEntries(names.map(name => [name, []]));

type SqlTabDetailProps = {
  tabId: string;
};

/** Nội dung của một tab SQL: thanh công cụ phía trên vùng editor. */
function SqlTabDetail({ tabId }: SqlTabDetailProps) {
  const { t } = useTranslation('sqlNavbar');

  const selectedProfileId = useSqlTabStore(s => s.tabList[tabId]?.profileId ?? null);
  const setTabProfile = useSqlTabStore(s => s.setTabProfile);
  const setQuery = useSqlTabStore(s => s.setQuery);
  // Chỉ ánh xạ id -> tên để profile đổi nhưng tên không đổi sẽ không khiến mọi tab render lại.
  const profileNames = useDbProfileStore(useShallow(selectProfileNames));
  const isConnected = useDbProfileStore(s => !!(selectedProfileId && s.dbProfiles[selectedProfileId]?.isConnected));
  const connectDbProfile = useDbProfileStore(s => s.connectDbProfile);
  const provider = useDbProfileStore(
    s => (selectedProfileId ? s.dbProfiles[selectedProfileId]?.provider : null) ?? null
  );
  const dialect = provider ? PROVIDER_DIALECT[provider] : null;
  // SQLite lấy bảng và view từ cây đối tượng; PostgreSQL hiện vẫn dùng schema mock.
  const tableNames = useDbTreeStore(s => (selectedProfileId ? s.trees[selectedProfileId]?.tableNames : undefined));
  const schema = useMemo(
    () => (provider === 'sqlite' ? toNamespace(tableNames) : getMockSchema(provider)),
    [provider, tableNames]
  );
  const editorRef = useRef<EditorView | null>(null);
  const initialDoc = useRef(useSqlTabStore.getState().queryByTab[tabId] ?? '').current;
  // State tìm kiếm được lưu ở đây (không nằm trong panel) để giữ lại khi đóng panel hoặc chuyển tab.
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findOptions, setFindOptions] = useState<FindOptions>(DEFAULT_FIND_OPTIONS);
  // Panel đang mở đặt hàm làm mới bộ đếm tại đây; editor gọi hàm sau mỗi lần văn bản thay đổi.
  const docChangeRef = useRef<(() => void) | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const { runId, statements, cancelled, running, loadingMore, run, cancel, detach, loadMore } = useSqlRunner(tabId);

  const optionsData = useMemo(
    () => Object.entries(profileNames).map(([key, name]) => ({ name, value: key })),
    [profileNames]
  );

  const onChangeSelectProfile = useCallback(
    (value: string | null) => {
      if (value !== selectedProfileId) detach();
      setTabProfile(tabId, value);
    },
    [tabId, selectedProfileId, setTabProfile, detach]
  );

  // SQLite kết nối thật; PostgreSQL hiện chỉ cập nhật cờ trạng thái.
  const onClickConnect = useCallback(async () => {
    if (!selectedProfileId || isConnected) return;
    if (await connectDbProfile(selectedProfileId)) {
      toast.success(t('toast.connected', { name: profileNames[selectedProfileId] }));
    }
  }, [selectedProfileId, isConnected, connectDbProfile, profileNames, t]);

  const onClickExecute = useCallback(
    () => run(selectedProfileId, editorRef.current?.state.doc.toString() ?? ''),
    [run, selectedProfileId]
  );

  // Ctrl+E: chạy phần đang chọn, hoặc toàn bộ văn bản nếu không có vùng chọn.
  const onExecuteShortcut = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    void run(selectedProfileId, from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to));
  }, [run, selectedProfileId]);

  // Ctrl+Q: định dạng phần đang chọn hoặc toàn bộ văn bản. Không làm gì nếu văn bản rỗng.
  const onFormatShortcut = useCallback(async () => {
    const view = editorRef.current;
    if (!view) return;
    const result = await formatEditorSql(view, dialect);
    if (!result) return;
    if (result.ok)
      toast.success(t(result.scope === 'all' ? 'toast.formatAll' : 'toast.formatSelection', { ns: 'sqlTab' }));
    else toast.error(t('toast.formatError', { ns: 'sqlTab', message: result.message }));
  }, [dialect, t]);

  // Ctrl+F: nếu đang chọn một dòng thì dùng dòng đó làm từ khóa (escape khi bật regex); nhấn lại chỉ focus ô Find.
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

  const onDocChange = useCallback(
    (doc: string) => {
      setQuery(tabId, doc);
      docChangeRef.current?.();
    },
    [setQuery, tabId]
  );

  return (
    <Paper withBorder h="100%" display="flex" style={{ flexDirection: 'column', overflow: 'hidden' }}>
      <SqlTabActionBar
        isConnected={isConnected}
        selectedProfileId={selectedProfileId}
        profileOptions={optionsData}
        onChangeSelectProfile={onChangeSelectProfile}
        onClickConnect={onClickConnect}
        onClickExecute={onClickExecute}
        running={running}
        onClickCancel={cancel}
      />

      <Divider />

      <Splitter orientation="vertical" classNames={{ handle: classes.handle }} style={{ flex: 1, minHeight: 0 }}>
        <Splitter.Pane defaultSize="60%" min="20%">
          <div style={{ height: '100%', position: 'relative' }}>
            <SqlEditor
              viewRef={editorRef}
              initialDoc={initialDoc}
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
        </Splitter.Pane>
        <Splitter.Pane defaultSize="40%" min="10%">
          <SqlResultPanel
            key={runId}
            statements={statements}
            cancelled={cancelled}
            running={running}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        </Splitter.Pane>
      </Splitter>
    </Paper>
  );
}
export default memo(SqlTabDetail);
