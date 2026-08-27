import { Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { ConnectS3 } from '@wails/go/handlers/API';
import { models } from '@wails/go/models';
import { EventsOn } from '@wails/runtime/runtime';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import Button from '@/components/buttons/Button';
import FieldInput from '@/components/inputs/FieldInput';

function Page() {
  const [message, setMessage] = useState('');

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      textInput: '',
      passwordInput: '',
    },
    validate: values => ({
      textInput: values.textInput.length === 0 ? 'This field is required' : null,
      passwordInput: values.passwordInput.length === 0 ? 'This field is required' : null,
    }),
  });

  useEffect(() => EventsOn('transfer:greet', (data: string) => setMessage(data)), []);

  const handleClick = useCallback(
    async (value: { textInput: string; passwordInput: string }) => {
      try {
        const input: models.ConnectionInput = {
          name: 'Test',
          color: 'white',
          endpoint: 'http://localhost:9998',
          region: 'us-east-1',
          accessKey: value.textInput,
          secretKey: value.passwordInput,
          pathStyle: true,
        };
        const output = await ConnectS3(input, true);
        if (output.isConnected) {
          toast.info('Connect to S3 success');
        } else {
          toast.error('Connect to S3 error', { description: output.message });
        }
      } catch (err) {
        toast.error('Connect to S3 error', {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        form.reset();
      }
    },
    [form]
  );

  const handleReset = useCallback(() => {
    form.reset();
  }, [form]);

  return (
    <>
      <Title order={1} ta="center">
        Home
      </Title>
      <form onSubmit={form.onSubmit(handleClick)}>
        <Stack align="stretch" gap="sm">
          <FieldInput
            type="text"
            label="Text input label"
            description="Text input description"
            placeholder="Text input placeholder"
            withAsterisk
            key={form.key('textInput')}
            {...form.getInputProps('textInput')}
          />

          <FieldInput
            type="password"
            label="Password input label"
            description="Password input description"
            placeholder="Password input placeholder"
            withAsterisk
            key={form.key('passwordInput')}
            {...form.getInputProps('passwordInput')}
          />

          <Button w="100px" type="submit" loading={form.submitting}>
            Connect
          </Button>

          <Button w="125px" type="button" onClick={handleReset}>
            Reset form
          </Button>
        </Stack>
      </form>
      {message && (
        <Text textWrap="balance" style={{ overflowWrap: 'break-word' }}>
          {message}
        </Text>
      )}
    </>
  );
}
export default Page;
