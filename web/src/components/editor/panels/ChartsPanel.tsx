'use client';

import { useState } from 'react';
import { BarChart3, Plus, Trash2, RefreshCw } from 'lucide-react';
import { Button, Field, TextInput, Select, Toggle } from '@/components/ui';
import { useEditor } from '@/store/editor';
import { createChart, defaultChartData, uid } from '@/engine/factory';
import { addAtViewCenter } from '../insert';
import { chartSvg } from '@/engine/render/chart';
import { CURATED_PALETTES } from '@/engine/color';
import type { ChartData, ChartKind, ChartNode } from '@/engine/types';

const KINDS: { id: ChartKind; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'bar-stacked', label: 'Stacked bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'doughnut', label: 'Doughnut' },
  { id: 'radar', label: 'Radar' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'progress', label: 'Progress' },
  { id: 'funnel', label: 'Funnel' },
];

export function ChartsPanel() {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const updateNodeDeep = useEditor((s) => s.updateNodeDeep);
  const selection = useEditor((s) => s.selection);
  const page = doc.pages[activePage];

  const selectedChart = page?.nodes.find((node) => node.id === selection[0] && node.type === 'chart') as ChartNode | undefined;
  const [kind, setKind] = useState<ChartKind>('bar');
  const [data, setData] = useState<ChartData>(() => defaultChartData('bar'));

  function insert() {
    if (!page) return;
    const node = createChart(kind, { name: `${kind} chart`, width: page.width * 0.6, height: page.width * 0.4 });
    node.data = ({ ...data, kind } as ChartData);
    addAtViewCenter(node, 'Add chart');
  }

  function editChart(mutate: (draft: ChartData) => void) {
    if (!selectedChart) return;
    updateNodeDeep(
      selectedChart.id,
      (node) => {
        if (node.type === 'chart') mutate(node.data as ChartData);
      },
      { label: 'Edit chart', coalesce: 'chart' },
    );
  }

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto p-3">
      <h3 className="mb-2 mt-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        <BarChart3 size={12} /> Chart types
      </h3>

      <div className="grid grid-cols-2 gap-2">
        {KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setKind(item.id);
              setData(defaultChartData(item.id));
            }}
            className="overflow-hidden rounded-lg p-1.5 transition-transform hover:-translate-y-0.5"
            style={{
              border: `1px solid ${kind === item.id ? 'var(--brand)' : 'var(--border)'}`,
              background: 'var(--bg-panel)',
            }}
          >
            <span
              className="pointer-events-none block [&>svg]:h-full [&>svg]:w-full"
              style={{ height: 62, color: 'var(--text)' }}
              dangerouslySetInnerHTML={{
                __html: chartSvg({ ...defaultChartData(item.id), options: { ...defaultChartData(item.id).options, palette: CURATED_PALETTES[0]!.colors } }, 160, 90),
              }}
            />
            <span className="block px-0.5 pt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {item.label}
            </span>
          </button>
        ))}
      </div>

      <Button variant="primary" size="sm" className="mt-3 w-full" icon={<Plus size={13} />} onClick={insert}>
        Insert chart
      </Button>

      {selectedChart ? (
        <div className="mt-5 rounded-xl p-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
          <h4 className="mb-3 mt-0 text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
            Edit selected chart
          </h4>

          <Field label="Type">
            <Select
              value={selectedChart.data.kind}
              onChange={(value) => editChart((draft) => void (draft.kind = value as ChartKind))}
              options={KINDS.map((item) => ({ value: item.id, label: item.label }))}
            />
          </Field>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                Labels
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedChart.data.labels.map((label, index) => (
                <input
                  key={index}
                  value={label}
                  onChange={(event) =>
                    editChart((draft) => {
                      draft.labels[index] = event.target.value;
                    })
                  }
                  className="field w-[70px] px-1.5 py-1 text-[11.5px]"
                />
              ))}
            </div>
          </div>

          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Series
            </span>
            {selectedChart.data.series.map((series, seriesIndex) => (
              <div key={seriesIndex} className="mb-2 rounded-lg p-2" style={{ background: 'var(--bg-panel-2)' }}>
                <div className="flex items-center gap-2">
                  <input
                    value={series.name}
                    onChange={(event) =>
                      editChart((draft) => {
                        draft.series[seriesIndex]!.name = event.target.value;
                      })
                    }
                    className="field flex-1 px-1.5 py-1 text-[11.5px]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      editChart((draft) => {
                        draft.series = draft.series.filter((_, index) => index !== seriesIndex);
                      })
                    }
                    className="grid h-6 w-6 place-items-center rounded"
                    style={{ color: 'var(--danger)' }}
                    aria-label="Remove series"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {series.values.map((value, valueIndex) => (
                    <input
                      key={valueIndex}
                      type="number"
                      value={value}
                      onChange={(event) =>
                        editChart((draft) => {
                          draft.series[seriesIndex]!.values[valueIndex] = Number(event.target.value);
                        })
                      }
                      className="field w-[62px] px-1.5 py-1 text-[11.5px]"
                    />
                  ))}
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              icon={<Plus size={12} />}
              onClick={() =>
                editChart((draft) => {
                  draft.series.push({ name: `Series ${draft.series.length + 1}`, values: draft.labels.map(() => Math.round(Math.random() * 80 + 20)) });
                })
              }
            >
              Add series
            </Button>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Show legend
            </span>
            <Toggle checked={selectedChart.data.options.showLegend} onChange={(value) => editChart((draft) => void (draft.options.showLegend = value))} label="Legend" />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Show values
            </span>
            <Toggle checked={selectedChart.data.options.showValues} onChange={(value) => editChart((draft) => void (draft.options.showValues = value))} label="Values" />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Smooth lines
            </span>
            <Toggle checked={selectedChart.data.options.smooth} onChange={(value) => editChart((draft) => void (draft.options.smooth = value))} label="Smooth" />
          </div>

          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Palette
            </span>
            <div className="flex flex-wrap gap-1.5">
              {CURATED_PALETTES.slice(0, 8).map((palette) => (
                <button
                  key={palette.name}
                  type="button"
                  onClick={() => editChart((draft) => void (draft.options.palette = palette.colors))}
                  className="flex overflow-hidden rounded"
                  style={{ border: '1px solid var(--border)' }}
                  title={palette.name}
                >
                  {palette.colors.slice(0, 4).map((color) => (
                    <span key={color} className="h-5 w-4" style={{ background: color }} />
                  ))}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="h-4" />
    </div>
  );
}

export function randomData(): ChartData {
  return defaultChartData('bar');
}

export function newChartId(): string {
  return uid('cht');
}

export { RefreshCw };
