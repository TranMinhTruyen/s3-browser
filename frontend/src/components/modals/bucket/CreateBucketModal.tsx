import { Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { CreateBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { FolderPlus } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type PolicyMode, validateBucketName, validatePolicy } from '@/common/utils/bucketUtils';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import BucketPolicyInput from '@/components/inputs/BucketPolicyInput';
import RegionCombobox from '@/components/inputs/combobox/RegionCombobox';
import FieldInput from '@/components/inputs/FieldInput';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

type CreateBucketModalProps = ModalProps & {
  connectionId: string;
  profileName?: string;
  // Only real AWS lets the user pick the region of the new bucket.
  withRegion: boolean;
  defaultRegion?: string;
};

/** Asks for the new bucket's name (and region on AWS); resolves true once the bucket is created, false if canceled. */
export default createMantineModal<CreateBucketModalProps, boolean>(
  props => {
    const {
      connectionId,
      profileName,
      withRegion,
      defaultRegion,
      mantine,
      size = 'md',
      centered = true,
      ...rest
    } = props;

    const { t } = useTranslation('createBucketModal');

    const [name, setName] = useState('');
    const [region, setRegion] = useState<string | null>(defaultRegion || null);
    const [mode, setMode] = useState<PolicyMode>('private');
    const [policy, setPolicy] = useState('');
    const ctrl = useRef<AbortController>(null);

    // Closing the modal (any way) cancels a create still in flight.
    useEffect(() => () => ctrl.current?.abort(), []);

    // An empty name is not flagged while typing, only the Create button stays disabled.
    const error = name ? validateBucketName(name) : null;

    const onChangeName = useCallback((e: ChangeEvent<HTMLInputElement>) => setName(e.currentTarget.value), []);

    const onChangePolicy = useCallback((value: string) => setPolicy(value), []);

    const onClickCreate = useCallback(async () => {
      if (validateBucketName(name)) return;
      ctrl.current = new AbortController();
      const { signal } = ctrl.current;
      let created = false;
      await callIPC(
        CreateBucket,
        [
          {
            connectionId,
            profileName,
            bucket: name,
            region: withRegion ? (region ?? undefined) : undefined,
            mode: mode !== 'private' ? mode : undefined,
            policy: mode === 'custom' ? policy : undefined,
          },
        ],
        {
          signal,
          resolveAction: () => {
            created = true;
          },
        }
      );
      // On failure callIPC already showed the error; the modal stays open so the user can fix the name.
      if (signal.aborted || !created) return;
      mantine.handler.resolve(true);
      mantine.handler.hide();
    }, [name, connectionId, profileName, withRegion, region, mode, policy, mantine.handler]);

    const onClickCancel = useCallback(() => {
      mantine.handler.resolve(false);
      mantine.handler.hide();
    }, [mantine.handler]);

    return (
      <Modal.Root {...mantine.props} size={size} centered={centered} {...rest}>
        <Modal.Overlay />
        <Modal.Content>
          <Modal.Header
            pos="relative"
            p="8px"
            mih="0px"
            style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
          >
            <Group
              gap="xs"
              style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            >
              <FolderPlus />
              <Title order={4}>{t('title')}</Title>
            </Group>
            <Modal.CloseButton size="md" aria-label={t('common:button.close')} />
          </Modal.Header>

          <Divider />

          <Modal.Body p="8px">
            <Paper withBorder p="8px">
              <Stack gap="8px">
                <FieldInput
                  data-autofocus
                  label={t('label.name')}
                  description={t('hint.name')}
                  placeholder={t('placeholder.name')}
                  withAsterisk
                  value={name}
                  error={error}
                  onChange={onChangeName}
                />
                {withRegion ? <RegionCombobox value={region} onChange={setRegion} /> : null}
                <Text size="sm" fw={500}>
                  {t('label.permission')}
                </Text>
                {withRegion && mode !== 'private' ? (
                  <Text size="sm" c="var(--mantine-color-orange-filled)">
                    {t('warning.publicAccessBlock')}
                  </Text>
                ) : null}
                <BucketPolicyInput mode={mode} policy={policy} onChangeMode={setMode} onChangePolicy={onChangePolicy} />
              </Stack>
            </Paper>
          </Modal.Body>

          <Divider />

          <Group p="8px" justify="space-between" wrap="nowrap">
            <Button onClick={onClickCancel} color="red">
              {t('common:button.cancel')}
            </Button>
            <Button
              onClick={onClickCreate}
              disabled={!name || !!error || (mode === 'custom' && (!policy || !!validatePolicy(mode, policy)))}
            >
              {t('create')}
            </Button>
          </Group>
        </Modal.Content>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
