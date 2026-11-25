// Builds the architecture workbook (Vietnamese) with diagrams drawn in cells, so it opens in any Excel
// without images and stays editable.
//
//   bun run --cwd docs architecture
//
// Output: docs/S3Browser-architecture.vi.xlsx. The source of truth is docs/ARCHITECTURE.vi.md; update both
// together, then run this script again.
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const OUT = resolve(import.meta.dirname, '..', 'S3Browser-architecture.vi.xlsx');
const FONT = 'Arial';

// Fill colors per layer; the legend on the first sheet uses the same table.
const LAYER = {
  fe: { fill: 'FFDDEBF7', border: 'FF5B9BD5', name: 'Frontend (React, WebView)' },
  go: { fill: 'FFE2EFDA', border: 'FF70AD47', name: 'Backend Go' },
  rust: { fill: 'FFFCE4D6', border: 'FFED7D31', name: 'Rust native (s3b_db.dll)' },
  store: { fill: 'FFEDEDED', border: 'FF7F7F7F', name: 'Dữ liệu / file' },
  ext: { fill: 'FFFFF2CC', border: 'FFBF8F00', name: 'Dịch vụ bên ngoài' },
};
const HEADER_FILL = 'FF305496';

const wb = new ExcelJS.Workbook();
wb.creator = 'S3Browser docs';

/** A sheet with a uniform narrow grid, for drawing. */
const gridSheet = (name, cols, colWidth = 3.2) => {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  ws.columns = Array.from({ length: cols }, () => ({ width: colWidth }));
  return ws;
};

/** A sheet for text tables, with the given column widths. */
const tableSheet = (name, widths) => {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  ws.columns = widths.map(width => ({ width }));
  return ws;
};

const thin = color => ({ style: 'thin', color: { argb: color } });

/** Title on row 1 and an optional note on row 2, both spanning `cols` columns. */
const title = (ws, text, note, cols) => {
  ws.mergeCells(1, 1, 1, cols);
  Object.assign(ws.getCell(1, 1), {
    value: text,
    font: { name: FONT, size: 16, bold: true, color: { argb: HEADER_FILL } },
    alignment: { vertical: 'middle' },
  });
  ws.getRow(1).height = 30;
  if (note) {
    ws.mergeCells(2, 1, 2, cols);
    Object.assign(ws.getCell(2, 1), {
      value: note,
      font: { name: FONT, size: 10, italic: true, color: { argb: 'FF595959' } },
      alignment: { wrapText: true, vertical: 'top' },
    });
    ws.getRow(2).height = 32;
  }
};

/** A colored box over rows r1..r2 and columns c1..c2 with centered, wrapped text. */
const box = (ws, r1, c1, r2, c2, text, layer, { bold = false, size = 10 } = {}) => {
  const { fill, border } = LAYER[layer];
  ws.mergeCells(r1, c1, r2, c2);
  const cell = ws.getCell(r1, c1);
  cell.value = text;
  cell.font = { name: FONT, size, bold };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  // A merged range takes fill from its anchor, but each edge cell needs its own border.
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const b = ws.getCell(r, c);
      b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      b.border = {
        top: r === r1 ? { style: 'medium', color: { argb: border } } : undefined,
        bottom: r === r2 ? { style: 'medium', color: { argb: border } } : undefined,
        left: c === c1 ? { style: 'medium', color: { argb: border } } : undefined,
        right: c === c2 ? { style: 'medium', color: { argb: border } } : undefined,
      };
    }
  }
};

