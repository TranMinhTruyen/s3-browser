import { CopyButton, Group, Stack, Text, Tooltip } from '@mantine/core';
import { LoginMinioOidc } from '@wails/S3Browser/internal/handlers/buckethandler';
import dayjs from 'dayjs';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldError } from '@/common/hooks/useFieldError';
import { callIPC } from '@/common/utils/ipcUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import FieldInput from '@/components/inputs/FieldInput';
import { type AuthFieldsProps, DEFAULT_CALLBACK_PORT } from '@/components/modals/connect/connectSchema';

/** Sign-in state shown next to the button; `expiresAt` is an epoch in ms. */
type Session = { status: 'none' | 'waiting' | 'expired' } | { status: 'signedIn'; expiresAt: number };

const NO_SESSION: Session = { status: 'none' };

const SETTINGS_PATHS = [
  'authConfig.clientId',
  'authConfig.issuerUrl',
  'authConfig.scope',
  'authConfig.roleArn',
  'authConfig.callbackPort',
] as const;

const STATUS_KEYS = { none: 'oidcNotSignedIn', waiting: 'oidcWaiting', expired: 'oidcExpired' } as const;

/** MinIO OpenID Connect: provider settings and the browser sign-in whose session id the connect sends. */
function AuthOidcFields({ form }: Pick<AuthFieldsProps, 'form'>) {
  const { t } = useTranslation('connectModal');
  const formatError = useFieldError();

  const clientId = form.useWatchValue('authConfig.clientId');
  const issuerUrl = form.useWatchValue('authConfig.issuerUrl');
  const callbackPort = form.useWatchValue('authConfig.callbackPort');

  const [session, setSession] = useState<Session>(NO_SESSION);
  const [controller, setController] = useState<AbortController | null>(null);

  // The aborted sign-in's result is ignored, so the cancel resets the status itself.
  const onClickCancelOidc = useCallback(() => {
    controller?.abort();
    setSession(NO_SESSION);
  }, [controller]);

  // A sign-in belongs to the settings it was made with: changing one of them drops it, or cancels a pending one.
  const isWaiting = session.status === 'waiting';
  const onChangeSettings = useCallback(() => {
    if (isWaiting) onClickCancelOidc();
    else if (!form.getValues().oidcSessionId) return;
    form.setFieldValue('oidcSessionId', '');
    setSession(NO_SESSION);
  }, [form, isWaiting, onClickCancelOidc]);
  for (const path of SETTINGS_PATHS) form.watch(path, onChangeSettings);

  // The backend forgets the session when it expires: do the same, so the connect asks to sign in again.
  const expiresAt = session.status === 'signedIn' ? session.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setTimeout(
      () => {
        form.setFieldValue('oidcSessionId', '');
        setSession({ status: 'expired' });
      },
      Math.max(expiresAt - Date.now(), 0)
    );
    return () => clearTimeout(timer);
  }, [expiresAt, form]);

  // Closing the modal (or leaving the method) cancels a sign-in that still waits for the browser.
  useEffect(() => () => controller?.abort(), [controller]);

  const onClickLoginOidc = useCallback(async () => {
    const controller = new AbortController();
    setController(controller);
    setSession({ status: 'waiting' });

    const config = form.getValues().authConfig;
    const output = await callIPC(
      LoginMinioOidc,
      [
        {
          clientId: config.clientId.trim(),
          issuerUrl: config.issuerUrl.trim(),
          scope: config.scope.trim(),
          roleArn: config.roleArn.trim(),
          callbackPort: typeof config.callbackPort === 'number' ? config.callbackPort : undefined,
        },
      ],
      { signal: controller.signal }
    );

    // A canceled sign-in settling late must not overwrite the state of a newer one.
    if (controller.signal.aborted) return;

    if (output?.sessionId) {
      form.setFieldValue('oidcSessionId', output.sessionId);
      form.clearFieldError('oidcSessionId');
      setSession({ status: 'signedIn', expiresAt: dayjs(output.expiresAt).valueOf() });
    } else {
      setSession(NO_SESSION);
    }
  }, [form]);

  const redirectUri = `http://127.0.0.1:${callbackPort || DEFAULT_CALLBACK_PORT}/callback`;
  const error = formatError(form.errors.oidcSessionId, t('form.label.oidcSession'));
  const status =
    session.status === 'signedIn'
      ? t('form.status.oidcSignedIn', { time: dayjs(session.expiresAt).format('HH:mm') })
      : t(`form.status.${STATUS_KEYS[session.status]}`);

  return (
    <>
      <FieldInput
        type="text"
        label={t('form.label.clientId')}
        placeholder={t('form.label.clientId')}
        autoComplete="off"
        withAsterisk
        key={form.key('authConfig.clientId')}
        {...form.getInputProps('authConfig.clientId')}
      />

      <FieldInput
        type="text"
        label={t('form.label.issuerUrl')}
        placeholder={t('form.placeholder.issuerUrl')}
        autoComplete="off"
        withAsterisk
        key={form.key('authConfig.issuerUrl')}
        {...form.getInputProps('authConfig.issuerUrl')}
      />

      <FieldInput
        type="text"
        label={t('form.label.scope')}
        placeholder={t('form.placeholder.scope')}
        autoComplete="off"
        key={form.key('authConfig.scope')}
        {...form.getInputProps('authConfig.scope')}
      />

      <FieldInput
        type="text"
        label={t('form.label.roleArnOptional')}
        placeholder={t('form.label.roleArnOptional')}
        autoComplete="off"
        key={form.key('authConfig.roleArn')}
        {...form.getInputProps('authConfig.roleArn')}
      />

      <FieldInput
        type="number"
        label={t('form.label.callbackPort')}
        min={1024}
        max={65535}
        allowDecimal={false}
        key={form.key('authConfig.callbackPort')}
        {...form.getInputProps('authConfig.callbackPort')}
      />

      <FieldInput
        type="text"
        label={t('form.label.redirectUri')}
        description={t('form.hint.redirectUri')}
        value={redirectUri}
        readOnly
        rightSection={
          <CopyButton value={redirectUri}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? t('form.button.copied') : t('form.button.copy')}>
                <ActionIcon size="sm" onClick={copy} aria-label={t('form.button.copy')}>
                  {copied ? <Check size="14px" /> : <Copy size="14px" />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        }
      />

      <Stack gap="xs">
        <Group wrap="nowrap" justify="space-between">
          <Text size="sm" c={session.status === 'signedIn' ? undefined : 'dimmed'}>
            {status}
          </Text>

          {session.status === 'waiting' ? (
            <Button key="oidc-cancel" color="red" onClick={onClickCancelOidc}>
              {t('form.button.oidcCancel')}
            </Button>
          ) : (
            <Button key="oidc-login" disabled={!clientId.trim() || !issuerUrl.trim()} onClick={onClickLoginOidc}>
              {t('form.button.oidcLogin')}
            </Button>
          )}
        </Group>

        <Text size="xs" c="dimmed">
          {t('form.hint.oidcLogin')}
        </Text>

        {error ? (
          <Text size="xs" c="var(--mantine-color-error)">
            {error}
          </Text>
        ) : null}
      </Stack>
    </>
  );
}

export default AuthOidcFields;
