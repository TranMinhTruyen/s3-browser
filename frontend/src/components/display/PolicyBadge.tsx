import { Badge, Skeleton, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

type PolicyBadgeProps = {
  mode?: string;
};

const POLICY_BADGE_COLORS = { private: 'gray', public: 'orange', custom: 'blue' } as const;

/** Policy mode of a bucket: skeleton while unknown yet, nothing when it could not be read ("unknown"). */
function PolicyBadge({ mode }: PolicyBadgeProps) {
  const { t } = useTranslation('bucket', { keyPrefix: 'page' });
  if (!mode) return <Skeleton w={56} h={18} radius="xl" />;
  if (!(mode in POLICY_BADGE_COLORS)) return null;
  const policyMode = mode as keyof typeof POLICY_BADGE_COLORS;
  return (
    <Tooltip label={t(`tooltip.policy.${policyMode}`)}>
      <Badge size="sm" variant="light" color={`var(--mantine-color-${POLICY_BADGE_COLORS[policyMode]}-6)`}>
        {t(`badge.policy.${policyMode}`)}
      </Badge>
    </Tooltip>
  );
}
export default PolicyBadge;
