import { Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionInput } from '@wails/S3Browser/models/bucket';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import z from 'zod';
import { useMantineModal } from '@/common/hooks/useMantineModal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createModal } from '@/common/utils/modalUtils';
import { createUUID } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import FieldInput from '@/components/inputs/FieldInput';

const baseSchema = z.object({
  name: z.string().trim(),
  color: z.string().trim(),
  endpoint: z.string().trim().nonempty('V000001'),
  region: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim(), // không bắt buộc
  pathStyle: z.boolean(),
  savePassword: z.boolean(),
  autoConnect: z.boolean(),
});

const connectSchema = baseSchema.extend({
  secretKey: z.string().trim().nonempty('V000001'),
});

export interface ConnectionInfo extends z.infer<typeof connectSchema> {}

interface ConnectModalProps {
  mode?: 'connect' | 'manualconnect' | 'createProfile' | 'editProfile';
  id?: string;
  version?: number;
  connectionInfo?: ConnectionInfo;
}

export default createModal<ConnectModalProps, false>(props => {
  const { mode = 'connect', id, version, connectionInfo } = props;
  const { t } = useTranslation('connectModal');

  const [saveProfile, { toggle: toggleSaveProfile }] = useDisclosure(true);

  const mantineModal = useMantineModal(false);
  const actionRef = useRef<'connect' | 'updateProfile'>('connect');

  const defaultValues = connectSchema
    .default({
      name: `Connection No.${createUUID()}`,
      color: '#d0ebff',
      endpoint: '',
      region: '',
      accessKey: '',
      secretKey: '',
      pathStyle: false,
      savePassword: false,
      autoConnect: false,
    })
    .parse(undefined);

  const form = useForm<ConnectionInfo>({
    mode: 'uncontrolled',
    initialValues: mode === 'connect' ? defaultValues : connectionInfo,
    validate: values => {
      const resolver = schemaResolver(actionRef.current === 'updateProfile' ? baseSchema : connectSchema, {
        sync: true,
      });
      return resolver(values);
    },
  });

  const submitAs = (action: 'connect' | 'updateProfile', handler: (values: ConnectionInfo) => Promise<void>) => () => {
    actionRef.current = action;
    form.onSubmit(handler)();
  };

  const savePassword = form.useWatchValue('savePassword');

  form.watch('savePassword', ({ value }) => {
    if (!value) {
      form.setFieldValue('autoConnect', false);
    }
  });

  const handleConnect = (isTestConnection: boolean) => async (value: ConnectionInfo) => {
    const input: ConnectionInput = {
      id: id ?? '',
      version: version ?? 1,
      ...value,
    };
    const output = await callIPC(ConnectS3, [input, isTestConnection, saveProfile], {
      showMessage: mode === 'connect',
    });
    if (output && output.isConnected && !isTestConnection) {
      mantineModal.handler.hide();
    }
  };

  const handleUpdateProfile = () => async (value: ConnectionInfo) => {
    const input: ConnectionInput = {
      id: id ?? '',
      version: version ?? 1,
      ...value,
    };
    const output = await callIPC(UpdateProfileById, [input]);
    if (output) {
      form.setValues({ ...output });
    }
  };

  const defaultSubmit =
    mode === 'editProfile'
      ? submitAs('updateProfile', handleUpdateProfile())
      : submitAs('connect', handleConnect(false));

  return (
    <Modal.Root {...mantineModal.props} centered size="lg">
      <Modal.Overlay />
      <form onSubmit={defaultSubmit}>
        <Modal.Content>
          <Modal.Header pos="relative" p="16px" mih="0px" style={{ justifyContent: 'flex-end' }}>
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
            <Modal.CloseButton size="md" />
          </Modal.Header>

          <Divider />

          <Modal.Body p="16px">
            <Stack gap="sm">
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
                withAsterisk
                key={form.key('endpoint')}
                {...form.getInputProps('endpoint')}
              />

              <RegionCombobox
                withAsterisk
                defaultValue={null}
                key={form.key('region')}
                {...form.getInputProps('region')}
              />

              <FieldInput
                type="text"
                label={t('form.label.accessKey')}
                placeholder={t('form.label.accessKey')}
                withAsterisk
                key={form.key('accessKey')}
                {...form.getInputProps('accessKey')}
              />

              <FieldInput
                type="password"
                label={t('form.label.secretKey')}
                placeholder={t('form.label.secretKey')}
                withAsterisk={mode === 'connect'}
                key={form.key('secretKey')}
                {...form.getInputProps('secretKey')}
              />

              <Group justify="space-between">
                <CheckBoxInput
                  label={t('form.label.pathStyle')}
                  key={form.key('pathStyle')}
                  {...form.getInputProps('pathStyle', { type: 'checkbox' })}
                />

                <CheckBoxInput
                  label={t('form.label.savePassword')}
                  key={form.key('savePassword')}
                  {...form.getInputProps('savePassword', { type: 'checkbox' })}
                />

                <CheckBoxInput
                  label={t('form.label.autoConnect')}
                  key={form.key('autoConnect')}
                  disabled={!savePassword}
                  {...form.getInputProps('autoConnect', { type: 'checkbox' })}
                />

                {mode === 'connect' && (
                  <CheckBoxInput
                    checked={saveProfile}
                    label={t('label.saveProfileLabel')}
                    onChange={toggleSaveProfile}
                  />
                )}
              </Group>
            </Stack>
          </Modal.Body>

          <Divider />

          <Group p="16px" justify="space-between">
            <Button type="button" loading={form.submitting} onClick={submitAs('connect', handleConnect(true))}>
              {t('form.button.testConnection')}
            </Button>

            {mode === 'connect' && (
              <Button type="submit" loading={form.submitting}>
                {t('form.button.connect')}
              </Button>
            )}

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
});
