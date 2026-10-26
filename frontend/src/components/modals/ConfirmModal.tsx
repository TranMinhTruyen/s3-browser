import { Divider, Group, Modal, Text, Title } from '@mantine/core';
import { Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import { WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';

type ConfirmModalProps = ModalProps & {
  type: 'info' | 'warning';
  confirmCode: string;
  params?: Record<string, any> | { [x: string]: any } | null;
};

export default createMantineModal<ConfirmModalProps, boolean>(props => {
  const { type, confirmCode, params, mantine, size = 'sm', centered = true, ...restProps } = props;

  const { t } = useTranslation('confirmModal');

  const icon = type === 'info' ? <Info color="#2600fdbe" /> : <TriangleAlert color={WARNING_COLOR} />;

  const title = type === 'info' ? t('title.info') : t('title.warning');

  const text = formatStringJson(t(`confirmCode.${confirmCode}`), params);

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: type === 'info' ? '#d0ebff' : WARNING_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            {icon}
            <Title order={4} style={{ color: type === 'info' ? '#2600fdbe' : WARNING_COLOR }}>
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
            {t('common:button.OK')}
          </Button>
          <Button
            onClick={() => {
              mantine.handler.resolve(false);
              mantine.handler.hide();
            }}
            color="red"
          >
            {t('common:button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
