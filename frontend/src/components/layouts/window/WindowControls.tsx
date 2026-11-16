import { Group } from '@mantine/core';
import { Events, Window } from '@wailsio/runtime';
import { Copy, Minus, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tintedColor } from '@/common/theme/tintedColor';
import ActionIcon from '@/components/buttons/ActionIcon';
import CloseButton from '@/components/buttons/CloseButton';

const MAXIMISE_EVENTS = [
  Events.Types.Common.WindowMaximise,
  Events.Types.Common.WindowUnMaximise,
  Events.Types.Common.WindowRestore,
];

/** Frameless window buttons: minimise, maximise/restore (icon follows window state) and close. */
function WindowControls() {
  const { t } = useTranslation('common');
  const [isMaximised, setIsMaximised] = useState(false);

  useEffect(() => {
    let active = true;
    const syncState = () => {
      Window.IsMaximised().then(value => active && setIsMaximised(value));
    };
    syncState();
    const unsubscribes = MAXIMISE_EVENTS.map(type => Events.On(type, syncState));
    return () => {
      active = false;
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, []);

  const onClickMinimise = useCallback(() => {
    Window.Minimise();
  }, []);

  const onClickMaximise = useCallback(() => {
    Window.ToggleMaximise();
  }, []);

  const onClickClose = useCallback(() => {
    Window.Close();
  }, []);

  const maximiseLabel = isMaximised ? t('window.restore') : t('window.maximise');

  return (
    <Group gap="xs" wrap="nowrap">
      <ActionIcon tooltip={t('window.minimise')} {...tintedColor('yellow', 'ai')} onClick={onClickMinimise}>
        <Minus size="1rem" />
      </ActionIcon>

      <ActionIcon tooltip={maximiseLabel} {...tintedColor('green', 'ai')} onClick={onClickMaximise}>
        {isMaximised ? <Copy size="0.875rem" /> : <Square size="0.875rem" />}
      </ActionIcon>

      <CloseButton size="lg" tooltip={t('window.close')} onClick={onClickClose} />
    </Group>
  );
}

export default WindowControls;
