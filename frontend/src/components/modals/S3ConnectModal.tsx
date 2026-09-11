import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { Button, Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionInput } from '@wails/S3Browser/models/bucket';
import { useTranslation } from 'react-i18next';
import z from 'zod';
import { useMantineModal } from '@/common/hooks/useMantineModal';
import { callIPC } from '@/common/utils/ipcUtils';
import { createUUID } from '@/common/utils/stringUtils';
import CheckBoxInput from '@/components/inputs/CheckBoxInput';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import FieldInput from '@/components/inputs/FieldInput';

const schema = z.object({
  name: z.string().trim(),
  color: z.string().trim(),
  endpoint: z.string().trim().nonempty('V000001'),
  region: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim().nonempty('V000001'),
  pathStyle: z.boolean(),
  savePassword: z.boolean(),
  autoConnect: z.boolean(),
});

export interface ConnectionInfo extends z.infer<typeof schema> {}

interface S3ConnectModalProps {
  mode?: 'add' | 'edit';
  id?: string;
  version?: number;
  connectionInfo?: ConnectionInfo;
}

export default NiceModal.create((props: S3ConnectModalProps) => {
  const { mode = 'add', id, version, connectionInfo } = props;
  const { t } = useTranslation('S3ConnectModal');

  const modal = useModal();
  const mantineModalProps = useMantineModal(modal);

  const defaultValues = schema
    .default({
      name: `Connection No.${createUUID()}`,
      color: '#177cff',
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
    initialValues: mode === 'add' ? defaultValues : connectionInfo,
    validate: schemaResolver(schema, { sync: true }),
  });

  const savePassword = form.useWatchValue('savePassword');

  form.watch('savePassword', ({ value }) => {
    if (!value) {
      form.setFieldValue('autoConnect', false);
    }
  });

  const handleConnect = (isTestConnection: boolean) => async (value: ConnectionInfo) => {
    const input: ConnectionInput = {
      id: mode === 'add' ? '' : (id ?? ''),
      version: mode === 'add' ? 1 : (version ?? 1),
      ...value,
    };
    const output = await callIPC(ConnectS3, [input, isTestConnection, mode === 'add'], { showMessage: mode === 'add' });
    if (output && output.isConnected && !isTestConnection) {
      modal.hide();
    }
  };

  return (
    <Modal.Root {...mantineModalProps} centered size="lg">
      <Modal.Overlay />
      <form onSubmit={form.onSubmit(handleConnect(false))}>
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
                withAsterisk
                key={form.key('secretKey')}
                {...form.getInputProps('secretKey')}
              />

              <Group justify="flex-end" gap="xl">
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
              </Group>
            </Stack>
          </Modal.Body>

          <Divider />

          <Group p="16px" justify="space-between">
            <Button type="button" loading={form.submitting} onClick={() => form.onSubmit(handleConnect(true))()}>
              {t('form.button.testConnection')}
            </Button>

            <Button type="submit" loading={form.submitting}>
              {t('form.button.connect')}
            </Button>
          </Group>
        </Modal.Content>
      </form>
    </Modal.Root>
  );
});
