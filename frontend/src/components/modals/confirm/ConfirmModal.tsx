import { Divider, Group, Modal, Text, Title } from '@mantine/core';
import { Info, TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import { INFO_BG_COLOR, INFO_COLOR, WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';

type ConfirmModalProps = ModalProps & {
  type: 'info' | 'warning';
  confirmCode: string;
  params?: Record<string, any> | { [x: string]: any } | null;
};

export default createMantineModal<ConfirmModalProps, boolean>(props => {
  const { type, confirmCode, params, mantine, size = 'sm', centered = true, ...restProps } = props;

  const { t } = useTranslation('confirmModal');

  const isInfo = type === 'info';
  const color = isInfo ? INFO_COLOR : WARNING_COLOR;
  const icon = isInfo ? <Info color={color} /> : <TriangleAlert color={color} />;
  const title = isInfo ? t('title.info') : t('title.warning');

  const text = formatStringJson(t(`confirmCode.${confirmCode}`), params);

  const { resolve, hide } = mantine.handler;

  const onClickOk = useCallback(() => {
    resolve(true);
    hide();
  }, [resolve, hide]);

  const onClickCancel = useCallback(() => {
    resolve(false);
    hide();
  }, [resolve, hide]);

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: isInfo ? INFO_BG_COLOR : WARNING_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            {icon}
            <Title order={4} style={{ color }}>
              {title}
            </Title>
          </Group>
          <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Modal.Stack>
            <Text ta="center">{text}</Text>
          </Modal.Stack>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between" wrap="nowrap">
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
          <Button onClick={onClickOk}>{t('common:button.OK')}</Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
