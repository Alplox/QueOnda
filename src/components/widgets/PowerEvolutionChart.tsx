import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

interface SeriesPoint {
  t: number;
  v: number;
}

interface Props {
  series: SeriesPoint[];
}

const RANGES: Array<{ key: string; hours: number; label: string }> = [
  { key: '24h', hours: 24, label: '24 h' },
  { key: '48h', hours: 48, label: '48 h' },
  { key: '72h', hours: 72, label: '72 h' },
  { key: '7d', hours: 24 * 7, label: '7 d' },
];

const fmt = (t: number) =>
  new Date(t).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function PowerEvolutionChart({ series }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [range, setRange] = useState(RANGES[3]);
  const [theme, setTheme] = useState(0);

  // re-create chart when the theme changes (colors are resolved at build time)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((t) => t + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => {
    const cutoff = Date.now() - range.hours * 3600 * 1000;
    const points = series.filter((p) => p.t >= cutoff);
    const step = points.length > 96 ? Math.ceil(points.length / 96) : 1;
    return points.filter((_, i) => i % step === 0);
  }, [series, range]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // resolve DaisyUI CSS vars to concrete rgba — Chart.js can't parse oklch/var()
    const cssVar = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const resolveColor = (raw: string, alpha = 1) => {
      if (!raw) return 'rgba(128, 128, 128, 1)';
      const probe = document.createElement('canvas').getContext('2d');
      if (!probe) return raw;
      probe.fillStyle = raw;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${a / 255 * alpha})`;
    };

    const error = resolveColor(cssVar('--color-error'));
    const baseContent = resolveColor(cssVar('--color-base-content'));
    const base100 = resolveColor(cssVar('--color-base-100'));
    const base300 = resolveColor(cssVar('--color-base-300'));
    const grid = resolveColor(cssVar('--color-base-content'), 0.1);

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((p) => fmt(p.t)),
        datasets: [
          {
            data: data.map((p) => p.v),
            borderColor: error,
            backgroundColor: resolveColor(cssVar('--color-error'), 0.15),
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: error,
            pointHoverBorderColor: base100,
            pointHoverBorderWidth: 2,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: base100,
            borderColor: base300,
            borderWidth: 1,
            titleColor: baseContent,
            bodyColor: baseContent,
            titleFont: { size: 10, weight: 600 },
            bodyFont: { size: 10 },
            padding: 8,
            callbacks: {
              label: (item) => `${Number(item.raw).toLocaleString('es-CL')} clientes`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 8,
              font: { size: 9 },
              color: baseContent,
              maxRotation: 0,
            },
            grid: { display: false },
          },
          y: {
            ticks: {
              font: { size: 9 },
              color: baseContent,
              callback: (v) => Number(v).toLocaleString('es-CL'),
            },
            grid: { color: grid },
            border: { display: false },
          },
        },
      },
    });

    chartRef.current = chart;
    return () => chart.destroy();
  }, [data, theme]);

  if (series.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
              range.key === r.key
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'border-base-300 text-base-content/70 hover:text-base-content'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="h-[160px] w-full">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
