import { createElement, type ReactNode } from 'react';

const MOTION_PROPS = new Set([
  'variants',
  'initial',
  'transition',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'whileInView',
  'layout',
  'layoutId',
]);

const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>;

/** Các prop mà từng `MotionConfig` được render nhận, theo thứ tự render. */
export const motionConfigProps: Record<string, unknown>[] = [];

const MotionConfig = ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
  motionConfigProps.push(props);
  return <>{children}</>;
};

const makeComponent = (tag: string) => {
  const Component = ({
    animate,
    exit,
    whileTap,
    children,
    ...props
  }: Record<string, unknown> & { children?: ReactNode }) => {
    const domProps = Object.fromEntries(Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key)));
    return createElement(
      tag,
      {
        ...domProps,
        // Hiển thị các prop chuyển động để test có thể kiểm tra mà không chạy animation.
        'data-animate': animate === undefined ? undefined : JSON.stringify(animate),
        'data-exit': typeof exit === 'string' ? exit : undefined,
        'data-while-tap': whileTap === undefined ? undefined : JSON.stringify(whileTap),
      },
      children
    );
  };
  return Component;
};

const createProxy = () => {
  const cache = new Map<string, ReturnType<typeof makeComponent>>();
  return new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        if (!cache.has(tag)) cache.set(tag, makeComponent(tag));
        return cache.get(tag);
      },
    }
  );
};

/** Giá trị mock `useReducedMotion` trả về; test thay đổi giá trị này rồi đặt lại false sau đó. */
export const motionState = { reducedMotion: false, isPresent: true };

/** Module thay thế trực tiếp cho `motion/react`: dùng phần tử HTML thuần, không chạy animation. */
export const motionMock = {
  useReducedMotion: () => motionState.reducedMotion,
  useIsPresent: () => motionState.isPresent,
  m: createProxy(),
  motion: createProxy(),
  AnimatePresence: passThrough,
  LazyMotion: passThrough,
  MotionConfig,
  domAnimation: {},
};
