import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetBucketDetail } from '@wails/S3Browser/internal/handlers/buckethandler';
import { Bucket, BucketDetailOutput } from '@wails/S3Browser/models/bucket';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabListStore } from '@/common/stores/tabListStore';
import { callIPC } from '@/common/utils/ipcUtils';
import BucketDetailDrawer from '@/pages/tab/components/BucketDetailDrawer';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@wails/S3Browser/internal/handlers/buckethandler', () => ({ GetBucketDetail: vi.fn() }));
vi.mock('@/common/utils/ipcUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/ipcUtils')>()),
  callIPC: vi.fn(),
}));

const TAB_ID = 'tab-1';
const callIPCMock = vi.mocked(callIPC);

const bucketA = new Bucket({ name: 'bucket-a', creationDate: '2026-01-02T03:04:05' });
const bucketB = new Bucket({ name: 'bucket-b', creationDate: '2026-02-03T04:05:06' });
const anonymous = new Bucket({ name: 'anon', creationDate: '0001-01-01T00:00:00Z' });

const full = new BucketDetailOutput({
  region: 'eu-west-1',
  arn: 'arn:aws:s3:::bucket-a',
  endpointUrl: 'https://bucket-a.s3.eu-west-1.amazonaws.com',
  policyMode: 'public',
  publicBlocked: true,
  versioning: 'Suspended',
  encryption: 'aws:kms (key-1)',
  objectLock: 'Enabled (GOVERNANCE, 30d)',
  tags: { zeta: 'last', alpha: 'first', empty: '' },
  rootCount: 12,
  rootCountCapped: false,
});
const nothing = new BucketDetailOutput({
  region: null,
  arn: '',
  endpointUrl: '',
  policyMode: null,
  publicBlocked: null,
  versioning: null,
  encryption: null,
  objectLock: null,
  tags: null,
  rootCount: null,
});

function renderDrawer() {
  return renderWithProviders(<BucketDetailDrawer tabId={TAB_ID} connectionId="conn" profileName="p" />);
}
const openBucket = (bucket: Bucket) => act(() => useTabListStore.getState().openBucketDetail(TAB_ID, bucket));
const closeBucket = () => act(() => useTabListStore.getState().closeBucketDetail(TAB_ID));
const loader = () => document.querySelector('.mantine-Loader-root');

// Text of the value paired with a label of a detail row.
const valueOf = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent;

// [key, value] pairs of the nested tag DataList, in rendered order.
function tagEntries() {
  const nested = screen.getByText('Tags', { selector: 'dt' }).nextElementSibling!.querySelector('dl')!;
  return Array.from(nested.querySelectorAll(':scope > div')).map(item => [
    item.querySelector('dt')!.textContent,
    item.querySelector('dd')!.textContent,
  ]);
}

