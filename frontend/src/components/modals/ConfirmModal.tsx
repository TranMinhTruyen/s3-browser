import { Divider, Group, Modal, Text, Title } from '@mantine/core';
import { Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';

type ConfirmModalProps = ModalProps & {
  type: 'info' | 'warning';
  confirmCode: string;
  params?: Record<string, any> | { [x: string]: any } | null;
};

export default createMantineModal<ConfirmModalProps, boolean>(props => {
  const { type, confirmCode, params, mantine, size = 'sm', centered = true, ...restProps } = props;

  const { t } = useTranslation('confirmModal');

  const icon = type === 'info' ? <Info color="#2600fdbe" /> : <TriangleAlert color="#dfc21e" />;

  const title = type === 'info' ? t('title.info') : t('title.warning');

  const text = formatStringJson(t(`confirmText.${confirmCode}`), params);

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
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

        <Modal.Body p="8px">
          <Modal.Stack>
            <Text ta="center">{text}</Text>
          </Modal.Stack>
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
