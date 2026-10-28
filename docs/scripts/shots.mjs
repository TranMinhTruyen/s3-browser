// Takes the user-guide screenshots (docs/user-guide/<lang>/images/*.png) from a running S3Browser in server mode.
//
// Prerequisites (see docs/user-guide/README of the report or sprints/sprint-07):
//   1. A local MinIO seeded with `node docs/seed/seed.mjs` (demo-photos, demo-reports, demo-backups).
//   2. The app running in server mode with the portable tag so its DB stays next to the exe, e.g.
//        go build -tags server,production,portable -o <dir>/S3Browser-server.exe .
//        cd <dir> && WAILS_SERVER_PORT=8090 ./S3Browser-server.exe
//   3. Credentials in the environment only (never written to disk or to the screenshots):
//        SHOTS_URL=http://localhost:8090 S3_ENDPOINT=http://localhost:10010 \
//        S3_ACCESS_KEY=... S3_SECRET_KEY=... [SHOTS_LANGS=en,vi,ja] bun run --cwd docs shots
//
// Per language the script creates the "MinIO demo" profile, walks through the app and deletes the profile again.
// Not capturable in server mode: native dialogs (file picker, download destination) and drag and drop from the
// file manager. The picker modal and the download window are therefore filled by dispatching the same Wails
// events the backend emits (window._wails.dispatchWailsEvent); the upload transfer itself is real.
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(docsDir, '..', 'frontend', 'src', 'locales');
const { SHOTS_URL: url, S3_ENDPOINT: endpoint, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey } = process.env;
const langs = (process.env.SHOTS_LANGS ?? 'en,vi,ja').split(',');
const PROFILE = 'MinIO demo';
const BIG_FILE = 'backup-full-2026-10-28.zip';
const BIG_FILE_MB = 700;

if (!url || !endpoint || !accessKey || !secretKey) {
  console.error('Set SHOTS_URL, S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY (see the header of this file).');
  process.exit(1);
}

/** Reads a label from the app's own locale files, so selectors always match the real UI text. */
function label(lang, namespace, key) {
  const json = JSON.parse(readFileSync(join(localesDir, lang, `${namespace}.json`), 'utf8'));
  return key.split('.').reduce((node, part) => node[part], json);
}

/** Creates a ~700 MB zero-filled file so the upload lasts long enough to be photographed. */
async function createBigFile(path) {
  const chunk = Buffer.alloc(1024 * 1024 * 50);
  const out = createWriteStream(path);
  for (let i = 0; i < BIG_FILE_MB / 50; i++) {
    if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
  }
  await new Promise(resolve => out.end(resolve));
}

