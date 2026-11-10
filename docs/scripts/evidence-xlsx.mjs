// Builds the sprint evidence workbook from sprints/sprint-NN/testcases.md and the screenshots in evidence/.
//
//   bun run --cwd docs evidence ../sprints/sprint-NN
//
// Output: sprints/sprint-NN/evidence/sprint-NN_evidence.xlsx with
//   - "Summary": result counts,
//   - "Testcases": the table of testcases.md as is (one row per case),
//   - one sheet per case (sheet name = case ID): its fields, then every screenshot evidence/**/<ID>-NN.png
//     in order, and the names of its logs (evidence/**/<ID>*.log).
// testcases.md stays the source of truth; the workbook is regenerated on every run.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import ExcelJS from 'exceljs';

const sprintDir = process.argv[2] && resolve(process.argv[2]);
if (!sprintDir) {
  console.error('Usage: bun run --cwd docs evidence ../sprints/sprint-NN');
  process.exit(1);
}
const sprint = basename(sprintDir);
const evidenceDir = join(sprintDir, 'evidence');
const IMAGE_WIDTH = 900; // px in the sheet; screenshots are scaled down to this width, never up
const RESULT_COLORS = { PASS: 'FFC6EFCE', FAIL: 'FFFFC7CE', BLOCKED: 'FFFFEB9C', MANUAL: 'FFDDEBF7' };

/** Splits a markdown table row on unescaped pipes and cleans the cell text for Excel. */
const cells = line =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map(c =>
      c
        .trim()
        .replace(/\\\|/g, '|')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/`/g, '')
        .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$2') // markdown link -> its target
    );

/** Reads the first table of testcases.md whose header starts with "ID". */
const readCases = () => {
  const lines = readFileSync(join(sprintDir, 'testcases.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(l => /^\|\s*ID\s*\|/.test(l));
  if (start < 0) throw new Error('testcases.md has no table with an "ID" column');
  const header = cells(lines[start]);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break;
    const values = cells(line);
    rows.push(Object.fromEntries(header.map((h, i) => [h, values[i] ?? ''])));
  }
  return { header, rows };
};

/** Every file under evidence/, relative paths, sorted so <ID>-01 comes before <ID>-02. */
const listEvidence = () => {
  try {
    return readdirSync(evidenceDir, { recursive: true })
      .map(String)
      .map(p => p.replaceAll('\\', '/'))
      .sort();
  } catch {
    return [];
  }
};

/** Width and height from the PNG IHDR chunk. */
const pngSize = buf => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

const resultOf = row => (row['Kết quả'] ?? '').split(/[\s:]/)[0].toUpperCase() || 'NOT RUN';

const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const { header, rows } = readCases();
const files = listEvidence();
const wb = new ExcelJS.Workbook();

// Summary
const summary = wb.addWorksheet('Summary');
summary.columns = [{ width: 18 }, { width: 12 }];
summary.addRow([`Evidence ${sprint}`]).font = { bold: true, size: 14 };
summary.addRow(['Generated', new Date().toISOString().slice(0, 10)]);
summary.addRow([]);
summary.addRow(['Result', 'Count']).font = { bold: true };
for (const r of ['PASS', 'FAIL', 'BLOCKED', 'MANUAL', 'NOT RUN']) {
  const row = summary.addRow([r, rows.filter(c => resultOf(c) === r).length]);
  if (RESULT_COLORS[r]) row.getCell(1).fill = fill(RESULT_COLORS[r]);
}
summary.addRow(['Total', rows.length]).font = { bold: true };

// Testcases
const list = wb.addWorksheet('Testcases', { views: [{ state: 'frozen', ySplit: 1 }] });
list.columns = header.map(h => ({ header: h, key: h, width: ['Bước', 'Mong đợi', 'Ghi chú'].includes(h) ? 45 : 18 }));
list.getRow(1).font = { bold: true };
for (const c of rows) {
  const row = list.addRow(c);
  row.alignment = { wrapText: true, vertical: 'top' };
  const color = RESULT_COLORS[resultOf(c)];
  if (color && header.includes('Kết quả')) row.getCell('Kết quả').fill = fill(color);
  // Link each case to its own sheet.
  row.getCell(1).value = { text: c.ID, hyperlink: `#'${c.ID.slice(0, 31)}'!A1` };
}

// One sheet per case
for (const c of rows) {
  const ws = wb.addWorksheet(c.ID.slice(0, 31));
  ws.columns = [{ width: 18 }, { width: 100 }];
  for (const h of header) {
    const row = ws.addRow([h, c[h]]);
    row.getCell(1).font = { bold: true };
    row.alignment = { wrapText: true, vertical: 'top' };
    if (h === 'Kết quả' && RESULT_COLORS[resultOf(c)]) row.getCell(2).fill = fill(RESULT_COLORS[resultOf(c)]);
  }
  const mine = files.filter(f => basename(f).startsWith(`${c.ID}-`) || basename(f).startsWith(`${c.ID}.`));
  const logs = mine.filter(f => f.endsWith('.log'));
  if (logs.length) ws.addRow(['Log', logs.map(f => `evidence/${f}`).join('\n')]).alignment = { wrapText: true };
  let top = ws.rowCount + 1; // 0-based row index for the next image, one empty row below the fields
  for (const f of mine.filter(f => f.endsWith('.png'))) {
    const buffer = readFileSync(join(evidenceDir, f));
    const { width, height } = pngSize(buffer);
    const scale = Math.min(1, IMAGE_WIDTH / width);
    ws.getCell(top + 1, 1).value = basename(f);
    const id = wb.addImage({ buffer, extension: 'png' });
    ws.addImage(id, { tl: { col: 1, row: top }, ext: { width: width * scale, height: height * scale } });
    top += Math.ceil((height * scale) / 20) + 2; // default row height is 20px
  }
}

mkdirSync(evidenceDir, { recursive: true });
const out = join(evidenceDir, `${sprint}_evidence.xlsx`);
await wb.xlsx.writeFile(out);
console.log(`Wrote ${out} (${rows.length} cases)`);
