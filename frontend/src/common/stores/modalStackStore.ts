import { createStore } from '@/common/stores/createStore';

interface ModalStackState {
  stack: string[];
  push: (id: string) => void;
  remove: (id: string) => void;
  reset: () => boolean;
}

export const useModalStackStore = createStore<ModalStackState>(
  set => ({
    stack: [],

    push: id => {
      set(
        state => ({
          stack: state.stack.includes(id) ? state.stack : [...state.stack, id],
        }),
        undefined,
        'modalStack/push'
      );
    },

    remove: id => {
      set(
        state => ({
          stack: state.stack.filter(x => x !== id),
        }),
        undefined,
        'modalStack/remove'
      );
    },

    reset: () => {
      set({ stack: [] }, undefined, 'modalStack/reset');
      return true;
    },
  }),
  'ModalStack'
);
