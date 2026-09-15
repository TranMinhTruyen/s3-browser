import { Divider, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createMantineModal } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';

type ConfirmModalProps = {
  type: 'info' | 'warning';
  confirmCode: string;
  params?: Record<string, any> | { [x: string]: any } | null;
};

export default createMantineModal<ConfirmModalProps, boolean>(props => {
  const { type, confirmCode, params, mantine } = props;

  const { t } = useTranslation('confirmModal');

  const icon = type === 'info' ? <Info color="#2600fdbe" /> : <TriangleAlert color="#dfc21e" />;

  const title = type === 'info' ? t('title.info') : t('title.warning');

  const text = formatStringJson(t(`confirmText.${confirmCode}`), params);

  return (
    <Modal.Root {...mantine.props} centered size="sm">
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: type === 'info' ? '#d0ebff' : '#f6ffd0' }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            {icon}
            <Title order={4} style={{ color: type === 'info' ? '#2600fdbe' : '#dfc21e' }}>
              {title}
            </Title>
          </Group>
          <Modal.CloseButton size="md" />
        </Modal.Header>

        <Divider />

        <Modal.Body p="16px">
          <Stack gap="sm" bg="var(--mantine-color-body)" align="stretch" justify="center">
            <Text size="lg" ta="center">
              {text}
            </Text>
          </Stack>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between">
          <Button
            onClick={() => {
              mantine.handler.resolve(true);
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
