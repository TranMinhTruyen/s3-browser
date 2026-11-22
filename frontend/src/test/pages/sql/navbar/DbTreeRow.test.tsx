import type { FlattenedTreeNodeData } from '@mantine/core';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DbTreeRow, { DbTreeStatusRow, NODE_HEIGHT } from '@/pages/sql/navbar/DbTreeRow';
import type { NodeKind, NodeMeta } from '@/pages/sql/utils/dbObjectSource';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const onToggle = vi.fn();
const onSelect = vi.fn();
const onOpenTable = vi.fn();

const flat = (meta: NodeMeta, extra: Partial<FlattenedTreeNodeData> = {}): FlattenedTreeNodeData =>
  ({
    node: { value: `p1:${meta.name}`, label: meta.name, nodeProps: meta },
    level: 1,
    hasChildren: false,
    expanded: false,
    ...extra,
  }) as FlattenedTreeNodeData;

const renderRow = (data: FlattenedTreeNodeData, selected = false) =>
  renderWithProviders(
    <DbTreeRow
      profileKey="p1"
      flat={data}
      selected={selected}
      onToggle={onToggle}
      onSelect={onSelect}
      onOpenTable={onOpenTable}
    />
  );

const rowOf = (name: string) => screen.getByText(name).closest<HTMLElement>('div')!;
const table = (extra: Partial<FlattenedTreeNodeData> = {}) =>
  flat({ kind: 'table', schema: 'main', name: 'users' }, extra);

beforeEach(() => vi.clearAllMocks());

describe('DbTreeRow', () => {
  it('exports the node height', () => {
    expect(NODE_HEIGHT).toBe(28);
  });

  it.each<[NodeKind, string]>([
    ['database', 'lucide-database'],
    ['schema', 'lucide-layers'],
    ['group', 'lucide-folder'],
    ['table', 'lucide-table-2'],
    ['view', 'lucide-eye'],
    ['index', 'lucide-list-tree'],
    ['trigger', 'lucide-zap'],
  ])('shows its own icon for a %s', (kind, icon) => {
    const name = kind === 'group' ? 'tables' : 'obj';
    const { container } = renderRow(
      flat({ kind, schema: 'main', name, group: kind === 'group' ? 'tables' : undefined })
    );
    expect(container.querySelector(`svg.${icon}`)).toBeInTheDocument();
    expect(screen.getByText(kind === 'group' ? 'Tables' : 'obj')).toBeInTheDocument();
  });

  it('translates the name of a group', () => {
    renderRow(flat({ kind: 'group', schema: 'main', name: 'tables', group: 'tables' }));
    expect(screen.getByText('Tables')).toBeInTheDocument();
    expect(screen.queryByText('tables')).not.toBeInTheDocument();
  });

  it('indents by level', () => {
    const { rerender } = renderRow(table({ level: 1 }));
    expect(rowOf('users').style.paddingLeft).toBe('0.5rem');

    rerender(
      <DbTreeRow
        profileKey="p1"
        flat={table({ level: 3 })}
        selected={false}
        onToggle={onToggle}
        onSelect={onSelect}
        onOpenTable={onOpenTable}
      />
    );
    expect(rowOf('users').style.paddingLeft).toBe('2.5rem');
  });

  it('marks the selected row only', () => {
    const { unmount } = renderRow(table(), true);
    expect(rowOf('users')).toHaveAttribute('data-selected', 'true');
    unmount();
    renderRow(table(), false);
    expect(rowOf('users')).not.toHaveAttribute('data-selected');
  });

  it('selects the node on click', () => {
    renderRow(table());
    fireEvent.click(rowOf('users'));
    expect(onSelect).toHaveBeenCalledWith('p1:users');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it.each([
    ['expanded', true, 'lucide-chevron-down'],
    ['collapsed', false, 'lucide-chevron-right'],
  ])('shows a chevron for a %s node with children, and the chevron toggles without selecting', (_n, expanded, icon) => {
    const { container } = renderRow(table({ hasChildren: true, expanded }));
    const chevron = container.querySelector(`svg.${icon}`)!;
    expect(chevron).toBeInTheDocument();

    fireEvent.click(chevron);

    expect(onToggle).toHaveBeenCalledWith('p1:users');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows no chevron and ignores a click on its place for a leaf', () => {
    const { container } = renderRow(table());
    expect(container.querySelector('svg.lucide-chevron-down, svg.lucide-chevron-right')).not.toBeInTheDocument();

    fireEvent.click(container.querySelector('span')!);

    expect(onToggle).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1); // the click still reaches the row
  });

  it('opens the table tab on double click of a table', () => {
    renderRow(table());
    fireEvent.doubleClick(rowOf('users'));
    expect(onOpenTable).toHaveBeenCalledWith('p1', 'main', 'users');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it.each<NodeKind>(['view', 'index', 'trigger'])('does nothing on double click of a %s', kind => {
    renderRow(flat({ kind, schema: 'main', name: 'obj' }));
    fireEvent.doubleClick(rowOf('obj'));
    expect(onOpenTable).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it.each<[NodeKind]>([['database'], ['schema'], ['group']])('folds or unfolds a %s on double click', kind => {
    const name = kind === 'group' ? 'tables' : 'obj';
    renderRow(flat({ kind, schema: 'main', name, group: 'tables' }, { hasChildren: true }));
    fireEvent.doubleClick(rowOf(kind === 'group' ? 'Tables' : 'obj'));
    expect(onToggle).toHaveBeenCalledWith(`p1:${name}`);
    expect(onOpenTable).not.toHaveBeenCalled();
  });

  it('does nothing on double click of an empty group', () => {
    renderRow(flat({ kind: 'group', schema: 'main', name: 'views', group: 'views' }));
    fireEvent.doubleClick(rowOf('Views'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('DbTreeStatusRow', () => {
  it.each([
    ['loading', 'Loading objects…', true],
    ['error', 'Could not load the objects', false],
    ['empty', 'No objects', false],
  ] as const)('shows the %s line', (status, text, spinner) => {
    const { container } = renderWithProviders(<DbTreeStatusRow status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(!!container.querySelector('.mantine-Loader-root')).toBe(spinner);
  });
});
