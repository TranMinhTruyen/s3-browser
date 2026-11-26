import type { Transition, Variants } from 'motion/react';

/** Các preset chuyển động dùng chung cho mọi component có animation. */
export const TRANSITION_FAST: Transition = { duration: 0.15, ease: 'easeOut' };

/** Mờ dần kết hợp phóng to/thu nhỏ nhẹ, ví dụ khi mục xuất hiện hoặc rời khỏi danh sách. */
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
};

/** Hiệu ứng thoát đồng thời thu chiều rộng để các tab phía sau trượt vào thay vì nhảy vị trí. */
export const fadeCollapse: Variants = {
  ...fadeScale,
  collapse: { opacity: 0, width: 0, overflow: 'hidden' },
};
