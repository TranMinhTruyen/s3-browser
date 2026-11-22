import type { FlattenedTreeNodeData } from '@mantine/core';
import { Loader, Text } from '@mantine/core';
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Folder,
  Layers,
  ListTree,
  type LucideIcon,
  Table2,
  Zap,
} from 'lucide-react';
import { type MouseEvent, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import TruncatedText from '@/components/display/TruncatedText';
import classes from '@/pages/sql/navbar/DbTreeRow.module.css';
import type { NodeKind, NodeMeta } from '@/pages/sql/utils/dbObjectSource';

/** Node height, px at the medium interface size; the list multiplies it by the interface scale. */
export const NODE_HEIGHT = 28;

/** Indent of one tree level and of the first one, in rem (the node rows sit under the profile card). */
const INDENT = 1;
const BASE_INDENT = 0.5;

const KIND_ICON: Record<NodeKind, { Icon: LucideIcon; color: string }> = {
  database: { Icon: Database, color: 'var(--mantine-color-violet-6)' },
  schema: { Icon: Layers, color: 'var(--mantine-color-grape-6)' },
  group: { Icon: Folder, color: 'var(--mantine-color-yellow-6)' },
  table: { Icon: Table2, color: 'var(--mantine-color-blue-6)' },
  view: { Icon: Eye, color: 'var(--mantine-color-teal-6)' },
  index: { Icon: ListTree, color: 'var(--mantine-color-orange-6)' },
  trigger: { Icon: Zap, color: 'var(--mantine-color-red-6)' },
};

type DbTreeRowProps = {
  profileKey: string;
  flat: FlattenedTreeNodeData;
  selected: boolean;
  // The three handlers must be stable (owned by the parent) so memo skips unchanged rows.
  onToggle: (value: string) => void;
  onSelect: (value: string) => void;
  onOpenTable: (profileKey: string, schema: string, name: string) => void;
};

/** One node of an object tree: indent, chevron, icon and name. Click selects; double click opens a table. */
function DbTreeRow({ profileKey, flat, selected, onToggle, onSelect, onOpenTable }: DbTreeRowProps) {
  const { t } = useTranslation('sqlNavbar');
  const { node, level, hasChildren, expanded } = flat;
  const meta = node.nodeProps as NodeMeta;
  const { Icon, color } = KIND_ICON[meta.kind];

  const onClickRow = useCallback(() => onSelect(node.value), [onSelect, node.value]);

  const onClickChevron = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onToggle(node.value);
    },
    [onToggle, node.value]
  );

  // A table opens its tab; a node with children folds/unfolds; a view, index or trigger does nothing.
  const onDoubleClickRow = useCallback(() => {
    if (meta.kind === 'table') onOpenTable(profileKey, meta.schema, meta.name);
    else if (hasChildren) onToggle(node.value);
  }, [meta, profileKey, hasChildren, onOpenTable, onToggle, node.value]);

  return (
    <div
      className={classes.row}
      data-selected={selected || undefined}
      style={{ paddingLeft: `${BASE_INDENT + (level - 1) * INDENT}rem` }}
      onClick={onClickRow}
      onDoubleClick={onDoubleClickRow}
    >
      <span className={classes.chevron} onClick={hasChildren ? onClickChevron : undefined}>
        {hasChildren ? expanded ? <ChevronDown size="1rem" /> : <ChevronRight size="1rem" /> : null}
      </span>
      <Icon size="1rem" color={color} className={classes.icon} />
      <TruncatedText size="sm">{meta.kind === 'group' ? t(`tree.${meta.name}`) : meta.name}</TruncatedText>
    </div>
  );
}

export default memo(DbTreeRow);

const STATUS_KEY = { loading: 'loading', error: 'loadError', empty: 'empty' } as const;

type DbTreeStatusRowProps = {
  status: 'loading' | 'error' | 'empty';
};

/** The line under a profile card while its tree loads, failed to load, or has no objects. */
export const DbTreeStatusRow = memo(function DbTreeStatusRow({ status }: DbTreeStatusRowProps) {
  const { t } = useTranslation('sqlNavbar');
  return (
    <div className={classes.status} style={{ paddingLeft: `${BASE_INDENT + INDENT}rem` }}>
      {status === 'loading' ? <Loader size="xs" /> : null}
      <Text size="sm" c="dimmed">
        {t(`tree.${STATUS_KEY[status]}`)}
      </Text>
    </div>
  );
});
