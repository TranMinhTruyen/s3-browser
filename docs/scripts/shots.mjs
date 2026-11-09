// Takes the user-guide screenshots (docs/user-guide/<lang>/images/*.png) from a running S3Browser in server mode.
//
// Prerequisites (see sprints/sprint-07 and sprints/sprint-15):
//   1. A throw-away MinIO (empty, own port, removed after the shots), seeded with `node docs/seed/seed.mjs`
//      (demo-photos, demo-reports, demo-backups):
//        docker run -d --name s3b-shots-minio -p 10030:9000 -e MINIO_ROOT_USER=<user> -e MINIO_ROOT_PASSWORD=<password> \
//          quay.io/minio/minio server /data
//        ... run the shots ...
//        docker rm -f s3b-shots-minio
//   2. The app running in server mode with the portable tag so its DB stays next to the exe, e.g.
//        go build -tags server,production,portable -o <dir>/S3Browser-server.exe .
//        cd <dir> && WAILS_SERVER_PORT=8090 ./S3Browser-server.exe
//   3. Credentials in the environment only (never written to disk or to the screenshots):
//        SHOTS_URL=http://localhost:8090 S3_ENDPOINT=http://localhost:10030 \
//        S3_ACCESS_KEY=... S3_SECRET_KEY=... [SHOTS_LANGS=en,vi] bun run --cwd docs shots
//
// SHOTS_LANGS defaults to every app language (same order as LANGUAGES in frontend/src/common/cnst/settingConst.ts).
// Per language the script creates the "MinIO demo" profile, walks through the app and deletes the profile again.
// The bucket shots create and delete the bucket "demo-new-bucket" for real; the update shots inject the
// `update:state-changed` event (the portable build has no updater, so nothing is downloaded or installed).
// Every shot is annotated (red frame, arrow and text drawn over the page just before the screenshot): the targets are
// in this file, the texts per language in docs/scripts/annotations.json. The script exits before starting when a
// shot or one of the SHOTS_LANGS has no text there.
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
const ALL_LANGS = ['en', 'vi', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de'];
const langs = process.env.SHOTS_LANGS?.split(',') ?? ALL_LANGS;
const PROFILE = 'MinIO demo';
const BIG_FILE = 'backup-full-2026-10-28.zip';
const BIG_FILE_MB = 1500; // big enough that the upload is still running when shot 15 is taken
const TEMP_BUCKET = 'demo-new-bucket';

if (!url || !endpoint || !accessKey || !secretKey) {
  console.error('Set SHOTS_URL, S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY (see the header of this file).');
  process.exit(1);
}

/** Language names shown in the Settings language select, parsed from LANGUAGE_LABELS so they never drift. */
const languageLabels = Object.fromEntries(
  [
    ...readFileSync(join(docsDir, '..', 'frontend', 'src', 'common', 'cnst', 'settingConst.ts'), 'utf8')
      .split('LANGUAGE_LABELS')[1]
      .split('};')[0]
      .matchAll(/^\s+'?([\w-]+)'?: '([^']+)',$/gm),
  ].map(([, code, name]) => [code, name])
);

/** Reads a label from the app's own locale files, so selectors always match the real UI text. */
function label(lang, namespace, key) {
  const json = JSON.parse(readFileSync(join(localesDir, lang, `${namespace}.json`), 'utf8'));
  return key.split('.').reduce((node, part) => node[part], json);
}

/** Every screenshot name; each one must have annotations (docs/scripts/annotations.json). */
const IMAGE_NAMES = [
  '01-main-window',
  '02-settings',
  '03-connect-modal',
  '04-profile-created',
  '05-profile-menu',
  '06-bucket-list',
  '07-bucket-search',
  '08-object-list',
  '09-object-folder',
  '10-object-detail',
  '11-object-selection',
  '12-object-search',
  '13-upload-modal',
  '14-upload-modal-files',
  '15-upload-progress',
  '16-object-uploaded',
  '17-delete-confirm',
  '18-profile-delete-confirm',
  '19-download-progress',
  '21-error-invalid-credentials',
  '22-error-endpoint',
  '23-auth-types',
  '24-auth-assume-role',
  '25-auth-minio-sts',
  '26-auth-ldap',
  '27-auth-oidc',
  '28-auth-certificate',
  '29-bucket-menu',
  '30-bucket-detail',
  '31-bucket-create',
  '32-bucket-policy',
  '33-bucket-delete',
  '34-settings-update',
  '35-update-downloading',
  '36-update-ready',
];

