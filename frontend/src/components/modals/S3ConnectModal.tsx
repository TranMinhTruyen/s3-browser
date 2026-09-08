import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { Button, Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/S3Browser/internal/handlers/buckethandler';
import { ConnectionInput } from '@wails/S3Browser/models/bucket';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import z from 'zod';
import { useMantineModal } from '@/common/hooks/useMantineModal';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { callIPC } from '@/common/utils/ipcUtils';
import FieldInput from '@/components/inputs/FieldInput';

const schema = z.object({
  endpoint: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim().nonempty('V000001'),
  pathStyle: z.boolean(),
});

interface ConnectionInfoForm extends z.infer<typeof schema> {}

export default NiceModal.create(() => {
  const { t } = useTranslation('S3ConnectModal');
  const get = useMasterDataStore(m => m.get);
  const modal = useModal();
  const mantineModalProps = useMantineModal(modal);

  useEffect(() => {
    const masterData = get('REGION');
    console.log(masterData);
  }, [get]);

  const defaultValues = schema
    .default({
      endpoint: '',
      accessKey: '',
      secretKey: '',
      pathStyle: false,
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
        name: 'Test',
        color: 'white',
        ...value,
        region: 'us-east-1',
        pathStyle: true,
        savePassword: true,
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
      <Modal.Content>
        <Modal.Header pos="relative" py="sm" mih={0} style={{ justifyContent: 'flex-end' }}>
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
          <Modal.CloseButton size="sm" />
        </Modal.Header>

        <Divider />

        <Modal.Body p="lg">
          <form onSubmit={form.onSubmit(handleConnect(false))}>
            <Stack gap="sm">
              <FieldInput
                type="text"
                label={t('form.label.endpoint')}
                placeholder={t('form.label.endpoint')}
                withAsterisk
                key={form.key('endpoint')}
                {...form.getInputProps('endpoint')}
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

              <Group justify="space-between">
                <Button type="button" loading={form.submitting} onClick={() => form.onSubmit(handleConnect(true))()}>
                  {t('form.button.testConnection')}
                </Button>

                <Button type="submit" loading={form.submitting}>
                  {t('form.button.connect')}
                </Button>
              </Group>
            </Stack>
          </form>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
});
