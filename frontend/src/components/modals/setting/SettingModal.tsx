import { Divider, Group, Modal, Paper, Stack, Title } from '@mantine/core';
import { type ChangeEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import {
  FONTS,
  type FontKey,
  getFontFamily,
  LANGUAGE_LABELS,
  LANGUAGES,
  type LanguageKey,
  THEMES,
  type ThemeKey,
} from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import { tintedColor } from '@/common/theme/tintedColor';
import { createMantineModal } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import SelectInput from '@/components/inputs/SelectInput';
import SwitchInput from '@/components/inputs/SwitchInput';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

/** Resolves true when the settings were saved, false/null when dismissed. */
export default createMantineModal<{}, boolean>(props => {
  const { mantine, ...restProps } = props;

  const { t } = useTranslation('settingModal');
  // While saving, every button and every way of closing the modal is locked.
  const [saving, setSaving] = useState(false);

  const draft = useSettingStore(useShallow(s => s.draft));
  const autostartSupported = useSettingStore(s => s.autostartSupported);
  const setDraft = useSettingStore(s => s.setDraft);
  const save = useSettingStore(s => s.save);
  const apply = useSettingStore(s => s.apply);
  const resetDraft = useSettingStore(s => s.resetDraft);
  const revert = useSettingStore(s => s.revert);

  const themeOptions = useMemo(() => THEMES.map(value => ({ value, label: t(`option.theme.${value}`) })), [t]);
  const fontOptions = useMemo(() => FONTS.map(value => ({ value, label: t(`option.font.${value}`) })), [t]);
  const languageOptions = useMemo(() => LANGUAGES.map(value => ({ value, label: LANGUAGE_LABELS[value] })), []);
  const comboboxProps = useMemo(() => ({ zIndex: mantine.props.zIndex + 1 }), [mantine.props.zIndex]);

  const onChangeTheme = useCallback(
    (value: string | null) => {
      if (value) setDraft({ theme: value as ThemeKey });
    },
    [setDraft]
  );
  const onChangeFont = useCallback(
    (value: string | null) => {
      if (value) setDraft({ font: value as FontKey });
    },
    [setDraft]
  );
  const onChangeLanguage = useCallback(
    (value: string | null) => {
      if (value) setDraft({ language: value as LanguageKey });
    },
    [setDraft]
  );
  const onChangeLaunchOnStartup = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setDraft({ launchOnStartup: e.currentTarget.checked }),
    [setDraft]
  );

  // Each font option is previewed in its own font.
  const renderFontOption = useCallback(
    ({ option }: { option: { value: string; label: string } }) => (
      <span style={{ fontFamily: getFontFamily(option.value as FontKey, draft.language) }}>{option.label}</span>
    ),
    [draft.language]
  );

  // Closing without saving undoes the preview (back to the last applied values).
  const onCloseModal = useCallback(() => {
    revert();
    mantine.props.onClose();
  }, [revert, mantine.props]);

  const onClickCancel = useCallback(() => {
    revert();
    mantine.handler.resolve(false);
    mantine.handler.hide();
  }, [revert, mantine.handler]);

  const onClickReset = useCallback(() => resetDraft(), [resetDraft]);

  // Apply keeps the current values for this session only; the modal stays open.
  const onClickApply = useCallback(() => {
    apply();
    toast.success(t('message.applied'));
  }, [apply, t]);

  // After a successful save the lock stays until the modal is hidden, so no second save can start.
  const onClickSave = useCallback(async () => {
    setSaving(true);
    // callIPC already reported any failure to the user, so a rejection is treated like a failed save.
    const ok = await save().catch(() => false);
    if (!ok) {
      setSaving(false);
      return;
    }
    toast.success(t('message.saved'));
    mantine.handler.resolve(true);
    mantine.handler.hide();
  }, [save, t, mantine.handler]);

  return (
    <Modal.Root
      {...mantine.props}
      onClose={onCloseModal}
      centered
      {...restProps}
      closeOnEscape={mantine.props.closeOnEscape && !saving}
      closeOnClickOutside={mantine.props.closeOnClickOutside && !saving}
      size="560px"
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Title order={4}>{t('title')}</Title>
          </Group>
          <Modal.CloseButton size="md" disabled={saving} aria-label={t('common:button.close')} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Paper withBorder p="8px">
            <Stack>
              <SelectInput
                label={t('label.theme')}
                data={themeOptions}
                value={draft.theme}
                onChange={onChangeTheme}
                allowDeselect={false}
                comboboxProps={comboboxProps}
              />
              <SelectInput
                label={t('label.font')}
                data={fontOptions}
                value={draft.font}
                onChange={onChangeFont}
                renderOption={renderFontOption}
                allowDeselect={false}
                comboboxProps={comboboxProps}
              />
              <SelectInput
                label={t('label.language')}
                data={languageOptions}
                value={draft.language}
                onChange={onChangeLanguage}
                allowDeselect={false}
                comboboxProps={comboboxProps}
              />
              {autostartSupported ? (
                <SwitchInput
                  label={t('label.launchOnStartup')}
                  checked={draft.launchOnStartup}
                  onChange={onChangeLaunchOnStartup}
                />
              ) : null}
            </Stack>
          </Paper>
        </Modal.Body>

        <Divider />

        {/* Cancel on the left, actions on the right; nowrap keeps the layout stable when text width changes. */}
        <Group p="8px" justify="space-between" wrap="nowrap">
          <Button color="red" onClick={onClickCancel} disabled={saving}>
            {t('button.cancel')}
          </Button>
          <Group gap="xs" wrap="nowrap">
            <Button {...tintedColor('gray', 'button')} onClick={onClickReset} disabled={saving}>
              {t('button.reset')}
            </Button>
            <Button {...tintedColor('teal', 'button')} onClick={onClickApply} disabled={saving}>
              {t('button.apply')}
            </Button>
            <Button onClick={onClickSave} loading={saving}>
              {t('button.save')}
            </Button>
          </Group>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
