import { Title } from '@mantine/core';
import { useCallback } from 'react';
import Button from '@/components/buttons/Button';
import ConnectModal from '@/components/modals/ConnectModal';

function Page() {
  const handleOpenConnectToS3Modal = useCallback(() => {
    ConnectModal.show();
  }, []);

  return (
    <>
      <Title order={1} ta="center">
        Home
      </Title>

      <Button w="auto" onClick={handleOpenConnectToS3Modal}>
        Open connect modal
      </Button>
    </>
  );
}
export default Page;
