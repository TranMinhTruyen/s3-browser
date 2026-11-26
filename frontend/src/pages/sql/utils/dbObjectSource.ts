import type { TreeNodeData } from '@mantine/core';
import { FetchRows, GetSchemaTree, GetTableInfo, OpenTableRows } from '@wails/S3Browser/internal/handlers/dbhandler';
import type { FetchRowsOutput, SchemaTreeOutput, TableInfoOutput } from '@wails/S3Browser/models';
import type { Output } from '@wails/S3Browser/models/common';
import { JSONStream } from '@wailsio/runtime';
import { callIPC, showOutputMessages } from '@/common/utils/ipcUtils';
import { getMockRows, getMockSchemas, getMockTableInfo } from '@/pages/sql/mock/dbObjectMock';
import type { Provider } from '@/pages/sql/stores/dbProfileStore';

/*
 * Nguồn lấy cây đối tượng, cấu trúc bảng và các hàng: SQLite gọi backend, PostgreSQL hiện vẫn dùng dữ liệu mock.
 * Mỗi hàm trả về null nếu lời gọi thất bại hoặc bị hủy (backend đã hiển thị toast).
 */

type DbSchema = SchemaTreeOutput['schemas'][number];

export type NodeKind = 'database' | 'schema' | 'group' | 'table' | 'view' | 'index' | 'trigger';
type GroupKind = 'tables' | 'views' | 'indexes' | 'triggers';

/** Kiểu dữ liệu của một node trong cây. `name` là tên đối tượng (hoặc id nhóm nếu là nhóm), lưu trong `nodeProps`. */
export type NodeMeta = { kind: NodeKind; schema: string; name: string; group?: GroupKind };

const SEP = '\u001f';

/** Giá trị node, duy nhất giữa các profile: id profile nối với đường dẫn của node. */
const nodeValue = (profileId: string, ...path: string[]) => [profileId, ...path].join(SEP);

/** Trả về true nếu giá trị node thuộc cây của profile đó. */
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

/** Cây của profile: schema ở cấp trên cùng (SQLite `main`), hoặc một node database phía trên chúng (PostgreSQL). */
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

/** Tên các bảng và view để gợi ý SQL tự động. */
export const listTableNames = (schemas: DbSchema[]): string[] => [
  ...new Set(schemas.flatMap(schema => [...(schema.tables ?? []), ...(schema.views ?? [])])),
];

/** Các schema của profile đã kết nối. */
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

/** Cột, chỉ mục, ràng buộc, khóa ngoại và DDL của một bảng. */
export const loadTableInfo = async (
  provider: Provider,
  ref: TableRef,
  signal: AbortSignal
): Promise<TableInfoOutput | null> => {
  if (provider !== 'sqlite') return getMockTableInfo(ref.schema, ref.table);
  return (await callIPC(GetTableInfo, [ref], { signal })) ?? null;
};

/** Một trang dữ liệu. Trang có thể ít hàng hơn kích thước trang mà vẫn chưa phải trang cuối. */
export type RowPage = { rows: (string | null)[][]; done: boolean };

/** Stream every remaining page from an open row cursor. */
export const streamCursorRows = (
  tabId: string,
  cursorId: number,
  signal: AbortSignal,
  onPage: (page: RowPage) => void
): Promise<boolean> => {
  const stream = JSONStream('db-fetch-rows');

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (completed: boolean, error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(completed);
    };

    const onAbort = () => {
      stream.close();
      finish(false);
    };

    stream.onopen = () => {
      if (signal.aborted) {
        onAbort();
        return;
      }
      stream.send({ tabId, cursorId, all: true });
    };

    stream.onmessage = event => {
      const output = event.data as Output<FetchRowsOutput>;
      showOutputMessages(output);
      if (!output.result || !output.body) {
        stream.close();
        finish(false);
        return;
      }

      try {
        onPage(output.body);
      } catch (error) {
        stream.close();
        finish(false, error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (output.body.done) {
        try {
          stream.send({ type: 'ack' });
        } catch (error) {
          stream.close();
          finish(false, error instanceof Error ? error : new Error(String(error)));
          return;
        }
        finish(true);
      }
    };

    stream.onclose = () => {
      if (signal.aborted) finish(false);
      else if (!settled) finish(false, new Error('Rows stream closed before all rows arrived'));
    };

    stream.onerror = () => {
      finish(false, new Error('Rows stream failed'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
};

/** Trang đầu của bảng; `cursorId` là null khi đã đọc hết dữ liệu. */
export type TableRows = RowPage & { columns: string[]; cursorId: number | null };

/** Trang đầu các hàng của bảng, trên kết nối của tab `tabId`. */
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
 * Trang kế tiếp sau `loaded` hàng; dữ liệu mock không có con trỏ nên dùng số lượng hàng đã tải. `all` đọc toàn bộ
 * số hàng còn lại trong một lần gọi.
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
