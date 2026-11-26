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
  /** Loại file mà hộp thoại backend yêu cầu chọn. */
  kind: 'cert' | 'key' | 'ca';
  label: string;
  placeholder: string;
  description?: string;
  withAsterisk?: boolean;
  /** Hiện nút xóa đường dẫn. */
  clearable?: boolean;
};

/** Đường dẫn chỉ đọc của file chọn bằng hộp thoại backend (chỉ giữ đường dẫn, không đọc nội dung file). */
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
    // Giá trị rỗng nghĩa là người dùng hủy hộp thoại: giữ nguyên đường dẫn hiện tại.
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
