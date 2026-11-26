import { Center, Divider, Group, Modal, Stack, Text, Title, Tooltip } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { CreateProfile, UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import awsLogo from '@/assets/images/aws.svg';
import minioLogo from '@/assets/images/minio.svg';
import { useUnmountSignal } from '@/common/hooks/useUnmountSignal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import SelectInput from '@/components/inputs/SelectInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import { MODAL_CHROME_HEIGHT } from '@/components/modals/modalLayout';
import RegionCombobox from '@/pages/s3/components/RegionCombobox';
import {
  DEFAULT_AUTH_TYPE,
  getAuthMethods,
  isAuthTypeValid,
  isRegionOptional,
} from '@/pages/s3/modals/connect/authMethods';
import {
  type ConnectionInfo,
  type ConnectModalProps,
  connectSchema,
  getDefaultAuthConfig,
  getDefaultConnectionInfo,
  profileSchema,
  toConnectionInput,
  toFormValues,
} from '@/pages/s3/modals/connect/connectSchema';
import AuthAnonymousFields from '@/pages/s3/modals/connect/fields/AuthAnonymousFields';
import AuthAssumeRoleFields from '@/pages/s3/modals/connect/fields/AuthAssumeRoleFields';
import AuthAwsProfileFields from '@/pages/s3/modals/connect/fields/AuthAwsProfileFields';
import AuthCertFields from '@/pages/s3/modals/connect/fields/AuthCertFields';
import AuthLdapFields from '@/pages/s3/modals/connect/fields/AuthLdapFields';
import AuthMinioStsFields from '@/pages/s3/modals/connect/fields/AuthMinioStsFields';
import AuthOidcFields from '@/pages/s3/modals/connect/fields/AuthOidcFields';
import AuthStaticFields from '@/pages/s3/modals/connect/fields/AuthStaticFields';
import CaFileField from '@/pages/s3/modals/connect/fields/CaFileField';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { canAutoConnect, getAuthType, getRequiredSecrets } from '@/pages/s3/utils/authUtils';

/** Các lựa chọn provider của segmented control; dữ liệu tĩnh nên chỉ tạo một lần. */
const PROVIDER_OPTIONS = [
  { logo: awsLogo, label: 'AWS', value: 'aws' },
  { logo: minioLogo, label: 'MinIO', value: 'minio' },
].map(({ logo, label, value }) => ({
  value,
  label: (
    <Center style={{ gap: '1rem' }}>
      <img src={logo} alt="" style={{ width: '1.125rem', height: '1.125rem' }} />
      <span>{label}</span>
    </Center>
  ),
}));

// Chiều cao nội dung tối đa trên màn hình cao, lấy theo phương thức Access key: phương thức ngắn hơn sẽ làm modal
// thu nhỏ vừa nội dung, phương thức dài hơn sẽ có vùng cuộn. Mỗi giới hạn giảm trên màn hình thấp để modal luôn vừa
// khung nhìn. Chế độ tạo/sửa hiện gợi ý dưới các trường (2 dòng chữ cỡ xs cộng khoảng cách Stack, khoảng 43px); chế độ
// kết nối thì không. Nội dung ở chế độ tạo đo được 747px, nên chế độ kết nối là 747 - 43 = 704, cộng thêm khoảng đệm = 710.
const bodyHeight = (px: number) =>
  `min(${px / 16}rem, calc(100dvh - 2 * var(--modal-y-offset) - ${MODAL_CHROME_HEIGHT}))`;
const BODY_HEIGHT_WITH_HINT = bodyHeight(750);
const BODY_HEIGHT_NO_HINT = bodyHeight(710);

/**
 * Modal dùng để kết nối, kiểm tra kết nối hoặc tạo/sửa profile kết nối tùy theo `mode`:
 * - `connect`: kết nối bằng thông tin xác thực đã nhập (chỉ lưu nếu đánh dấu "save password");
 * - `manualconnect`: kết nối bằng profile đã lưu nhưng cần nhập thông tin chưa được lưu (secret key, mã MFA);
 * - `createProfile` / `editProfile`: lưu profile; thông tin bí mật là tùy chọn (để trống sẽ giữ giá trị đã lưu).
 * Trả về `false` khi đóng modal. Tải qua `showConnectModal` (lazy chunk).
 */
export default createMantineModal<ConnectModalProps, false>(
  props => {
    const { mode = 'connect', connectionProfile, mantine } = props;

    const { t } = useTranslation('connectModal');

    const actionRef = useRef<'connect' | 'profile'>('connect');
    // Đóng modal sẽ hủy thao tác kết nối/kiểm tra vẫn đang chạy.
    const getSignal = useUnmountSignal();
    const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);
    // Profile ở lần lưu gần nhất: id, phiên bản và các thông tin bí mật đã được lưu.
    const [profile, setProfile] = useState(connectionProfile);

    // useForm chỉ đọc initialValues khi mount; tính một lần thay vì mỗi khi nhấn phím.
    const [initialValues] = useState(() => {
      const defaultValues = getDefaultConnectionInfo(`Connection No.${createUUID()}`);

      return connectionProfile && (mode === 'manualconnect' || mode === 'editProfile')
        ? toFormValues(defaultValues, connectionProfile)
        : defaultValues;
    });

    const form = useForm<ConnectionInfo>({
      mode: 'uncontrolled',
      initialValues: initialValues,
      validate: values => {
        const resolver = schemaResolver(actionRef.current === 'profile' ? profileSchema : connectSchema, {
          sync: true,
        });
        return resolver(values);
      },
    });

    const savePassword = form.useWatchValue('savePassword');
    const provider = form.useWatchValue('provider');
    const authType = form.useWatchValue('authType');
    const secretKey = form.useWatchValue('secretKey');
    const ldapPassword = form.useWatchValue('authSecret.ldapPassword');
    const sourceType = form.useWatchValue('authConfig.sourceType');
    const mfaSerial = form.useWatchValue('authConfig.mfaSerial');
    const keyEncrypted = form.useWatchValue('authConfig.keyEncrypted');
    const keyPassword = form.useWatchValue('authSecret.keyPassword');

    form.watch('provider', ({ value }) => {
      if (!value) return;
      form.clearErrors(); // errors from the previous provider no longer apply
      form.setFieldValue('pathStyle', value === 'minio');
      if (!isAuthTypeValid(value, form.getValues().authType)) {
        form.setFieldValue('authType', DEFAULT_AUTH_TYPE);
      }
    });

    // Phương thức khác không dùng chung các trường của phương thức cũ (ví dụ profile không phải SSO không được chuyển sang `sso`).
    form.watch('authType', ({ value }) => {
      form.clearErrors(); // errors from the previous method no longer apply
      // CA thuộc về máy chủ MinIO, không phụ thuộc phương thức; giữ nguyên giá trị này.
      const { caFile } = form.getValues().authConfig;
      form.setFieldValue('authConfig', { ...getDefaultAuthConfig(value), caFile });
      form.setFieldValue('mfaCode', '');
      form.setFieldValue('oidcSessionId', '');
      form.setFieldValue('authSecret.keyPassword', '');
    });

    const secretRequired = mode === 'connect' || mode === 'manualconnect';
    // Thông tin bí mật đã lưu chỉ có ý nghĩa với phương thức đã lưu; phương thức khác bắt đầu mà không có chúng.
    const savedSecrets = useMemo(
      () =>
        mode === 'editProfile' && profile && authType === getAuthType(profile) ? (profile.savedSecrets ?? []) : [],
      [mode, profile, authType]
    );

    const authOptions = useMemo(
      () => getAuthMethods(provider).map(type => ({ value: type, label: t(`authType.${type}.label`) })),
      [provider, t]
    );

    // Tự động kết nối cần thông tin bí mật đã lưu và phương thức không yêu cầu nhập thêm (không cần mã MFA).
    const authState = useMemo(
      () => ({ authType, authConfig: { sourceType, mfaSerial, keyEncrypted } }),
      [authType, sourceType, mfaSerial, keyEncrypted]
    );
    const autoConnectLocked = !canAutoConnect(authState);
    const typedSecrets: Record<string, string> = { secretKey, ldapPassword, keyPassword };
    const requiredSecrets = getRequiredSecrets(authState);
    const secretsReady = requiredSecrets.every(name => !!typedSecrets[name] || savedSecrets.includes(name));
    // Chỉ cần lưu thông tin bí mật với phương thức có dùng chúng; các phương thức khác (ẩn danh, SSO...) tự kết nối.
    const autoConnectDisabled = (requiredSecrets.length > 0 && !savePassword) || autoConnectLocked || !secretsReady;

    useEffect(() => {
      if (autoConnectDisabled && form.getValues().autoConnect) form.setFieldValue('autoConnect', false);
    }, [autoConnectDisabled, form]);

    // Xóa region sẽ trả về null; form lưu giá trị chuỗi rỗng.
    const onChangeRegion = useCallback(
      (value: string | null) => form.getInputProps('region').onChange(value ?? ''),
      [form]
    );

    const authFieldsProps = { form, savedSecrets, secretRequired };

    const onSubmitConnect = useCallback(
      async (value: ConnectionInfo, isTestConnection: boolean) => {
        const input = toConnectionInput(value, connectionProfile?.id ?? '', connectionProfile?.version ?? 1);
        const isExistingProfile = mode === 'manualconnect';

        const output = await callIPC(ConnectS3, [input, isTestConnection, isExistingProfile], { signal: getSignal() });

        if (output && output.isConnected && !isTestConnection) {
          if (isExistingProfile && connectionProfile?.id) {
            updateConnectionProfiles(connectionProfile.id, {
              ...connectionProfile,
              isConnected: output.isConnected,
            });
          }
          mantine.handler.hide();
        }
      },
      [connectionProfile, mode, mantine.handler, updateConnectionProfiles, getSignal]
    );

    const onSubmitConnectProfile = useCallback(
      (value: ConnectionInfo) => onSubmitConnect(value, false),
      [onSubmitConnect]
    );

    const onSubmitTestConnection = useCallback(
      (value: ConnectionInfo) => onSubmitConnect(value, true),
      [onSubmitConnect]
    );

    const onSubmitUpdateProfile = useCallback(
      async (value: ConnectionInfo) => {
        const confirmModal = await ConfirmModal.show({
          type: 'info',
          confirmCode: 'C000001',
        });
        if (confirmModal && profile) {
          const input = toConnectionInput(value, profile.id ?? '', profile.version ?? 1, false);
          const output = await callIPC(UpdateProfileById, [input]);
          if (output?.id) {
            setProfile(output);
            form.setValues(toFormValues(getDefaultConnectionInfo(output.name ?? ''), output));
            updateConnectionProfiles(output.id, { ...output });
          }
        }
      },
      [profile, form, updateConnectionProfiles]
    );

    const onSubmitCreateProfile = useCallback(
      async (value: ConnectionInfo) => {
        const input = toConnectionInput(value, createUUID(), 1, false);
        const output = await callIPC(CreateProfile, [input], {
          showMessage: true,
        });
        if (output?.id) {
          updateConnectionProfiles(output.id, { ...output });
          mantine.handler.hide();
        }
      },
      [mantine.handler, updateConnectionProfiles]
    );

    const submitAs = useCallback(
      (action: 'connect' | 'profile', handler: (values: ConnectionInfo) => Promise<void>) => {
        actionRef.current = action;
        form.onSubmit(handler)();
      },
      [form]
    );

    const onSubmitForm = useCallback(
      (event: SyntheticEvent) => {
        event.preventDefault();
        if (mode === 'editProfile') submitAs('profile', onSubmitUpdateProfile);
        else if (mode === 'createProfile') submitAs('profile', onSubmitCreateProfile);
        else submitAs('connect', onSubmitConnectProfile);
      },
      [mode, submitAs, onSubmitUpdateProfile, onSubmitCreateProfile, onSubmitConnectProfile]
    );

    const onClickTestConnection = useCallback(
      () => submitAs('connect', onSubmitTestConnection),
      [submitAs, onSubmitTestConnection]
    );

    return (
      <Modal.Root {...mantine.props} centered size="xl">
        <Modal.Overlay />
        <form onSubmit={onSubmitForm}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="0.5rem"
              mih="0"
              style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
            >
              <Title
                order={4}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {t('title')}
              </Title>
              <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
            </Modal.Header>

            <Divider />

            <Modal.Body
              p="1rem"
              style={{ overflow: 'auto', maxHeight: secretRequired ? BODY_HEIGHT_NO_HINT : BODY_HEIGHT_WITH_HINT }}
            >
              <Stack gap="sm">
                <SegmentedControl
                  data={PROVIDER_OPTIONS}
                  key={form.key('provider')}
                  {...form.getInputProps('provider')}
                />

                <FieldInput
                  type="text"
                  label={t('form.label.name')}
                  placeholder={t('form.label.name')}
                  key={form.key('name')}
                  {...form.getInputProps('name')}
                />

                <FieldInput
                  type="color"
                  label={t('form.label.color')}
                  placeholder={t('form.label.color')}
                  key={form.key('color')}
                  {...form.getInputProps('color')}
                />

                <FieldInput
                  type="text"
                  label={t('form.label.endpoint')}
                  placeholder={t('form.label.endpoint')}
                  withAsterisk={provider === 'minio'}
                  key={form.key('endpoint')}
                  {...form.getInputProps('endpoint')}
                />

                <RegionCombobox
                  withAsterisk={!isRegionOptional(provider, authType)}
                  defaultValue={null}
                  key={form.key('region')}
                  {...form.getInputProps('region')}
                  onChange={onChangeRegion}
                />

                <SelectInput
                  label={t('form.label.authType')}
                  description={t(`authType.${authType}.description`)}
                  data={authOptions}
                  allowDeselect={false}
                  key={form.key('authType')}
                  {...form.getInputProps('authType')}
                />

                {authType === 'static' && <AuthStaticFields {...authFieldsProps} />}
                {authType === 'sharedProfile' && <AuthAwsProfileFields form={form} />}
                {authType === 'sso' && <AuthAwsProfileFields form={form} ssoOnly />}
                {authType === 'assumeRole' && <AuthAssumeRoleFields {...authFieldsProps} />}
                {authType === 'anonymous' && <AuthAnonymousFields form={form} />}
                {authType === 'minioAssumeRole' && <AuthMinioStsFields {...authFieldsProps} />}
                {authType === 'minioLdap' && <AuthLdapFields {...authFieldsProps} />}
                {authType === 'minioOidc' && <AuthOidcFields form={form} />}
                {authType === 'minioCert' && <AuthCertFields {...authFieldsProps} />}
                {provider === 'minio' && <CaFileField form={form} />}

                {secretRequired ? null : (
                  <Text size="xs" c="dimmed">
                    {t('form.hint.testNeedsSecrets')}
                  </Text>
                )}

                <Group justify="space-between">
                  <CheckBoxInput
                    label={t('form.label.pathStyle')}
                    key={form.key('pathStyle')}
                    disabled={provider === 'minio'}
                    {...form.getInputProps('pathStyle', { type: 'checkbox' })}
                  />

                  <CheckBoxInput
                    label={t('form.label.savePassword')}
                    key={form.key('savePassword')}
                    {...form.getInputProps('savePassword', { type: 'checkbox' })}
                  />

                  <Tooltip label={t('form.tooltip.autoConnectLocked')} disabled={!autoConnectLocked}>
                    <div>
                      <CheckBoxInput
                        label={t('form.label.autoConnect')}
                        key={form.key('autoConnect')}
                        disabled={autoConnectDisabled}
                        {...form.getInputProps('autoConnect', { type: 'checkbox' })}
                      />
                    </div>
                  </Tooltip>
                </Group>
              </Stack>
            </Modal.Body>

            <Divider />

            <Group p="0.5rem" justify="space-between" wrap="nowrap">
              <Button type="button" loading={form.submitting} onClick={onClickTestConnection}>
                {t('form.button.testConnection')}
              </Button>

              {mode === 'connect' || mode === 'manualconnect' ? (
                <Button type="submit" loading={form.submitting}>
                  {t('common:button.connect')}
                </Button>
              ) : null}

              {mode === 'createProfile' || mode === 'editProfile' ? (
                <Button type="submit" loading={form.submitting}>
                  {t(`form.button.${mode}`)}
                </Button>
              ) : null}
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
