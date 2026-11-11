import { Center, Group, Loader, Text } from '@mantine/core';
import { CancelUploadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import { useUploaderStore } from '@/pages/s3/stores/uploaderStore';
import TransferRow from '@/pages/s3/transfer/TransferRow';
import TransferSizes from '@/pages/s3/transfer/TransferSizes';

type UploaderItemProps = {
  id: string;
};

/** One upload row; shows a loader while the backend finalizes the object. */
function UploaderItem(props: UploaderItemProps) {
  const { id } = props;

  const { t } = useTranslation('uploaderWindow');

  const item = useUploaderStore(s => s.uploadItems[id]);

  const onClickCancelUpload = useCallback(async () => {
    await callIPC(CancelUploadOne, [id]);
  }, [id]);

  if (!item) return null;

  const finalizing = item.total > 0 && item.uploaded >= item.total;
  const percent = finalizing ? 100 : item.total > 0 ? Math.min(99, Math.round((item.uploaded / item.total) * 100)) : 0;

  return (
    <TransferRow
      title={`${t('label.objectLbl')}: ${item.fileName}`}
      percent={percent}
      ringLabel={
        finalizing ? (
          <Center>
            <Loader size="xs" />
          </Center>
        ) : (
          <Text size="xs" ta="center">
            {percent}%
          </Text>
        )
      }
      cancelTooltip={t('action.cancel')}
      onCancel={onClickCancelUpload}
    >
      {finalizing ? (
        <Group gap="xs">
          <Text c="var(--mantine-color-blue-filled)">{t('label.finalizingLbl')}</Text>
          <Text size="xs" c="dimmed">
            {formatFileSize(item.total)}
          </Text>
        </Group>
      ) : (
        <TransferSizes
          doneLabel={t('label.uploadedLbl')}
          doneSize={formatFileSize(item.uploaded)}
          remainingLabel={t('label.remainingLbl')}
          remainingSize={formatFileSize(Math.max(0, item.total - item.uploaded))}
        />
      )}
    </TransferRow>
  );
}

export default memo(UploaderItem);
