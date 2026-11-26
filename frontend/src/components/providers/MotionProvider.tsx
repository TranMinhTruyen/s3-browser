import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Cấu hình chuyển động cho toàn ứng dụng. Bọc ứng dụng một lần:
 * - `LazyMotion` (strict) tải các tính năng animation theo nhu cầu, vì vậy component phải dùng `m.*`, không dùng `motion.*`.
 * - `MotionConfig reducedMotion="user"` tắt animation transform/layout khi hệ điều hành yêu cầu giảm chuyển động.
 */
function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
export default MotionProvider;
