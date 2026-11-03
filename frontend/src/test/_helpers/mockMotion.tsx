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

/** Props received by every rendered `MotionConfig`, in render order. */
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
        // Exposes motion props so tests can assert them without running animations.
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

/** Value returned by the mocked `useReducedMotion`; tests flip it and reset it to false afterwards. */
export const motionState = { reducedMotion: false, isPresent: true };

/** Drop-in replacement for the `motion/react` module: plain HTML elements, no animation. */
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
