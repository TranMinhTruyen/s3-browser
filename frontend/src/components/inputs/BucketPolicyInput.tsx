import { Stack, Text } from '@mantine/core';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { POLICY_MODES, type PolicyMode, validatePolicy } from '@/common/utils/bucketUtils';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';

type BucketPolicyInputProps = {
  mode: PolicyMode;
  policy: string;
  readOnly?: boolean;
  onChangeMode: (mode: PolicyMode) => void;
  onChangePolicy: (policy: string) => void;
};

/** Picks a bucket's access as private / public read-only / custom policy JSON. */
export default function BucketPolicyInput({
  mode,
  policy,
  readOnly,
  onChangeMode,
  onChangePolicy,
}: BucketPolicyInputProps) {
  const { t } = useTranslation('bucketPolicyModal');

  const modeOptions = useMemo(() => POLICY_MODES.map(value => ({ value, label: t(`mode.${value}`) })), [t]);

  const onChangeSegment = useCallback((value: string) => onChangeMode(value as PolicyMode), [onChangeMode]);

  return (
    <Stack gap="8px">
      <SegmentedControl fullWidth data={modeOptions} value={mode} disabled={readOnly} onChange={onChangeSegment} />
      <Text size="sm" c="dimmed">
        {t(`hint.${mode}`)}
      </Text>
      {mode === 'custom' ? (
        <FieldInput
          type="json"
          label={t('label.policy')}
          autosize
          minRows={8}
          maxRows={16}
          readOnly={readOnly}
          value={policy}
          error={validatePolicy(mode, policy)}
          onChange={onChangePolicy}
        />
      ) : null}
    </Stack>
  );
}
