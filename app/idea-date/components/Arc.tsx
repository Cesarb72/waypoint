'use client';

import { useEffect, useState } from 'react';
import type { IdeaDateArcModel } from '@/lib/engine/idea-date';

type ArcProps = {
  arcModel: IdeaDateArcModel | null;
  title?: string;
  series?: number[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      setPrefersReducedMotion(media.matches);
    };
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return prefersReducedMotion;
}

export default function Arc({ arcModel, title = 'ENERGY ARC', series }: ArcProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isDrawing, setIsDrawing] = useState(false);
  const points = Array.isArray(series) && series.length > 0
    ? series.map((value, index) => ({
        x: series.length <= 1 ? 0 : index / (series.length - 1),
        y: clamp01(value),
      }))
    : (arcModel?.points ?? []);
  const width = 320;
  const height = 120;
  const padding = 14;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const polylinePoints = points
    .map((point) => {
      const x = padding + point.x * innerWidth;
      const y = padding + (1 - point.y) * innerHeight;
      return `${x},${y}`;
    })
    .join(' ');

  useEffect(() => {
    if (!polylinePoints || prefersReducedMotion) {
      setIsDrawing(false);
      return;
    }
    setIsDrawing(true);
    const frame = requestAnimationFrame(() => {
      setIsDrawing(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [polylinePoints, prefersReducedMotion]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={`Idea-Date ${title.toLowerCase()}`}
      >
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#334155" />
        {polylinePoints ? (
          <polyline
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            style={
              prefersReducedMotion
                ? undefined
                : {
                    strokeDasharray: 1,
                    strokeDashoffset: isDrawing ? 1 : 0,
                    transition: 'stroke-dashoffset 280ms ease, opacity 180ms ease',
                    opacity: isDrawing ? 0.85 : 1,
                  }
            }
            points={polylinePoints}
          />
        ) : null}
      </svg>
    </div>
  );
}
