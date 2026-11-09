import { Divider, Group, Modal, Paper, Stack, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ExportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { FileDown } from 'lucide-react';
import { SyntheticEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import type { ConnectionProfile } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import FieldInput from '@/components/inputs/FieldInput';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

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
 * Exports one profile to a JSON file chosen in the native save dialog; secrets are optional and encrypted with
 * the password typed here (kept only in this form). Resolves true once the file is written, false if canceled.
 * Canceling the save dialog keeps the modal open. Load it through `showExportProfileModal` (lazy chunk).
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
          // Count code points (not UTF-16 units) to match the backend, which counts runes.
          return [...value].length < MIN_PASSWORD_LENGTH ? `V000012:${MIN_PASSWORD_LENGTH}` : null;
        },
        confirmPassword: (value, values) => (values.includeSecret && value !== values.password ? 'V000011' : null),
      },
    });

    const onSubmitExport = useCallback(
      async ({ includeSecret, password }: ExportProfileForm) => {
        const path = await callIPC(
          ExportProfile,
          [{ id: profile.id, includeSecret, password: includeSecret ? password : undefined }],
          { signal: getSignal() }
        );
        // Empty path = the save dialog was canceled, null = failed: keep the modal open in both cases.
        if (!path) return;
        resolve(true);
        hide();
      },
      [profile.id, getSignal, resolve, hide]
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
      <Modal.Root {...mantine.props} centered size="md">
        <Modal.Overlay />
        <form onSubmit={onSubmitForm}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="8px"
              mih="0px"
              style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
            >
              <Group
                gap="xs"
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              >
                <FileDown />
                <Title order={4}>{t('title')}</Title>
              </Group>
              <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
            </Modal.Header>

            <Divider />

            <Modal.Body p="8px">
              <Paper withBorder p="8px">
                <Stack gap="8px">
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

            <Group p="8px" justify="space-between" wrap="nowrap">
              <Button type="button" color="red" onClick={onClickCancel}>
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
