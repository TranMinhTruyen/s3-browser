import { Divider, Group, Modal, Text, Title } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import { WARNING_BG_COLOR, WARNING_COLOR } from '@/components/modals/modalColors';

type UnsavedSettingChoice = 'back' | 'discard' | 'save';

/** Asks what to do with the unsaved settings; closing it (X, Esc, click outside) counts as `back`. */
export default createMantineModal<ModalProps, UnsavedSettingChoice>(
  props => {
    const { mantine, size = 'sm', centered = true, ...restProps } = props;

    const { t } = useTranslation('settingModal');
    const { resolve, hide } = mantine.handler;

    const choose = useCallback(
      (choice: UnsavedSettingChoice) => {
        resolve(choice);
        hide();
      },
      [resolve, hide]
    );
    const onClickBack = useCallback(() => choose('back'), [choose]);
    const onClickDiscard = useCallback(() => choose('discard'), [choose]);
    const onClickSave = useCallback(() => choose('save'), [choose]);

    return (
      <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
        <Modal.Overlay />
        <Modal.Content>
          <Modal.Header
            pos="relative"
            p="8px"
            mih="0px"
            style={{ justifyContent: 'flex-end', backgroundColor: WARNING_BG_COLOR }}
          >
            <Group
              gap="xs"
              style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            >
              <TriangleAlert color={WARNING_COLOR} />
              <Title order={4} style={{ color: WARNING_COLOR }}>
                {t('unsaved.title')}
              </Title>
            </Group>
            <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
          </Modal.Header>

          <Divider />

          <Modal.Body p="8px">
            <Text ta="center">{t('unsaved.message')}</Text>
          </Modal.Body>

          <Divider />

          {/* Back on the left (like Cancel), actions on the right. */}
          <Group p="8px" justify="space-between" wrap="nowrap">
            <Button color="red" onClick={onClickBack}>
              {t('unsaved.button.back')}
            </Button>
            <Group gap="xs" wrap="nowrap">
              <Button onClick={onClickDiscard}>{t('unsaved.button.discard')}</Button>
              <Button onClick={onClickSave}>{t('unsaved.button.save')}</Button>
            </Group>
          </Group>
        </Modal.Content>
      </Modal.Root>
    );
  },
  { cancelValue: 'back' }
);
