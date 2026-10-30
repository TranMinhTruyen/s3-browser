import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * App-wide motion setup. Wrap the app once:
 * - `LazyMotion` (strict) loads the animation features lazily, so components must use `m.*`, not `motion.*`.
 * - `MotionConfig reducedMotion="user"` turns off transform/layout animation when the OS asks for reduced motion.
 */
function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
export default MotionProvider;