/** A small label (no box), centered over columns c1..c2. */
const label = (ws, r, c1, c2, text, { italic = true, color = 'FF404040', size = 9 } = {}) => {
  if (c2 > c1) ws.mergeCells(r, c1, r, c2);
  Object.assign(ws.getCell(r, c1), {
    value: text,
    font: { name: FONT, size, italic, color: { argb: color } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  });
};

/** A down arrow in column c on row r, with an optional label to its right. */
const arrowDown = (ws, r, c, text, labelTo) => {
  Object.assign(ws.getCell(r, c), {
    value: '▼',
    font: { name: FONT, size: 12, color: { argb: 'FF404040' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  if (text) label(ws, r, c + 1, labelTo ?? c + 12, text, { color: 'FF404040' });
  if (text) ws.getCell(r, c + 1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
};

/**
 * A horizontal arrow on row r from column `from` to column `to` (either direction): a line drawn as the bottom
 * border of the cells between them, the label above it and the head at `to`. `dashed` is a reply.
 */
const arrowH = (ws, r, from, to, text, { dashed = false } = {}) => {
  const right = to > from;
  const [a, b] = right ? [from + 1, to - 1] : [to + 1, from - 1];
  const line = { style: dashed ? 'dashed' : 'medium', color: { argb: 'FF404040' } };
  if (b >= a) {
    ws.mergeCells(r, a, r, b);
    for (let c = a; c <= b; c++) ws.getCell(r, c).border = { ...ws.getCell(r, c).border, bottom: line };
    Object.assign(ws.getCell(r, a), {
      value: text,
      font: { name: FONT, size: 9, color: { argb: 'FF202020' } },
      alignment: { horizontal: 'center', vertical: 'bottom', wrapText: true },
    });
  }
  Object.assign(ws.getCell(r, to), {
    value: right ? '▶' : '◀',
    font: { name: FONT, size: 10, color: { argb: 'FF404040' } },
    alignment: { horizontal: right ? 'left' : 'right', vertical: 'bottom' },
  });
};

/** A table: header row then rows, starting at row r and column c; returns the next free row. */
const table = (ws, r, c, header, rows, { wrap = true, layer } = {}) => {
  const head = ws.getRow(r);
  header.forEach((h, i) => {
    Object.assign(head.getCell(c + i), {
      value: h,
      font: { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } },
      alignment: { vertical: 'middle', wrapText: true },
      border: { top: thin('FFBFBFBF'), bottom: thin('FFBFBFBF'), left: thin('FFBFBFBF'), right: thin('FFBFBFBF') },
    });
  });
  head.height = 20;
  rows.forEach((values, n) => {
    const row = ws.getRow(r + 1 + n);
    values.forEach((v, i) => {
      Object.assign(row.getCell(c + i), {
        value: v,
        font: { name: FONT, size: 10, bold: i === 0 },
        alignment: { vertical: 'top', wrapText: wrap },
        border: { top: thin('FFBFBFBF'), bottom: thin('FFBFBFBF'), left: thin('FFBFBFBF'), right: thin('FFBFBFBF') },
      });
      if (layer && i === 0)
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYER[layer].fill } };
    });
  });
  return r + rows.length + 2;
};

/** Sets the height of rows r1..r2. */
const heights = (ws, r1, r2, h) => {
  for (let r = r1; r <= r2; r++) ws.getRow(r).height = h;
};

/** A section heading on row r. */
const heading = (ws, r, c, text) => {
  Object.assign(ws.getCell(r, c), {
    value: text,
    font: { name: FONT, size: 12, bold: true, color: { argb: HEADER_FILL } },
  });
  ws.getRow(r).height = 22;
};

// ---------------------------------------------------------------------------------------------------------
// 1. Overview: purpose, legend, sheet list
// ---------------------------------------------------------------------------------------------------------
{
  const ws = tableSheet('Tổng quan', [28, 90]);
  title(
    ws,
    'Kiến trúc S3Browser',
    'Tóm tắt từ docs/ARCHITECTURE.vi.md (nguồn chính). Sinh lại bằng: bun run --cwd docs architecture',
    2
  );
  heading(ws, 4, 1, 'Ứng dụng');
  let r = table(
    ws,
    5,
    1,
    ['Mục', 'Nội dung'],
    [
      [
        'Loại app',
        'App desktop Wails v3, chỉ chạy trên Windows: backend Go + frontend React 19 / TypeScript trong WebView2.',
      ],
      [
        'Chế độ S3',
        'Duyệt và thao tác bucket/object trên AWS S3 và MinIO: profile kết nối, nhiều cách xác thực, upload, download, policy.',
      ],
      [
        'Chế độ SQL',
        'Kết nối database người dùng, chạy SQL, cây đối tượng, xem bảng. Mọi việc với database do thư viện Rust s3b_db.dll làm.',
      ],
      [
        'Go gọi Rust',
        'Không dùng cgo: nạp DLL bằng golang.org/x/sys/windows, gọi 4 hàm C ABI, trao đổi bằng JSON (xem sheet "Luồng Go - Rust").',
      ],
      [
        'Hiện trạng SQL',
        'Go mới mở SQLite. Driver Rust cho PostgreSQL, MySQL, MariaDB, SQL Server, MongoDB, Redis đã có nhưng chưa nối vào UI; PostgreSQL ở FE còn là mock.',
      ],
    ]
  );
  heading(ws, r, 1, 'Chú thích màu trong sơ đồ');
  r++;
  for (const key of Object.keys(LAYER)) {
    const c = ws.getCell(r, 1);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAYER[key].fill } };
    c.border = {
      top: thin(LAYER[key].border),
      bottom: thin(LAYER[key].border),
      left: thin(LAYER[key].border),
      right: thin(LAYER[key].border),
    };
    c.font = { name: FONT, size: 10 };
    ws.getCell(r, 2).value = LAYER[key].name;
    ws.getCell(r, 2).font = { name: FONT, size: 10 };
    r++;
  }
  ws.getCell(r, 2).value = '▶ / ▼ mũi tên gọi; nét đứt = trả kết quả';
  ws.getCell(r, 2).font = { name: FONT, size: 10, italic: true };
  r += 2;
  heading(ws, r, 1, 'Các sheet');
  table(
    ws,
    r + 1,
    1,
    ['Sheet', 'Nội dung'],
    [
      ['Sơ đồ tổng thể', 'Các lớp của app từ giao diện xuống dữ liệu và dịch vụ bên ngoài.'],
      ['Luồng Go - Rust', 'Sơ đồ tuần tự một lần ExecuteSql: React -> Go -> FFI -> Rust -> trả về.'],
      ['Bên trong Rust', 'ffi -> dispatch -> actor của từng connection -> driver; registry và runtime.'],
      ['Huỷ và phân trang', 'Luồng huỷ một truy vấn và cách kết quả được chia trang.'],
      ['Hợp đồng FFI', '4 hàm export, mã trả về, giao thức JSON, bảng đổi mã lỗi sang DBE.'],
      ['Module Go', 'Handler, module và việc chính của từng module.'],
      ['Lệnh', 'Lệnh sinh binding, build, kiểm tra và test.'],
    ]
  );
}

// ---------------------------------------------------------------------------------------------------------
// 2. Layered overview diagram
// ---------------------------------------------------------------------------------------------------------
{
  const ws = gridSheet('Sơ đồ tổng thể', 44);
  title(
    ws,
    'Sơ đồ tổng thể',
    'Mỗi lớp chỉ gọi lớp ngay dưới nó. Frontend không biết Rust tồn tại: nó chỉ gọi binding của DbHandler.',
    44
  );

  box(ws, 4, 2, 5, 43, 'Frontend: React 19 + TypeScript trong WebView2 (Mantine, zustand, i18next 7 ngôn ngữ)', 'fe', {
    bold: true,
    size: 11,
  });
  box(ws, 6, 2, 8, 11, 'pages/s3\nbucket, object, upload, download', 'fe');
  box(ws, 6, 12, 8, 21, 'pages/sql\neditor, cây đối tượng, DataGrid', 'fe');
  box(ws, 6, 22, 8, 32, 'stores (zustand + immer)\ncommon/stores, pages/*/stores', 'fe');
  box(ws, 6, 33, 8, 43, 'callIPC (ipcUtils.ts)\nscope, AbortController, toast', 'fe');
  heights(ws, 4, 8, 18);

  arrowDown(
    ws,
    9,
    22,
    'Binding Wails sinh tự động (frontend/bindings, tag wailsgen); huỷ call thì huỷ luôn ctx Go',
    43
  );
  ws.getRow(9).height = 22;

  box(
    ws,
    10,
    2,
    11,
    43,
    'Handlers Go (internal/handlers): mỏng, chỉ gọi module; method public thành binding TypeScript',
    'go',
    { bold: true, size: 11 }
  );
  const handlers = ['BucketHandler', 'DbHandler', 'MasterHandler', 'ProfileHandler', 'SettingHandler', 'UpdateHandler'];
  handlers.forEach((h, i) => box(ws, 12, 2 + i * 7, 13, 7 + i * 7, h, 'go'));
  heights(ws, 10, 13, 18);

  arrowDown(ws, 14, 22, 'Gọi module.go (API public) -> submodule_*_mng.go', 43);
  ws.getRow(14).height = 22;

  const modules = [
    ['bucket', 'kết nối, bucket, policy, object, upload, download, tìm kiếm'],
    ['db', 'chế độ SQL: profile DB, kết nối, truy vấn'],
    ['profile', 'profile kết nối, secret mã hoá'],
    ['global', 'container kết nối S3 dùng chung, access cache'],
    ['master', 'dữ liệu master (region)'],
    ['setting', 'settings.json, tabs.json, autostart'],
  ];
  box(ws, 15, 2, 16, 43, 'Modules Go (internal/modules)', 'go', { bold: true, size: 11 });
  modules.forEach(([m, d], i) => box(ws, 17, 2 + i * 7, 20, 7 + i * 7, `${m}\n${d}`, 'go'));
  heights(ws, 15, 20, 18);
  box(ws, 21, 2, 22, 43, 'update: tự cập nhật từ GitHub Releases (kiểm sha256, chạy bộ cài NSIS)', 'go');
  heights(ws, 21, 22, 16);

  arrowDown(ws, 23, 4, 'S3 API', 8);
  arrowDown(ws, 23, 15, 'sqlc', 20);
  arrowDown(ws, 23, 25, 'file JSON', 30);
  arrowDown(ws, 23, 34, 'syscall, không cgo', 43);
  ws.getRow(23).height = 22;

  box(ws, 24, 2, 27, 10, 'AWS S3 / MinIO\nAWS SDK v2, madmin-go\nSTS, OIDC, mTLS', 'ext');
  box(ws, 24, 12, 27, 21, 'SQLite của app (data.db)\nmodernc + goose + sqlc\nprofile, master, lịch sử', 'store');
  box(ws, 24, 23, 27, 31, 'settings.json, tabs.json\n(thư mục data của app)', 'store');
  box(ws, 24, 33, 27, 43, 's3b_db.dll (Rust)\ntokio + driver mức thấp\nchỉ build Windows msvc', 'rust', { bold: true });
  heights(ws, 24, 27, 18);

  arrowDown(ws, 28, 38, 'driver từng DB', 43);
  box(
    ws,
    29,
    33,
    32,
    43,
    'Database người dùng\nSQLite (đang dùng)\nPostgreSQL, MySQL, MariaDB, SQL Server, MongoDB, Redis (chưa nối UI)',
    'ext'
  );
  heights(ws, 28, 32, 18);
  box(ws, 29, 2, 30, 21, 'GitHub Releases (module update)', 'ext');
}

// ---------------------------------------------------------------------------------------------------------
// 3. Sequence: one ExecuteSql from React to Rust and back
// ---------------------------------------------------------------------------------------------------------
{
  const LANE_W = 7;
  const lanes = [
    ['React\n(callIPC)', 'fe'],
    ['DbHandler +\nmodules/db', 'go'],
    ['submodule\nNativeMng', 'go'],
    ['ffi.rs\n(s3b_call)', 'rust'],
    ['dispatch.rs\n(tokio)', 'rust'],
    ['actor của\nconnection', 'rust'],
  ];
  const cols = lanes.length * LANE_W + 1;
  const ws = gridSheet('Luồng Go - Rust', cols, 3);
  title(
    ws,
    'Luồng một lần chạy SQL (ExecuteSql)',
    'Đọc từ trên xuống. Mũi tên liền = gọi; nét đứt = trả kết quả. Rust trả JSON; Go không decode các dòng dữ liệu mà chuyển nguyên byte ra frontend.',
    cols
  );
  const center = i => 2 + i * LANE_W + Math.floor(LANE_W / 2);
  lanes.forEach(([name, layer], i) =>
    box(ws, 4, 2 + i * LANE_W, 5, 1 + (i + 1) * LANE_W - 1, name, layer, { bold: true })
  );
  heights(ws, 4, 5, 18);

  const steps = [
    [0, 1, 'ExecuteSql(input) qua binding'],
    [1, 2, 'callNativeRaw(ctx, "execute", params)'],
    [2, 3, 's3b_call(JSON) bằng syscall.SyscallN'],
    [3, 4, 'dispatch::call: spawn task, block_on'],
    [4, 5, 'Cmd::Execute qua kênh mpsc'],
    [5, 4, 'ExecuteResult qua kênh oneshot', true],
    [4, 3, '{"ok":true,"result":{...}}', true],
    [3, 2, 'out_ptr / out_len (buffer của Rust)', true],
    [2, 3, 's3b_free(ptr, len) sau khi copy'],
    [2, 1, 'byte kết quả, không parse', true],
    [1, 0, 'Output.Body = nguyên JSON đó', true],
  ];
  let r = 7;
  for (const [a, b, text, dashed] of steps) {
    arrowH(ws, r, center(a), center(b), text, { dashed });
    ws.getRow(r).height = 30;
    r++;
  }
  // Lifelines: a dotted line through the center column of each lane.
  for (let row = 6; row < r; row++) {
    lanes.forEach((_, i) => {
      const cell = ws.getCell(row, center(i));
      cell.border = { ...cell.border, left: { style: 'dotted', color: { argb: 'FF7F7F7F' } } };
    });
  }

  r += 1;
  heading(ws, r, 2, 'Nạp DLL (internal/modules/db/native_windows.go)');
  const notes = [
    'App build với CGO_ENABLED=0. Go nạp DLL bằng golang.org/x/sys/windows: LoadLibraryEx(<thư mục exe>\\s3b_db.dll, LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32). Đường dẫn tuyệt đối nên không thư mục nào trên search path thay được DLL.',
    'GetProcAddress lấy 4 hàm export, rồi s3b_init chạy một lần. Mọi lời gọi đi qua syscall.SyscallN.',
    'DLL nạp ở lời gọi đầu tiên (thường là Connect), không nạp lúc mở app. Nạp lỗi thì lần gọi sau thử lại và báo DBE009. Hệ điều hành khác: native_other.go chỉ trả lỗi.',
    'DLL link +crt-static (rust/.cargo/config.toml) nên không cần VCRUNTIME140.dll.',
    'Kết quả lớn (execute, fetch, tableRows): callNativeRaw cắt byte sau {"ok":true,"result": mà không parse; StatementResult/ExecuteSqlOutput/FetchRowsOutput giữ byte đó và MarshalJSON ghi nguyên ra Wails. Vì vậy binding phải sinh với -tags=wailsgen.',
    'Kết quả nhỏ (open, schemaTree, tableInfo): callNative[T] decode bình thường.',
  ];
  for (const n of notes) {
    r++;
    ws.mergeCells(r, 2, r, cols);
    Object.assign(ws.getCell(r, 2), {
      value: `• ${n}`,
      font: { name: FONT, size: 10 },
      alignment: { wrapText: true, vertical: 'top' },
    });
    ws.getRow(r).height = 30;
  }
}

// ---------------------------------------------------------------------------------------------------------
// 4. Inside Rust
// ---------------------------------------------------------------------------------------------------------
{
  const ws = gridSheet('Bên trong Rust', 44);
  title(
    ws,
    'Bên trong s3b_db.dll',
    'Phân lớp: ffi.rs (chỉ hàm export) -> dispatch.rs (theo method) -> drivers/<db>/. Kiểu JSON ở protocol/.',
    44
  );

  box(
    ws,
    4,
    2,
    6,
    43,
    'ffi.rs: s3b_init, s3b_call, s3b_cancel, s3b_free\nmọi hàm bọc catch_unwind; panic = "unwind"; không giữ con trỏ của Go',
    'rust',
    { bold: true }
  );
  arrowDown(ws, 7, 22, 'request JSON (copy)', 43);
  box(
    ws,
    8,
    2,
    10,
    27,
    'dispatch.rs\nparse JSON, chọn nhánh theo method; lỗi parse không lặp lại giá trị (không lộ mật khẩu)',
    'rust'
  );
  box(
    ws,
    8,
    29,
    10,
    43,
    'runtime.rs\nmột tokio runtime đa luồng cho cả DLL; spawn + block_on, panic trong task -> internal',
    'rust'
  );
  arrowDown(ws, 11, 14, 'Cmd qua kênh mpsc', 27);
  box(
    ws,
    12,
    2,
    14,
    27,
    'Actor của từng connection\nmột tokio task duy nhất giữ connection; nhận Cmd::Execute / Fetch / TableRows / SchemaTree / TableInfo / Close; trả qua oneshot',
    'rust'
  );
  box(ws, 12, 29, 14, 43, 'registry.rs\nconnId -> kênh của actor\nrequest id -> connection + CancelSignal', 'rust');
  arrowDown(ws, 15, 14, 'đọc dòng thô, ghi thẳng ra JSON', 27);
  heights(ws, 4, 15, 18);

  const drivers = [
    ['SQLite', 'libsqlite3-sys'],
    ['PostgreSQL', 'tokio-postgres'],
    ['MySQL / MariaDB', 'mysql_async'],
    ['SQL Server', 'tiberius'],
    ['MongoDB', 'mongodb (BSON thô)'],
    ['Redis', 'redis'],
  ];
  drivers.forEach(([db, lib], i) => box(ws, 16, 2 + i * 7, 18, 7 + i * 7, `${db}\n${lib}`, 'rust'));
  heights(ws, 16, 18, 18);

  let r = 20;
  heading(ws, r, 2, 'Nguyên tắc của driver');
  const rules = [
    'Ưu tiên hiệu năng: trang 10.000 dòng (~2 MB JSON) mục tiêu < 40 ms, nhắm < 20 ms (đo bản release, DB local).',
    'Dùng driver mức thấp nhất của từng DB, tự đọc dòng thô và chuyển thẳng sang chuỗi JSON, cấp sẵn capacity.',
    'Mỗi tab một connection; kết quả theo trang qua cursorId, không đọc cả kết quả vào RAM.',
    'Không log secret hay dữ liệu truy vấn. Comment Rust viết tiếng Việt cho người mới học Rust.',
  ];
  for (const n of rules) {
    r++;
    ws.mergeCells(r, 2, r, 43);
    Object.assign(ws.getCell(r, 2), {
      value: `• ${n}`,
      font: { name: FONT, size: 10 },
      alignment: { wrapText: true, vertical: 'top' },
    });
    ws.getRow(r).height = 18;
  }
}

// ---------------------------------------------------------------------------------------------------------
// 5. Cancel and paging
// ---------------------------------------------------------------------------------------------------------
{
  const ws = gridSheet('Huỷ và phân trang', 44);
  title(
    ws,
    'Huỷ truy vấn và phân trang',
    'Huỷ đi từ frontend xuống Rust; kết quả lớn ở lại trong cursor phía Rust và được đọc từng trang.',
    44
  );

  heading(ws, 4, 2, 'Luồng huỷ');
  const flow = [
    ['Frontend huỷ (AbortController), app tắt, hoặc hết thời gian chờ', 'fe'],
    ['Context Go của lời gọi kết thúc', 'go'],
    [
      'Goroutine trong callNativeRaw gọi s3b_cancel(id) mỗi 100 ms tới khi s3b_call trả về (lần huỷ đầu có thể tới trước khi Rust kịp đăng ký request)',
      'go',
    ],
    ['Rust tra registry theo id, bật CancelSignal và ngắt câu lệnh đang chạy', 'rust'],
    ['Rust trả {"ok":false,"error":{"code":"cancelled"}}', 'rust'],
    ['Go: frontend huỷ -> Result=false im lặng; hết thời gian chờ -> DBE015', 'go'],
  ];
  let r = 5;
  flow.forEach(([text, layer], i) => {
    box(ws, r, 2, r + 1, 30, text, layer);
    heights(ws, r, r + 1, 18);
    r += 2;
    if (i < flow.length - 1) {
      arrowDown(ws, r, 16);
      r++;
    }
  });

  r += 1;
  heading(ws, r, 2, 'Thông số');
  // The sheet is a narrow grid, so each table column is a range of merged cells.
  const params = [
    [
      'queryTimeout',
      '5 phút',
      'Giới hạn một ExecuteSql, OpenTableRows hoặc FetchRows; cursor đang mở mà rảnh thì không tính',
    ],
    ['metaTimeout', '30 giây', 'Mở kết nối và đọc metadata (cây đối tượng, thông tin bảng)'],
    ['pageSize', '10.000 dòng', 'Số dòng tối đa của trang đầu và mỗi trang FetchRows'],
    ['maxPageBytes', '16 MiB', 'Giới hạn kích thước chữ của một trang (luôn có ít nhất một dòng)'],
    [
      'FetchRows All',
      'không giới hạn',
      'Đọc hết phần còn lại, không giới hạn trang, không timeout; frontend dừng bằng cách huỷ',
    ],
  ];
  const head = [
    ['Hằng (modules/db/module.go)', 2, 10],
    ['Giá trị', 11, 16],
    ['Ý nghĩa', 17, 43],
  ];
  const writeRow = (row, values, isHead) => {
    values.forEach(([v, c1, c2]) => {
      ws.mergeCells(row, c1, row, c2);
      for (let c = c1; c <= c2; c++) {
        const cell = ws.getCell(row, c);
        cell.border = {
          top: thin('FFBFBFBF'),
          bottom: thin('FFBFBFBF'),
          left: c === c1 ? thin('FFBFBFBF') : undefined,
          right: c === c2 ? thin('FFBFBFBF') : undefined,
        };
        if (isHead) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      }
      Object.assign(ws.getCell(row, c1), {
        value: v,
        font: { name: FONT, size: 10, bold: isHead, color: { argb: isHead ? 'FFFFFFFF' : 'FF000000' } },
        alignment: { vertical: 'top', wrapText: true },
      });
    });
    ws.getRow(row).height = isHead ? 20 : 28;
  };
  writeRow(r + 1, head, true);
  params.forEach((p, i) =>
    writeRow(
      r + 2 + i,
      p.map((v, j) => [v, head[j][1], head[j][2]]),
      false
    )
  );

  r += params.length + 3;
  heading(ws, r, 2, 'Connection');
  const conns = [
    'Mỗi profile một connection chính (ConnectDb), dùng cho cây đối tượng và thông tin bảng.',
    'Mỗi tab SQL một connection riêng, mở ở lần chạy đầu tiên trong tab đó.',
    'CloseDbTab đóng connection của tab; DisconnectDb đóng mọi connection của profile; Close (tắt app) đóng tất cả.',
  ];
  for (const n of conns) {
    r++;
    ws.mergeCells(r, 2, r, 43);
    Object.assign(ws.getCell(r, 2), { value: `• ${n}`, font: { name: FONT, size: 10 }, alignment: { wrapText: true } });
  }
}

// ---------------------------------------------------------------------------------------------------------
// 6. FFI contract and protocol
// ---------------------------------------------------------------------------------------------------------
{
  const ws = tableSheet('Hợp đồng FFI', [22, 44, 70]);
  title(
    ws,
    'Hợp đồng FFI và giao thức JSON',
    'rust/src/ffi.rs và rust/src/protocol/mod.rs. Payload JSON, field camelCase.',
    3
  );
  heading(ws, 4, 1, 'Hàm export');
  let r = table(
    ws,
    5,
    1,
    ['Export', 'Chữ ký', 'Vai trò'],
    [
      ['s3b_init', '() -> i32', 'Tạo tokio runtime duy nhất và TLS provider. Gọi một lần sau khi nạp DLL.'],
      [
        's3b_call',
        '(req_ptr, req_len, *out_ptr, *out_len) -> i32',
        'Một request JSON; chặn tới khi response JSON sẵn sàng, trả buffer do Rust sở hữu.',
      ],
      ['s3b_cancel', '(id: u64)', 'Yêu cầu ngắt request id.'],
      ['s3b_free', '(ptr, len)', 'Giải phóng buffer do s3b_call trả về. Buffer của Rust chỉ được giải phóng ở đây.'],
    ],
    { layer: 'rust' }
  );
  heading(ws, r, 1, 'Mã trả về của hàm export');
  r = table(
    ws,
    r + 1,
    1,
    ['Mã', 'Ý nghĩa', 'Ghi chú'],
    [
      ['0', 'OK', 'Lỗi của công việc (SQL sai, connection đóng...) nằm trong JSON, không ở mã trả về.'],
      ['1', 'Sai tham số', 'Con trỏ null.'],
      ['2', 'Init lỗi', 'Không tạo được runtime.'],
      ['-1', 'Panic', 'catch_unwind bắt panic để không tràn sang Go.'],
    ]
  );
  heading(ws, r, 1, 'Giao thức JSON');
  r = table(
    ws,
    r + 1,
    1,
    ['Loại', 'Dạng', 'Ghi chú'],
    [
      [
        'Request',
        '{"id":7,"method":"execute","params":{...}}',
        'id duy nhất mỗi lời gọi (bộ đếm atomic ở Go), cũng là khoá của s3b_cancel.',
      ],
      ['Thành công', '{"ok":true,"result":{...}}', 'Go cắt phần result mà không parse khi là dữ liệu dòng.'],
      [
        'Thất bại',
        '{"ok":false,"error":{"code":"sqlError","message":"..."}}',
        'code ổn định, Go đổi sang message DBE.',
      ],
      [
        'Methods',
        'open, close, execute, fetch, schemaTree, tableInfo, tableRows',
        'Thêm khả năng mới = thêm method bên Rust, không làm tạm ở Go.',
      ],
    ]
  );
  heading(ws, r, 1, 'Đổi mã lỗi Rust sang message (errorCodeMessage)');
  table(
    ws,
    r + 1,
    1,
    ['Mã Rust', 'Message', 'Nội dung'],
    [
      ['invalidRequest', 'DBE001', 'Request không hợp lệ'],
      ['openFailed', 'DBE002', 'Không mở được file database {path}'],
      ['notADatabase', 'DBE003', 'File không phải database SQLite'],
      ['connNotFound', 'DBE004', 'Connection đã đóng, cần Connect lại'],
      ['cursorNotFound', 'DBE005', 'Kết quả không còn, cần chạy lại'],
      ['sqlError', 'DBE006', 'Lỗi SQL, hiện cùng câu lệnh (không toast)'],
      ['tableNotFound', 'DBE007', 'Bảng [{name}] không tồn tại'],
      ['mã khác / internal', 'DBE008', 'Lỗi bộ xử lý database'],
      ['cancelled', '(không có)', 'Result=false im lặng'],
      ['(Go) nạp DLL lỗi', 'DBE009', 'Không nạp được s3b_db.dll'],
      ['(Go) hết thời gian', 'DBE015', 'Quá thời gian {timeout}'],
    ]
  );
}

// ---------------------------------------------------------------------------------------------------------
// 7. Go modules
// ---------------------------------------------------------------------------------------------------------
{
  const ws = tableSheet('Module Go', [16, 18, 90]);
  title(
    ws,
    'Handler và module Go',
    'main.go đăng ký 6 handler bằng application.NewService; internal/app.go dựng DB, KeyManager, module rồi handler.',
    3
  );
  const r = table(
    ws,
    4,
    1,
    ['Module', 'Handler', 'Việc chính'],
    [
      [
        'bucket',
        'BucketHandler',
        'Kết nối S3/MinIO, danh sách bucket (badge policy), tạo/xoá bucket, policy, object, upload, download (song song theo range), tìm kiếm.',
      ],
      [
        'db',
        'DbHandler',
        'Chế độ SQL: profile DB (bảng db_profiles, secret mã hoá), Connect/Disconnect, cây đối tượng, thông tin bảng, ExecuteSql, OpenTableRows, FetchRows, CloseDbTab. Gọi s3b_db.dll.',
      ],
      [
        'profile',
        'ProfileHandler',
        'Profile kết nối S3 trong SQLite (auth_config JSON, auth_secret mã hoá), export/import profile.',
      ],
      ['master', 'MasterHandler', 'Dữ liệu master (region...).'],
      [
        'setting',
        'SettingHandler',
        'settings.json (theme, font, cỡ giao diện, ngôn ngữ, cập nhật), tabs.json, khởi động cùng Windows.',
      ],
      ['update', 'UpdateHandler', 'Kiểm tra và tải bản mới từ GitHub Releases, kiểm sha256, chạy bộ cài NSIS.'],
      [
        'global',
        '(không có)',
        'Container kết nối S3 dùng chung (map + RWMutex) và access cache; Remove/Replace trả connection để đóng ngoài lock.',
      ],
    ],
    { layer: 'go' }
  );
  heading(ws, r, 1, 'Quy ước');
  table(
    ws,
    r + 1,
    1,
    ['Mục', 'Quy ước', 'Chi tiết'],
    [
      [
        'Phân lớp',
        'handler -> module.go -> submodule',
        'Handler mỏng; module.go là API public có doc comment; submodule unexported submoduleXxxMng.',
      ],
      ['Output', 'models.Output[T]', 'Result, MessageList, Body; lỗi trả bằng output.ThrowError(msg).'],
      ['Message', '<PREFIX><S|E|W><NNN>', 'Khai báo var ở đầu module.go; mỗi mã có key trong 7 file ipcMessage.json.'],
      [
        'Context',
        'withCallContext',
        'Dừng khi frontend huỷ, app tắt hoặc hết timeout; huỷ từ frontend trả Result=false im lặng.',
      ],
      [
        'Go hay Rust',
        'Việc nặng -> Rust',
        'Dữ liệu lớn, CPU nặng, chạy lâu thì làm ở Rust; Go chỉ là cầu nối. CRUD cấu hình nhẹ vẫn ở Go.',
      ],
    ]
  );
}

// ---------------------------------------------------------------------------------------------------------
// 8. Commands
// ---------------------------------------------------------------------------------------------------------
{
  const ws = tableSheet('Lệnh', [26, 80, 40]);
  title(
    ws,
    'Lệnh thường dùng',
    'Chạy ở gốc repo trừ khi ghi khác. Tool Go khai báo trong tool (...) của go.mod nên không cần cài riêng.',
    3
  );
  table(
    ws,
    4,
    1,
    ['Việc', 'Lệnh', 'Ghi chú'],
    [
      ['Sinh binding', 'go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts', 'Tag wailsgen bắt buộc'],
      ['Chạy dev', 'go tool wails3 task dev', 'Tự build s3b_db.dll và copy cạnh exe'],
      ['Build / bộ cài', 'go tool wails3 task build | package', 'Tắt app trước khi build để thay được DLL'],
      ['Build DLL', 'cargo build --release --target x86_64-pc-windows-msvc', 'Task common:build:dll, trong rust/'],
      ['Kiểm tra Go', 'go build ./... ; go vet ./... ; go tool golangci-lint run ./...', ''],
      [
        'Kiểm tra Rust',
        'cargo fmt --check ; cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings',
        'Trong rust/',
      ],
      [
        'Test Rust',
        'cargo test',
        'Test cần DB dùng test-env/docker-compose.yml; S3B_REQUIRE_DB=1 biến skip thành fail',
      ],
      [
        'Kiểm tra FE',
        'node_modules/.bin/biome check src ; npx oxlint src ; node_modules/.bin/tsc --noEmit',
        'Trong frontend/ (Windows thêm .exe)',
      ],
      ['Test FE', 'node_modules/.bin/vitest run', 'C1 >= 95% cho mỗi file đã đổi'],
      ['File Excel này', 'bun run --cwd docs architecture', 'Sinh lại docs/S3Browser-architecture.vi.xlsx'],
    ]
  );
}

await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
