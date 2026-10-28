import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/common/cnst/settingConst';
import { useModalStackStore } from '@/common/stores/modalStackStore';
import { useSettingStore } from '@/common/stores/settingStore';
import SettingModal from '@/components/modals/SettingModal';
import { renderWithProviders } from '@/test/renderWithProviders';

// The real Select never emits null (allowDeselect is off), so a stub drives that guard directly.
vi.mock('@/components/inputs/SelectInput', () => ({
  default: ({ label, onChange }: { label: string; onChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onChange(null)}>
      clear {label}
    </button>
  ),
}));
vi.mock('@/common/utils/settingUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/common/utils/settingUtils')>()),
  applySettings: vi.fn(),
}));
vi.mock('@/common/utils/ipcUtils', () => ({ callIPC: vi.fn(), invalidateLoads: vi.fn() }));

describe('SettingModal empty selection', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
    useSettingStore.getState().reset();
  });

  it.each(['Theme', 'Font', 'Language'])('keeps the draft when the %s select reports no value', async label => {
    renderWithProviders(<div />);
    act(() => {
      SettingModal.show();
    });

    await userEvent.click(await screen.findByRole('button', { name: `clear ${label}`, hidden: true }));

    expect(useSettingStore.getState().draft).toEqual(DEFAULT_SETTINGS);
  });
});
