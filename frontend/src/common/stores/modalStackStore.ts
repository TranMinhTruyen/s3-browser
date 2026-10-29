import { createAppStore } from '@/common/stores/createStore';

interface ModalStackState {
  stack: string[];
}

interface ModalStackAction {
  /** Registers a visible modal. Keeps its existing position if it is already in the stack. */
  acquire: (id: string) => void;
  /** Releases a modal. It leaves the stack only if nothing re-acquires it in the same tick. */
  release: (id: string) => void;
  reset: () => boolean;
}

const SCOPE = 'modalStack';

/**
 * Active acquisitions per modal id. Kept outside the state because it never drives rendering.
 *
 * Lives in this module (not in `modalUtils`) on purpose: when a modal or `modalUtils` is
 * hot-reloaded, the old effect cleanup and the new effect setup must share the same counter.
 */
const refCounts = new Map<string, number>();

/** Stack of visible modals (bottom to top); drives z-index and which modal Escape / click-outside can close. */
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
