import { createAppStore } from '@/common/stores/createStore';

interface ModalStackState {
  stack: string[];
}

interface ModalStackAction {
  /** Đăng ký modal đang hiển thị. Giữ nguyên vị trí nếu modal đã có trong stack. */
  acquire: (id: string) => void;
  /** Giải phóng modal. Chỉ xóa khỏi stack nếu trong cùng tick không có thao tác nào đăng ký lại. */
  release: (id: string) => void;
  reset: () => boolean;
}

const SCOPE = 'modalStack';

/**
 * Số lần đăng ký đang hoạt động theo id modal. Lưu ngoài state vì giá trị này không điều khiển render.
 *
 * Cố ý đặt trong module này (không đặt trong `modalUtils`): khi modal hoặc `modalUtils` được hot reload,
 * cleanup của effect cũ và setup của effect mới phải dùng chung bộ đếm.
 */
const refCounts = new Map<string, number>();

/** Stack modal đang hiển thị (từ dưới lên trên); quyết định z-index và modal nào được đóng bằng Escape/click bên ngoài. */
export const useModalStackStore = createAppStore<ModalStackState & ModalStackAction>(
  set => ({
    stack: [],

    acquire: id => {
      refCounts.set(id, (refCounts.get(id) ?? 0) + 1);
      set(
        state => {
          if (!state.stack.includes(id)) {
            state.stack.push(id);
          }
        },
        undefined,
        `${SCOPE}/acquire`
      );
    },

    release: id => {
      refCounts.set(id, (refCounts.get(id) ?? 0) - 1);
      queueMicrotask(() => {
        if ((refCounts.get(id) ?? 0) > 0) return;
        refCounts.delete(id);
        set(state => ({ stack: state.stack.filter(x => x !== id) }), undefined, `${SCOPE}/release`);
      });
    },

    reset: () => {
      refCounts.clear();
      set({ stack: [] }, undefined, `${SCOPE}/reset`);
      return true;
    },
  }),
  'ModalStack'
);
