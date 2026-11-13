import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { useSettingStore } from '@/common/stores/settingStore';
import { applySettings } from '@/common/utils/settingUtils';
import SettingModal from '@/components/modals/setting/SettingModal';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

// Mantine's slider measures its track with getBoundingClientRect (all zeros in jsdom), so mouse dragging cannot be
// simulated. This stub shows the props SettingModal passes and calls onChange (drag) / onChangeEnd (release) directly.
vi.mock('@/components/inputs/SliderInput', () => ({
  default: ({
    value,
    thumbLabel,
    label,
    onChange,
    onChangeEnd,
  }: {
    value: number;
    thumbLabel: string;
    label: string;
    onChange: (v: number) => void;
    onChangeEnd: (v: number) => void;
  }) => (
    <div>
      <span>{`${label}|${thumbLabel}|value=${value}`}</span>
      {[0, 1, 2].map(v => (
        <button key={`drag${v}`} type="button" onClick={() => onChange(v)}>{`drag ${v}`}</button>
      ))}
      {[0, 1, 2].map(v => (
        <button key={`release${v}`} type="button" onClick={() => onChangeEnd(v)}>{`release ${v}`}</button>
      ))}
    </div>
  ),
}));
vi.mock('@/common/utils/settingUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/settingUtils')>()),
  applySettings: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

const state = () => useSettingStore.getState();
const click = (name: string) => act(() => screen.getByRole('button', { name }).click());

async function open() {
  renderWithProviders(<div />);
  await act(async () => {
    SettingModal.show();
  });
}

describe('SettingModal size slider while dragging', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    state().reset();
    vi.clearAllMocks();
  });

  it('passes the field label, the thumb label and the draft index', async () => {
    useSettingStore.setState({ draft: { ...DEFAULT_SETTINGS, size: 'small' } });
    await open();
    expect(screen.getByText('Interface size|Interface size|value=0')).toBeInTheDocument();
  });

  it('only moves the thumb while dragging and leaves the draft and the app size alone', async () => {
    await open();
    vi.mocked(applySettings).mockClear();

    click('drag 2');

    expect(screen.getByText('Interface size|Interface size|value=2')).toBeInTheDocument();
    expect(state().draft.size).toBe('medium');
    expect(applySettings).not.toHaveBeenCalled();
  });

  it('sets the draft once with the last size on release and the thumb then follows the draft', async () => {
    const setDraft = vi.fn(state().setDraft);
    useSettingStore.setState({ setDraft });
    await open();

    click('drag 2');
    click('drag 0');
    click('release 0');

    expect(setDraft).toHaveBeenCalledExactlyOnceWith({ size: 'small' });
    expect(state().draft.size).toBe('small');
    expect(applySettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, size: 'small' });
    expect(screen.getByText('Interface size|Interface size|value=0')).toBeInTheDocument();
  });

  it('release on the same size does not touch the draft and drops the drag position', async () => {
    const setDraft = vi.fn(state().setDraft);
    useSettingStore.setState({ setDraft });
    await open();

    click('drag 2');
    click('release 1');

    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByText('Interface size|Interface size|value=1')).toBeInTheDocument();
  });

  it('applies each released size in turn', async () => {
    await open();

    click('release 2');
    expect(state().draft.size).toBe('large');
    click('release 1');
    expect(state().draft.size).toBe('medium');
  });
});
