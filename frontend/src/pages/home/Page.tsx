import { Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { Greet } from '@wails/go/transfer/API';
import { EventsOn } from '@wails/runtime/runtime';
import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/buttons/Button';
import FieldInput from '@/components/inputs/FieldInput';

function Page() {
  const [message, setMessage] = useState('');
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      textInput: '',
      passwordInput: '',
      numberInput: 0,
      textareaInput: '',
    },
  });

  useEffect(() => EventsOn('transfer:greet', (data: string) => setMessage(data)), []);

  const handleClick = useCallback(
    async (value: { textInput: string; passwordInput: string; numberInput: number; textareaInput: string }) => {
      await Greet(value.textInput, value.passwordInput);
    },
    []
  );

  return (
    <>
      <Title order={1} ta="center">
        Home
      </Title>
      <form
        onSubmit={form.onSubmit(values => {
          handleClick(values);
        })}
      >
        <Stack align="stretch" gap="sm">
          <FieldInput
            type="text"
            label="Text input label"
            description="Text input description"
            placeholder="Text input placeholder"
            key={form.key('textInput')}
            {...form.getInputProps('textInput')}
          />

          <FieldInput
            type="password"
            label="Password input label"
            description="Password input description"
            placeholder="Password input placeholder"
            key={form.key('passwordInput')}
            {...form.getInputProps('passwordInput')}
          />

          <FieldInput
            type="number"
            label="Number input label"
            description="Number input description"
            placeholder="Number input placeholder"
            key={form.key('numberInput')}
            {...form.getInputProps('numberInput')}
          />

          <FieldInput
            type="textarea"
            label="Textarea input label"
            description="Textarea input description"
            placeholder="Textarea input placeholder"
            key={form.key('textareaInput')}
            {...form.getInputProps('textareaInput')}
          />

          <Button w="100px" type="submit">
            Greet
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
