import { Center, Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { CreateProfile, UpdateProfileById } from '@wails/S3Browser/internal/handlers/profilehandler';
import { ConnectionProfileInput, ConnectionProfileOutput } from '@wails/S3Browser/models';
import { SyntheticEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import z from 'zod';
import awsLogo from '@/assets/images/aws.svg';
import minioLogo from '@/assets/images/minio.svg';
import { useProfileStore } from '@/common/stores/profileStore';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID, isNullOrEmpty } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import ConfirmModal from '@/components/modals/ConfirmModal';

const baseSchema = z.object({
  name: z.string().trim(),
  color: z.string().trim(),
  provider: z.string().trim(),
  endpoint: z.string().trim().nonempty('V000001'),
  region: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim(),
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
  connectionProfile?: ConnectionProfileOutput;
};

export default createMantineModal<ConnectModalProps, false>(
  props => {
    const { mode = 'connect', connectionProfile, mantine } = props;

    const { t } = useTranslation('connectModal');

    const actionRef = useRef<'connect' | 'profile'>('connect');
    const updateConnectionProfiles = useProfileStore(s => s.updateConnectionProfiles);

    // useForm only reads initialValues on mount; compute them once instead of on every keystroke.
    const [initialValues] = useState(() => {
      const defaultValues = connectSchema
        .default({
          name: `Connection No.${createUUID()}`,
          color: '#d0ebff',
          provider: 'aws',
          endpoint: '',
          region: '',
          accessKey: '',
          secretKey: '',
          pathStyle: false,
          savePassword: false,
          autoConnect: false,
        })
        .parse(undefined);

      return mode === 'connect' || mode === 'createProfile'
        ? defaultValues
        : { ...defaultValues, ...connectionProfile, savePassword: connectionProfile?.secretKey ? true : false };
    });

    const form = useForm<ConnectionInfo>({
      mode: 'uncontrolled',
      initialValues: initialValues,
      validate: values => {
        const resolver = schemaResolver(actionRef.current === 'profile' ? baseSchema : connectSchema, {
          sync: true,
        });
        return resolver(values);
      },
    });

    const savePassword = form.useWatchValue('savePassword');
    const provider = form.useWatchValue('provider');
    const secretKey = form.useWatchValue('secretKey');

    form.watch('savePassword', ({ value }) => {
      if (!value) {
        form.setFieldValue('autoConnect', false);
      }
    });

    form.watch('provider', ({ value }) => {
      if (value) {
        form.setFieldValue('pathStyle', value === 'minio');
      }
    });

    const handleConnect =
      (isTestConnection: boolean = false) =>
      async (value: ConnectionInfo) => {
        const input: ConnectionProfileInput = {
          ...value,
          id: connectionProfile?.id ?? '',
          version: connectionProfile?.version ?? 1,
        };

        const output = await callIPC(ConnectS3, [input, isTestConnection, mode === 'manualconnect']);

        if (output && output.isConnected && !isTestConnection) {
          if (mode === 'manualconnect' && connectionProfile?.id) {
            updateConnectionProfiles(connectionProfile.id, {
              ...connectionProfile,
              isConnected: output.isConnected,
            });
          }
          mantine.handler.hide();
        }
      };

    const handleUpdateProfile = () => async (value: ConnectionInfo) => {
      const confirmModal = await ConfirmModal.show({
        type: 'info',
        confirmCode: 'C000001',
      });
      if (confirmModal && connectionProfile) {
        const input: ConnectionProfileInput = {
          ...value,
          id: connectionProfile.id ?? '',
          version: connectionProfile.version ?? 1,
        };
        const output = await callIPC(UpdateProfileById, [input]);
        if (output?.id) {
          form.setValues({ ...output });
          updateConnectionProfiles(output.id, { ...output });
        }
      }
    };

    const handleCreateProfile = () => async (value: ConnectionInfo) => {
      const input: ConnectionProfileInput = {
        ...value,
        id: createUUID(),
        version: 1,
      };
      const output = await callIPC(CreateProfile, [input], {
        showMessage: true,
      });
      if (output?.id) {
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
              p="8px"
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
                <SegmentedControl
                  data={[
                    {
                      label: (
                        <Center style={{ gap: '16px' }}>
                          <img src={awsLogo} alt="" width={18} height={18} />
                          <span>AWS</span>
                        </Center>
                      ),
                      value: 'aws',
                    },
                    {
                      label: (
                        <Center style={{ gap: '16px' }}>
                          <img src={minioLogo} alt="" width={18} height={18} />
                          <span>MinIO</span>
                        </Center>
                      ),
                      value: 'minio',
                    },
                  ]}
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
                  withAsterisk={mode === 'connect' || mode === 'manualconnect'}
                  key={form.key('secretKey')}
                  {...form.getInputProps('secretKey')}
                />

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

                  <CheckBoxInput
                    label={t('form.label.autoConnect')}
                    key={form.key('autoConnect')}
                    disabled={!savePassword || isNullOrEmpty(secretKey)}
                    {...form.getInputProps('autoConnect', { type: 'checkbox' })}
                  />
                </Group>
              </Stack>
            </Modal.Body>

            <Divider />

            <Group p="8px" justify="space-between">
              <Button type="button" loading={form.submitting} onClick={submitAs('connect', handleConnect(true))}>
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
