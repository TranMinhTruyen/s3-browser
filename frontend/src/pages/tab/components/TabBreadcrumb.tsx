import { Anchor, Breadcrumbs, Group, Text } from '@mantine/core';
import { MouseEvent, memo, useCallback, useMemo } from 'react';
import { useTabListStore } from '@/common/stores/tabListStore';

type TabBreadcrumbProps = {
  tabId: string;
  bucket?: string;
  prefix: string;
};

/** Path of the current folder: the bucket, then one crumb per folder; every crumb but the last is a link. */
function TabBreadcrumb(props: TabBreadcrumbProps) {
  const { tabId, bucket, prefix } = props;

  const changePrefix = useTabListStore(s => s.changePrefix);

  // One crumb per folder in the prefix, each pointing to that folder's own prefix.
  const crumbs = useMemo(() => {
    const parts = prefix ? prefix.slice(0, -1).split('/') : [];
    return parts.map((name, i) => ({ name: name || '/', prefix: parts.slice(0, i + 1).join('/') + '/' }));
  }, [prefix]);

  // The crumb's folder prefix is stored in data-prefix ("" is the bucket root).
  const onClickBreadcrumb = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      changePrefix(tabId, e.currentTarget.dataset.prefix ?? '');
    },
    [changePrefix, tabId]
  );

  return (
    <Group gap="xs" p="4px" style={{ flexShrink: 0 }}>
      <Breadcrumbs separatorMargin="4px" style={{ minWidth: 0, flexWrap: 'wrap' }}>
        {prefix ? (
          <Anchor data-prefix="" onClick={onClickBreadcrumb}>
            {bucket}
          </Anchor>
        ) : (
          <Text fw={500}>{bucket}</Text>
        )}
        {crumbs.map((crumb, i) =>
          i === crumbs.length - 1 ? (
            <Text key={crumb.prefix} fw={500}>
              {crumb.name}
            </Text>
          ) : (
            <Anchor key={crumb.prefix} data-prefix={crumb.prefix} onClick={onClickBreadcrumb}>
              {crumb.name}
            </Anchor>
          )
        )}
      </Breadcrumbs>
    </Group>
  );
}
export default memo(TabBreadcrumb);
