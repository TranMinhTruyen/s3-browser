import { Divider, Group, Modal, Paper, Stack, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ExportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { FileDown } from 'lucide-react';
import { SyntheticEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import FieldInput from '@/components/inputs/FieldInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import type { ConnectionProfile } from '@/pages/s3/stores/profileStore';

type ExportProfileModalProps = {
  profile: Pick<ConnectionProfile, 'id' | 'name' | 'savedSecrets'>;
};

type ExportProfileForm = {
  includeSecret: boolean;
  password: string;
  confirmPassword: string;
};

const MIN_PASSWORD_LENGTH = 8;

/**
 * Xuất một profile ra file JSON được chọn trong hộp thoại lưu của hệ thống; có thể xuất kèm thông tin bí mật được mã hóa
 * bằng mật khẩu nhập tại đây (chỉ lưu trong form này). Trả về true khi ghi file xong, false nếu hủy.
 * Hủy hộp thoại lưu sẽ giữ modal mở. Tải qua `showExportProfileModal` (lazy chunk).
 */
export default createMantineModal<ExportProfileModalProps, boolean>(
  props => {
    const { profile, mantine } = props;
    const { t } = useTranslation('exportProfileModal');
    const getSignal = useUnmountSignal();
    const { resolve, hide } = mantine.handler;
    const hasSecret = !!profile.savedSecrets?.length;

    const form = useForm<ExportProfileForm>({
      initialValues: { includeSecret: false, password: '', confirmPassword: '' },
      validate: {
        password: (value, values) => {
          if (!values.includeSecret) return null;
          if (!value) return 'V000001';
          // Đếm code point (không phải đơn vị UTF-16) để khớp với backend, nơi đếm rune.
          return [...value].length < MIN_PASSWORD_LENGTH ? `V000012:${MIN_PASSWORD_LENGTH}` : null;
        },
        confirmPassword: (value, values) => (values.includeSecret && value !== values.password ? 'V000011' : null),
      },
    });

    const onSubmitExport = useCallback(
      async ({ includeSecret, password }: ExportProfileForm) => {
        // Không xuất thông tin bí mật đã lưu trừ khi được đánh dấu: hỏi xác nhận trước; hủy sẽ giữ modal mở.
        if (hasSecret && !includeSecret) {
          const confirmed = await ConfirmModal.show({
            type: 'warning',
            confirmCode: 'C000011',
            params: { name: profile.name },
          });
          if (!confirmed) return;
        }
        const path = await callIPC(
          ExportProfile,
          [{ id: profile.id, includeSecret, password: includeSecret ? password : undefined }],
          { signal: getSignal() }
        );
        // Đường dẫn rỗng nghĩa là đã hủy hộp thoại lưu, null nghĩa là thất bại: cả hai trường hợp đều giữ modal mở.
        if (!path) return;
        resolve(true);
        hide();
      },
      [profile.id, profile.name, hasSecret, getSignal, resolve, hide]
    );

    const onSubmitForm = useCallback(
      (event: SyntheticEvent) => {
        event.preventDefault();
        void form.onSubmit(onSubmitExport)();
      },
      [form, onSubmitExport]
    );

    const onClickCancel = useCallback(() => {
      resolve(false);
      hide();
    }, [resolve, hide]);

    return (
      <Modal.Root
        {...mantine.props}
        closeOnEscape={mantine.props.closeOnEscape && !form.submitting}
        closeOnClickOutside={mantine.props.closeOnClickOutside && !form.submitting}
        centered
        size="md"
      >
        <Modal.Overlay />
        <form onSubmit={onSubmitForm}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="0.5rem"
              mih="0"
              style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
            >
              <Group
                gap="xs"
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              >
                <FileDown />
                <Title order={4}>{t('title')}</Title>
              </Group>
              {form.submitting ? null : (
                <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
              )}
            </Modal.Header>

            <Divider />

            <Modal.Body p="0.5rem">
              <Paper withBorder p="0.5rem">
                <Stack gap="0.5rem">
                  <CheckBoxInput
                    label={t('label.includeSecret')}
                    description={hasSecret ? t('hint.includeSecret') : t('hint.noSavedSecret')}
                    disabled={!hasSecret}
                    {...form.getInputProps('includeSecret', { type: 'checkbox' })}
                  />
                  {form.values.includeSecret ? (
                    <>
                      <FieldInput
                        type="password"
                        label={t('label.password')}
                        autoComplete="off"
                        withAsterisk
                        data-autofocus
                        {...form.getInputProps('password')}
                      />
                      <FieldInput
                        type="password"
                        label={t('label.confirmPassword')}
                        autoComplete="off"
                        withAsterisk
                        {...form.getInputProps('confirmPassword')}
                      />
                    </>
                  ) : null}
                </Stack>
              </Paper>
            </Modal.Body>

            <Divider />

            <Group p="0.5rem" justify="space-between" wrap="nowrap">
              <Button type="button" color="red" onClick={onClickCancel} disabled={form.submitting}>
                {t('common:button.cancel')}
              </Button>
              <Button type="submit" loading={form.submitting}>
                {t('button.export')}
              </Button>
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
