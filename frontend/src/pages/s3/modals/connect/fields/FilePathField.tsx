import { Group } from '@mantine/core';
import { ChooseAuthFile } from '@wails/S3Browser/internal/handlers/buckethandler';
import { X } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import FieldInput from '@/components/inputs/FieldInput';
import type { AuthFieldsProps } from '@/pages/s3/modals/connect/connectSchema';

type FilePathFieldProps = Pick<AuthFieldsProps, 'form'> & {
  name: 'authConfig.certFile' | 'authConfig.keyFile' | 'authConfig.caFile';
  /** Which file the backend dialog asks for. */
  kind: 'cert' | 'key' | 'ca';
  label: string;
  placeholder: string;
  description?: string;
  withAsterisk?: boolean;
  /** Shows a button that empties the path. */
  clearable?: boolean;
};

/** Read-only path of a file picked with the backend dialog (only the path is kept, never the content). */
function FilePathField({
  form,
  name,
  kind,
  label,
  placeholder,
  description,
  withAsterisk,
  clearable,
}: FilePathFieldProps) {
  const { t } = useTranslation('connectModal');
  const getSignal = useUnmountSignal();
  const path = form.useWatchValue(name);

  const onClickChooseFile = useCallback(async () => {
    const chosen = await callIPC(ChooseAuthFile, [kind], { signal: getSignal() });
    // Empty means the user canceled the dialog: keep the current path.
    if (chosen) form.setFieldValue(name, chosen);
  }, [kind, name, form, getSignal]);

  const onClickClearFile = useCallback(() => form.setFieldValue(name, ''), [name, form]);

  return (
    <Group align="flex-end" wrap="nowrap" gap="xs">
      <FieldInput
        type="text"
        label={label}
        placeholder={placeholder}
        description={description}
        withAsterisk={withAsterisk}
        readOnly
        style={{ flex: 1, minWidth: 0 }}
        key={form.key(name)}
        {...form.getInputProps(name)}
      />

      {clearable ? (
        <ActionIcon
          size="lg"
          color="red"
          disabled={!path}
          tooltip={t('form.button.clearFile')}
          onClick={onClickClearFile}
        >
          <X size="1rem" />
        </ActionIcon>
      ) : null}

      <Button onClick={onClickChooseFile}>{t('form.button.chooseFile')}</Button>
    </Group>
  );
}

export default FilePathField;
