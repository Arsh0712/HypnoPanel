"use client";

import type { Variants } from "framer-motion";

/**
 * Shared motion vocabulary for the whole panel. One easing curve, one
 * timing scale — every surface moves the same way, which is what makes an
 * interface feel engineered rather than decorated.
 */

export const EASE_OUT_EXP0 = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE_OUT_EXP0 },
  },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.35, ease: EASE_OUT_EXP0 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: EASE_OUT_EXP0 },
  },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};

/** View-level transition (used with AnimatePresence in the shell). */
export const viewVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: EASE_OUT_EXP0 },
  },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18, ease: "easeIn" } },
};
