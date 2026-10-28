import { AppShell, Group, SegmentedControl, Splitter, Tooltip } from '@mantine/core';
import { RotateCcwClock } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import ActionIcon from '@/components/buttons/ActionIcon';
import DownloaderWindow from '@/components/layouts/downloader/DownloaderWindow';
import LeftNavbar from '@/components/layouts/navbar/LeftNavbar';
import UploaderWindow from '@/components/layouts/uploader/UploaderWindow';
import { showHistoryModal } from '@/components/modals/lazyModals';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import i18n from '@/locales/i18n';

type Language = 'en' | 'ja' | 'vi';

const LANGUAGE_OPTIONS: { label: string; value: Language }[] = [
  { label: 'EN', value: 'en' },
  { label: 'VI', value: 'vi' },
  { label: 'JA', value: 'ja' },
];

/** App shell: header (history, language), navbar + routed page splitter, and transfer windows. */
function MainLayout() {
  const { t } = useTranslation('historyModal');

  const onClickHistory = useCallback(() => {
    showHistoryModal();
  }, []);

  const onChangeLanguage = useCallback((value: Language) => {
    i18n.changeLanguage(value);
  }, []);

  return (
    <AppShell header={{ height: '48px' }} styles={{ main: { height: '100vh' } }}>
      <AppShell.Header>
        <Group h="100%" px="sm" style={{ backgroundColor: INFO_BG_COLOR }}>
          <Group gap="xs"></Group>
          <Group ml="auto">
            <Tooltip label={t('title')}>
              <ActionIcon aria-label={t('title')} color="gray" onClick={onClickHistory}>
                <RotateCcwClock />
              </ActionIcon>
            </Tooltip>

            <SegmentedControl<Language>
              defaultValue="en"
              onChange={onChangeLanguage}
              style={{ height: '35px' }}
              data={LANGUAGE_OPTIONS}
            />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Splitter h="100%">
          <Splitter.Pane defaultSize="18%" min="18%" p={'4px 4px 4px 4px'}>
            <LeftNavbar />
          </Splitter.Pane>
          <Splitter.Pane defaultSize="85%" min="50%" p={'4px 4px 4px 4px'}>
            <Outlet />
          </Splitter.Pane>
        </Splitter>

        <DownloaderWindow />
        <UploaderWindow />
      </AppShell.Main>
    </AppShell>
  );
}

export default MainLayout;
