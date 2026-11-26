import { Anchor, Breadcrumbs, Group, Text } from '@mantine/core';
import { MouseEvent, memo, useCallback, useMemo } from 'react';
import { useTabListStore } from '@/pages/s3/stores/tabListStore';

type TabBreadcrumbProps = {
  tabId: string;
  bucket?: string;
  prefix: string;
};

/** Đường dẫn thư mục hiện tại: bucket rồi đến từng crumb cho mỗi thư mục; mọi crumb trừ crumb cuối đều là liên kết. */
function TabBreadcrumb(props: TabBreadcrumbProps) {
  const { tabId, bucket, prefix } = props;

  const changePrefix = useTabListStore(s => s.changePrefix);

  // Mỗi thư mục trong tiền tố có một crumb trỏ đến chính tiền tố của thư mục đó.
  const crumbs = useMemo(() => {
    const parts = prefix ? prefix.slice(0, -1).split('/') : [];
    return parts.map((name, i) => ({ name: name || '/', prefix: parts.slice(0, i + 1).join('/') + '/' }));
  }, [prefix]);

  // Tiền tố thư mục của crumb được lưu trong data-prefix ("" nghĩa là thư mục gốc bucket).
  const onClickBreadcrumb = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      changePrefix(tabId, e.currentTarget.dataset.prefix ?? '');
    },
    [changePrefix, tabId]
  );

  return (
    <Group gap="xs" p="0.25rem" style={{ flexShrink: 0 }}>
      <Breadcrumbs separatorMargin="0.25rem" style={{ minWidth: 0, flexWrap: 'wrap' }}>
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
