import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { Button, Divider, Group, Modal, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/go/handlers/API';
import { models } from '@wails/go/models';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import z from 'zod';
import { useMantineModal } from '@/common/hooks/useMantineModal';
import FieldInput from '@/components/inputs/FieldInput';

const schema = z.object({
  endpoint: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim().nonempty('V000001'),
  pathStyle: z.boolean(),
});

export interface ConnectionInfoForm extends z.infer<typeof schema> {}

export default NiceModal.create(() => {
  const { t } = useTranslation('S3ConnectModal');
  const modal = useModal();
  const mantineModalProps = useMantineModal(modal);

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
      try {
        const input: models.ConnectionInput = {
          name: 'Test',
          color: 'white',
          ...value,
          region: 'us-east-1',
          pathStyle: true,
        };
        const output = await ConnectS3(input, isTestConnection);
        const message = t(`toastMessage.${output.message}`);
        if (output.isConnected) {
          if (!isTestConnection) {
            toast.success(message);
            modal.hide();
          } else {
            toast.info(message);
          }
        } else {
          toast.error(message);
        }
      } catch (err) {
        toast.error('Connect to S3 error', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [modal, t]
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
