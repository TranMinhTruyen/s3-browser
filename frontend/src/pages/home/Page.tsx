import { Stack, Text } from '@mantine/core';
import { Greet } from '@wails/go/transfer/API';
import { EventsOn } from '@wails/runtime/runtime';
import { useCallback, useEffect, useState } from 'react';
import Button from '@/components/buttons/Button';

function Page() {
  const [message, setMessage] = useState('');

  useEffect(() => EventsOn('transfer:greet', (data: string) => setMessage(data)), []);

  const handleClick = useCallback(async () => {
    await Greet('Minh', 'Truyen');
  }, []);

  return (
    <Stack align="stretch" justify="center" gap="sm">
      Home
      <Button w="100px" onClick={handleClick}>
        Greet
      </Button>
      {message && <Text>{message}</Text>}
    </Stack>
  );
}
export default Page;
