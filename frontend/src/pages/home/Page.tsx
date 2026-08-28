import NiceModal from '@ebay/nice-modal-react';
import { Title } from '@mantine/core';
import { useCallback } from 'react';
import Button from '@/components/buttons/Button';
import S3ConnectModal from '@/components/modals/S3ConnectModal';

function Page() {
  const handleOpenConnectToS3Modal = useCallback(() => {
    NiceModal.show(S3ConnectModal);
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
