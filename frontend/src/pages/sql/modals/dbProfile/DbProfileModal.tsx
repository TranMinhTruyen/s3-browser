import { Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ChooseDbFile } from '@wails/S3Browser/internal/handlers/dbhandler';
import { FolderOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import SelectInput from '@/components/inputs/SelectInput';
import SwitchInput from '@/components/inputs/SwitchInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import {
  createDbProfileSchema,
  type DbProfileForm,
  getDefaultDbProfileForm,
  SSL_MODES,
  toDbProfileInput,
  toFormValues,
} from '@/pages/sql/modals/dbProfile/dbProfileSchema';
import { type DbProfile, PROVIDER_LABEL_KEY, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';

type DbProfileModalProps = {
  /** Profile cần chỉnh sửa; nếu không có thì modal tạo profile mới. */
  profile?: DbProfile;
};

/**
 * Modal tạo hoặc chỉnh sửa profile database (được backend lưu). Khi profile đang kết nối, khóa đường dẫn file,
 * tùy chọn chỉ đọc và loại DB. Lưu thất bại thì giữ modal mở; khi chỉnh sửa cần xác nhận trước. Trả về `false` khi đóng.
 */
export default createMantineModal<DbProfileModalProps, false>(
  props => {
    const { profile, mantine } = props;
    const { t } = useTranslation('dbProfileModal');
    const saveDbProfile = useDbProfileStore(s => s.saveDbProfile);
    // Cờ trạng thái trực tiếp (prop `profile` chỉ là ảnh chụp): profile có thể kết nối hoặc ngắt kết nối khi modal đang mở.
    const locked = useDbProfileStore(s => !!(profile && s.dbProfiles[profile.id]?.isConnected));

    // useForm chỉ đọc initialValues lúc mount; tính một lần thay vì mỗi lần nhấn phím.
    const [initialValues] = useState(() =>
      profile ? toFormValues(profile) : getDefaultDbProfileForm(`Connection No.${createUUID()}`)
    );

    const form = useForm<DbProfileForm>({
      mode: 'uncontrolled',
      initialValues,
      validate: values => {
        // Có profile khác trùng tên (không phân biệt hoa thường và khoảng trắng đầu/cuối); bỏ qua profile đang chỉnh sửa.
        const isNameTaken = (name: string) =>
          Object.values(useDbProfileStore.getState().dbProfiles).some(
            p => p && p.id !== profile?.id && p.name.trim().toLowerCase() === name.trim().toLowerCase()
          );
        return schemaResolver(createDbProfileSchema(isNameTaken), { sync: true })(values);
      },
    });

    const provider = form.useWatchValue('provider');

    form.watch('provider', () => form.clearErrors()); // errors of the other DB type no longer apply

    const providerOptions = useMemo(
      () => [
        { value: 'postgres', label: t(`form.dbType.${PROVIDER_LABEL_KEY.postgres}`) },
        { value: 'sqlite', label: t(`form.dbType.${PROVIDER_LABEL_KEY.sqlite}`) },
      ],
      [t]
    );

    // Khi chỉnh sửa, chỉ giữ mật khẩu đã lưu nếu provider không thay đổi.
    const showKeepPassword = !!profile?.hasSecret && provider === profile.provider;

    const sslOptions = useMemo(() => SSL_MODES.map(value => ({ value, label: t(`form.sslMode.${value}`) })), [t]);

    const onSubmitProfile = useCallback(
      async (values: DbProfileForm) => {
        if (profile && !(await ConfirmModal.show({ type: 'info', confirmCode: 'C000001' }))) return;
        const input = toDbProfileInput(values, profile?.id);
        if (!(await saveDbProfile(input, !!profile))) return;
        toast.success(t(profile ? 'toast.updated' : 'toast.created', { name: input.name }));
        mantine.handler.hide();
      },
      [profile, saveDbProfile, t, mantine.handler]
    );

    const onClickChooseFile = useCallback(async () => {
      const path = await callIPC(ChooseDbFile, []);
      if (path) form.setFieldValue('filePath', path); // empty = dialog canceled
    }, [form]);

    return (
      <Modal.Root {...mantine.props} centered size="lg">
        <Modal.Overlay />
        <form onSubmit={form.onSubmit(onSubmitProfile)}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="0.5rem"
              mih="0"
              style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
            >
              <Title
                order={4}
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              >
                {t(profile ? 'title.edit' : 'title.create')}
              </Title>
              <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
            </Modal.Header>

            <Divider />

            <Modal.Body p="1rem">
              <Paper withBorder p="md">
                <Stack gap="sm">
                  {locked && provider === 'sqlite' && (
                    <Text size="sm" c="dimmed">
                      {t('form.description.disconnectToEdit')}
                    </Text>
                  )}

                  <SegmentedControl
                    data={providerOptions}
                    aria-label={t('form.label.dbType')}
                    disabled={locked}
                    key={form.key('provider')}
                    {...form.getInputProps('provider')}
                  />

                  <FieldInput
                    type="text"
                    label={t('form.label.name')}
                    placeholder={t('form.label.name')}
                    withAsterisk
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

                  {provider === 'postgres' ? (
                    <>
                      <FieldInput
                        type="text"
                        label={t('form.label.host')}
                        placeholder={t('form.label.host')}
                        withAsterisk
                        key={form.key('host')}
                        {...form.getInputProps('host')}
                      />

                      <FieldInput
                        type="number"
                        label={t('form.label.port')}
                        placeholder={t('form.label.port')}
                        withAsterisk
                        hideControls
                        allowDecimal={false}
                        allowNegative={false}
                        key={form.key('port')}
                        {...form.getInputProps('port')}
                      />

                      <FieldInput
                        type="text"
                        label={t('form.label.database')}
                        placeholder={t('form.label.database')}
                        withAsterisk
                        key={form.key('database')}
                        {...form.getInputProps('database')}
                      />

                      <FieldInput
                        type="text"
                        label={t('form.label.username')}
                        placeholder={t('form.label.username')}
                        withAsterisk
                        key={form.key('username')}
                        {...form.getInputProps('username')}
                      />

                      <FieldInput
                        type="password"
                        label={t('form.label.password')}
                        placeholder={t('form.label.password')}
                        description={showKeepPassword ? t('form.description.keepPassword') : undefined}
                        key={form.key('password')}
                        {...form.getInputProps('password')}
                      />

                      <SelectInput
                        label={t('form.label.sslMode')}
                        data={sslOptions}
                        allowDeselect={false}
                        key={form.key('sslMode')}
                        {...form.getInputProps('sslMode')}
                      />
                    </>
                  ) : (
                    <>
                      <FieldInput
                        type="text"
                        label={t('form.label.filePath')}
                        placeholder={t('form.label.filePath')}
                        withAsterisk
                        disabled={locked}
                        rightSection={
                          <ActionIcon
                            variant="subtle"
                            disabled={locked}
                            onClick={onClickChooseFile}
                            tooltip={t('form.tooltip.chooseFile')}
                          >
                            <FolderOpen size="1rem" />
                          </ActionIcon>
                        }
                        key={form.key('filePath')}
                        {...form.getInputProps('filePath')}
                      />
                      <SwitchInput
                        label={t('form.label.readOnly')}
                        description={t('form.description.readOnly')}
                        disabled={locked}
                        key={form.key('readOnly')}
                        {...form.getInputProps('readOnly', { type: 'checkbox' })}
                      />
                    </>
                  )}
                </Stack>
              </Paper>
            </Modal.Body>

            <Divider />

            <Group p="0.5rem" justify="space-between" wrap="nowrap">
              <Button type="button" color="red" onClick={mantine.props.onClose} disabled={form.submitting}>
                {t('common:button.cancel')}
              </Button>
              <Button type="submit" loading={form.submitting}>
                {t(profile ? 'form.button.edit' : 'form.button.create')}
              </Button>
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
