import { Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { ChooseDbFile } from '@wails/S3Browser/internal/handlers/dbhandler';
import { FolderOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import SelectInput from '@/components/inputs/SelectInput';
import SwitchInput from '@/components/inputs/SwitchInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import {
  createDbProfileSchema,
  type DbProfileForm,
  getDefaultDbProfileForm,
  SSL_MODES,
  toDbProfileInput,
  toFormValues,
} from '@/pages/sql/modals/dbProfile/dbProfileSchema';
import { type DbProfile, PROVIDER_LABEL_KEY, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';

type DbProfileModalProps = {
  /** Profile to edit; without it the modal creates a new one. */
  profile?: DbProfile;
};

/**
 * Modal to create or edit a database profile (saved by the backend). While the profile is connected, the file path,
 * read-only switch and DB type are locked. A failed save keeps the modal open; editing asks for confirmation first. Resolves `false` when dismissed.
 */
export default createMantineModal<DbProfileModalProps, false>(
  props => {
    const { profile, mantine } = props;
    const { t } = useTranslation('dbProfileModal');
    const saveDbProfile = useDbProfileStore(s => s.saveDbProfile);
    // Live flag (the `profile` prop is a snapshot): the profile may connect or disconnect while the modal is open.
    const locked = useDbProfileStore(s => !!(profile && s.dbProfiles[profile.id]?.isConnected));

    // useForm only reads initialValues on mount; compute them once instead of on every keystroke.
    const [initialValues] = useState(() =>
      profile ? toFormValues(profile) : getDefaultDbProfileForm(`Connection No.${createUUID()}`)
    );

    const form = useForm<DbProfileForm>({
      mode: 'uncontrolled',
      initialValues,
      validate: values => {
        // Another profile with the same name (ignoring case and surrounding spaces); the edited one is skipped.
        const isNameTaken = (name: string) =>
          Object.values(useDbProfileStore.getState().dbProfiles).some(
            p => p && p.id !== profile?.id && p.name.trim().toLowerCase() === name.trim().toLowerCase()
          );
        return schemaResolver(createDbProfileSchema(isNameTaken), { sync: true })(values);
      },
    });

    const provider = form.useWatchValue('provider');

    form.watch('provider', () => form.clearErrors()); // errors of the other DB type no longer apply

    const providerOptions = useMemo(
      () => [
        { value: 'postgres', label: t(`form.dbType.${PROVIDER_LABEL_KEY.postgres}`) },
        { value: 'sqlite', label: t(`form.dbType.${PROVIDER_LABEL_KEY.sqlite}`) },
      ],
      [t]
    );

    // Editing keeps the stored password only while the provider stays the same.
    const showKeepPassword = !!profile?.hasSecret && provider === profile.provider;

    const sslOptions = useMemo(() => SSL_MODES.map(value => ({ value, label: t(`form.sslMode.${value}`) })), [t]);

    const onSubmitProfile = useCallback(
      async (values: DbProfileForm) => {
        if (profile && !(await ConfirmModal.show({ type: 'info', confirmCode: 'C000001' }))) return;
        const input = toDbProfileInput(values, profile?.id);
        if (!(await saveDbProfile(input, !!profile))) return;
        toast.success(t(profile ? 'toast.updated' : 'toast.created', { name: input.name }));
        mantine.handler.hide();
      },
      [profile, saveDbProfile, t, mantine.handler]
    );

    const onClickChooseFile = useCallback(async () => {
      const path = await callIPC(ChooseDbFile, []);
      if (path) form.setFieldValue('filePath', path); // empty = dialog canceled
    }, [form]);

    return (
      <Modal.Root {...mantine.props} centered size="lg">
        <Modal.Overlay />
        <form onSubmit={form.onSubmit(onSubmitProfile)}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="0.5rem"
              mih="0"
              style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
            >
              <Title
                order={4}
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              >
                {t(profile ? 'title.edit' : 'title.create')}
              </Title>
              <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
            </Modal.Header>

            <Divider />

            <Modal.Body p="1rem">
              <Paper withBorder p="md">
                <Stack gap="sm">
                  {locked && provider === 'sqlite' && (
                    <Text size="sm" c="dimmed">
                      {t('form.description.disconnectToEdit')}
                    </Text>
                  )}

                  <SegmentedControl
                    data={providerOptions}
                    aria-label={t('form.label.dbType')}
                    disabled={locked}
                    key={form.key('provider')}
                    {...form.getInputProps('provider')}
                  />

                  <FieldInput
                    type="text"
                    label={t('form.label.name')}
                    placeholder={t('form.label.name')}
                    withAsterisk
                    key={form.key('name')}
                    {...form.getInputProps('name')}
                  />

                  <FieldInput
                    type="color"
                    label={t('form.label.color')}
                    placeholder={t('form.label.color')}
                    key={form.key('color')}
                    {...form.getInputProps('color')}
                  />

                  {provider === 'postgres' ? (
                    <>
                      <FieldInput
                        type="text"
                        label={t('form.label.host')}
                        placeholder={t('form.label.host')}
                        withAsterisk
                        key={form.key('host')}
                        {...form.getInputProps('host')}
                      />

                      <FieldInput
                        type="number"
                        label={t('form.label.port')}
                        placeholder={t('form.label.port')}
                        withAsterisk
                        hideControls
                        allowDecimal={false}
                        allowNegative={false}
                        key={form.key('port')}
                        {...form.getInputProps('port')}
                      />

                      <FieldInput
                        type="text"
                        label={t('form.label.database')}
                        placeholder={t('form.label.database')}
                        withAsterisk
                        key={form.key('database')}
                        {...form.getInputProps('database')}
                      />

                      <FieldInput
                        type="text"
                        label={t('form.label.username')}
                        placeholder={t('form.label.username')}
                        withAsterisk
                        key={form.key('username')}
                        {...form.getInputProps('username')}
                      />

                      <FieldInput
                        type="password"
                        label={t('form.label.password')}
                        placeholder={t('form.label.password')}
                        description={showKeepPassword ? t('form.description.keepPassword') : undefined}
                        key={form.key('password')}
                        {...form.getInputProps('password')}
                      />

                      <SelectInput
                        label={t('form.label.sslMode')}
                        data={sslOptions}
                        allowDeselect={false}
                        key={form.key('sslMode')}
                        {...form.getInputProps('sslMode')}
                      />
                    </>
                  ) : (
                    <>
                      <FieldInput
                        type="text"
                        label={t('form.label.filePath')}
                        placeholder={t('form.label.filePath')}
                        withAsterisk
                        disabled={locked}
                        rightSection={
                          <ActionIcon
                            variant="subtle"
                            disabled={locked}
                            onClick={onClickChooseFile}
                            tooltip={t('form.tooltip.chooseFile')}
                          >
                            <FolderOpen size="1rem" />
                          </ActionIcon>
                        }
                        key={form.key('filePath')}
                        {...form.getInputProps('filePath')}
                      />
                      <SwitchInput
                        label={t('form.label.readOnly')}
                        description={t('form.description.readOnly')}
                        disabled={locked}
                        key={form.key('readOnly')}
                        {...form.getInputProps('readOnly', { type: 'checkbox' })}
                      />
                    </>
                  )}
                </Stack>
              </Paper>
            </Modal.Body>

            <Divider />

            <Group p="0.5rem" justify="space-between" wrap="nowrap">
              <Button type="button" color="red" onClick={mantine.props.onClose} disabled={form.submitting}>
                {t('common:button.cancel')}
              </Button>
              <Button type="submit" loading={form.submitting}>
                {t(profile ? 'form.button.edit' : 'form.button.create')}
              </Button>
            </Group>
          </Modal.Content>
        </form>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
