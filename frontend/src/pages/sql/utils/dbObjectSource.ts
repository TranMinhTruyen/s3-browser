import type { TreeNodeData } from '@mantine/core';
import { FetchRows, GetSchemaTree, GetTableInfo, OpenTableRows } from '@wails/S3Browser/internal/handlers/dbhandler';
import type { SchemaTreeOutput, TableInfoOutput } from '@wails/S3Browser/models';
import { callIPC } from '@/common/utils/ipcUtils';
import { getMockRows, getMockSchemas, getMockTableInfo } from '@/pages/sql/mock/dbObjectMock';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';

/*
 * Where the object tree, table structure and table rows come from: SQLite asks the backend, PostgreSQL still
 * reads the mock. Each function resolves null when the call failed or was aborted (the backend already toasted).
 */

type DbSchema = SchemaTreeOutput['schemas'][number];

export type NodeKind = 'database' | 'schema' | 'group' | 'table' | 'view' | 'index' | 'trigger';
type GroupKind = 'tables' | 'views' | 'indexes' | 'triggers';

/** What a tree node is. `name` is the object name (the group id for a group). Kept in `nodeProps` of the node. */
export type NodeMeta = { kind: NodeKind; schema: string; name: string; group?: GroupKind };

const SEP = '\u001f';

/** Node value, unique across profiles: the profile id followed by the path of the node. */
const nodeValue = (profileId: string, ...path: string[]) => [profileId, ...path].join(SEP);

/** True when the node value belongs to the tree of the profile. */
export const isNodeOf = (profileId: string, value: string) => value.startsWith(`${profileId}${SEP}`);

const leaf = (profileId: string, path: string[], meta: NodeMeta): TreeNodeData => ({
  value: nodeValue(profileId, ...path),
  label: meta.name,
  nodeProps: meta,
});

const schemaNode = (profileId: string, root: string, schema: DbSchema): TreeNodeData => {
  const { name } = schema;
  const path = [root, name];
  const group = (id: GroupKind, kind: NodeKind, names: string[]): TreeNodeData => ({
    value: nodeValue(profileId, ...path, id),
    label: id,
    nodeProps: { kind: 'group', schema: name, name: id, group: id } satisfies NodeMeta,
    children: names.map(item => leaf(profileId, [...path, id, item], { kind, schema: name, name: item })),
  });
  return {
    value: nodeValue(profileId, ...path),
    label: name,
    nodeProps: { kind: 'schema', schema: name, name } satisfies NodeMeta,
    children: [
      group('tables', 'table', schema.tables ?? []),
      group('views', 'view', schema.views ?? []),
      group(
        'indexes',
        'index',
        (schema.indexes ?? []).map(item => item.name)
      ),
      group(
        'triggers',
        'trigger',
        (schema.triggers ?? []).map(item => item.name)
      ),
    ],
  };
};

/** Tree of a profile: schemas at the top (SQLite `main`), or one database node over them (PostgreSQL). */
export const buildTreeNodes = (profileId: string, database: string | null, schemas: DbSchema[]): TreeNodeData[] => {
  const nodes = schemas.map(schema => schemaNode(profileId, database ?? '', schema));
  if (database === null) return nodes;
  return [
    {
      value: nodeValue(profileId, database),
      label: database,
      nodeProps: { kind: 'database', schema: '', name: database } satisfies NodeMeta,
      children: nodes,
    },
  ];
};

/** Names of the tables and views, for SQL autocomplete. */
export const listTableNames = (schemas: DbSchema[]): string[] => [
  ...new Set(schemas.flatMap(schema => [...(schema.tables ?? []), ...(schema.views ?? [])])),
];

/** Schemas of a connected profile. */
export const loadSchemas = async (
  provider: Provider,
  profileId: string,
  signal: AbortSignal,
  scope: string
): Promise<DbSchema[] | null> => {
  if (provider !== 'sqlite') return getMockSchemas();
  const output = await callIPC(GetSchemaTree, [{ profileId }], { signal, scope });
  return output ? (output.schemas ?? []) : null;
};

export type TableRef = { profileId: string; schema: string; table: string };

/** Columns, indexes, constraints, foreign keys and DDL of a table. */
export const loadTableInfo = async (
  provider: Provider,
  ref: TableRef,
  signal: AbortSignal
): Promise<TableInfoOutput | null> => {
  if (provider !== 'sqlite') return getMockTableInfo(ref.schema, ref.table);
  return (await callIPC(GetTableInfo, [ref], { signal })) ?? null;
};

/** A page of rows. It can hold fewer rows than the page size and still not be the last one. */
export type RowPage = { rows: (string | null)[][]; done: boolean };

/** First page of a table; `cursorId` is null once everything was read. */
export type TableRows = RowPage & { columns: string[]; cursorId: number | null };

/** The first page of the rows of a table, on the connection of tab `tabId`. */
export const openTableRows = async (
  provider: Provider,
  tabId: string,
  ref: TableRef,
  signal: AbortSignal
): Promise<TableRows | null> => {
  if (provider !== 'sqlite') {
    const page = getMockRows(ref.schema, ref.table, 0);
    return page && { ...page, cursorId: page.done ? null : 0 };
  }
  const result = await callIPC(OpenTableRows, [{ ...ref, tabId }], { signal });
  if (!result) return null;
  const { columns, rows, done, cursorId } = result;
  return { columns: columns.map(column => column.name), rows, done, cursorId };
};

/**
 * The next page after `loaded` rows; the mock has no cursor, so it works from the row count. `all` reads every
 * remaining row in one call.
 */
export const fetchTableRows = async (
  provider: Provider,
  tabId: string,
  ref: TableRef,
  cursorId: number,
  loaded: number,
  signal: AbortSignal,
  all = false
): Promise<RowPage | null> => {
  if (provider !== 'sqlite') return getMockRows(ref.schema, ref.table, loaded, all);
  return (await callIPC(FetchRows, [{ tabId, cursorId, all }], { signal })) ?? null;
};
