import { Divider, Group, Modal, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { createMantineModal } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';

export default createMantineModal<{}, false>(props => {
  const { mantine, ...restProps } = props;

  const { t } = useTranslation('confirmModal');

  return (
    <Modal.Root {...mantine.props} size="xl" centered {...restProps}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: '#d0ebff' }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Title order={4}>History download</Title>
          </Group>
          <Modal.CloseButton size="md" />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Modal.Stack>
            <></>
          </Modal.Stack>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between">
          <Button
            onClick={() => {
              mantine.handler.resolve(false);
              mantine.handler.hide();
            }}
          >
            {t('button.OK')}
          </Button>
          <Button
            onClick={() => {
              mantine.handler.resolve(false);
              mantine.handler.hide();
            }}
            color="#ff0000"
          >
            {t('button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
