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
  UI_SIZES,
} from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';
import { useUpdateStore } from '@/common/stores/updateStore';
import { tintedColor } from '@/common/theme/tintedColor';
import { createMantineModal } from '@/common/utils/modalUtils';
import { isSettingDirty } from '@/common/utils/settingUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import SelectInput from '@/components/inputs/SelectInput';
import SliderInput from '@/components/inputs/SliderInput';
import SwitchInput from '@/components/inputs/SwitchInput';
import { showUnsavedSettingModal } from '@/components/modals/lazyModals';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import UpdateSection from '@/components/modals/setting/UpdateSection';

/** Trả về true khi đã lưu thiết lập, false/null khi đóng modal. */
export default createMantineModal<{}, boolean>(props => {
  const { mantine, ...restProps } = props;

  const { t } = useTranslation('settingModal');
  // Trong lúc lưu, khóa mọi nút và mọi cách đóng modal.
  const [saving, setSaving] = useState(false);
  // Giữ khóa tương tự khi Apply đang chờ để Cancel/Save/đóng modal không chạy đua với kết quả.
  const [applying, setApplying] = useState(false);
  const busy = saving || applying;
  // Khi kéo chỉ di chuyển nút trượt; áp dụng cỡ khi thả chuột (nhấn phím thì áp dụng ngay).
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const draft = useSettingStore(useShallow(s => s.draft));
  const applied = useSettingStore(useShallow(s => s.applied));
  const autostartSupported = useSettingStore(s => s.autostartSupported);
  const updateSupported = useUpdateStore(s => s.supported);
  const setDraft = useSettingStore(s => s.setDraft);
  const save = useSettingStore(s => s.save);
  const apply = useSettingStore(s => s.apply);
  const resetDraft = useSettingStore(s => s.resetDraft);
  const revert = useSettingStore(s => s.revert);

  const themeOptions = useMemo(() => THEMES.map(value => ({ value, label: t(`option.theme.${value}`) })), [t]);
  const fontOptions = useMemo(() => FONTS.map(value => ({ value, label: t(`option.font.${value}`) })), [t]);
  const languageOptions = useMemo(() => LANGUAGES.map(value => ({ value, label: LANGUAGE_LABELS[value] })), []);
  const sizeMarks = useMemo(() => UI_SIZES.map((key, value) => ({ value, label: t(`option.size.${key}`) })), [t]);
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
  const onChangeSize = useCallback((value: number) => setDragIndex(value), []);
  const onChangeEndSize = useCallback(
    (value: number) => {
      setDragIndex(null);
      const size = UI_SIZES[value];
      if (size !== draft.size) setDraft({ size });
    },
    [draft.size, setDraft]
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

  const onChangeAutoUpdate = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setDraft({ autoUpdate: e.currentTarget.checked }),
    [setDraft]
  );

  const onChangeBetaUpdate = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setDraft({ betaUpdate: e.currentTarget.checked }),
    [setDraft]
  );

  // Mỗi tùy chọn phông chữ được xem trước bằng chính phông đó.
  const renderFontOption = useCallback(
    ({ option }: { option: { value: string; label: string } }) => (
      <span style={{ fontFamily: getFontFamily(option.value as FontKey, draft.language) }}>{option.label}</span>
    ),
    [draft.language]
  );

  const onClickCancel = useCallback(() => {
    revert();
    mantine.handler.resolve(false);
    mantine.handler.hide();
  }, [revert, mantine.handler]);

  const onClickReset = useCallback(() => resetDraft(), [resetDraft]);

  // Apply chỉ giữ các giá trị hiện tại trong phiên này; modal vẫn mở.
  const onClickApply = useCallback(async () => {
    setApplying(true);
    try {
      if (await apply().catch(() => false)) {
        toast.success(t('message.applied'));
      }
    } finally {
      setApplying(false);
    }
  }, [apply, t]);

  // Sau khi lưu thành công, giữ khóa đến khi modal ẩn để không thể bắt đầu lượt lưu thứ hai.
  const onClickSave = useCallback(async () => {
    setSaving(true);
    // callIPC đã báo lỗi cho người dùng nên xem rejection như một lần lưu thất bại.
    const ok = await save().catch(() => false);
    if (!ok) {
      setSaving(false);
      return;
    }
    toast.success(t('message.saved'));
    mantine.handler.resolve(true);
    mantine.handler.hide();
  }, [save, t, mantine.handler]);

  // Nút X, Esc và click bên ngoài: đóng ngay nếu không có thay đổi, nếu có thì hỏi cách xử lý các thay đổi.
  const onCloseModal = useCallback(async () => {
    if (!isSettingDirty(draft, applied)) {
      revert();
      mantine.props.onClose();
      return;
    }
    const choice = await showUnsavedSettingModal();
    if (choice === 'save') {
      await onClickSave();
    } else if (choice === 'discard') {
      revert();
      mantine.props.onClose();
    }
  }, [draft, applied, revert, mantine.props, onClickSave]);

  return (
    <Modal.Root
      {...mantine.props}
      onClose={onCloseModal}
      centered
      {...restProps}
      closeOnEscape={mantine.props.closeOnEscape && !busy}
      closeOnClickOutside={mantine.props.closeOnClickOutside && !busy}
      size="35rem"
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="0.5rem"
          mih="0"
          style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Title order={4}>{t('title')}</Title>
          </Group>
          <CloseButton tooltip={t('common:button.close')} disabled={busy} onClick={onCloseModal} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="0.5rem">
          <Stack gap="0.5rem">
            <Paper withBorder p="0.5rem">
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
                <SliderInput
                  label={t('label.size')}
                  thumbLabel={t('label.size')}
                  min={0}
                  max={UI_SIZES.length - 1}
                  step={1}
                  marks={sizeMarks}
                  value={dragIndex ?? UI_SIZES.indexOf(draft.size)}
                  onChange={onChangeSize}
                  onChangeEnd={onChangeEndSize}
                  mb="lg"
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
                {updateSupported ? (
                  <>
                    <SwitchInput
                      label={t('label.autoUpdate')}
                      checked={draft.autoUpdate}
                      onChange={onChangeAutoUpdate}
                    />
                    <SwitchInput
                      label={t('label.betaUpdate')}
                      checked={draft.betaUpdate}
                      onChange={onChangeBetaUpdate}
                    />
                  </>
                ) : null}
              </Stack>
            </Paper>
            <UpdateSection />
          </Stack>
        </Modal.Body>

        <Divider />

        {/* Cancel on the left, actions on the right; nowrap keeps the layout stable when text width changes. */}
        <Group p="0.5rem" justify="space-between" wrap="nowrap">
          <Button color="red" onClick={onClickCancel} disabled={busy}>
            {t('button.cancel')}
          </Button>
          <Group gap="xs" wrap="nowrap">
            <Button {...tintedColor('gray', 'button')} onClick={onClickReset} disabled={busy}>
              {t('button.reset')}
            </Button>
            <Button {...tintedColor('teal', 'button')} onClick={onClickApply} disabled={busy}>
              {t('button.apply')}
            </Button>
            <Button onClick={onClickSave} loading={saving} disabled={applying}>
              {t('button.save')}
            </Button>
          </Group>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
