import { Divider, Group, Modal, Paper, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { FolderOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createMantineModal } from '@/common/utils/modalUtils';
import { createUUID } from '@/common/utils/stringUtils';
import ActionIcon from '@/components/buttons/ActionIcon';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import SelectInput from '@/components/inputs/SelectInput';
import ConfirmModal from '@/components/modals/confirm/ConfirmModal';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import {
  createDbProfileSchema,
  type DbProfileForm,
  getDefaultDbProfileForm,
  SSL_MODES,
  toDbProfile,
  toFormValues,
} from '@/pages/sql/modals/dbProfile/dbProfileSchema';
import { type DbProfile, useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';
import { notifyNoBackend } from '@/pages/sql/utils/sqlToast';

type DbProfileModalProps = {
  /** Profile to edit; without it the modal creates a new one. */
  profile?: DbProfile;
};

const DB_TYPE_OPTIONS = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
];

/**
 * Modal to create or edit a database profile (kept in RAM for now). Both save paths close the modal;
 * editing asks for confirmation first. Resolves `false` when dismissed.
 */
export default createMantineModal<DbProfileModalProps, false>(
  props => {
    const { profile, mantine } = props;
    const { t } = useTranslation('dbProfileModal');
    const saveDbProfile = useDbProfileStore(s => s.saveDbProfile);

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

    const dbType = form.useWatchValue('dbType');

    form.watch('dbType', () => form.clearErrors()); // errors of the other DB type no longer apply

    const sslOptions = useMemo(() => SSL_MODES.map(value => ({ value, label: t(`form.sslMode.${value}`) })), [t]);

    const onSubmitProfile = useCallback(
      async (values: DbProfileForm) => {
        if (profile && !(await ConfirmModal.show({ type: 'info', confirmCode: 'C000001' }))) return;
        const saved = toDbProfile(values, profile?.id ?? createUUID(), profile?.isConnected ?? false);
        saveDbProfile(saved);
        toast.success(t(profile ? 'toast.updated' : 'toast.created', { name: saved.name }));
        mantine.handler.hide();
      },
      [profile, saveDbProfile, t, mantine.handler]
    );

    return (
      <Modal.Root {...mantine.props} centered size="lg">
        <Modal.Overlay />
        <form onSubmit={form.onSubmit(onSubmitProfile)}>
          <Modal.Content>
            <Modal.Header
              pos="relative"
              p="8px"
              mih="0px"
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

            <Modal.Body p="16px">
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <SegmentedControl data={DB_TYPE_OPTIONS} key={form.key('dbType')} {...form.getInputProps('dbType')} />

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

                  {dbType === 'postgresql' ? (
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
                    <FieldInput
                      type="text"
                      label={t('form.label.filePath')}
                      placeholder={t('form.label.filePath')}
                      withAsterisk
                      rightSection={
                        <ActionIcon variant="subtle" onClick={notifyNoBackend} tooltip={t('form.tooltip.chooseFile')}>
                          <FolderOpen size="16px" />
                        </ActionIcon>
                      }
                      key={form.key('filePath')}
                      {...form.getInputProps('filePath')}
                    />
                  )}
                </Stack>
              </Paper>
            </Modal.Body>

            <Divider />

            <Group p="8px" justify="space-between" wrap="nowrap">
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
