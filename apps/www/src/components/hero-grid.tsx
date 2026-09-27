'use client';

import { useEffect, useRef } from 'react';
import { mountHeroGrid } from './hero-grid.core';

/** The live hero background. All of the drawing lives in hero-grid.core.ts. */
export function HeroGrid() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return mountHeroGrid(canvas);
  }, []);
  return <canvas ref={ref} className="hero-grid absolute inset-0 h-full w-full" aria-hidden />;
}
