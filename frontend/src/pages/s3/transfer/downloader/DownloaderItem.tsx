import { Text } from '@mantine/core';
import { CancelDownloadOne } from '@wails/S3Browser/internal/handlers/buckethandler';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import { formatFileSize } from '@/common/utils/stringUtils';
import { useDownloaderStore } from '@/pages/s3/stores/downloaderStore';
import TransferRow from '@/pages/s3/transfer/TransferRow';
import TransferSizes from '@/pages/s3/transfer/TransferSizes';

type DownloaderItemProps = {
  id: string;
};

/** One download row. */
function DownloaderItem(props: DownloaderItemProps) {
  const { id } = props;
  const { t } = useTranslation('downloaderWindow');

  const item = useDownloaderStore(s => s.downloadItems[id]);

  const onClickCancelDownload = useCallback(async () => {
    await callIPC(CancelDownloadOne, [id]);
  }, [id]);

  if (!item) return null;

  const percent = item.total > 0 ? Math.min(99, Math.round((item.downloaded / item.total) * 100)) : 100;

  return (
    <TransferRow
      title={`${t('label.objectLbl')}: ${item.fileName}`}
      percent={percent}
      ringLabel={
        <Text size="xs" ta="center">
          {percent}%
        </Text>
      }
      cancelTooltip={t('action.cancel')}
      onCancel={onClickCancelDownload}
    >
      <TransferSizes
        doneLabel={t('label.downloadedLbl')}
        doneSize={formatFileSize(item.downloaded)}
        remainingLabel={t('label.remainingLbl')}
        remainingSize={formatFileSize(item.total - item.downloaded)}
      />
    </TransferRow>
  );
}

export default memo(DownloaderItem);
