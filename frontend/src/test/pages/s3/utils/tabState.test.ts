import { describe, expect, it } from 'vitest';
import { buildTabState } from '@/pages/s3/utils/tabState';

describe('buildTabState', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('turns a %s profileId into null', (_name, profileId) => {
    expect(buildTabState('a', [['a', profileId]])).toEqual({ tabs: [{ id: 'a', profileId: null }], activeTab: 'a' });
  });

  it('keeps an existing profileId', () => {
    expect(buildTabState('a', [['a', 'p1']]).tabs[0]).toEqual({ id: 'a', profileId: 'p1' });
  });

  it('handles an empty tab list', () => {
    expect(buildTabState('x', [])).toEqual({ tabs: [], activeTab: 'x' });
  });

  it('keeps the order of many tabs', () => {
    const state = buildTabState('c', [
      ['a', 'p1'],
      ['b', null],
      ['c', undefined],
    ]);
    expect(state.tabs).toEqual([
      { id: 'a', profileId: 'p1' },
      { id: 'b', profileId: null },
      { id: 'c', profileId: null },
    ]);
    expect(state.activeTab).toBe('c');
  });

  it('serializes keys as tabs then activeTab, and id then profileId', () => {
    expect(JSON.stringify(buildTabState('a', [['a', 'p1']]))).toBe(
      '{"tabs":[{"id":"a","profileId":"p1"}],"activeTab":"a"}'
    );
  });
});
