import type { Page } from '@playwright/test';
import { expect, hideToasts, switchMode, t, test } from './fixtures';
import { dropBucket, hasS3, s3, s3Env, seedBucket } from './s3';

const PROFILES = 'pages/s3/connectionProfiles';
const CONNECT = 'pages/s3/modals/connectModal';
const TAB = 'pages/s3/tabLayout';
const OBJECT = 'pages/s3/object/page';
const PROFILE = 'E2E MinIO';
const BUCKET = `e2e-${Date.now()}`;
const OBJECTS = {
  'docs/readme.txt': 'readme',
  'docs/notes.txt': 'notes',
  'delete-me.txt': 'temporary',
  'keep.txt': 'kept',
};

test.describe.configure({ mode: 'serial' });
test.skip(!hasS3, 'Set E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY and E2E_S3_SECRET_KEY (an S3/MinIO server) to run.');

test.beforeAll(() => seedBucket(BUCKET, OBJECTS));
test.afterAll(() => dropBucket(BUCKET, Object.keys(OBJECTS)));

const form = (key: string) => t(CONNECT, `form.label.${key}`);
const profileCard = (page: Page) => page.locator('.mantine-Card-root', { hasText: PROFILE });

/** Chọn hồ sơ trong tab đang hoạt động rồi kết nối. */
async function connect(page: Page) {
  await switchMode(page, 's3');
  await hideToasts(page);
  const panel = page.getByRole('tabpanel');
  await panel.locator('[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: PROFILE }).click();
  await panel.getByRole('button', { name: t(TAB, 'tooltip.connect'), exact: true }).click();
  await expect(panel.getByText(BUCKET, { exact: true })).toBeVisible();
}

test('create a MinIO profile', async ({ page }) => {
  await switchMode(page, 's3');
  await page.getByRole('button', { name: t(PROFILES, 'tooltip.createProfile'), exact: true }).click();
  await page.getByText('MinIO', { exact: true }).click();
  await page.getByRole('textbox', { name: form('name'), exact: true }).fill(PROFILE);
  await page.getByRole('textbox', { name: form('endpoint') }).fill(s3Env.endpoint);
  await page.locator('button', { hasText: t('pages/s3/components/inputs', 'regionCombobox.placeholder') }).click();
  await page
    .getByRole('option', { name: new RegExp(s3Env.region) })
    .first()
    .click();
  await page.getByRole('textbox', { name: form('accessKey') }).fill(s3Env.accessKey);
  await page.getByLabel(form('secretKey'), { exact: true }).fill(s3Env.secretKey);
  await page.getByLabel(form('savePassword')).check();
  await page.getByRole('button', { name: t(CONNECT, 'form.button.createProfile'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(profileCard(page)).toBeVisible();
});

test('connect, search buckets and browse objects', async ({ page }) => {
  await connect(page);
  const panel = page.getByRole('tabpanel');

  const bucketSearch = panel.getByPlaceholder(t(TAB, 'search.placeholderBucket'));
  await bucketSearch.fill(BUCKET.slice(4));
  await bucketSearch.press('Enter');
  await expect(panel.getByText(BUCKET, { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: t(TAB, 'tooltip.clearSearch') }).click();

  await panel.getByText(BUCKET, { exact: true }).click();
  await expect(panel.getByText('docs', { exact: true })).toBeVisible();
  await expect(panel.getByText('keep.txt', { exact: true })).toBeVisible();
  await panel.getByText('docs', { exact: true }).click();
  await expect(panel.getByText('readme.txt', { exact: true })).toBeVisible();
  await expect(panel.getByText('notes.txt', { exact: true })).toBeVisible();

  const objectSearch = panel.getByPlaceholder(t(TAB, 'search.placeholderObject'));
  await objectSearch.fill('notes');
  await objectSearch.press('Enter');
  await expect(panel.getByText('notes.txt', { exact: true })).toBeVisible();
  await expect(panel.getByText('readme.txt', { exact: true })).toBeHidden();
});

test('delete an object', async ({ page }) => {
  await connect(page);
  const panel = page.getByRole('tabpanel');
  await panel.getByText(BUCKET, { exact: true }).click();
  const name = panel.getByText('delete-me.txt', { exact: true });
  await expect(name).toBeVisible();

  const moreActions = t(OBJECT, 'tooltip.moreActions');
  await name
    .locator(`xpath=ancestor::*[.//button[@aria-label="${moreActions}"]][1]`)
    .getByRole('button', { name: moreActions })
    .click();
  await page.getByRole('menuitem', { name: t(OBJECT, 'action.delete') }).click();
  await page
    .getByRole('button', { name: `${t('pages/s3/modals/deleteConfirmModal', 'delete')} (1)`, exact: true })
    .click();
  await expect(page.getByText(t('pages/s3/modals/deleteResultModal', 'title'), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: t('common', 'button.OK'), exact: true }).click();

  await expect(name).toBeHidden();
  await expect(panel.getByText('keep.txt', { exact: true })).toBeVisible();
  expect(await s3('HEAD', `/${BUCKET}/delete-me.txt`)).toBe(404);
  expect(await s3('HEAD', `/${BUCKET}/keep.txt`)).toBe(200);
});

test('delete the profile', async ({ page }) => {
  await switchMode(page, 's3');
  await profileCard(page).getByText(PROFILE, { exact: true }).click({ button: 'right' });
  const disconnect = page.getByRole('menuitem', { name: t(PROFILES, 'contextMenu.disconnect'), exact: true });
  if (await disconnect.isVisible()) {
    await disconnect.click();
    await profileCard(page).getByText(PROFILE, { exact: true }).click({ button: 'right' });
  }
  await page.getByRole('menuitem', { name: t(PROFILES, 'contextMenu.delete'), exact: true }).click();
  await page.getByRole('button', { name: t('common', 'button.OK'), exact: true }).click();
  await expect(profileCard(page)).toHaveCount(0);
});
