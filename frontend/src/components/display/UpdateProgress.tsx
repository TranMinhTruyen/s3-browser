import { Progress, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '@/common/utils/stringUtils';

type UpdateProgressProps = {
  written: number;
  total: number;
};

/** Download progress bar with "45% · 12.00 MiB / 30.00 MiB"; the bar is animated while the total is unknown (0). */
function UpdateProgress(props: UpdateProgressProps) {
  const { written, total } = props;

  const { t } = useTranslation('appUpdate');

  const percent = total > 0 ? Math.min(100, Math.floor((written * 100) / total)) : 0;
  const text =
    total > 0
      ? t('progress', { percent, written: formatFileSize(written), total: formatFileSize(total) })
      : t('progressUnknown', { written: formatFileSize(written) });

  return (
    <Stack gap="4px">
      <Progress value={total > 0 ? percent : 100} animated={total === 0} size="sm" />
      <Text size="xs">{text}</Text>
    </Stack>
  );
}
export default UpdateProgress;
