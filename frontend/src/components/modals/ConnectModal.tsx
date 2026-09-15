import { Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { CreateProfile, UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionInput } from '@wails/S3Browser/models/bucket';
import { SyntheticEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import z from 'zod';
import { useNavBarStore } from '@/common/stores/navBarStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID, isNullOrEmpty } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import FieldInput from '@/components/inputs/FieldInput';
import ConfirmModal from '@/components/modals/ConfirmModal';

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

type ConnectModalProps = {
  mode?: 'connect' | 'manualconnect' | 'createProfile' | 'editProfile';
  id?: string;
  version?: number;
  connectionInfo?: ConnectionInfo;
};

export default createMantineModal<ConnectModalProps, false>(
  props => {
    const { mode = 'connect', id, version, connectionInfo, mantine } = props;
    const { t } = useTranslation('connectModal');

    const [saveProfile, { toggle: toggleSaveProfile }] = useDisclosure(true);

    const actionRef = useRef<'connect' | 'profile'>('connect');
    const updateConnectionProfiles = useNavBarStore(s => s.updateConnectionProfiles);

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
      initialValues: mode === 'connect' || mode === 'createProfile' ? defaultValues : connectionInfo,
      validate: values => {
        const resolver = schemaResolver(actionRef.current === 'profile' ? baseSchema : connectSchema, {
          sync: true,
        });
        return resolver(values);
      },
    });

    const savePassword = form.useWatchValue('savePassword');
    const secretKey = form.useWatchValue('secretKey');

    form.watch('savePassword', ({ value }) => {
      if (!value) {
        form.setFieldValue('autoConnect', false);
      }
    });

    const handleConnect =
      (isTestConnection: boolean = false) =>
      async (value: ConnectionInfo) => {
        const input: ConnectionInput = {
          id: id ?? '',
          version: version ?? 1,
          ...value,
        };
        const output = await callIPC(ConnectS3, [input, isTestConnection, saveProfile], {
          showMessage: mode === 'connect',
        });
        if (output && output.isConnected && !isTestConnection) {
          mantine.handler.hide();
        }
      };

    const handleUpdateProfile = () => async (value: ConnectionInfo) => {
      const confirmModal = await ConfirmModal.show({
        type: 'info',
        confirmCode: 'CFPF000001',
      });
      if (confirmModal) {
        const input: ConnectionInput = {
          id: id ?? '',
          version: version ?? 1,
          ...value,
        };
        const output = await callIPC(UpdateProfileById, [input]);
        if (output) {
          form.setValues({ ...output });
          updateConnectionProfiles(output.id, { ...output });
        }
      }
    };

    const handleCreateProfile = () => async (value: ConnectionInfo) => {
      const input: ConnectionInput = {
        id: createUUID(),
        version: 1,
        ...value,
      };
      const output = await callIPC(CreateProfile, [input], {
        showMessage: true,
      });
      if (output) {
        updateConnectionProfiles(output.id, { ...output });
        mantine.handler.hide();
      }
    };

    const submitAs =
      (action: 'connect' | 'profile', handler: (values: ConnectionInfo) => Promise<void>) =>
      (event?: SyntheticEvent) => {
        event?.preventDefault();
        actionRef.current = action;
        form.onSubmit(handler)();
      };

    const defaultSubmit =
      mode === 'editProfile' || mode === 'createProfile'
        ? submitAs('profile', mode === 'editProfile' ? handleUpdateProfile() : handleCreateProfile())
        : submitAs('connect', handleConnect());

    return (
      <Modal.Root {...mantine.props} centered size="lg">
        <Modal.Overlay />
        <form onSubmit={defaultSubmit}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="16px"
              mih="0px"
              style={{ justifyContent: 'flex-end', backgroundColor: '#d0ebff' }}
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
                    disabled={!savePassword || isNullOrEmpty(secretKey)}
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
  },
  { cancelValue: false }
);
