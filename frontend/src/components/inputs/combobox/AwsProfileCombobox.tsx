import { Stack, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { ListAwsProfiles } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { AwsProfileOutput } from '@wails/S3Browser/models';
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import Combobox from '@/components/inputs/combobox/Combobox';

const FILE_DEBOUNCE_MS = 300;

type AwsProfileComboboxProps = Omit<
  ComponentProps<typeof Combobox>,
  'data' | 'label' | 'searchPlaceholder' | 'emptyText'
> & {
  /** Only list SSO profiles. */
  ssoOnly?: boolean;
  /** Custom AWS CLI files; empty means the standard ones. The list reloads when they change. */
  configFile?: string;
  credentialsFile?: string;
};

/**
 * Dropdown of the profiles found in the AWS CLI config files. Warns when the selected profile runs a
 * `credential_process` command (it only runs on connect, never while listing).
 */
function AwsProfileCombobox(props: AwsProfileComboboxProps) {
  const { ssoOnly, configFile = '', credentialsFile = '', value, defaultValue, onChange, ...rest } = props;
  const { t } = useTranslation('inputs');

  const [profiles, setProfiles] = useState<AwsProfileOutput[]>([]);
  const [current, setCurrent] = useState(value ?? defaultValue ?? '');
  const [debouncedConfigFile] = useDebouncedValue(configFile.trim(), FILE_DEBOUNCE_MS);
  const [debouncedCredentialsFile] = useDebouncedValue(credentialsFile.trim(), FILE_DEBOUNCE_MS);

  useEffect(() => {
    const controller = new AbortController();
    void callIPC(ListAwsProfiles, [debouncedConfigFile, debouncedCredentialsFile], {
      signal: controller.signal,
    }).then(body => {
      if (body) setProfiles(body);
    });
    return () => controller.abort();
  }, [debouncedConfigFile, debouncedCredentialsFile]);

  const data = useMemo(() => {
    const names = profiles.filter(p => !ssoOnly || p.isSso).map(p => p.name);
    // Keep a saved profile that is no longer in the files visible, so the field does not look empty.
    if (current && !names.includes(current)) names.unshift(current);
    return names.map(name => ({ name, value: name }));
  }, [profiles, ssoOnly, current]);

  const onChangeProfile = useCallback(
    (next: string | null) => {
      setCurrent(next ?? '');
      onChange?.(next ?? '');
    },
    [onChange]
  );

  const hasCredentialProcess = profiles.some(p => p.name === current && p.hasCredentialProcess);

  return (
    <Stack gap={4}>
      <Combobox
        {...rest}
        label={t('awsProfileCombobox.label')}
        data={data}
        value={value}
        defaultValue={defaultValue}
        onChange={onChangeProfile}
        searchPlaceholder={t('awsProfileCombobox.searchPlaceholder')}
        emptyText={t('awsProfileCombobox.empty')}
      />
      {hasCredentialProcess ? (
        <Text size="xs" c="orange">
          {t('awsProfileCombobox.credentialProcessWarning')}
        </Text>
      ) : null}
    </Stack>
  );
}

export default AwsProfileCombobox;
