import { useEffect, useRef } from 'react';
import { UI_SIZE_FONT_PX } from '@/common/cnst/settingConst';
import { useSettingStore } from '@/common/stores/settingStore';

/**
 * Tỷ lệ giao diện (0.875 / 1 / 1.125) so với cỡ phông gốc mặc định 16px.
 * Các kích thước pixel không dùng rem (như chiều cao hàng của virtualizer) được nhân với tỷ lệ này. Đọc `draft`, vốn luôn
 * bằng cỡ đang hiển thị vì mọi luồng áp dụng trong store đều đặt `draft` bằng giá trị đã áp dụng.
 */
export const useUiScale = (): number => useSettingStore(s => UI_SIZE_FONT_PX[s.draft.size] / 16);

/** Kích thước hàng lấy từ `estimateSize` và được virtualizer lưu đệm; sau khi đổi cỡ cần đo lại. */
export function useRemeasureOnScale(virtualizer: { measure: () => void }, scale: number): void {
  const previous = useRef(scale);
  useEffect(() => {
    if (previous.current === scale) return;
    previous.current = scale;
    virtualizer.measure();
  }, [virtualizer, scale]);
}
