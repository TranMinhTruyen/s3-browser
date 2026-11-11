import { Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ImportProfile } from '@wails/S3Browser/internal/handlers/profilehandler';
import { FileUp } from 'lucide-react';
import { SyntheticEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import type { ConnectionProfile } from '@/pages/s3/stores/profileStore';

type ImportPasswordModalProps = {
  path: string;
  name: string;
};

type ImportPasswordForm = {
  password: string;
};

const MIN_PASSWORD_LENGTH = 8;

/**
 * Asks for the password of an encrypted profile file and imports it (the password lives only in this form).
 * Resolves the imported profile, or null if canceled. A wrong password keeps the modal open to retry.
 * Load it through `showImportPasswordModal` (lazy chunk).
 */
export default createMantineModal<ImportPasswordModalProps, ConnectionProfile | null>(
  props => {
    const { path, name, mantine } = props;
    const { t } = useTranslation('importPasswordModal');
    const getSignal = useUnmountSignal();
    const { resolve, hide } = mantine.handler;

    const form = useForm<ImportPasswordForm>({
      initialValues: { password: '' },
      validate: {
        password: value => {
          if (!value) return 'V000001';
          // Count code points (not UTF-16 units) to match the backend, which counts runes.
          return [...value].length < MIN_PASSWORD_LENGTH ? `V000012:${MIN_PASSWORD_LENGTH}` : null;
        },
      },
    });

    const onSubmitImport = useCallback(
      async ({ password }: ImportPasswordForm) => {
        const profile = await callIPC(ImportProfile, [{ path, password }], { signal: getSignal() });
        if (!profile) return;
        resolve(profile);
        hide();
      },
      [path, getSignal, resolve, hide]
    );

    const onSubmitForm = useCallback(
      (event: SyntheticEvent) => {
        event.preventDefault();
        void form.onSubmit(onSubmitImport)();
      },
      [form, onSubmitImport]
    );

    const onClickCancel = useCallback(() => {
      resolve(null);
      hide();
    }, [resolve, hide]);

    return (
      <Modal.Root
        {...mantine.props}
        centered
        size="md"
        closeOnEscape={!form.submitting}
        closeOnClickOutside={!form.submitting}
      >
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
                <FileUp />
                <Title order={4}>{t('title')}</Title>
              </Group>
              <CloseButton
                tooltip={t('common:button.close')}
                onClick={mantine.props.onClose}
                disabled={form.submitting}
              />
            </Modal.Header>

            <Divider />

            <Modal.Body p="8px">
              <Paper withBorder p="8px">
                <Stack gap="8px">
                  <Text size="sm">{t('description', { name })}</Text>
                  <FieldInput
                    type="password"
                    label={t('label.password')}
                    autoComplete="off"
                    withAsterisk
                    data-autofocus
                    {...form.getInputProps('password')}
                  />
                </Stack>
              </Paper>
            </Modal.Body>

            <Divider />

            <Group p="8px" justify="space-between" wrap="nowrap">
              <Button type="button" color="red" onClick={onClickCancel} disabled={form.submitting}>
                {t('common:button.cancel')}
              </Button>
              <Button type="submit" loading={form.submitting}>
                {t('button.import')}
              </Button>
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: null }
);