describe('BucketDetailDrawer', () => {
  beforeEach(() => {
    callIPCMock.mockReset();
    useTabListStore.setState({
      tabList: { [TAB_ID]: { currentView: 'bucketList', prefix: '', selectionItem: {}, deletingItems: {} } },
    });
  });

  it('renders nothing and calls nothing when no bucket is open', () => {
    renderDrawer();

    expect(screen.queryByText('Bucket details')).not.toBeInTheDocument();
    expect(callIPCMock).not.toHaveBeenCalled();
  });

  it('renders nothing for an unknown tab', () => {
    useTabListStore.setState({ tabList: {} });
    renderDrawer();

    expect(screen.queryByText('Bucket details')).not.toBeInTheDocument();
  });

  it('shows the name and date at once and a loader while the detail loads', () => {
    callIPCMock.mockReturnValue(new Promise(() => {}) as never);
    openBucket(bucketA);
    renderDrawer();

    expect(screen.getByText('Bucket details')).toBeInTheDocument();
    expect(valueOf('Name')).toBe('bucket-a');
    expect(valueOf('Create date')).toBe('02-01-2026 03:04:05');
    expect(loader()).toBeInTheDocument();
    expect(screen.queryByText('Region')).not.toBeInTheDocument();
    expect(callIPCMock).toHaveBeenCalledExactlyOnceWith(
      GetBucketDetail,
      [{ connectionId: 'conn', profileName: 'p', bucket: 'bucket-a' }],
      { signal: expect.any(AbortSignal) }
    );
  });

  it('shows every field of the detail with its translated label and value', async () => {
    callIPCMock.mockResolvedValue(full as never);
    openBucket(bucketA);
    renderDrawer();

    expect(await screen.findByText('Region', { selector: 'dt' })).toBeInTheDocument();
    expect(loader()).not.toBeInTheDocument();
    expect(valueOf('Region')).toBe('eu-west-1');
    expect(valueOf('ARN')).toBe('arn:aws:s3:::bucket-a');
    expect(valueOf('Endpoint URL')).toBe('https://bucket-a.s3.eu-west-1.amazonaws.com');
    expect(valueOf('Policy')).toBe('Public (read-only)');
    expect(valueOf('Block Public Access')).toBe('On');
    expect(valueOf('Versioning')).toBe('Suspended');
    expect(valueOf('Default encryption')).toBe('aws:kms (key-1)');
    expect(valueOf('Object lock')).toBe('Enabled (GOVERNANCE, 30d)');
    expect(valueOf('Objects at root')).toBe('12');
    for (const heading of ['Basic', 'Access', 'Configuration']) expect(screen.getByText(heading)).toBeInTheDocument();
  });

  it('lets ARN and endpoint URL be copied', async () => {
    callIPCMock.mockResolvedValue(full as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('lists the tags sorted by key and shows "-" for an empty tag value', async () => {
    callIPCMock.mockResolvedValue(full as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(tagEntries()).toEqual([
      ['alpha', 'first'],
      ['empty', '-'],
      ['zeta', 'last'],
    ]);
  });

  it('shows "-" for every field the backend could not read', async () => {
    callIPCMock.mockResolvedValue(nothing as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    for (const label of [
      'Region',
      'ARN',
      'Endpoint URL',
      'Policy',
      'Block Public Access',
      'Versioning',
      'Default encryption',
      'Object lock',
      'Tags',
      'Objects at root',
    ]) {
      expect(valueOf(label)).toBe('-');
    }
  });

  it.each([
    ['Enabled', 'Enabled'],
    ['Off', 'Off'],
    ['Something else', 'Something else'],
  ])('shows the versioning %s as %s', async (versioning, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, versioning }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Versioning')).toBe(expected);
  });

  it.each([
    ['None', 'None'],
    ['AES256', 'AES256'],
  ])('shows the encryption %s as %s', async (encryption, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, encryption }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Default encryption')).toBe(expected);
  });

  it.each([
    ['Disabled', 'Disabled'],
    ['Enabled', 'Enabled'],
    ['Enabled (COMPLIANCE, 1y)', 'Enabled (COMPLIANCE, 1y)'],
    ['Unknown', 'Unknown'],
  ])('shows the object lock %s as %s', async (objectLock, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, objectLock }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Object lock')).toBe(expected);
  });

  it.each([
    ['private', 'Private'],
    ['custom', 'Custom'],
  ])('shows the policy mode %s as %s', async (policyMode, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, policyMode }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Policy')).toBe(expected);
  });

  it.each([
    ['public', 'private', 'Public (read-only)'],
    ['custom', 'public', 'Custom'],
    ['private', null, 'Private'],
  ])('shows the saved mode %s of the store over the loaded %s', async (saved, loaded, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, policyMode: loaded }) as never);
    openBucket(new Bucket({ ...bucketA, policyMode: saved }));
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Policy')).toBe(expected);
  });

  it('updates the policy row when the mode is saved while the drawer is open', async () => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, policyMode: 'private' }) as never);
    openBucket(new Bucket({ name: 'bucket-a', creationDate: '2026-01-02T03:04:05' }));
    renderDrawer();
    await screen.findByText('Region', { selector: 'dt' });
    expect(valueOf('Policy')).toBe('Private');

    act(() => useTabListStore.getState().setBucketDetailPolicyMode(TAB_ID, 'bucket-a', 'public'));

    expect(valueOf('Policy')).toBe('Public (read-only)');
  });

  it.each([
    ['unknown', 'Custom'],
    ['', 'Custom'],
    [undefined, 'Custom'],
  ])('falls back to the loaded mode when the store mode is %j', async (stored, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, policyMode: 'custom' }) as never);
    openBucket(new Bucket({ ...bucketA, policyMode: stored }));
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Policy')).toBe(expected);
  });

  it.each([
    [true, 'On'],
    [false, 'Off'],
  ])('shows Block Public Access %s as %s', async (publicBlocked, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, publicBlocked }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Block Public Access')).toBe(expected);
  });

  it.each([
    [10000, true, '10,000+'],
    [10000, false, '10,000'],
    [0, false, '0'],
  ])('shows %s objects at root (capped: %s) as %s', async (rootCount, rootCountCapped, expected) => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, rootCount, rootCountCapped }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Objects at root')).toBe(expected);
  });

  it('shows "-" for no tags', async () => {
    callIPCMock.mockResolvedValue(new BucketDetailOutput({ ...nothing, tags: {} }) as never);
    openBucket(bucketA);
    renderDrawer();

    await screen.findByText('Region', { selector: 'dt' });

    expect(valueOf('Tags')).toBe('-');
  });

  it('hides the create date of an anonymous bucket (zero date)', () => {
    callIPCMock.mockReturnValue(new Promise(() => {}) as never);
    openBucket(anonymous);
    renderDrawer();

    expect(valueOf('Name')).toBe('anon');
    expect(screen.queryByText('Create date')).not.toBeInTheDocument();
  });

  describe('when the detail cannot be loaded', () => {
    it('shows an error with a retry button that loads again', async () => {
      callIPCMock.mockResolvedValueOnce(null as never).mockResolvedValueOnce(full as never);
      openBucket(bucketA);
      renderDrawer();

      expect(await screen.findByText('Could not load details')).toBeInTheDocument();
      expect(loader()).not.toBeInTheDocument();
      expect(screen.queryByText('Region')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Region', { selector: 'dt' })).toBeInTheDocument();
      expect(screen.queryByText('Could not load details')).not.toBeInTheDocument();
      expect(callIPCMock).toHaveBeenCalledTimes(2);
    });

    it('shows the loader again while retrying', async () => {
      callIPCMock.mockResolvedValueOnce(null as never).mockReturnValueOnce(new Promise(() => {}) as never);
      openBucket(bucketA);
      renderDrawer();
      await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

      expect(loader()).toBeInTheDocument();
      expect(screen.queryByText('Could not load details')).not.toBeInTheDocument();
    });
  });

  it('aborts the previous request when the bucket changes and ignores its late result', async () => {
    const signals: AbortSignal[] = [];
    const resolvers: ((v: BucketDetailOutput) => void)[] = [];
    callIPCMock.mockImplementation(((_b: unknown, _a: unknown, options?: { signal?: AbortSignal }) => {
      signals.push(options!.signal!);
      return new Promise(resolve => resolvers.push(resolve as (v: BucketDetailOutput) => void));
    }) as never);
    openBucket(bucketA);
    renderDrawer();
    openBucket(bucketB);

    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    await act(async () => {
      resolvers[0](new BucketDetailOutput({ ...nothing, region: 'old-region' }));
      resolvers[1](new BucketDetailOutput({ ...nothing, region: 'new-region' }));
    });

    expect(valueOf('Name')).toBe('bucket-b');
    expect(valueOf('Region')).toBe('new-region');
    expect(screen.queryByText('old-region')).not.toBeInTheDocument();
  });

  it('does not show the previous bucket detail while the next one loads', async () => {
    callIPCMock.mockResolvedValueOnce(full as never).mockReturnValueOnce(new Promise(() => {}) as never);
    openBucket(bucketA);
    renderDrawer();
    expect(await screen.findByText('eu-west-1')).toBeInTheDocument();

    openBucket(bucketB);

    expect(screen.queryByText('eu-west-1')).not.toBeInTheDocument();
    expect(loader()).toBeInTheDocument();
  });

  it('forgets the loaded detail when closed, so reopening the same bucket shows the loader first', async () => {
    callIPCMock.mockResolvedValueOnce(full as never).mockReturnValueOnce(new Promise(() => {}) as never);
    openBucket(bucketA);
    renderDrawer();
    expect(await screen.findByText('eu-west-1')).toBeInTheDocument();

    closeBucket();
    expect(screen.queryByText('Bucket details')).not.toBeInTheDocument();
    openBucket(bucketA);

    expect(screen.queryByText('eu-west-1')).not.toBeInTheDocument();
    expect(loader()).toBeInTheDocument();
  });

  it('closes the drawer through the store from the close button', async () => {
    callIPCMock.mockReturnValue(new Promise(() => {}) as never);
    openBucket(bucketA);
    renderDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(useTabListStore.getState().tabList[TAB_ID].detailBucket).toBeUndefined();
    expect(screen.queryByText('Bucket details')).not.toBeInTheDocument();
  });

  it('aborts the request when unmounted', async () => {
    let signal!: AbortSignal;
    callIPCMock.mockImplementation(((_b: unknown, _a: unknown, options?: { signal?: AbortSignal }) => {
      signal = options!.signal!;
      return new Promise(() => {});
    }) as never);
    openBucket(bucketA);
    renderDrawer();

    cleanup();

    expect(signal.aborted).toBe(true);
  });
});
