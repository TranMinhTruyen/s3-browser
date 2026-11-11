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
import SegmentedControl from '@/components/inputs/SegmentedControl';
import WindowControls from '@/components/layouts/window/WindowControls';
import { showHistoryModal, showSettingModal } from '@/components/modals/lazyModals';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import i18n from '@/locales/i18n';
import DownloaderWindow from '@/pages/s3/transfer/downloader/DownloaderWindow';
import UploaderWindow from '@/pages/s3/transfer/uploader/UploaderWindow';

type AppMode = 'S3' | 'SQL';

/** App modes in SegmentedControl order. Each chunk loads on the first visit to its mode. */
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
 * The lazy component of a mode, created once. A failed chunk load shows a toast (the app has no ErrorBoundary),
 * drops the cached component so the next visit loads the chunk again, and calls `onFail` so the caller can unmount it.
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

/** Suspense fallback centered in both directions. */
const LOADING_FALLBACK = (
  <Center h="100%">
    <Loader />
  </Center>
);

/** App shell: header (settings, history), navbar + tab page splitter, and transfer windows. */
function MainLayout() {
  const { t } = useTranslation('historyModal');
  const { t: tSetting } = useTranslation('settingModal');
  const { t: tCommon } = useTranslation('common');

  const [mode, setMode] = useState<AppMode>('S3');
  const [visited, setVisited] = useState<Set<AppMode>>(() => new Set(['S3']));

  const onChangeMode = useCallback((value: string) => {
    const next = value as AppMode;
    setMode(next);
    setVisited(prev => (prev.has(next) ? prev : new Set(prev).add(next)));
  }, []);

  // Un-visit a mode whose chunk failed to load, so selecting it again retries.
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
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group
          h="100%"
          px="sm"
          style={{ backgroundColor: INFO_BG_COLOR, '--wails-draggable': 'drag' }}
          onDoubleClick={onDoubleClickHeader}
        >
          <Group gap="xs" wrap="nowrap">
            <Image src="/favicon.ico" alt="" w={20} h={20} />
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

        <DownloaderWindow />
        <UploaderWindow />
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
