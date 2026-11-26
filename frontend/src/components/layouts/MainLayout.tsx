import { AppShell, Box, Center, Group, Image, Loader, Text } from '@mantine/core';
import { Window } from '@wailsio/runtime';
import { RotateCcwClock, Settings } from 'lucide-react';
import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type MouseEvent,
  Suspense,
  useCallback,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { tintedColor } from '@/common/theme/tintedColor';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import WindowControls from '@/components/layouts/window/WindowControls';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import i18n from '@/locales/i18n';
import DownloaderWindow from '@/pages/s3/transfer/downloader/DownloaderWindow';
import UploaderWindow from '@/pages/s3/transfer/uploader/UploaderWindow';

type AppMode = 'S3' | 'SQL';

/** Các chế độ ứng dụng theo thứ tự SegmentedControl. Mỗi chunk tải ở lần đầu truy cập chế độ tương ứng. */
const WORKSPACES = [
  { mode: 'S3', labelKey: 'appMode.s3', errorKey: 'common:s3LoadError', load: () => import('@/pages/s3/S3Workspace') },
  {
    mode: 'SQL',
    labelKey: 'appMode.sql',
    errorKey: 'common:sqlLoadError',
    load: () => import('@/pages/sql/SqlWorkspace'),
  },
] as const;

const lazyWorkspaces: Partial<Record<AppMode, LazyExoticComponent<ComponentType>>> = {};

/**
 * Component lazy của một chế độ, chỉ tạo một lần. Nếu tải chunk thất bại thì hiện toast (ứng dụng không có ErrorBoundary),
 * xóa component khỏi bộ nhớ đệm để lần sau tải lại chunk, đồng thời gọi `onFail` để nơi gọi unmount component.
 */
const getWorkspace = (workspace: (typeof WORKSPACES)[number], onFail: (mode: AppMode) => void) => {
  const { mode, errorKey, load } = workspace;
  lazyWorkspaces[mode] ??= lazy(() =>
    load().catch((error: unknown) => {
      toast.error(i18n.t(errorKey), { description: String(error) });
      delete lazyWorkspaces[mode];
      onFail(mode);
      return { default: () => <></> };
    })
  );
  return lazyWorkspaces[mode] as LazyExoticComponent<ComponentType>;
};

/** Nội dung thay thế của Suspense, căn giữa theo cả hai chiều. */
const LOADING_FALLBACK = (
  <Center h="100%">
    <Loader />
  </Center>
);

/** Khung ứng dụng: header (thiết lập, lịch sử), thanh điều hướng, vùng chia trang tab và cửa sổ truyền file. */
function MainLayout() {
  const { t } = useTranslation('historyModal');
  const { t: tSetting } = useTranslation('settingModal');
  const { t: tCommon } = useTranslation('common');

  const [mode, setMode] = useState<AppMode>('S3');
  const [visited, setVisited] = useState<Set<AppMode>>(() => new Set(['S3']));

  const visit = useCallback((target: AppMode) => {
    setVisited(prev => (prev.has(target) ? prev : new Set(prev).add(target)));
  }, []);

  const onChangeMode = useCallback(
    (value: string) => {
      const next = value as AppMode;
      setMode(next);
      visit(next);
    },
    [visit]
  );

  const onClickRetry = useCallback(() => {
    visit(mode);
  }, [visit, mode]);

  // Bỏ đánh dấu đã truy cập chế độ có chunk tải lỗi để lần chọn tiếp theo thử tải lại.
  const onLoadFail = useCallback((failed: AppMode) => {
    setVisited(prev => {
      const next = new Set(prev);
      next.delete(failed);
      return next;
    });
  }, []);

  const onClickHistory = useCallback(() => {
    showHistoryModal();
  }, []);

  const onDoubleClickHeader = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!(e.target as HTMLElement).closest('button, [data-no-maximise]')) Window.ToggleMaximise();
  }, []);

  const onClickSetting = useCallback(() => {
    showSettingModal();
  }, []);

  return (
    <AppShell header={{ height: '3rem' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group
          h="100%"
          px="sm"
          style={{ backgroundColor: INFO_BG_COLOR, '--wails-draggable': 'drag' }}
          onDoubleClick={onDoubleClickHeader}
        >
          <Group gap="xs" wrap="nowrap">
            <Image src="/favicon.ico" alt="" w="1.25rem" h="1.25rem" />
            <Text fw={600}>{tCommon('appName')}</Text>
          </Group>

          <Group gap="xs" wrap="nowrap" data-no-maximise style={{ '--wails-draggable': 'no-drag' }}>
            <SegmentedControl
              size="xs"
              aria-label={tCommon('appMode.label')}
              value={mode}
              onChange={onChangeMode}
              data={WORKSPACES.map(w => ({ value: w.mode, label: tCommon(w.labelKey) }))}
            />
          </Group>

          <Group gap="xs" wrap="nowrap" ml="auto" data-no-maximise style={{ '--wails-draggable': 'no-drag' }}>
            <ActionIcon tooltip={tSetting('title')} {...tintedColor('gray', 'ai')} onClick={onClickSetting}>
              <Settings />
            </ActionIcon>

            <ActionIcon tooltip={t('title')} {...tintedColor('gray', 'ai')} onClick={onClickHistory}>
              <RotateCcwClock />
            </ActionIcon>

            <WindowControls />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {/* Visited workspaces stay mounted (display: none) so their state, IPC calls and effects survive a mode switch. */}
        {WORKSPACES.map(workspace => {
          const Component = visited.has(workspace.mode) ? getWorkspace(workspace, onLoadFail) : null;
          return Component ? (
            <Box key={workspace.mode} h="100%" display={mode === workspace.mode ? 'block' : 'none'}>
              <Suspense fallback={LOADING_FALLBACK}>
                <Component />
              </Suspense>
            </Box>
          ) : null;
        })}

        {/* A mode leaves `visited` only when its chunk failed to load: offer a retry. */}
        {!visited.has(mode) && (
          <Center h="100%">
            <Button onClick={onClickRetry}>{tCommon('retry')}</Button>
          </Center>
        )}

        <DownloaderWindow />
        <UploaderWindow />
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