/** { image: { noteId: { lang: text } } }; a text may hold {{namespace:key}}, replaced by the app's own label. */
const annotations = JSON.parse(readFileSync(join(docsDir, 'scripts', 'annotations.json'), 'utf8'));
const PLACEHOLDER = /\{\{([^:}]+):([^}]+)\}\}/g;
const noteText = (lang, image, id) =>
  annotations[image][id][lang].replace(PLACEHOLDER, (_, namespace, key) => {
    const text = label(lang, namespace, key);
    if (typeof text !== 'string') throw new Error(`${namespace}:${key} is not a text`);
    return text;
  });

/** Exits before anything slow starts when a shot has no note or a note lacks a text for any of the 7 languages. */
function checkAnnotations() {
  const problems = Object.keys(annotations)
    .filter(name => !IMAGE_NAMES.includes(name))
    .map(name => `${name}: unknown image`);
  for (const image of IMAGE_NAMES) {
    const notes = Object.entries(annotations[image] ?? {});
    if (!notes.length) problems.push(`${image}: no note`);
    for (const [id, texts] of notes) {
      for (const lang of ALL_LANGS) {
        try {
          if (!texts[lang]?.trim()) problems.push(`${image}/${id}: no text for ${lang}`);
          else noteText(lang, image, id);
        } catch (error) {
          problems.push(`${image}/${id}/${lang}: label not found (${error.message})`);
        }
      }
    }
  }
  if (problems.length) {
    console.error(`annotations.json is incomplete:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}
checkAnnotations();

const OVERLAY_ID = 'shots-annotation';

/**
 * Runs in the page: draws one overlay with a red frame around each note's box, a red bold text with a white outline
 * and an arrow from the text to the frame. The text goes on the preferred side of the frame; when it would leave the
 * viewport or cover a frame or another text, the other sides are tried. A note may also set `gap` (distance to the
 * frame), `dx`/`dy` (shift from that spot) and `width` (max text width) to land in blank space. The overlay ignores the mouse, so it cannot
 * close an open menu or listbox.
 */
function drawAnnotations({ items, overlayId, lang }) {
  const RED = '#e03131';
  const MARGIN = 8;
  const PAD = 4; // frame grows this much around the element
  const SVG = 'http://www.w3.org/2000/svg';
  const OPPOSITE = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
  const root = document.createElement('div');
  root.id = overlayId;
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', innerWidth);
  svg.setAttribute('height', innerHeight);
  svg.style.cssText = 'position:absolute;left:0;top:0';
  root.append(svg);
  document.body.append(root);

  const draw = (tag, attrs) => {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    svg.append(element);
  };
  // A white copy under the red shape keeps it visible on dark and red backgrounds.
  const stroked = (tag, attrs) => {
    draw(tag, { ...attrs, stroke: '#fff', 'stroke-width': 7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    draw(tag, { ...attrs, stroke: RED, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  };
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const touches = (a, b) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 6 && b.y < a.y + a.h + 6;

  const frames = items.map(({ box }) => ({
    x: box.x - PAD,
    y: box.y - PAD,
    w: box.width + 2 * PAD,
    h: box.height + 2 * PAD,
  }));
  const taken = [...frames];
  items.forEach(({ text, place, gap = 56, dx = 0, dy = 0, width = 300 }, index) => {
    const frame = frames[index];
    const caption = document.createElement('div');
    caption.textContent = text;
    caption.lang = lang; // lets the browser pick the CJK glyphs and break lines per language
    caption.style.cssText = `position:absolute;left:0;top:0;width:max-content;max-width:${width}px;color:${RED};
      font:700 20px/1.25 var(--mantine-font-family),sans-serif;-webkit-text-stroke:5px #fff;paint-order:stroke fill;
      text-wrap:balance;line-break:strict;word-break:auto-phrase`;
    root.append(caption);
    // text-wrap:balance leaves the box at max-width: shrink it to the text so the arrow starts at the text
    const range = document.createRange();
    range.selectNodeContents(caption);
    caption.style.width = `${Math.ceil(range.getBoundingClientRect().width)}px`;
    const { width: w, height: h } = caption.getBoundingClientRect();
    const fit = (side, gap) => {
      const cx = frame.x + frame.w / 2 - w / 2;
      const cy = frame.y + frame.h / 2 - h / 2;
      const at = {
        right: { x: frame.x + frame.w + gap, y: clamp(cy, MARGIN, innerHeight - MARGIN - h) },
        left: { x: frame.x - gap - w, y: clamp(cy, MARGIN, innerHeight - MARGIN - h) },
        top: { x: clamp(cx, MARGIN, innerWidth - MARGIN - w), y: frame.y - gap - h },
        bottom: { x: clamp(cx, MARGIN, innerWidth - MARGIN - w), y: frame.y + frame.h + gap },
      }[side];
      return { x: at.x + dx, y: at.y + dy, w, h };
    };
    const inside = r =>
      r.x >= MARGIN && r.y >= MARGIN && r.x + r.w <= innerWidth - MARGIN && r.y + r.h <= innerHeight - MARGIN;
    const sides = [
      place,
      OPPOSITE[place],
      ...['right', 'left', 'top', 'bottom'].filter(s => s !== place && s !== OPPOSITE[place]),
    ];
    const candidates = [gap, gap / 2].flatMap(g => sides.map(side => fit(side, g)));
    const rect =
      candidates.find(r => inside(r) && !taken.some(t => touches(r, t))) ?? candidates.find(inside) ?? fit(place, gap);
    taken.push(rect);
    caption.style.left = `${rect.x}px`;
    caption.style.top = `${rect.y}px`;

    // Arrow: from the text edge nearest the frame centre to the frame edge nearest the text centre.
    const from = {
      x: clamp(frame.x + frame.w / 2, rect.x, rect.x + rect.w),
      y: clamp(frame.y + frame.h / 2, rect.y, rect.y + rect.h),
    };
    const to = {
      x: clamp(rect.x + rect.w / 2, frame.x, frame.x + frame.w),
      y: clamp(rect.y + rect.h / 2, frame.y, frame.y + frame.h),
    };
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const HEAD = 14;
    const base = { x: to.x - Math.cos(angle) * HEAD * 0.8, y: to.y - Math.sin(angle) * HEAD * 0.8 };
    const wing = side => `${to.x - Math.cos(angle + side) * HEAD},${to.y - Math.sin(angle + side) * HEAD}`;
    stroked('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 6, fill: 'none' });
    stroked('line', { x1: from.x, y1: from.y, x2: base.x, y2: base.y });
    stroked('polygon', { points: `${to.x},${to.y} ${wing(0.45)} ${wing(-0.45)}`, fill: RED });
  });
}

/** Boxes of the notes' targets (all matches of a locator, merged), failing with the image name when one is missing. */
async function resolveNotes(page, lang, image, notes) {
  if (!notes?.length) throw new Error(`${image}: shot without notes`);
  return Promise.all(
    notes.map(async ({ id, target, ...layout }) => {
      if (!annotations[image]?.[id]) throw new Error(`${image}: note "${id}" is not in annotations.json`);
      await target
        .first()
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => {
          throw new Error(`${image}: target of note "${id}" not found`);
        });
      const boxes = (await Promise.all((await target.all()).map(match => match.boundingBox()))).filter(Boolean);
      const x = Math.min(...boxes.map(b => b.x));
      const y = Math.min(...boxes.map(b => b.y));
      const right = Math.max(...boxes.map(b => b.x + b.width));
      const bottom = Math.max(...boxes.map(b => b.y + b.height));
      return { ...layout, text: noteText(lang, image, id), box: { x, y, width: right - x, height: bottom - y } };
    })
  );
}

/** Creates a ~1.5 GB zero-filled file so the upload lasts long enough to be photographed. */
async function createBigFile(path) {
  const chunk = Buffer.alloc(1024 * 1024 * 50);
  const out = createWriteStream(path);
  for (let i = 0; i < BIG_FILE_MB / 50; i++) {
    if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
  }
  await new Promise(resolve => out.end(resolve));
}

/** Removes the demo bucket and profile of the language in progress; set by runLang, used when it fails. */
let cleanupLang = null;

async function runLang(browser, lang, bigFilePath) {
  const L = (ns, key) => label(lang, ns, key);
  const dir = join(docsDir, 'user-guide', lang, 'images');
  mkdirSync(dir, { recursive: true });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pause = (ms = 700) => page.waitForTimeout(ms);
  // Toasts are hidden unless the shot is about them; the mouse is parked so no tooltip stays open.
  // `notes` ([{ id, target, place }], see drawAnnotations) are drawn on the page for the shot and removed after it.
  const shot = async (name, { toast = false, notes, ...options } = {}) => {
    await page.mouse.move(640, 760);
    await page.evaluate(show => {
      const toaster = document.querySelector('[data-sonner-toaster]');
      if (toaster) toaster.style.display = show ? '' : 'none';
    }, toast);
    await pause(500);
    const items = await resolveNotes(page, lang, name, notes);
    try {
      await page.evaluate(drawAnnotations, { items, overlayId: OVERLAY_ID, lang });
      await page.screenshot({ path: join(dir, `${name}.png`), ...options });
    } finally {
      await page.evaluate(id => document.getElementById(id)?.remove(), OVERLAY_ID).catch(() => {});
    }
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

  const createProfileButton = () =>
    page.getByRole('button', {
      name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'),
      exact: true,
    });
  /** The side panel whose header text is the title of the given drawer namespace. */
  const drawer = namespace => page.getByText(L(namespace, 'title'), { exact: true }).locator('xpath=../..');
  const okButton = () => page.getByRole('button', { name: L('common', 'button.OK'), exact: true });
  const profileItem = () => page.getByText(PROFILE, { exact: true }).first();
  const profileCard = () => page.locator('.mantine-Card-root', { hasText: PROFILE });
  /** The floating upload/download window (its header text is the window title). */
  const transferWindow = namespace =>
    page
      .locator('.mantine-Paper-root')
      .filter({ has: page.getByText(L(namespace, 'title'), { exact: true }) })
      .last();
  const toastBox = () => page.locator('[data-sonner-toast]').first();
  const tabConnect = () =>
    page.getByRole('button', { name: L('pages/tab/tabLayout', 'tooltip.connect'), exact: true }).last();
  const openProfileMenu = async () => {
    await page.getByText(PROFILE, { exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem').first().waitFor();
  };
  const clickMenuItem = key =>
    page.getByRole('menuitem', { name: L('components/layouts/navbar/connectionProfiles', key), exact: true }).click();

  /** Disconnects (when connected) and deletes the demo profile; `withShot` photographs the confirmation. */
  async function deleteProfile(withShot) {
    if (!(await page.getByText(PROFILE, { exact: true }).count())) return;
    await openProfileMenu();
    const disconnect = page.getByRole('menuitem', {
      name: L('components/layouts/navbar/connectionProfiles', 'contextMenu.disconnect'),
      exact: true,
    });
    if (await disconnect.count()) {
      await disconnect.click();
      await pause();
      await openProfileMenu();
    }
    await clickMenuItem('contextMenu.delete');
    await pause();
    if (withShot)
      await shot('18-profile-delete-confirm', {
        notes: [{ id: 'confirm', target: okButton(), place: 'bottom', gap: 40 }],
      });
    await page.getByRole('button', { name: L('common', 'button.OK'), exact: true }).click();
    await pause(1000);
  }

  const BUCKET_PAGE = 'pages/tab/bucket/page';
  const CREATE_BUCKET = 'components/modals/createBucketModal';
  const DELETE_BUCKET = 'components/modals/deleteBucketModal';
  const POLICY_MODAL = 'components/modals/bucketPolicyModal';
  const CONNECT = 'components/modals/connectModal';
  const closeModal = () =>
    page
      .getByRole('button', { name: L('common', 'button.close'), exact: true })
      .last()
      .click();
  const bucketRow = name => page.locator('.mantine-Card-root', { hasText: name });
  const openBucketMenu = async name => {
    await bucketRow(name)
      .getByRole('button', { name: L(BUCKET_PAGE, 'tooltip.moreActions') })
      .click();
    await page.getByRole('menuitem').first().waitFor();
  };
  const clickBucketMenu = key =>
    page.getByRole('menuitem', { name: L(BUCKET_PAGE, `menu.${key}`), exact: true }).click();

  /** Deletes the temporary bucket through the real delete modal (typing its name); `withShot` photographs it. */
  async function deleteTempBucket(withShot) {
    if (!(await page.getByText(TEMP_BUCKET, { exact: true }).count())) return;
    await openBucketMenu(TEMP_BUCKET);
    await clickBucketMenu('delete');
    await page.getByPlaceholder(L(DELETE_BUCKET, 'placeholder.confirmName')).fill(TEMP_BUCKET);
    await pause(900);
    if (withShot)
      await shot('33-bucket-delete', {
        notes: [
          {
            id: 'confirmName',
            target: page.getByPlaceholder(L(DELETE_BUCKET, 'placeholder.confirmName')),
            place: 'right',
          },
        ],
      });
    await page
      .getByRole('button', { name: L(DELETE_BUCKET, 'delete'), exact: true })
      .last()
      .click();
    await page.getByText(TEMP_BUCKET, { exact: true }).waitFor({ state: 'detached', timeout: 60000 });
    await pause();
  }

  cleanupLang = async () => {
    await page.keyboard.press('Escape'); // close a modal or menu left open by a failed shot
    await deleteTempBucket(false);
    await deleteProfile(false);
  };

  /** Opens an empty profile form for the provider (AWS or MinIO); nothing is typed, nothing is connected. */
  async function openEmptyProfileForm(provider) {
    await page
      .getByRole('button', {
        name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'),
        exact: true,
      })
      .click();
    await page.getByText(provider, { exact: true }).click();
    await pause(500);
  }
  const authCombobox = () => page.getByRole('combobox', { name: L(CONNECT, 'form.label.authType'), exact: true });
  /** Picks an authentication method and scrolls the form so the method's fields are in view. */
  async function pickAuthType(type) {
    await authCombobox().click();
    await page.getByRole('option', { name: L(CONNECT, `authType.${type}.label`), exact: true }).click();
    await authCombobox().evaluate(select => select.scrollIntoView({ block: 'start' }));
    await pause();
  }

  await page.goto(url, { waitUntil: 'networkidle' });
  // The app starts in English (default setting); the language is switched in the Settings modal and only
  // applied for this page (Apply, not Save), so every language starts from the same state after a reload.
  const SETTING = 'components/modals/settingModal';
  await page.getByRole('button', { name: label('en', SETTING, 'title'), exact: true }).click();
  await page.getByText(label('en', SETTING, 'label.language'), { exact: true }).waitFor();
  if (lang !== 'en') {
    await page.getByRole('combobox', { name: label('en', SETTING, 'label.language'), exact: true }).click();
    await page.getByRole('option', { name: languageLabels[lang], exact: true }).click();
    await page.getByRole('button', { name: L(SETTING, 'button.apply'), exact: true }).click();
    await page.getByText(L(SETTING, 'label.language'), { exact: true }).waitFor();
  }
  await pause();
  await shot('02-settings', {
    notes: [
      {
        id: 'language',
        target: page.getByRole('combobox', { name: L(SETTING, 'label.language'), exact: true }),
        place: 'right',
      },
    ],
  });
  await page.getByRole('button', { name: L(SETTING, 'button.cancel'), exact: true }).click();
  await pause();
  await deleteProfile(false);

  // 01 main window
  await shot('01-main-window', {
    notes: [{ id: 'createProfile', target: createProfileButton(), place: 'bottom', gap: 150, width: 200 }],
  });

  // 03 connection profile form (fake key values; the real ones are typed only after the shot)
  const form = key => L('components/modals/connectModal', `form.label.${key}`);
  await page
    .getByRole('button', {
      name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'),
      exact: true,
    })
    .click();
  await page.getByText('MinIO', { exact: true }).click();
  await page.getByRole('textbox', { name: form('name'), exact: true }).fill(PROFILE);
  await page.getByRole('textbox', { name: form('endpoint') }).fill('http://localhost:9000');
  await page.locator('button', { hasText: L('components/inputs/inputs', 'regionCombobox.placeholder') }).click();
  await page.getByRole('option', { name: /us-east-1/ }).click();
  await page.getByRole('textbox', { name: form('accessKey') }).fill('demo-access-key');
  await page.getByLabel(form('secretKey'), { exact: true }).fill('demo-secret-key');
  await page.getByLabel(form('savePassword')).check();
  await shot('03-connect-modal', {
    notes: [
      { id: 'endpoint', target: page.getByRole('textbox', { name: form('endpoint') }), place: 'bottom' },
      {
        id: 'save',
        target: page.getByRole('button', {
          name: L('components/modals/connectModal', 'form.button.createProfile'),
          exact: true,
        }),
        place: 'left',
      },
    ],
  });

  // 04 profile created and listed
  await page.getByRole('textbox', { name: form('endpoint') }).fill(endpoint);
  await page.getByRole('textbox', { name: form('accessKey') }).fill(accessKey);
  await page.getByLabel(form('secretKey'), { exact: true }).fill(secretKey);
  await page
    .getByRole('button', { name: L('components/modals/connectModal', 'form.button.createProfile'), exact: true })
    .click();
  await pause(900);
  await shot('04-profile-created', {
    toast: true,
    notes: [{ id: 'profile', target: profileCard(), place: 'right', gap: 80, dy: 60 }],
  });
  await openProfileMenu();
  await shot('05-profile-menu', {
    notes: [{ id: 'rightClick', target: profileItem(), place: 'right', gap: 80, dy: 60 }],
  });
  await page.keyboard.press('Escape');

  // 06 bucket list
  await page.locator('[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: PROFILE }).click();
  await tabConnect().click();
  await page.getByText('demo-photos', { exact: true }).waitFor();
  await deleteTempBucket(false); // left over by an interrupted run
  await pause(1500);
  const tabPanel = page.getByRole('tabpanel');
  await shot('06-bucket-list', {
    notes: [
      {
        id: 'profile',
        target: tabPanel
          .locator('[aria-haspopup="listbox"]')
          .first()
          .or(tabPanel.getByRole('button', { name: L('pages/tab/tabLayout', 'tooltip.connect'), exact: true })),
        place: 'left',
        gap: 25,
        dy: 110,
        width: 200,
      },
    ],
  });

  // 07 bucket search
  const bucketSearch = page.getByPlaceholder(L('pages/tab/tabLayout', 'search.placeholderBucket'));
  await bucketSearch.fill('reports');
  await bucketSearch.press('Enter');
  await page.getByText('demo-reports', { exact: true }).waitFor();
  await pause(1000);
  await shot('07-bucket-search', { notes: [{ id: 'search', target: bucketSearch, place: 'bottom', gap: 130 }] });
  await page.getByRole('button', { name: L('pages/tab/tabLayout', 'tooltip.clearSearch') }).click();
  await pause();

  // 29 bucket menu, 30 bucket details drawer, 31 create bucket (real), 32 bucket permission (custom policy)
  await openBucketMenu('demo-photos');
  await shot('29-bucket-menu', { notes: [{ id: 'menu', target: page.getByRole('menu'), place: 'right' }] });
  await clickBucketMenu('detail');
  await page.getByText(L('pages/tab/bucketDetailDrawer', 'label.rootCount')).waitFor();
  await pause(1500);
  await shot('30-bucket-detail', {
    notes: [{ id: 'detail', target: drawer('pages/tab/bucketDetailDrawer'), place: 'left' }],
  });
  await page
    .getByRole('button', { name: L('pages/tab/bucketDetailDrawer', 'tooltip.close'), exact: true })
    .last()
    .click();
  await pause();
  await page.getByRole('button', { name: L('pages/tab/tabLayout', 'tooltip.createBucket'), exact: true }).click();
  await page.getByPlaceholder(L(CREATE_BUCKET, 'placeholder.name')).fill(TEMP_BUCKET);
  await page.getByText(L(POLICY_MODAL, 'mode.public'), { exact: true }).click();
  await pause();
  await shot('31-bucket-create', {
    notes: [
      { id: 'name', target: page.getByPlaceholder(L(CREATE_BUCKET, 'placeholder.name')), place: 'right' },
      { id: 'permission', target: page.getByRole('dialog').locator('.mantine-SegmentedControl-root'), place: 'right' },
    ],
  });
  await page.getByRole('button', { name: L(CREATE_BUCKET, 'create'), exact: true }).click();
  await page.getByText(TEMP_BUCKET, { exact: true }).waitFor();
  await pause(1000);
  await openBucketMenu('demo-reports');
  await clickBucketMenu('editPolicy');
  await page.getByText(L(POLICY_MODAL, 'label.policy')).waitFor();
  await pause(1000);
  const policyDialog = page.getByRole('dialog');
  await shot('32-bucket-policy', {
    notes: [
      {
        id: 'policy',
        target: policyDialog.getByText(L(POLICY_MODAL, 'label.policy')).or(policyDialog.getByRole('textbox')),
        place: 'right',
      },
    ],
  });
  await closeModal();
  await pause();
  await deleteTempBucket(true);

  // 08 objects of a bucket, 09 inside a folder, 10 object details
  await page.getByText('demo-photos', { exact: true }).click();
  await page.getByText('travel', { exact: true }).waitFor();
  await pause(1000);
  await shot('08-object-list', {
    notes: [{ id: 'folder', target: page.getByText('travel', { exact: true }), place: 'right' }],
  });
  await page.getByText('travel', { exact: true }).click();
  await page.getByText('2026', { exact: true }).click();
  await page.getByText('paris.png').waitFor();
  await shot('09-object-folder', { notes: [{ id: 'file', target: page.getByText('paris.png'), place: 'right' }] });
  await page.getByText('paris.png').click();
  await page.getByText(L('pages/tab/objectDetailDrawer', 'label.contentType')).waitFor();
  await shot('10-object-detail', {
    notes: [{ id: 'detail', target: drawer('pages/tab/objectDetailDrawer'), place: 'left' }],
  });
  await page
    .getByRole('button', { name: L('pages/tab/objectDetailDrawer', 'tooltip.close'), exact: true })
    .last()
    .click();
  await pause();

  // 11 selecting several objects
  const checkboxes = page.getByRole('checkbox');
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  await shot('11-object-selection', {
    notes: [
      { id: 'selected', target: page.getByRole('checkbox', { checked: true }), place: 'bottom', gap: 30, dx: 130 },
    ],
  });
  await page.getByRole('button', { name: L('pages/tab/object/page', 'tooltip.clearSelected') }).click();

  // 12 object search (keys containing the keyword in the current folder)
  const objectSearch = page.getByPlaceholder(L('pages/tab/tabLayout', 'search.placeholderObject'));
  await objectSearch.fill('tokyo');
  await objectSearch.press('Enter');
  await page.getByText('tokyo.png').waitFor();
  await pause(1000);
  await shot('12-object-search', { notes: [{ id: 'search', target: objectSearch, place: 'bottom' }] });
  await page.getByRole('button', { name: L('pages/tab/tabLayout', 'tooltip.clearSearch') }).click();

  // 13 upload picker (empty, then filled by the drop event the backend would send)
  await page.getByRole('button', { name: L('pages/tab/tabLayout', 'tooltip.upload') }).click();
  await page.getByText(L('components/modals/uploadPickerModal', 'dropHint')).waitFor();
  await shot('13-upload-modal', {
    notes: [
      { id: 'drop', target: page.getByText(L('components/modals/uploadPickerModal', 'dropHint')), place: 'bottom' },
    ],
  });
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
  await shot('14-upload-modal-files', {
    notes: [{ id: 'files', target: page.getByText(/holiday-0|report-2026/), place: 'right' }],
  });
  await page
    .getByRole('button', { name: L('common', 'button.close'), exact: true })
    .last()
    .click();
  await pause();

  // 15 real upload with progress, 16 the new object, 17 delete confirmation
  await page.getByText('demo-photos', { exact: true }).first().click();
  await page.getByRole('button', { name: L('pages/tab/object/page', 'tooltip.backToBucket') }).click();
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
  await page.getByText(L('components/layouts/transfer/uploaderWindow', 'label.uploadedLbl')).first().waitFor();
  await pause(200);
  await shot('15-upload-progress', {
    notes: [{ id: 'progress', target: transferWindow('components/layouts/transfer/uploaderWindow'), place: 'left' }],
  });
  await upload;
  await pause(500);
  await page
    .getByRole('button', {
      name: L('pages/tab/tabLayout', 'tooltip.refresh').replace(
        '{target}',
        L('pages/tab/object/page', 'tooltip.objectList')
      ),
    })
    .click();
  await page.getByText(BIG_FILE, { exact: true }).waitFor();
  await shot('16-object-uploaded', {
    notes: [{ id: 'file', target: page.getByText(BIG_FILE, { exact: true }), place: 'bottom' }],
  });
  await page
    .getByRole('button', { name: L('pages/tab/object/page', 'tooltip.moreActions') })
    .last()
    .click();
  await page.getByRole('menuitem', { name: L('pages/tab/object/page', 'action.delete') }).click();
  await pause();
  await shot('17-delete-confirm', {
    notes: [
      {
        id: 'confirm',
        target: page.getByRole('button', {
          name: `${L('components/modals/deleteConfirmModal', 'delete')} (1)`,
          exact: true,
        }),
        place: 'left',
      },
    ],
  });
  await page
    .getByRole('button', { name: `${L('components/modals/deleteConfirmModal', 'delete')} (1)`, exact: true })
    .click();
  await page.getByText(L('components/modals/deleteResultModal', 'title'), { exact: true }).waitFor();
  await page.getByRole('button', { name: L('common', 'button.OK'), exact: true }).click();
  await page.getByRole('tabpanel').getByText(BIG_FILE, { exact: true }).waitFor({ state: 'detached' });
  await pause(600);

  // 19 download window (no history shot: the modal is empty in a demo run) (events as the backend emits them; the native destination dialog cannot be driven here)
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
    await dispatchEvent('downloader:download-progress-batch', { items: [{ downloadId: id, downloaded, total: size }] });
  }
  await pause(800);
  await shot('19-download-progress', {
    notes: [{ id: 'progress', target: transferWindow('components/layouts/transfer/downloaderWindow'), place: 'left' }],
  });
  // Finish the fake downloads (newer version, status DONE) so the window is not in shots 21 onwards
  for (const { id, fileName } of downloads) {
    await dispatchEvent('downloader:load-download-history', { id, fileName, status: 'DONE', version: 2 });
  }
  await pause(500);

  // 21-22 common errors, reproduced with "Test connection" in the profile form
  await page
    .getByRole('button', {
      name: L('components/layouts/navbar/connectionProfiles', 'tooltip.createProfile'),
      exact: true,
    })
    .click();
  await page.getByText('MinIO', { exact: true }).click();
  await page.getByRole('textbox', { name: form('name'), exact: true }).fill('Wrong credentials');
  await page.getByRole('textbox', { name: form('endpoint') }).fill(endpoint);
  await page.locator('button', { hasText: L('components/inputs/inputs', 'regionCombobox.placeholder') }).click();
  await page.getByRole('option', { name: /us-east-1/ }).click();
  await page.getByRole('textbox', { name: form('accessKey') }).fill('wrong-access-key');
  await page.getByLabel(form('secretKey'), { exact: true }).fill('wrong-secret-key');
  const testButton = page.getByRole('button', {
    name: L('components/modals/connectModal', 'form.button.testConnection'),
  });
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 });
  await testButton.click();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'attached' });
  await shot('21-error-invalid-credentials', {
    toast: true,
    notes: [{ id: 'cause', target: toastBox(), place: 'left', gap: 245, dy: 40, width: 200 }],
  });
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 });
  await page.getByRole('textbox', { name: form('endpoint') }).fill('http://localhost:1');
  await testButton.click();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'attached', timeout: 40000 });
  await shot('22-error-endpoint', {
    toast: true,
    notes: [{ id: 'cause', target: toastBox(), place: 'left', gap: 245, dy: 40, width: 200 }],
  });
  await page
    .getByRole('button', { name: L('common', 'button.close'), exact: true })
    .last()
    .click();
  await pause();

  // 23-28 authentication methods: empty forms, nothing is connected
  await openEmptyProfileForm('AWS');
  await authCombobox().click();
  await shot('23-auth-types', {
    notes: [{ id: 'types', target: page.getByRole('listbox'), place: 'left', gap: 25, width: 200 }],
  });
  await page.keyboard.press('Escape');
  await pickAuthType('assumeRole');
  await shot('24-auth-assume-role', {
    notes: [{ id: 'type', target: authCombobox(), place: 'left', gap: 50, width: 200 }],
  });
  await page.getByText('MinIO', { exact: true }).click();
  const minioAuth = [
    ['25-auth-minio-sts', 'minioAssumeRole'],
    ['26-auth-ldap', 'minioLdap'],
    ['27-auth-oidc', 'minioOidc'],
    ['28-auth-certificate', 'minioCert'],
  ];
  for (const [name, type] of minioAuth) {
    await pickAuthType(type);
    await shot(name, { notes: [{ id: 'type', target: authCombobox(), place: 'left', gap: 50, width: 200 }] });
  }
  await closeModal();
  await pause();

  // 34-36 update: Settings section, then the toast while downloading and when ready (injected events)
  const update = (state, extra = {}) =>
    dispatchEvent('update:state-changed', {
      supported: true,
      state,
      currentVersion: '0.1.0',
      version: '0.2.0',
      releaseUrl: 'https://github.com/TranMinhTruyen/s3-browser/releases/tag/v0.2.0',
      written: 0,
      total: 0,
      ...extra,
    });
  await update('available');
  await page.getByRole('button', { name: L(SETTING, 'title'), exact: true }).click();
  await page.getByText(L(SETTING, 'update.title'), { exact: true }).waitFor();
  await pause();
  await shot('34-settings-update', {
    notes: [{ id: 'update', target: page.getByText(L(SETTING, 'update.title'), { exact: true }), place: 'right' }],
  });
  await page.getByRole('button', { name: L(SETTING, 'button.cancel'), exact: true }).click();
  await pause();
  await update('downloading', { written: 31457280, total: 52428800 });
  await pause(900);
  await shot('35-update-downloading', { toast: true, notes: [{ id: 'toast', target: toastBox(), place: 'right' }] });
  await update('ready');
  await pause(900);
  await shot('36-update-ready', { toast: true, notes: [{ id: 'toast', target: toastBox(), place: 'right' }] });
  await update('idle', { supported: false });
  await pause();

  // 18 deleting the profile (also leaves the app clean for the next language)
  await deleteProfile(true);
  cleanupLang = null;
  await page.close();
}

const tempDir = join(tmpdir(), 's3browser-shots');
mkdirSync(tempDir, { recursive: true });
const bigFilePath = join(tempDir, BIG_FILE);
await createBigFile(bigFilePath);
const browser = await chromium.launch();
const failed = [];
try {
  // A language that fails is reported at the end and does not stop the others; rerun it with SHOTS_LANGS=<lang>.
  for (const lang of langs) {
    try {
      await runLang(browser, lang, bigFilePath);
    } catch (error) {
      const where = error.stack.split('\n').find(line => line.includes('shots.mjs:'));
      console.error(`[fail] ${lang}: ${error.message.split('\n')[0]} (${where?.trim()})`);
      failed.push(lang);
      // Best effort: leave no demo bucket or profile behind
      await cleanupLang?.().catch(() => {});
      cleanupLang = null;
      await Promise.all(
        browser
          .contexts()
          .flatMap(context => context.pages())
          .map(page => page.close())
      );
    }
  }
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}
if (failed.length) {
  console.error(`Failed languages: ${failed.join(', ')}`);
  process.exitCode = 1;
}
