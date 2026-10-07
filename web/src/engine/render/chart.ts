/**
 * Chart renderer.
 *
 * Produces a standalone SVG for a chart node — the same output is used by the
 * live editor (inline SVG) and by the export pipeline, so what you design is
 * exactly what you export. Charts are generated from the node's data table, so
 * editing numbers in the panel instantly redraws the design.
 */
import type { ChartData } from '../types';

const escape = (text: string) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function chartSvg(data: ChartData, width: number, height: number): string {
  const o = data.options ?? ({} as ChartData['options']);
  const font = o.fontFamily ?? 'Inter';
  const fontSize = o.fontSize ?? 14;
  const palette = o.palette?.length ? o.palette : ['#6C5CE7', '#00B894', '#FD79A8', '#FDCB6E', '#0984E3', '#E17055'];
  const label = o.labelColor ?? '#6B7280';
  const grid = o.gridColor ?? '#E5E7EB';
  const pad = { top: 24, right: 24, bottom: 40, left: 52 };
  const legendHeight = o.showLegend && data.series.length > 1 ? fontSize * 2.2 : 0;
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(40, height - pad.top - pad.bottom - legendHeight);

  const max = o.max ?? Math.max(1, ...data.series.flatMap((s) => s.values));
  const min = Math.min(0, ...data.series.flatMap((s) => s.values));
  const range = max - min || 1;
  const y = (value: number) => pad.top + plotH - ((value - min) / range) * plotH;
  const bandW = plotW / Math.max(1, data.labels.length);

  const parts: string[] = [];

  // Grid + Y axis labels
  if (o.showGrid) {
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const value = min + (range * i) / steps;
      const yy = y(value);
      parts.push(`<line x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${pad.left + plotW}" y2="${yy.toFixed(1)}" stroke="${grid}" stroke-width="1"/>`);
      parts.push(
        `<text x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-family="${font}" font-size="${fontSize * 0.82}" fill="${label}">${formatNumber(value)}</text>`,
      );
    }
  }

  const series = data.series.length ? data.series : [{ name: 'Series', values: [] }];

  switch (data.kind) {
    case 'bar':
    case 'bar-stacked': {
      const groupCount = data.labels.length;
      const groupW = plotW / Math.max(1, groupCount);
      const barGap = Math.min(12, groupW * 0.18);
      const barW = Math.max(2, (groupW - barGap * 2) / Math.max(1, series.length));
      data.labels.forEach((labelText, index) => {
        const groupX = pad.left + index * groupW;
        if (data.kind === 'bar-stacked') {
          let cursor = y(min);
          series.forEach((s, si) => {
            const value = s.values[index] ?? 0;
            const h = Math.max(0, y(value) - y(min));
            cursor -= h;
            parts.push(
              `<rect x="${(groupX + barGap).toFixed(1)}" y="${cursor.toFixed(1)}" width="${(groupW - barGap * 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color ?? palette[si % palette.length]}"/>`,
            );
          });
        } else {
          series.forEach((s, si) => {
            const value = s.values[index] ?? 0;
            const h = Math.max(0, y(value) - y(min));
            const x = groupX + barGap + si * barW;
            parts.push(
              `<rect x="${x.toFixed(1)}" y="${(y(min) - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color ?? palette[si % palette.length]}"/>`,
            );
            if (o.showValues) {
              parts.push(
                `<text x="${(x + barW / 2).toFixed(1)}" y="${(y(min) - h - 6).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.8}" fill="${label}">${formatNumber(value)}</text>`,
              );
            }
          });
        }
        parts.push(
          `<text x="${(groupX + groupW / 2).toFixed(1)}" y="${(pad.top + plotH + fontSize + 8).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.85}" fill="${label}">${escape(labelText)}</text>`,
        );
      });
      break;
    }

    case 'line':
    case 'area': {
      series.forEach((s, si) => {
        const color = s.color ?? palette[si % palette.length];
        const points = s.values.map((value, index) => ({ x: pad.left + bandW * index + bandW / 2, y: y(value) }));
        const d = smoothPath(points, !!o.smooth);
        if (data.kind === 'area') {
          parts.push(
            `<path d="${d} L${points[points.length - 1]?.x.toFixed(1) ?? pad.left} ${y(min).toFixed(1)} L${points[0]?.x.toFixed(1) ?? pad.left} ${y(min).toFixed(1)} Z" fill="${color}" opacity="0.22"/>`,
          );
        }
        parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
        points.forEach((point, index) => {
          parts.push(`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="#fff" stroke="${color}" stroke-width="2.5"/>`);
          if (o.showValues) {
            parts.push(
              `<text x="${point.x.toFixed(1)}" y="${(point.y - 10).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.8}" fill="${label}">${formatNumber(s.values[index] ?? 0)}</text>`,
            );
          }
        });
      });
      data.labels.forEach((labelText, index) => {
        parts.push(
          `<text x="${(pad.left + bandW * index + bandW / 2).toFixed(1)}" y="${(pad.top + plotH + fontSize + 8).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.85}" fill="${label}">${escape(labelText)}</text>`,
        );
      });
      break;
    }

    case 'pie':
    case 'doughnut': {
      const values = (series[0]?.values ?? []).filter((v) => v > 0);
      const total = values.reduce((sum, v) => sum + v, 0) || 1;
      const cx = width / 2;
      const cy = pad.top + plotH / 2;
      const r = Math.min(plotW, plotH) / 2;
      const inner = data.kind === 'doughnut' || o.donut ? r * 0.58 : 0;
      let angle = -Math.PI / 2;
      values.forEach((value, index) => {
        const slice = (value / total) * Math.PI * 2;
        const color = series[0]?.color ?? palette[index % palette.length];
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle + slice);
        const y2 = cy + r * Math.sin(angle + slice);
        const large = slice > Math.PI ? 1 : 0;
        let d: string;
        if (inner > 0) {
          const ix1 = cx + inner * Math.cos(angle + slice);
          const iy1 = cy + inner * Math.sin(angle + slice);
          const ix2 = cx + inner * Math.cos(angle);
          const iy2 = cy + inner * Math.sin(angle);
          d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix1.toFixed(1)},${iy1.toFixed(1)} A${inner},${inner} 0 ${large} 0 ${ix2.toFixed(1)},${iy2.toFixed(1)} Z`;
        } else {
          d = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
        }
        parts.push(`<path d="${d}" fill="${color}"/>`);
        if (o.showValues) {
          const mid = angle + slice / 2;
          const lr = inner > 0 ? (r + inner) / 2 : r * 0.68;
          parts.push(
            `<text x="${(cx + lr * Math.cos(mid)).toFixed(1)}" y="${(cy + lr * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.85}" fill="#fff">${Math.round((value / total) * 100)}%</text>`,
          );
        }
        angle += slice;
      });
      break;
    }

    case 'radar': {
      const axes = data.labels.length || 3;
      const cx = pad.left + plotW / 2;
      const cy = pad.top + plotH / 2;
      const r = Math.min(plotW, plotH) / 2;
      for (let ring = 1; ring <= 4; ring++) {
        const rr = (r * ring) / 4;
        const pts = Array.from({ length: axes }, (_, i) => {
          const a = (i / axes) * Math.PI * 2 - Math.PI / 2;
          return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
        }).join(' ');
        parts.push(`<polygon points="${pts}" fill="none" stroke="${grid}" stroke-width="1"/>`);
      }
      series.forEach((s, si) => {
        const color = s.color ?? palette[si % palette.length];
        const pts = data.labels.map((_, i) => {
          const a = (i / axes) * Math.PI * 2 - Math.PI / 2;
          const rr = ((s.values[i] ?? 0) / (max || 1)) * r;
          return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
        });
        parts.push(`<polygon points="${pts.join(' ')}" fill="${color}" fill-opacity="0.32" stroke="${color}" stroke-width="2.5"/>`);
      });
      data.labels.forEach((labelText, i) => {
        const a = (i / axes) * Math.PI * 2 - Math.PI / 2;
        parts.push(
          `<text x="${(cx + (r + 14) * Math.cos(a)).toFixed(1)}" y="${(cy + (r + 14) * Math.sin(a) + 4).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.85}" fill="${label}">${escape(labelText)}</text>`,
        );
      });
      break;
    }

    case 'scatter': {
      series.forEach((s, si) => {
        const color = s.color ?? palette[si % palette.length];
        s.values.forEach((value, index) => {
          const x = pad.left + bandW * index + bandW / 2;
          parts.push(`<circle cx="${x.toFixed(1)}" cy="${y(value).toFixed(1)}" r="6" fill="${color}" opacity="0.72"/>`);
        });
      });
      data.labels.forEach((labelText, index) => {
        parts.push(
          `<text x="${(pad.left + bandW * index + bandW / 2).toFixed(1)}" y="${(pad.top + plotH + fontSize + 8).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.85}" fill="${label}">${escape(labelText)}</text>`,
        );
      });
      break;
    }

    case 'progress': {
      const rowH = Math.min(46, plotH / Math.max(1, data.labels.length) - 10);
      data.labels.forEach((labelText, index) => {
        const value = series[0]?.values[index] ?? 0;
        const pct = Math.max(0, Math.min(100, (value / (max || 100)) * 100));
        const yy = pad.top + index * (plotH / Math.max(1, data.labels.length));
        parts.push(
          `<text x="${pad.left}" y="${(yy + rowH * 0.6).toFixed(1)}" font-family="${font}" font-size="${fontSize * 0.9}" fill="${label}">${escape(labelText)}</text>`,
        );
        const barX = pad.left + plotW * 0.32;
        const barW = plotW * 0.68;
        parts.push(`<rect x="${barX}" y="${(yy + 4).toFixed(1)}" width="${barW}" height="${rowH * 0.44}" rx="${rowH * 0.22}" fill="${grid}"/>`);
        parts.push(
          `<rect x="${barX}" y="${(yy + 4).toFixed(1)}" width="${((barW * pct) / 100).toFixed(1)}" height="${rowH * 0.44}" rx="${rowH * 0.22}" fill="${series[0]?.color ?? palette[index % palette.length]}"/>`,
        );
        if (o.showValues) {
          parts.push(
            `<text x="${(barX + barW + 6).toFixed(1)}" y="${(yy + rowH * 0.62).toFixed(1)}" font-family="${font}" font-size="${fontSize * 0.85}" fill="${label}">${Math.round(pct)}%</text>`,
          );
        }
      });
      break;
    }

    case 'funnel': {
      const steps = data.labels.length;
      const stepH = plotH / Math.max(1, steps);
      data.labels.forEach((labelText, index) => {
        const value = series[0]?.values[index] ?? 0;
        const ratio = value / (series[0]?.values[0] || max || 1);
        const w = plotW * Math.max(0.12, ratio);
        const x = pad.left + (plotW - w) / 2;
        const yy = pad.top + index * stepH;
        parts.push(
          `<path d="M${x.toFixed(1)},${yy.toFixed(1)} L${(x + w).toFixed(1)},${yy.toFixed(1)} L${(x + w * 1.08).toFixed(1)},${(yy + stepH - 4).toFixed(1)} L${(x - w * 0.08).toFixed(1)},${(yy + stepH - 4).toFixed(1)} Z" fill="${palette[index % palette.length]}" opacity="0.9"/>`,
        );
        parts.push(
          `<text x="${pad.left + plotW / 2}" y="${(yy + stepH / 2 + 4).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${fontSize * 0.9}" fill="#fff">${escape(labelText)} · ${formatNumber(value)}</text>`,
        );
      });
      break;
    }
  }

  // Legend
  if (o.showLegend && series.length > 1) {
    const legendY = height - legendHeight / 2;
    let cursorX = pad.left;
    series.forEach((s, si) => {
      const color = s.color ?? palette[si % palette.length];
      parts.push(`<rect x="${cursorX}" y="${legendY - 6}" width="12" height="12" rx="3" fill="${color}"/>`);
      parts.push(
        `<text x="${cursorX + 18}" y="${legendY + 4}" font-family="${font}" font-size="${fontSize * 0.85}" fill="${label}">${escape(s.name)}</text>`,
      );
      cursorX += 24 + s.name.length * fontSize * 0.55;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${font}">${parts.join('')}</svg>`;
}

function smoothPath(points: { x: number; y: number }[], smooth: boolean): string {
  if (!points.length) return '';
  if (!smooth || points.length < 3) return `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  let d = `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const t = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function formatNumber(value: number): string {
  if (!isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

/** Pie/doughnut hit-testing is not needed; data editing drives everything. */
export function chartSeriesSummary(data: ChartData): string {
  const total = data.series.reduce((sum, s) => sum + s.values.reduce((a, b) => a + b, 0), 0);
  return `${data.series.length} series · ${data.labels.length} labels · ${formatNumber(total)} total`;
}
