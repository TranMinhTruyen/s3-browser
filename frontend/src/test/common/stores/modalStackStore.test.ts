import { beforeEach, describe, expect, it } from 'vitest';
import { useModalStackStore } from '@/common/stores/modalStackStore';

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));
const stack = () => useModalStackStore.getState().stack;

describe('modalStackStore', () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  it('acquire pushes a new id and keeps the position of an existing one', () => {
    const { acquire } = useModalStackStore.getState();
    acquire('a');
    acquire('b');
    acquire('a');
    expect(stack()).toEqual(['a', 'b']);
  });

  it('release removes the id once nothing re-acquires it', async () => {
    const { acquire, release } = useModalStackStore.getState();
    acquire('a');
    release('a');
    await flush();
    expect(stack()).toEqual([]);
  });

  it('release keeps the id when it is re-acquired in the same tick', async () => {
    const { acquire, release } = useModalStackStore.getState();
    acquire('a');
    release('a');
    acquire('a');
    await flush();
    expect(stack()).toEqual(['a']);
  });

  it('release of an unknown id is harmless', async () => {
    useModalStackStore.getState().release('ghost');
    await flush();
    expect(stack()).toEqual([]);
  });

  it('a second release in the same tick finds the counter already deleted', async () => {
    const { acquire, release } = useModalStackStore.getState();
    acquire('a');
    release('a');
    release('a');
    await flush();
    expect(stack()).toEqual([]);
  });

  it('reset clears the stack and the counters', async () => {
    const { acquire, release, reset } = useModalStackStore.getState();
    acquire('a');
    expect(reset()).toBe(true);
    expect(stack()).toEqual([]);
    acquire('a');
    release('a');
    await flush();
    expect(stack()).toEqual([]);
  });
});
