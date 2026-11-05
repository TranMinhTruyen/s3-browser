import { Center, Divider, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { DeleteBucket, GetBucketDeleteInfo } from '@wails/S3Browser/internal/handlers/buckethandler';
import { DeleteBucketInfoOutput, DeleteBucketOutput } from '@wails/S3Browser/models/bucket';
import { Output } from '@wails/S3Browser/models/common';
import { Trash2 } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import FieldInput from '@/components/inputs/FieldInput';
import { showDeleteResultModal } from '@/components/modals/lazyModals';
import { WARNING_BG_COLOR } from '@/components/modals/modalColors';

type DeleteBucketModalProps = ModalProps & {
  connectionId: string;
  profileName?: string;
  bucket: string;
};

const WARNING_TEXT_COLOR = 'var(--mantine-color-orange-filled)';
const ERROR_TEXT_COLOR = 'var(--mantine-color-red-filled)';

/**
 * Asks the user to type the bucket name before deleting it, with warnings from what the bucket holds.
 * Resolves the delete result when the bucket or some of its objects were deleted, null otherwise (canceled or failed).
 */
export default createMantineModal<DeleteBucketModalProps, DeleteBucketOutput | null>(props => {
  const { connectionId, profileName, bucket, mantine, size = 'md', centered = true, ...rest } = props;

  const { t } = useTranslation('deleteBucketModal');

  // undefined while checking, null when the check failed.
  const [info, setInfo] = useState<DeleteBucketInfoOutput | null>();
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Closing the modal (any way) cancels the check in flight, so a late result never sets state.
  useEffect(() => {
    const ctrl = new AbortController();
    callIPC(GetBucketDeleteInfo, [{ connectionId, profileName, bucket }], { signal: ctrl.signal }).then(output => {
      if (!ctrl.signal.aborted) setInfo(output ?? null);
    });
    return () => ctrl.abort();
  }, [connectionId, profileName, bucket]);

  // The check failed and callIPC already told the user: nothing to confirm.
  useEffect(() => {
    if (info !== null) return;
    mantine.handler.resolve(null);
    mantine.handler.hide();
  }, [info, mantine.handler]);

  const objectLockBlocked = !!info?.objectLock && info.empty === false;
  const canDelete = !!info && !objectLockBlocked && confirmName === bucket;

  const onChangeConfirmName = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setConfirmName(e.currentTarget.value),
    []
  );

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve(null);
    mantine.handler.hide();
  }, [mantine.handler]);

  const onClickDelete = useCallback(async () => {
    setDeleting(true);
    // Not aborted from here: a half-done delete would leave the bucket half emptied without telling the user.
    let result: DeleteBucketOutput | undefined;
    const onResult = (output?: Output<DeleteBucketOutput>) => {
      result = output?.body;
    };
    await callIPC(DeleteBucket, [{ connectionId, profileName, bucket }], {
      resolveAction: onResult,
      rejectAction: onResult,
    });
    const changed = !!result && (result.bucketDeleted || result.deleted > 0 || result.failed > 0);
    if (result && result.failed > 0) {
      showDeleteResultModal({ deleted: result.deleted, failed: result.failed, failures: result.failures });
    }
    mantine.handler.resolve(changed ? (result ?? null) : null);
    mantine.handler.hide();
  }, [connectionId, profileName, bucket, mantine.handler]);

  return (
    <Modal.Root
      {...mantine.props}
      closeOnEscape={mantine.props.closeOnEscape && !deleting}
      closeOnClickOutside={mantine.props.closeOnClickOutside && !deleting}
      size={size}
      centered={centered}
      {...rest}
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: WARNING_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Trash2 />
            <Title order={4}>{t('title')}</Title>
          </Group>
          {deleting ? null : <Modal.CloseButton size="md" aria-label={t('common:button.close')} />}
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Paper withBorder p="8px">
            {!info ? (
              <Center py="md">
                <Loader size="sm" aria-label={t('checking')} />
              </Center>
            ) : (
              <Stack gap="8px">
                {objectLockBlocked ? (
                  <Text c={ERROR_TEXT_COLOR}>{t('warning.objectLockBlocked', { bucket })}</Text>
                ) : (
                  <>
                    <Text c={ERROR_TEXT_COLOR}>{t('warning.irreversible')}</Text>
                    {info.empty === false ? <Text c={WARNING_TEXT_COLOR}>{t('warning.notEmpty')}</Text> : null}
                    {info.empty == null ? <Text c={WARNING_TEXT_COLOR}>{t('warning.unknown')}</Text> : null}
                    {info.versioning && info.versioning !== 'Off' ? (
                      <Text c={WARNING_TEXT_COLOR}>{t('warning.versioned')}</Text>
                    ) : null}
                    {info.objectLock && info.empty == null ? (
                      <Text c={WARNING_TEXT_COLOR}>{t('warning.objectLockUnknown')}</Text>
                    ) : null}
                  </>
                )}
                <FieldInput
                  data-autofocus
                  label={t('label.confirmName', { bucket })}
                  placeholder={t('placeholder.confirmName')}
                  disabled={objectLockBlocked || deleting}
                  value={confirmName}
                  onChange={onChangeConfirmName}
                />
                {deleting ? <Text c="dimmed">{t('deleting')}</Text> : null}
              </Stack>
            )}
          </Paper>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify={deleting ? 'flex-end' : 'space-between'} wrap="nowrap">
          {deleting ? null : (
            <Button onClick={onClickCancel} color="red">
              {t('common:button.cancel')}
            </Button>
          )}
          <Button onClick={onClickDelete} disabled={!canDelete} loading={deleting}>
            {t('delete')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
