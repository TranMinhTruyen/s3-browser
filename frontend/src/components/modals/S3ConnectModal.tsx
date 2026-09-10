import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { Button, Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionInput } from '@wails/S3Browser/models/bucket';
import { useCallback } from 'react';
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
  endpoint: z.string().trim().nonempty('V000001'),
  region: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim().nonempty('V000001'),
  pathStyle: z.boolean(),
  savePassword: z.boolean(),
});

interface ConnectionInfoForm extends z.infer<typeof schema> {}

export default NiceModal.create(() => {
  const { t } = useTranslation('S3ConnectModal');

  const modal = useModal();
  const mantineModalProps = useMantineModal(modal);

  const defaultValues = schema
    .default({
      name: `Connection No.${createUUID()}`,
      endpoint: '',
      region: '',
      accessKey: '',
      secretKey: '',
      pathStyle: false,
      savePassword: false,
    })
    .parse(undefined);

  const form = useForm<ConnectionInfoForm>({
    mode: 'uncontrolled',
    initialValues: defaultValues,
    validate: schemaResolver(schema, { sync: true }),
  });

  const handleConnect = useCallback(
    (isTestConnection: boolean) => async (value: ConnectionInfoForm) => {
      const input: ConnectionInput = {
        color: 'white',
        ...value,
      };
      const output = await callIPC(() => ConnectS3(input, isTestConnection));
      if (output && output.isConnected && !isTestConnection) {
        modal.hide();
      }
    },
    [modal]
  );

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
                  {...form.getInputProps('pathStyle')}
                />

                <CheckBoxInput
                  label={t('form.label.savePassword')}
                  key={form.key('savePassword')}
                  {...form.getInputProps('savePassword')}
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