async function runLang(browser, lang, bigFilePath) {
  const L = (ns, key) => label(lang, ns, key);
  const dir = join(docsDir, 'user-guide', lang, 'images');
  mkdirSync(dir, { recursive: true });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pause = (ms = 700) => page.waitForTimeout(ms);
  // Toasts are hidden unless the shot is about them; the mouse is parked so no tooltip stays open.
  const shot = async (name, { toast = false, ...options } = {}) => {
    await page.mouse.move(640, 760);
    await page.evaluate(show => {
      const toaster = document.querySelector('[data-sonner-toaster]');
      if (toaster) toaster.style.display = show ? '' : 'none';
    }, toast);
    await pause(500);
    await page.screenshot({ path: join(dir, `${name}.png`), ...options });
    console.log(`[shot] ${lang}/${name}.png`);
  };

  // Last connectionId the app sent to the backend; needed for the direct upload call below.
  let connectionId = '';
  page.on('request', request => {
    const id = request.url().endsWith('/wails/runtime') && request.postData()?.match(/"connectionId":"([^"]+)"/)?.[1];
    if (id) connectionId = id;
  });

  /** Calls a bound backend method the same way the generated bindings do. */
  const callBackend = (methodName, ...args) =>
    page.evaluate(
      async ({ methodName, args }) => {
        const body = { object: 0, method: 0, args: { 'call-id': crypto.randomUUID(), methodName, args } };
        const res = await fetch('/wails/runtime', {
          method: 'POST',
          headers: { 'x-wails-client-id': 'shots', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.json();
      },
      { methodName, args }
    );

  const dispatchEvent = (name, data) =>
    page.evaluate(({ name, data }) => window._wails.dispatchWailsEvent({ name, data }), { name, data });

  const tabConnect = () => page.getByRole('button', { name: L('components/tabLayout', 'tooltip.connect'), exact: true }).last();
  const openProfileMenu = async () => {
    await page.getByText(PROFILE, { exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem').first().waitFor();
  };
  const clickMenuItem = key =>
    page.getByRole('menuitem', { name: L('components/navbar/connectionProfiles', key), exact: true }).click();

  /** Disconnects (when connected) and deletes the demo profile; `withShot` photographs the confirmation. */
  async function deleteProfile(withShot) {
    if (!(await page.getByText(PROFILE, { exact: true }).count())) return;
    await openProfileMenu();
    const disconnect = page.getByRole('menuitem', {
      name: L('components/navbar/connectionProfiles', 'contextMenu.disconnect'),
      exact: true,
    });
    if (await disconnect.count()) {
      await disconnect.click();
      await pause();
      await openProfileMenu();
    }
    await clickMenuItem('contextMenu.delete');
    await pause();
    if (withShot) await shot('18-profile-delete-confirm');
    await page.getByRole('button', { name: L('common', 'button.OK'), exact: true }).click();
    await pause(1000);
  }

  await page.goto(url, { waitUntil: 'networkidle' });
  if (lang !== 'en') await page.locator('label', { hasText: new RegExp(`^${lang}$`, 'i') }).click();
  await pause();
  await deleteProfile(false);

  // 01 main window
  await shot('01-main-window');
  await shot('02-language-switch', { clip: { x: 0, y: 0, width: 1280, height: 48 } });

  // 03 connection profile form (fake key values; the real ones are typed only after the shot)
  const form = key => L('components/modals/connectModal', `form.label.${key}`);
  await page.getByRole('button', { name: L('components/navbar/connectionProfiles', 'tooltip.createProfile'), exact: true }).click();
  await page.getByText('MinIO', { exact: true }).click();
  await page.getByRole('textbox', { name: form('name'), exact: true }).fill(PROFILE);
  await page.getByRole('textbox', { name: form('endpoint') }).fill('http://localhost:9000');
  await page.locator('button', { hasText: L('components/inputs', 'regionCombobox.placeholder') }).click();
  await page.getByRole('option', { name: /us-east-1/ }).click();
  await page.getByRole('textbox', { name: form('accessKey') }).fill('demo-access-key');
  await page.getByLabel(form('secretKey'), { exact: true }).fill('demo-secret-key');
  await page.getByLabel(form('savePassword')).check();
  await shot('03-connect-modal');

  // 04 profile created and listed
  await page.getByRole('textbox', { name: form('endpoint') }).fill(endpoint);
  await page.getByRole('textbox', { name: form('accessKey') }).fill(accessKey);
  await page.getByLabel(form('secretKey'), { exact: true }).fill(secretKey);
  await page.getByRole('button', { name: L('components/modals/connectModal', 'form.button.createProfile'), exact: true }).click();
  await pause(900);
  await shot('04-profile-created', { toast: true });
  await openProfileMenu();
  await shot('05-profile-menu');
  await page.keyboard.press('Escape');

  // 06 bucket list
  await page.locator('[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: PROFILE }).click();
  await tabConnect().click();
  await page.getByText('demo-photos', { exact: true }).waitFor();
  await pause(1500);
  await shot('06-bucket-list');

  // 07 bucket search
  const bucketSearch = page.getByPlaceholder(L('components/tabLayout', 'search.placeholderBucket'));
  await bucketSearch.fill('reports');
  await bucketSearch.press('Enter');
  await page.getByText('demo-reports', { exact: true }).waitFor();
  await pause(1000);
  await shot('07-bucket-search');
  await page.getByRole('button', { name: L('components/tabLayout', 'tooltip.clearSearch') }).click();
  await pause();

  // 08 objects of a bucket, 09 inside a folder, 10 object details
  await page.getByText('demo-photos', { exact: true }).click();
  await page.getByText('travel', { exact: true }).waitFor();
  await pause(1000);
  await shot('08-object-list');
  await page.getByText('travel', { exact: true }).click();
  await page.getByText('2026', { exact: true }).click();
  await page.getByText('paris.png').waitFor();
  await shot('09-object-folder');
  await page.getByText('paris.png').click();
  await page.getByText(L('components/objectDetailDrawer', 'label.contentType')).waitFor();
  await shot('10-object-detail');
  await page.getByRole('button', { name: L('components/objectDetailDrawer', 'tooltip.close'), exact: true }).click();
  await pause();

  // 11 selecting several objects
  const checkboxes = page.getByRole('checkbox');
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  await shot('11-object-selection');
  await page.getByRole('button', { name: L('pages/object/page', 'tooltip.clearSelected') }).click();

  // 12 object search (keys containing the keyword in the current folder)
  const objectSearch = page.getByPlaceholder(L('components/tabLayout', 'search.placeholderObject'));
  await objectSearch.fill('tokyo');
  await objectSearch.press('Enter');
  await page.getByText('tokyo.png').waitFor();
  await pause(1000);
  await shot('12-object-search');
  await page.getByRole('button', { name: L('components/tabLayout', 'tooltip.clearSearch') }).click();

  // 13 upload picker (empty, then filled by the drop event the backend would send)
  await page.getByRole('button', { name: L('components/tabLayout', 'tooltip.upload') }).click();
  await page.getByText(L('components/modals/uploadPickerModal', 'dropHint')).waitFor();
  await shot('13-upload-modal');
  const tabId = await page.evaluate(() => document.querySelector('[data-tab-id]')?.getAttribute('data-tab-id'));
  const file = (name, size) => ({ path: `C:\\Users\\demo\\Pictures\\${name}`, relKey: name, size, isLarge: false });
  const files = [
    ['holiday-01.jpg', 2400000],
    ['holiday-02.jpg', 3100000],
    ['holiday-03.jpg', 2800000],
    ['report-2026.pdf', 540000],
  ].map(([name, size]) => file(name, size));
  await dispatchEvent('uploader:picker-files-dropped', {
    tabId,
    groups: [{ name: '', files, totalFiles: files.length, largeCount: 0, overMaxFiles: false, overLargeCount: false }],
    skipped: 0,
    totalFiles: files.length,
    overMaxTotal: false,
    capped: false,
    maxFilesPerFolder: 50,
    largeFileSize: 10 * 1024 ** 3,
    largeFileMaxCount: 4,
    maxTotalFiles: 1000,
  });
  await pause(800);
  await shot('14-upload-modal-files');
  await page.getByRole('button', { name: L('common', 'button.close'), exact: true }).last().click();
  await pause();

  // 15 real upload with progress, 16 the new object, 17 delete confirmation
  await page.getByText('demo-photos', { exact: true }).first().click();
  await page.getByRole('button', { name: L('pages/object/page', 'tooltip.backToBucket') }).click();
  await page.getByText('demo-backups', { exact: true }).click();
  await page.getByText('db', { exact: true }).click();
  await page.getByText('backup-2026-10-28.zip').waitFor();
  const upload = callBackend('S3Browser/internal/handlers.BucketHandler.UploadObject', {
    connectionId,
    profileName: PROFILE,
    bucket: 'demo-backups',
    prefix: 'db/',
    objList: [{ path: bigFilePath, relKey: BIG_FILE }],
  });
  await page.getByText(L('components/uploaderWindow', 'label.uploadedLbl')).first().waitFor();
  await pause(900);
  await shot('15-upload-progress');
  await upload;
  await pause(500);
  await page.getByRole('button', { name: L('components/tabLayout', 'tooltip.refresh').replace('{target}', L('pages/object/page', 'tooltip.objectList')) }).click();
  await page.getByText(BIG_FILE, { exact: true }).waitFor();
  await shot('16-object-uploaded');
  await page.getByRole('button', { name: L('pages/object/page', 'tooltip.moreActions') }).last().click();
  await page.getByRole('menuitem', { name: L('pages/object/page', 'action.delete') }).click();
  await pause();
  await shot('17-delete-confirm');
  await page.getByRole('button', { name: L('common', 'button.OK'), exact: true }).click();
  await page.getByText(BIG_FILE, { exact: true }).waitFor({ state: 'detached' });
  await pause(600);

  // 19 download window (events as the backend emits them; the native destination dialog cannot be driven here)
  const downloads = [
    { id: 'demo-1', fileName: 'summary-2026.pdf', size: 52428800, downloaded: 31457280 },
    { id: 'demo-2', fileName: 'sales.csv', size: 8388608, downloaded: 2097152 },
  ];
  for (const { id, fileName, size, downloaded } of downloads) {
    await dispatchEvent('downloader:load-download-history', {
      id,
      fileName,
      destPath: `C:\\Users\\demo\\Downloads\\${fileName}`,
      status: 'DOWNLOADING',
      size,
      updatedAt: new Date().toISOString(),
      version: 1,
    });
    await dispatchEvent('downloader:download-progress', { downloadId: id, downloaded, total: size });
  }
  await pause(800);
  await shot('19-download-progress');

  // 20 download history
  await page.getByRole('button', { name: L('components/modals/historyModal', 'title'), exact: true }).click();
  await page.getByText(L('components/modals/historyModal', 'title')).last().waitFor();
  await shot('20-download-history');
  await page.getByRole('button', { name: L('common', 'button.close'), exact: true }).last().click();
  await pause();

  // 21-22 common errors, reproduced with "Test connection" in the profile form
  await page.getByRole('button', { name: L('components/navbar/connectionProfiles', 'tooltip.createProfile'), exact: true }).click();
  await page.getByText('MinIO', { exact: true }).click();
  await page.getByRole('textbox', { name: form('name'), exact: true }).fill('Wrong credentials');
  await page.getByRole('textbox', { name: form('endpoint') }).fill(endpoint);
  await page.locator('button', { hasText: L('components/inputs', 'regionCombobox.placeholder') }).click();
  await page.getByRole('option', { name: /us-east-1/ }).click();
  await page.getByRole('textbox', { name: form('accessKey') }).fill('wrong-access-key');
  await page.getByLabel(form('secretKey'), { exact: true }).fill('wrong-secret-key');
  const testButton = page.getByRole('button', { name: L('components/modals/connectModal', 'form.button.testConnection') });
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 });
  await testButton.click();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'attached' });
  await shot('21-error-invalid-credentials', { toast: true });
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 });
  await page.getByRole('textbox', { name: form('endpoint') }).fill('http://localhost:1');
  await testButton.click();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'attached', timeout: 40000 });
  await shot('22-error-endpoint', { toast: true });
  await page.getByRole('button', { name: L('common', 'button.close'), exact: true }).last().click();
  await pause();

  // 18 deleting the profile (also leaves the app clean for the next language)
  await deleteProfile(true);
  await page.close();
}

const tempDir = join(tmpdir(), 's3browser-shots');
mkdirSync(tempDir, { recursive: true });
const bigFilePath = join(tempDir, BIG_FILE);
await createBigFile(bigFilePath);
const browser = await chromium.launch();
try {
  for (const lang of langs) await runLang(browser, lang, bigFilePath);
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}
