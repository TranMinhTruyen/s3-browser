import { Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ReauthConnection } from '@wails/S3Browser/internal/handlers/buckethandler';
import type { ConnectionProfileInput } from '@wails/S3Browser/models';
import { SyntheticEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import { WARNING_BG_COLOR } from '@/components/modals/modalColors';
import { MODAL_CHROME_HEIGHT } from '@/components/modals/modalLayout';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { getRequiredSecrets } from '@/pages/s3/utils/authUtils';

type MfaCodeModalProps = {
  connectionId: string;
  profileName: string;
};

type MfaCodeForm = {
  mfaCode: string;
  secretKey: string;
};

// Scrolls instead of leaving the viewport on short screens.
const BODY_MAX_HEIGHT = `calc(100dvh - 2 * var(--modal-y-offset) - ${MODAL_CHROME_HEIGHT})`;

/**
 * Asks for a new MFA code (and the secret key when the profile does not store it) to renew the credentials of a
 * connected `assumeRole` profile that is about to expire. Resolves true when the connection was renewed.
 * Load it through `showMfaCodeModal` (lazy chunk).
 */
export default createMantineModal<MfaCodeModalProps, boolean>(
  props => {
    const { connectionId, profileName, mantine } = props;
    const { t } = useTranslation('credentialExpiring');
    const getSignal = useUnmountSignal();
    const { resolve, hide } = mantine.handler;

    const profile = useProfileStore(s => s.connectionProfiles[connectionId]);
    // The secret key is never kept in memory: ask for it again unless the profile stores it.
    const needsSecretKey =
      !!profile && getRequiredSecrets(profile).includes('secretKey') && !profile.savedSecrets?.includes('secretKey');

    const form = useForm<MfaCodeForm>({
      mode: 'uncontrolled',
      initialValues: { mfaCode: '', secretKey: '' },
      validate: {
        mfaCode: value => (value.trim() ? null : 'V000001'),
        secretKey: value => (needsSecretKey && !value ? 'V000001' : null),
      },
    });

    const onSubmitReauth = useCallback(
      async (values: MfaCodeForm) => {
        const input: ConnectionProfileInput = {
          mfaCode: values.mfaCode.trim(),
          secretKey: needsSecretKey ? values.secretKey : undefined,
          authConfig: {},
          authSecret: {},
        };
        const output = await callIPC(ReauthConnection, [connectionId, input], { signal: getSignal() });
        if (output?.isConnected) {
          resolve(true);
          hide();
        }
      },
      [connectionId, needsSecretKey, getSignal, resolve, hide]
    );

    const onSubmitForm = useCallback(
      (event: SyntheticEvent) => {
        event.preventDefault();
        form.onSubmit(onSubmitReauth)();
      },
      [form, onSubmitReauth]
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
              style={{ justifyContent: 'flex-end', backgroundColor: WARNING_BG_COLOR }}
            >
              <Title
                order={4}
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              >
                {t('mfa.title')}
              </Title>
              <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
            </Modal.Header>

            <Divider />

            <Modal.Body p="16px" style={{ overflow: 'auto', maxHeight: BODY_MAX_HEIGHT }}>
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Text size="sm">{formatStringJson(t('ipcMessage:bucket.S3W010'), { name: profileName })}</Text>

                  <FieldInput
                    type="text"
                    label={t('mfa.label.mfaCode')}
                    placeholder={t('mfa.hint.mfaCode')}
                    autoComplete="off"
                    inputMode="numeric"
                    withAsterisk
                    data-autofocus
                    key={form.key('mfaCode')}
                    {...form.getInputProps('mfaCode')}
                  />

                  {needsSecretKey ? (
                    <FieldInput
                      type="password"
                      label={t('mfa.label.secretKey')}
                      placeholder={t('mfa.label.secretKey')}
                      autoComplete="off"
                      withAsterisk
                      key={form.key('secretKey')}
                      {...form.getInputProps('secretKey')}
                    />
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
                {t('mfa.button.renew')}
              </Button>
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
