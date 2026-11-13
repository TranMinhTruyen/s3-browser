import { useEffect, useRef } from 'react';
import { UI_SIZE_FONT_PX } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';

/**
 * Scale of the interface (0.875 / 1 / 1.125) relative to the default 16px root font.
 * Pixel sizes that are not rem (virtualizer row heights) multiply by it. Reads `draft`, which always equals
 * the size shown, because every apply path in the store sets `draft` to the applied value.
 */
export const useUiScale = (): number => useSettingStore(s => UI_SIZE_FONT_PX[s.draft.size] / 16);

/** Row sizes come from `estimateSize`, which the virtualizer caches: after a size change it must measure again. */
export function useRemeasureOnScale(virtualizer: { measure: () => void }, scale: number): void {
  const previous = useRef(scale);
  useEffect(() => {
    if (previous.current === scale) return;
    previous.current = scale;
    virtualizer.measure();
  }, [virtualizer, scale]);
}
