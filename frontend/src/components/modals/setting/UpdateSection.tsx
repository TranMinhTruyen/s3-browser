import { Group, Paper, Stack, Text, Title } from '@mantine/core';
import { Browser } from '@wailsio/runtime';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useUpdateStore } from '@/common/stores/updateStore';
import { tintedColor } from '@/common/theme/tintedColor';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import UpdateProgress from '@/components/display/UpdateProgress';

/** "Update" block of the settings modal: version, manual check, download/install and the release link. */
function UpdateSection() {
  const { t } = useTranslation('settingModal', { keyPrefix: 'update' });
  const { t: tRoot } = useTranslation();

  const { supported, state, currentVersion, version, releaseUrl, written, total, errorCode } = useUpdateStore(
    useShallow(s => ({
      supported: s.supported,
      state: s.state,
      currentVersion: s.currentVersion,
      version: s.version,
      releaseUrl: s.releaseUrl,
      written: s.written,
      total: s.total,
      errorCode: s.errorCode,
    }))
  );
  const check = useUpdateStore(s => s.check);
  const download = useUpdateStore(s => s.download);
  const install = useUpdateStore(s => s.install);

  // The button is only rendered when `releaseUrl` is set.
  const onClickViewRelease = useCallback(() => void Browser.OpenURL(releaseUrl as string), [releaseUrl]);

  if (!supported) return null;

  const busy = state === 'checking' || state === 'downloading';
  // The backend message of the failure (e.g. UPE003); a state without a code gets a general text.
  const status =
    state === 'error' && errorCode
      ? formatStringJson(tRoot(`ipcMessage:update.${errorCode}`), { version })
      : t(`status.${state}`, { version });

  return (
    <Paper withBorder p="8px">
      <Stack gap="xs">
        <Title order={5}>{t('title')}</Title>
        <Text size="sm">{t('currentVersion', { version: currentVersion })}</Text>
        <Text size="sm" c={state === 'error' ? 'var(--mantine-color-error)' : 'dimmed'}>
          {status}
        </Text>
        {state === 'downloading' ? <UpdateProgress written={written} total={total} /> : null}
        <Group gap="xs" wrap="nowrap">
          <Button onClick={check} disabled={busy}>
            {t('check')}
          </Button>
          {state === 'available' ? <Button onClick={download}>{t('download')}</Button> : null}
          {state === 'ready' ? <Button onClick={install}>{t('install')}</Button> : null}
          {releaseUrl ? (
            <Button {...tintedColor('gray', 'button')} onClick={onClickViewRelease}>
              {t('viewRelease')}
            </Button>
          ) : null}
        </Group>
      </Stack>
    </Paper>
  );
}
export default UpdateSection;
