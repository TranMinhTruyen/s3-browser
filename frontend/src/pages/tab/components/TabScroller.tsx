import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fadeScale, TRANSITION_FAST } from '@/common/cnst/motionConst';
import ActionIcon from '@/components/buttons/ActionIcon';

type TabScrollerProps = {
  /** Points at the scrollable viewport (for scrollIntoView / dnd-kit scrollable ancestor). */
  ref?: Ref<HTMLDivElement | null>;
  children: ReactNode;
};

type ScrollState = { overflow: boolean; atStart: boolean; atEnd: boolean };

// Sub-pixel tolerance for scroll position comparisons.
const EPS = 1;
// Smooth-scroll time constant (ms): the remaining distance shrinks by 1/e every TAU, independent of frame rate.
const TAU = 90;
// Stop animating (and snap to target) when closer than this many px.
const STOP_DISTANCE = 0.5;

/**
 * Horizontal scroller with arrow buttons outside the viewport; arrows page by aligning a tab to the left edge.
 * Tracks overflow via scroll + ResizeObserver and removes every listener/observer/frame on unmount.
 */
function TabScroller({ ref, children }: TabScrollerProps) {
  const { t } = useTranslation('tabLayout');
  const viewportRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement, []);

  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<ScrollState>({ overflow: false, atStart: true, atEnd: true });

  // Smooth scroll animator (refs only, no state): one rAF loop runs only while scrollLeft is approaching targetRef.
  const targetRef = useRef(0);
  const animRef = useRef(0);
  const lastTimeRef = useRef(0);
  // Float position: the browser may round scrollLeft to integers, which would swallow sub-pixel steps.
  const posRef = useRef(0);
  // Target is the far end: re-clamp it every frame, since arrows showing/hiding resize the viewport mid-scroll.
  const toEndRef = useRef(false);

  // Recompute from the DOM; only set state when a value changed. While animating, judge by the target so the
  // arrows react as soon as a scroll heads to (or leaves) an edge instead of waiting for the slow easing tail.
  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = animRef.current ? targetRef.current : el.scrollLeft;
    const next: ScrollState = { overflow: max > EPS, atStart: pos <= EPS, atEnd: pos >= max - EPS };
    setState(prev =>
      prev.overflow === next.overflow && prev.atStart === next.atStart && prev.atEnd === next.atEnd ? prev : next
    );
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    // Throttle to one measure per frame.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener('scroll', schedule, { passive: true });
    measure();

    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [measure]);

  // Left offset of each item relative to the viewport's scroll origin.
  const getItemLefts = useCallback((el: HTMLElement) => {
    const base = el.getBoundingClientRect().left - el.scrollLeft;
    return Array.from(el.firstElementChild?.children ?? [], c => c.getBoundingClientRect().left - base);
  }, []);

  const step = useCallback(function tick(now: number) {
    const el = viewportRef.current;
    if (!el) return;
    if (toEndRef.current) targetRef.current = el.scrollWidth - el.clientWidth;
    const diff = targetRef.current - posRef.current;
    if (Math.abs(diff) < STOP_DISTANCE) {
      el.scrollLeft = targetRef.current;
      animRef.current = 0;
      return;
    }
    const dt = now - lastTimeRef.current;
    lastTimeRef.current = now;
    posRef.current += diff * (1 - Math.exp(-dt / TAU));
    el.scrollLeft = posRef.current;
    animRef.current = requestAnimationFrame(tick);
  }, []);

  // Scroll to `left` (clamped); a running loop just picks up the new target.
  const animateTo = useCallback(
    (left: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const max = el.scrollWidth - el.clientWidth;
      targetRef.current = Math.min(Math.max(0, left), max);
      toEndRef.current = left >= max - EPS;
      if (reducedMotion) {
        el.scrollLeft = targetRef.current;
        return;
      }
      if (!animRef.current) {
        posRef.current = el.scrollLeft;
        lastTimeRef.current = performance.now();
        animRef.current = requestAnimationFrame(step);
      }
      // Update the arrows right away from the new target.
      measure();
    },
    [reducedMotion, step, measure]
  );

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const onClickScrollRight = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const items = Array.from(el.firstElementChild?.children ?? []);
    const lefts = getItemLefts(el);
    const edge = el.scrollLeft + el.clientWidth;
    // First item not fully visible at the right edge becomes the first visible tab.
    const index = items.findIndex((c, i) => lefts[i] + c.getBoundingClientRect().width > edge + EPS);
    if (index >= 0) animateTo(lefts[index]);
  }, [getItemLefts, animateTo]);

  const onClickScrollLeft = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const lefts = getItemLefts(el);
    const target = el.scrollLeft - el.clientWidth;
    let index = lefts.findIndex(left => left >= target - EPS);
    // Same spot as now: step back one more item.
    if (index >= 0 && lefts[index] >= el.scrollLeft - EPS) index -= 1;
    animateTo(lefts[index] ?? 0);
  }, [getItemLefts, animateTo]);

  // Vertical wheel scrolls horizontally; deltas accumulate on the running target. When idle, start from the
  // current scrollLeft (it may have been changed externally, e.g. scrollIntoView or dnd-kit autoscroll).
  const onWheelViewport = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(e.deltaX) >= 1) return;
      const base = animRef.current ? targetRef.current : e.currentTarget.scrollLeft;
      animateTo(base + e.deltaY);
    },
    [animateTo]
  );

  return (
    <>
      <AnimatePresence initial={false}>
        {state.overflow && !state.atStart && (
          <m.div
            key="left"
            variants={fadeScale}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_FAST}
            whileTap={{ scale: 0.9 }}
            style={{ flexShrink: 0, alignSelf: 'center' }}
          >
            <ActionIcon variant="subtle" onClick={onClickScrollLeft} tooltip={t('tooltip.scrollLeft')}>
              <ChevronLeft />
            </ActionIcon>
          </m.div>
        )}
      </AnimatePresence>
      <div
        ref={viewportRef}
        onWheel={onWheelViewport}
        style={{ flex: '0 1 auto', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}
      >
        {children}
      </div>
      <AnimatePresence initial={false}>
        {state.overflow && !state.atEnd && (
          <m.div
            key="right"
            variants={fadeScale}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_FAST}
            whileTap={{ scale: 0.9 }}
            style={{ flexShrink: 0, alignSelf: 'center' }}
          >
            <ActionIcon variant="subtle" onClick={onClickScrollRight} tooltip={t('tooltip.scrollRight')}>
              <ChevronRight />
            </ActionIcon>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
export default TabScroller;
