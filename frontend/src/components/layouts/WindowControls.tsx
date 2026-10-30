import { Group, Tooltip } from '@mantine/core';
import { Events, Window } from '@wailsio/runtime';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';
import classes from '@/components/layouts/WindowControls.module.css';

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
      <Tooltip label={t('window.minimise')}>
        <ActionIcon aria-label={t('window.minimise')} color="gray" onClick={onClickMinimise}>
          <Minus size={16} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label={maximiseLabel}>
        <ActionIcon aria-label={maximiseLabel} color="gray" onClick={onClickMaximise}>
          {isMaximised ? <Copy size={14} /> : <Square size={14} />}
        </ActionIcon>
      </Tooltip>

      <Tooltip label={t('window.close')}>
        <ActionIcon aria-label={t('window.close')} color="gray" className={classes.closeButton} onClick={onClickClose}>
          <X size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export default WindowControls;
