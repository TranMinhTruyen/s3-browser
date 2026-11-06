import { CopyButton, DataList, Group, Text } from '@mantine/core';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ActionIcon from '@/components/buttons/ActionIcon';

export const EMPTY_VALUE = '-';

type DetailRowProps = {
  label: string;
  value?: string;
  copyable?: boolean;
};

/** One label/value item of a `DataList`: an empty value shows `-`, a `copyable` one gets a copy button. */
function DetailRow(props: DetailRowProps) {
  const { label, value, copyable } = props;

  const { t } = useTranslation('common', { keyPrefix: 'tooltip' });

  return (
    <DataList.Item>
      <DataList.ItemLabel>{label}</DataList.ItemLabel>
      {/* Full width so the copy button always sits at the right edge, not right after the text. */}
      <DataList.ItemValue w="100%">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Text inherit style={{ overflowWrap: 'anywhere', flex: 1 }}>
            {value || EMPTY_VALUE}
          </Text>
          {copyable && value ? (
            <CopyButton value={value}>
              {({ copied, copy }) => (
                <ActionIcon size="sm" onClick={copy} tooltip={copied ? t('copied') : t('copy')}>
                  {copied ? <Check size="14px" /> : <Copy size="14px" />}
                </ActionIcon>
              )}
            </CopyButton>
          ) : null}
        </Group>
      </DataList.ItemValue>
    </DataList.Item>
  );
}
export default DetailRow;
