import type { Transition, Variants } from 'motion/react';

/** Shared motion presets, reused by any animated component. */
export const TRANSITION_FAST: Transition = { duration: 0.15, ease: 'easeOut' };

/** Fade + slight scale, e.g. for items entering or leaving a list. */
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
};
