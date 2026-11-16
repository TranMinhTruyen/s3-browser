import { act, fireEvent, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TabScroller from '@/components/tabs/TabScroller';
import { motionState } from '@/test/_helpers/mockMotion';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);

// Plain button that also exposes the latest onClick so tests can call it after unmount.
const clicks = vi.hoisted(() => ({}) as Record<string, () => void>);
vi.mock('@/components/buttons/ActionIcon', () => ({
  default: ({ children, onClick, disabled, tooltip, ...rest }: any) => {
    clicks[tooltip] = onClick;
    return (
      <button type="button" disabled={disabled} onClick={onClick} aria-label={tooltip} {...rest}>
        {children}
      </button>
    );
  },
}));

type Metrics = { scrollWidth: number; clientWidth: number; scrollLeft: number };
type Box = { left: number; width: number };

const ro = vi.hoisted(() => ({ callbacks: [] as (() => void)[], observed: [] as Element[], disconnect: vi.fn() }));
const raf = vi.hoisted(() => ({ queue: new Map<number, (now: number) => void>(), next: 1 }));

class FakeResizeObserver {
  constructor(cb: () => void) {
    ro.callbacks.push(cb);
  }
  observe(el: Element) {
    ro.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    ro.disconnect();
  }
}

// Fake clock shared by performance.now and the rAF timestamps.
const clock = { now: 1000 };
let roundScroll = false;

// Runs the currently queued frames once, advancing the clock by `dt` ms first.
const flushFrames = (dt = 16) =>
  act(() => {
    clock.now += dt;
    const cbs = [...raf.queue.values()];
    raf.queue.clear();
    for (const cb of cbs) cb(clock.now);
  });

// Runs frames until the queue is empty; returns how many frames ran.
const runToEnd = (limit = 500) => {
  let frames = 0;
  while (raf.queue.size > 0 && frames < limit) {
    flushFrames();
    frames += 1;
  }
  return frames;
};

let metrics: Metrics;
let viewportLeft: number;
let itemBoxes: Box[];

