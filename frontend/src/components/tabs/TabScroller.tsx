import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fadeScale, TRANSITION_FAST } from '@/common/cnst/motionConst';
import ActionIcon from '@/components/buttons/ActionIcon';

type TabScrollerProps = {
  /** Trỏ đến vùng cuộn (dùng cho scrollIntoView / phần tử cuộn cha của dnd-kit). */
  ref?: Ref<HTMLDivElement | null>;
  children: ReactNode;
};

type ScrollState = { overflow: boolean; atStart: boolean; atEnd: boolean };

// Sai số nhỏ hơn một pixel khi so sánh vị trí cuộn.
const EPS = 1;
// Hằng số thời gian cuộn mượt (ms): quãng đường còn lại giảm theo hệ số 1/e sau mỗi TAU, không phụ thuộc tốc độ khung hình.
const TAU = 90;
// Dừng chuyển động (và khớp về đích) khi khoảng cách nhỏ hơn số px này.
const STOP_DISTANCE = 0.5;

/**
 * Vùng cuộn ngang có các nút mũi tên nằm ngoài khung nhìn; mỗi lần bấm sẽ cuộn để căn một tab vào mép trái.
 * Theo dõi phần tràn bằng scroll + ResizeObserver và gỡ mọi listener/observer/frame khi component bị gỡ.
 */
function TabScroller({ ref, children }: TabScrollerProps) {
  const { t } = useTranslation('common');
  const viewportRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement, []);

  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<ScrollState>({ overflow: false, atStart: true, atEnd: true });

  // Bộ điều khiển cuộn mượt (chỉ dùng ref, không dùng state): một vòng lặp rAF chạy khi scrollLeft đang tiến đến targetRef.
  const targetRef = useRef(0);
  const animRef = useRef(0);
  const lastTimeRef = useRef(0);
  // Vị trí dạng số thực: trình duyệt có thể làm tròn scrollLeft thành số nguyên, khiến mất các bước nhỏ hơn một pixel.
  const posRef = useRef(0);
  // Đích là điểm cuối: giới hạn lại ở mỗi khung hình vì hiện/ẩn mũi tên có thể đổi kích thước vùng nhìn giữa lúc cuộn.
  const toEndRef = useRef(false);

  // Tính lại từ DOM và chỉ cập nhật state khi giá trị thay đổi. Khi đang chuyển động, xét theo đích để mũi tên
  // phản hồi ngay khi cuộn tiến đến (hoặc rời khỏi) mép, không phải đợi đoạn giảm tốc chậm kết thúc.
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

    // Giới hạn còn một lần đo mỗi khung hình.
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

  // Độ lệch trái của mỗi mục so với gốc cuộn của vùng nhìn.
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

  // Cuộn đến `left` (đã giới hạn); vòng lặp đang chạy sẽ nhận đích mới.
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
      // Cập nhật mũi tên ngay theo đích mới.
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
    // Mục đầu tiên chưa hiện trọn ở mép phải sẽ trở thành tab đầu tiên cần hiện.
    const index = items.findIndex((c, i) => lefts[i] + c.getBoundingClientRect().width > edge + EPS);
    if (index >= 0) animateTo(lefts[index]);
  }, [getItemLefts, animateTo]);

  const onClickScrollLeft = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const lefts = getItemLefts(el);
    const target = el.scrollLeft - el.clientWidth;
    let index = lefts.findIndex(left => left >= target - EPS);
    // Nếu vẫn ở vị trí cũ thì lùi thêm một mục.
    if (index >= 0 && lefts[index] >= el.scrollLeft - EPS) index -= 1;
    animateTo(lefts[index] ?? 0);
  }, [getItemLefts, animateTo]);

  // Cuộn bánh xe theo chiều dọc sẽ cuộn ngang; cộng dồn delta vào đích đang chạy. Khi đang nghỉ, bắt đầu từ
  // scrollLeft hiện tại (có thể đã bị thay đổi bên ngoài, chẳng hạn bởi scrollIntoView hoặc dnd-kit autoscroll).
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
            <ActionIcon variant="subtle" onClick={onClickScrollLeft} tooltip={t('tab.scrollLeft')}>
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
            <ActionIcon variant="subtle" onClick={onClickScrollRight} tooltip={t('tab.scrollRight')}>
              <ChevronRight />
            </ActionIcon>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
export default TabScroller;
