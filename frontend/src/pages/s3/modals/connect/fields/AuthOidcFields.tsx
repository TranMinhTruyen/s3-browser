import { CopyButton, Group, Stack, Text } from '@mantine/core';
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
import { type AuthFieldsProps, DEFAULT_CALLBACK_PORT } from '@/pages/s3/modals/connect/connectSchema';

/** Trạng thái đăng nhập hiển thị cạnh nút; `expiresAt` là thời điểm epoch tính bằng ms. */
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

/** OpenID Connect của MinIO: cấu hình provider và phiên đăng nhập trình duyệt có session id được gửi khi kết nối. */
function AuthOidcFields({ form }: Pick<AuthFieldsProps, 'form'>) {
  const { t } = useTranslation('connectModal');
  const formatError = useFieldError();

  const clientId = form.useWatchValue('authConfig.clientId');
  const issuerUrl = form.useWatchValue('authConfig.issuerUrl');
  const callbackPort = form.useWatchValue('authConfig.callbackPort');

  const [session, setSession] = useState<Session>(NO_SESSION);
  const [controller, setController] = useState<AbortController | null>(null);

  // Kết quả đăng nhập bị hủy sẽ bị bỏ qua nên thao tác hủy tự đặt lại trạng thái.
  const onClickCancelOidc = useCallback(() => {
    controller?.abort();
    setSession(NO_SESSION);
  }, [controller]);

  // Phiên đăng nhập gắn với cấu hình lúc tạo: đổi một trong các thiết lập sẽ xóa phiên hoặc hủy đăng nhập đang chờ.
  const isWaiting = session.status === 'waiting';
  const onChangeSettings = useCallback(() => {
    if (isWaiting) onClickCancelOidc();
    else if (!form.getValues().oidcSessionId) return;
    form.setFieldValue('oidcSessionId', '');
    setSession(NO_SESSION);
  }, [form, isWaiting, onClickCancelOidc]);
  for (const path of SETTINGS_PATHS) form.watch(path, onChangeSettings);

  // Backend quên phiên khi hết hạn: thực hiện tương tự để thao tác kết nối yêu cầu đăng nhập lại.
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

  // Đóng modal (hoặc đổi phương thức) sẽ hủy phiên đăng nhập vẫn đang chờ trình duyệt.
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

    // Kết quả đăng nhập đã hủy nhưng trả về muộn không được ghi đè trạng thái của phiên mới hơn.
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
              <ActionIcon size="sm" onClick={copy} tooltip={copied ? t('form.button.copied') : t('form.button.copy')}>
                {copied ? <Check size="0.875rem" /> : <Copy size="0.875rem" />}
              </ActionIcon>
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