// Render the scroller, then wire the viewport DOM metrics and rects (jsdom has no layout).
const setup = (opts: { items?: number; withChildren?: boolean } = {}) => {
  const { items = 4, withChildren = true } = opts;
  const ref = createRef<HTMLDivElement>();
  const view = renderWithProviders(
    <TabScroller ref={ref}>
      {withChildren && (
        <div data-testid="row">
          {Array.from({ length: items }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
    </TabScroller>
  );
  const viewport = ref.current as HTMLDivElement;
  for (const key of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
    Object.defineProperty(viewport, key, {
      configurable: true,
      get: () => metrics[key],
      set: v => {
        metrics[key] = roundScroll && key === 'scrollLeft' ? Math.round(v) : v;
      },
    });
  }
  viewport.getBoundingClientRect = () => ({ left: viewportLeft, width: metrics.clientWidth }) as DOMRect;
  Array.from(viewport.firstElementChild?.children ?? []).forEach((c, i) => {
    (c as HTMLElement).getBoundingClientRect = () =>
      ({ left: viewportLeft - metrics.scrollLeft + itemBoxes[i].left, width: itemBoxes[i].width }) as DOMRect;
  });
  return { ...view, viewport };
};

const resize = () => {
  act(() => ro.callbacks[0]());
  flushFrames();
};

// Move the scroll position and let the scroll listener measure inside a frame.
const scrollToLeft = (viewport: HTMLElement, left: number) => {
  metrics.scrollLeft = left;
  fireEvent.scroll(viewport);
  flushFrames();
};

const makeItems = (count: number) => Array.from({ length: count }, (_, i) => ({ left: i * 100, width: 100 }));

beforeEach(() => {
  ro.callbacks = [];
  ro.observed = [];
  ro.disconnect.mockClear();
  raf.queue.clear();
  raf.next = 1;
  clock.now = 1000;
  roundScroll = false;
  motionState.reducedMotion = false;
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  for (const key of Object.keys(clicks)) delete clicks[key];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: (now: number) => void) => {
      const id = raf.next++;
      raf.queue.set(id, cb);
      return id;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      raf.queue.delete(id);
    })
  );
  // 4 items of 100px, viewport 250px wide, content 400px.
  metrics = { scrollWidth: 400, clientWidth: 250, scrollLeft: 0 };
  viewportLeft = 50;
  itemBoxes = makeItems(4);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  motionState.reducedMotion = false;
});

const arrowLeft = () => screen.queryByRole('button', { name: 'Scroll left' });
const arrowRight = () => screen.queryByRole('button', { name: 'Scroll right' });

describe('TabScroller', () => {
  it('renders children inside the viewport returned by the ref', () => {
    const { viewport } = setup();
    expect(screen.getByTestId('row').parentElement).toBe(viewport);
  });

  it('shows no arrows when the content fits', () => {
    metrics.scrollWidth = 250;
    setup();
    resize();
    expect(arrowLeft()).not.toBeInTheDocument();
    expect(arrowRight()).not.toBeInTheDocument();
  });

  it('at the start of overflowing content only the right arrow is shown', () => {
    setup();
    resize();
    expect(arrowLeft()).not.toBeInTheDocument();
    expect(arrowRight()).toBeInTheDocument();
  });

  it('at the end of overflowing content only the left arrow is shown', () => {
    const { viewport } = setup();
    resize();
    scrollToLeft(viewport, 150);
    expect(arrowLeft()).toBeInTheDocument();
    expect(arrowRight()).not.toBeInTheDocument();
  });

  it('in the middle of overflowing content both arrows are shown', () => {
    const { viewport } = setup();
    resize();
    scrollToLeft(viewport, 50);
    expect(arrowLeft()).toBeInTheDocument();
    expect(arrowRight()).toBeInTheDocument();
  });

  it('observes the viewport and its first child', () => {
    const { viewport } = setup();
    expect(ro.observed).toEqual([viewport, screen.getByTestId('row')]);
  });

  it('observes only the viewport when there is no child', () => {
    const { viewport } = setup({ withChildren: false });
    expect(ro.observed).toEqual([viewport]);
  });

  it('keeps the same state when the measured values do not change', () => {
    const { viewport } = setup();
    resize();
    scrollToLeft(viewport, 0);
    resize();
    expect(arrowLeft()).not.toBeInTheDocument();
    expect(arrowRight()).toBeInTheDocument();
  });

  it('throttles measuring to one frame at a time', () => {
    const { viewport } = setup();
    const rafMock = vi.mocked(requestAnimationFrame);
    rafMock.mockClear();
    fireEvent.scroll(viewport);
    fireEvent.scroll(viewport);
    act(() => ro.callbacks[0]());
    expect(rafMock).toHaveBeenCalledTimes(1);
    flushFrames();
    fireEvent.scroll(viewport);
    expect(rafMock).toHaveBeenCalledTimes(2);
  });

  it('disconnects the observer and cancels the pending frame on unmount', () => {
    const { viewport, unmount } = setup();
    fireEvent.scroll(viewport);
    expect(raf.queue.size).toBe(1);
    unmount();
    expect(ro.disconnect).toHaveBeenCalled();
    expect(raf.queue.size).toBe(0);
  });

  describe('after unmount (viewport ref cleared)', () => {
    it('ignores a late measure frame callback', () => {
      const { viewport, unmount } = setup();
      fireEvent.scroll(viewport);
      const late = [...raf.queue.values()];
      unmount();
      expect(() => act(() => late.forEach(cb => cb(clock.now + 16)))).not.toThrow();
    });

    it('ignores late arrow clicks', () => {
      const { viewport, unmount } = setup();
      resize();
      scrollToLeft(viewport, 50);
      const handlers = [clicks['Scroll left'], clicks['Scroll right']];
      unmount();
      for (const h of handlers) h();
      expect(raf.queue.size).toBe(0);
    });

    it('ignores a late animation frame', () => {
      const { viewport, unmount } = setup();
      fireEvent.wheel(viewport, { deltaY: 40 });
      const late = [...raf.queue.values()];
      unmount();
      expect(() => act(() => late.forEach(cb => cb(clock.now + 16)))).not.toThrow();
      expect(metrics.scrollLeft).toBe(0);
      expect(raf.queue.size).toBe(0);
    });
  });

  describe('arrow wrappers', () => {
    const tapOf = (button: HTMLElement | null) => (button as HTMLElement).parentElement?.dataset.whileTap;
    const tap = JSON.stringify({ scale: 0.9 });

    it('always has a tap animation on the visible arrow at the start', () => {
      setup();
      resize();
      expect(tapOf(arrowRight())).toBe(tap);
    });

    it('always has a tap animation on both arrows in the middle', () => {
      const { viewport } = setup();
      resize();
      scrollToLeft(viewport, 50);
      expect(tapOf(arrowLeft())).toBe(tap);
      expect(tapOf(arrowRight())).toBe(tap);
    });

    it('always has a tap animation on the visible arrow at the end', () => {
      const { viewport } = setup();
      resize();
      scrollToLeft(viewport, 150);
      expect(tapOf(arrowLeft())).toBe(tap);
    });

    it('removes the arrows when the content stops overflowing', () => {
      const { viewport } = setup();
      resize();
      scrollToLeft(viewport, 50);
      expect(arrowLeft()).toBeInTheDocument();
      expect(arrowRight()).toBeInTheDocument();
      metrics.scrollWidth = 250;
      resize();
      expect(arrowLeft()).not.toBeInTheDocument();
      expect(arrowRight()).not.toBeInTheDocument();
    });
  });

  describe('right arrow', () => {
    it('smoothly aligns the first clipped tab to the left edge over several frames', () => {
      itemBoxes = makeItems(6);
      metrics.scrollWidth = 600;
      setup({ items: 6 });
      resize();
      fireEvent.click(arrowRight() as HTMLElement);
      // Nothing moves synchronously; visible edge is 250, so the item at 200..300 is the target.
      expect(metrics.scrollLeft).toBe(0);
      flushFrames();
      expect(metrics.scrollLeft).toBeGreaterThan(0);
      expect(metrics.scrollLeft).toBeLessThan(200);
      expect(raf.queue.size).toBe(1);
      expect(runToEnd()).toBeGreaterThan(2);
      expect(metrics.scrollLeft).toBe(200);
    });

    it('clamps the target to the maximum scroll position', () => {
      setup();
      resize();
      fireEvent.click(arrowRight() as HTMLElement);
      // item at 200 would overshoot: max is 400 - 250 = 150.
      runToEnd();
      expect(metrics.scrollLeft).toBe(150);
    });

    it('does nothing when no item is clipped', () => {
      setup();
      resize();
      metrics.scrollWidth = 400;
      metrics.clientWidth = 400;
      fireEvent.click(arrowRight() as HTMLElement);
      expect(raf.queue.size).toBe(0);
      expect(metrics.scrollLeft).toBe(0);
    });

    it('does nothing when the viewport has no child', () => {
      setup({ withChildren: false });
      resize();
      fireEvent.click(arrowRight() as HTMLElement);
      expect(raf.queue.size).toBe(0);
      expect(metrics.scrollLeft).toBe(0);
    });
  });

  describe('left arrow', () => {
    it('pages back by about one viewport, aligning a tab to the left edge', () => {
      itemBoxes = makeItems(6);
      metrics.scrollWidth = 600;
      const { viewport } = setup({ items: 6 });
      resize();
      scrollToLeft(viewport, 350);
      fireEvent.click(arrowLeft() as HTMLElement);
      // target 350 - 250 = 100: the item at 100.
      runToEnd();
      expect(metrics.scrollLeft).toBe(100);
    });

    it('steps back one more item when the aligned tab is the current position', () => {
      metrics.clientWidth = 50;
      const { viewport } = setup();
      resize();
      scrollToLeft(viewport, 100);
      fireEvent.click(arrowLeft() as HTMLElement);
      // target 50: first left >= 49 is 100 (current), so go to the previous item at 0.
      runToEnd();
      expect(metrics.scrollLeft).toBe(0);
    });

    it('goes to 0 when no item matches (index -1)', () => {
      const { viewport } = setup();
      resize();
      scrollToLeft(viewport, 150);
      metrics.scrollLeft = 1000;
      metrics.clientWidth = 10;
      fireEvent.click(arrowLeft() as HTMLElement);
      runToEnd();
      expect(metrics.scrollLeft).toBe(0);
    });

    it('never scrolls to a negative position', () => {
      itemBoxes = [{ left: -20, width: 100 }, ...makeItems(4).slice(1)];
      metrics.clientWidth = 50;
      const { viewport } = setup();
      resize();
      scrollToLeft(viewport, 100);
      // target 50 -> item at 100 equals current -> previous item is at -20 -> clamped to 0.
      fireEvent.click(arrowLeft() as HTMLElement);
      runToEnd();
      expect(metrics.scrollLeft).toBe(0);
    });
  });

  describe('wheel', () => {
    it('animates horizontally by deltaY and lands exactly on the target', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaX: 0, deltaY: 40 });
      expect(metrics.scrollLeft).toBe(0);
      flushFrames();
      expect(metrics.scrollLeft).toBeGreaterThan(0);
      expect(metrics.scrollLeft).toBeLessThan(40);
      runToEnd();
      expect(metrics.scrollLeft).toBe(40);
    });

    it('eases by 1 - exp(-dt / 90) per frame', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 100 });
      flushFrames(90);
      expect(metrics.scrollLeft).toBeCloseTo(100 * (1 - Math.exp(-1)), 5);
    });

    it('snaps to the target and stops when closer than half a pixel', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 0.3 });
      expect(raf.queue.size).toBe(1);
      flushFrames();
      expect(metrics.scrollLeft).toBe(0.3);
      expect(raf.queue.size).toBe(0);
    });

    it('still stops when the browser rounds scrollLeft to integers', () => {
      roundScroll = true;
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 100 });
      const frames = runToEnd(200);
      expect(raf.queue.size).toBe(0);
      expect(frames).toBeLessThan(200);
      expect(metrics.scrollLeft).toBe(100);
    });

    it('starts from the current scrollLeft when idle (externally changed position)', () => {
      const { viewport } = setup();
      metrics.scrollLeft = 50;
      fireEvent.wheel(viewport, { deltaY: 20 });
      runToEnd();
      expect(metrics.scrollLeft).toBe(70);
    });

    it('accumulates deltas on the running target without starting another loop', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 40 });
      flushFrames();
      const rafMock = vi.mocked(requestAnimationFrame);
      rafMock.mockClear();
      fireEvent.wheel(viewport, { deltaY: 40 });
      expect(rafMock).not.toHaveBeenCalled();
      expect(raf.queue.size).toBe(1);
      runToEnd();
      // 80 (target + 40), not the in-flight scrollLeft + 40.
      expect(metrics.scrollLeft).toBe(80);
    });

    it('starts a new loop from the current position after the previous one finished', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 40 });
      runToEnd();
      fireEvent.wheel(viewport, { deltaY: 30 });
      runToEnd();
      expect(metrics.scrollLeft).toBe(70);
    });

    it('clamps to 0', () => {
      const { viewport } = setup();
      metrics.scrollLeft = 30;
      fireEvent.wheel(viewport, { deltaY: -500 });
      runToEnd();
      expect(metrics.scrollLeft).toBe(0);
    });

    it('clamps to the maximum scroll position', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 1000 });
      runToEnd();
      expect(metrics.scrollLeft).toBe(150);
    });

    it('leaves native horizontal wheel scrolling alone', () => {
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaX: 30, deltaY: 40 });
      expect(metrics.scrollLeft).toBe(0);
      expect(raf.queue.size).toBe(0);
    });

    it('cancels the running animation on unmount', () => {
      const { viewport, unmount } = setup();
      fireEvent.wheel(viewport, { deltaY: 40 });
      expect(raf.queue.size).toBe(1);
      unmount();
      expect(raf.queue.size).toBe(0);
    });
  });

  describe('reduced motion', () => {
    it('sets scrollLeft directly from the wheel without animating', () => {
      motionState.reducedMotion = true;
      const { viewport } = setup();
      fireEvent.wheel(viewport, { deltaY: 40 });
      expect(metrics.scrollLeft).toBe(40);
      expect(raf.queue.size).toBe(0);
    });

    it('jumps straight to the clamped target on arrow click', () => {
      motionState.reducedMotion = true;
      setup();
      resize();
      fireEvent.click(arrowRight() as HTMLElement);
      expect(metrics.scrollLeft).toBe(150);
      expect(raf.queue.size).toBe(0);
    });
  });
});
