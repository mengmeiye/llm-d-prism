// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from 'react';
import { Star, GitCompare } from 'lucide-react';
import {
    BarChart, Bar, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts';
import { ChartCard, CustomXAxis, CustomYAxis } from './common';

// Per-run colour palette — cycles if > 8 runs.
const RUN_COLORS = [
    '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b',
    '#ef4444', '#3b82f6', '#ec4899', '#84cc16',
];
const runColor = (idx) => RUN_COLORS[idx % RUN_COLORS.length];

const fmt = (val, dec = 1) =>
    val === null || val === undefined ? '—' : Number(val).toFixed(dec);

const pctDiff = (baseline, value) => {
    if (!baseline || baseline === 0 || value === null || value === undefined) return null;
    return ((value - baseline) / Math.abs(baseline)) * 100;
};

const stageLabel = (stage) => {
    if (!stage) return '—';
    const idx = stage.stageIndex !== null ? `Stage ${stage.stageIndex}` : 'Stage —';
    const qps = stage.scenario?.rateQps != null ? ` · ${stage.scenario.rateQps} QPS` : '';
    return `${idx}${qps}`;
};

const DiffBadge = ({ diff, higherIsBetter }) => {
    if (diff === null || higherIsBetter === null) return null;
    const isImprovement = higherIsBetter ? diff > 0 : diff < 0;
    const isNeutral = Math.abs(diff) < 0.1;
    const color = isNeutral
        ? 'text-slate-400'
        : isImprovement ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
    return (
        <span className={`text-[11px] font-medium ml-1 ${color}`}>
            ({diff > 0 ? '+' : ''}{diff.toFixed(1)}%)
        </span>
    );
};

// Lightweight tooltip for bar charts — mirrors the surface style of
// CustomChartTooltip without inheriting its scatter/data-point assumptions.
const BarTooltip = ({ active, payload, unit, decimals }) => {
    if (!active || !payload || !payload.length) return null;
    const entry = payload[0];
    const data = entry.payload;
    return (
        <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700/50 rounded-xl shadow-2xl px-3 py-2 backdrop-blur-md text-slate-900 dark:text-slate-100 text-xs">
            <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: data.color }} />
                <span className="font-semibold">{data.label}</span>
                {data.isBaseline && <span className="text-violet-500 dark:text-violet-400 text-[10px]">★ baseline</span>}
            </div>
            <div className="font-mono text-sm">
                {fmt(entry.value, decimals)}
                {unit && <span className="text-slate-500 dark:text-slate-400 ml-1 text-[11px]">{unit}</span>}
            </div>
            {data.stageText && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{data.stageText}</div>
            )}
        </div>
    );
};

const MetricBarChart = ({ title, unit, data, higherIsBetter, decimals = 1 }) => {
    if (!data || data.every(d => d.value === null || d.value === undefined)) return null;

    const directionLabel = higherIsBetter === null
        ? 'context metric'
        : higherIsBetter ? '↑ higher is better' : '↓ lower is better';

    const titleNode = (
        <span className="flex items-center justify-between w-full">
            <span>{title}</span>
            <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                {unit && <span className="mr-2">{unit}</span>}
                {directionLabel}
            </span>
        </span>
    );

    return (
        <ChartCard title={titleNode}>
            <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} vertical={false} />
                        <CustomXAxis dataKey="label" type="category" interval={0} height={32} label={null} />
                        <CustomYAxis label={null} width={48} />
                        <Tooltip
                            cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
                            content={<BarTooltip unit={unit} decimals={decimals} />}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
                            {data.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </ChartCard>
    );
};

export default function BenchmarkComparisonDashboard({
    runs,
    customLabels,
    baselineRunId,
    selectedStages,
    setBaselineRunId,
}) {
    const getLabel = (run) => customLabels?.[run.runId] || run.runLabel;

    const columns = React.useMemo(() => {
        const baseline = runs.find(r => r.runId === baselineRunId);
        const rest = runs.filter(r => r.runId !== baselineRunId);
        return [...(baseline ? [baseline] : []), ...rest].map((run, idx) => {
            const stageIdx = selectedStages?.[run.runId] ?? 0;
            const stage = run.stages[stageIdx] || run.stages[0];
            return { run, stage, isBaseline: run.runId === baselineRunId, color: runColor(idx) };
        });
    }, [runs, baselineRunId, selectedStages]);

    if (runs.length === 0) return null;

    const baselineCol = columns.find(c => c.isBaseline);

    const makeBarData = (accessor) =>
        columns.map(col => ({
            label: getLabel(col.run),
            value: accessor(col.stage),
            color: col.color,
            isBaseline: col.isBaseline,
            stageText: stageLabel(col.stage),
        }));

    const perfMetrics = [
        { title: 'Output Throughput',  unit: 'tok/s', dec: 0, higher: true,  fn: s => s?.performance?.outputTokenRate },
        { title: 'TTFT Mean',          unit: 'ms',    dec: 1, higher: false, fn: s => s?.performance?.ttftMean },
        { title: 'TTFT P99',           unit: 'ms',    dec: 1, higher: false, fn: s => s?.performance?.ttftP99 },
        { title: 'TPOT Mean',          unit: 'ms',    dec: 2, higher: false, fn: s => s?.performance?.tpotMean },
        { title: 'ITL Mean',           unit: 'ms',    dec: 2, higher: false, fn: s => s?.performance?.itlMean },
        { title: 'E2E Latency Mean',   unit: 'ms',    dec: 1, higher: false, fn: s => s?.performance?.e2eMean },
    ];

    const obsMetrics = [
        { title: 'KV Cache Utilization',  unit: '%',  dec: 1, higher: null,  fn: s => s?.observability?.kvCacheUsage },
        { title: 'Prefix Cache Hit Rate', unit: '%',  dec: 1, higher: true,  fn: s => s?.observability?.prefixCacheHitRate },
        { title: 'EPP KV Utilization',    unit: '%',  dec: 1, higher: null,  fn: s => s?.observability?.eppKvUtilization },
        { title: 'EPP Queue Size',        unit: '',   dec: 1, higher: false, fn: s => s?.observability?.eppQueueSize },
        { title: 'Pod Startup Mean',      unit: 's',  dec: 1, higher: false, fn: s => s?.observability?.podStartupMeanS },
    ];

    const hasObs = columns.some(c => c.stage?.observability !== null && c.stage?.observability !== undefined);

    return (
        <section className="space-y-4">
            {/* Section header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-600/15 text-cyan-400 dark:text-cyan-300">
                        <GitCompare className="w-4 h-4" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                            Local Benchmark Comparison
                        </h2>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {runs.length} runs uploaded · ★ marks the baseline · click a run pill to change baseline
                        </p>
                    </div>
                </div>
            </div>

            {/* Run legend / baseline picker */}
            <div className="flex flex-wrap gap-2">
                {columns.map((col) => (
                    <button
                        key={col.run.runId}
                        onClick={() => setBaselineRunId(col.run.runId)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            col.isBaseline
                                ? 'border-cyan-500/60 bg-cyan-600/15 text-cyan-700 dark:text-cyan-300'
                                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:border-cyan-500/40 hover:text-cyan-600 dark:hover:text-cyan-300'
                        }`}
                        title={col.isBaseline ? 'Current baseline' : 'Click to set as baseline'}
                    >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.color }} />
                        {col.isBaseline && <Star size={10} fill="currentColor" />}
                        <span className="truncate max-w-[180px]">{getLabel(col.run)}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            {stageLabel(col.stage)}
                        </span>
                    </button>
                ))}
            </div>

            {/* Performance bar charts */}
            <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    Request Performance
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {perfMetrics.map(m => (
                        <MetricBarChart
                            key={m.title}
                            title={m.title}
                            unit={m.unit}
                            data={makeBarData(m.fn)}
                            higherIsBetter={m.higher}
                            decimals={m.dec}
                        />
                    ))}
                </div>
            </div>

            {/* Observability bar charts */}
            {hasObs && (
                <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                        Observability
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {obsMetrics.map(m => {
                            const anyData = columns.some(c => {
                                const v = m.fn(c.stage);
                                return v !== null && v !== undefined;
                            });
                            if (!anyData) return null;
                            return (
                                <MetricBarChart
                                    key={m.title}
                                    title={m.title}
                                    unit={m.unit}
                                    data={makeBarData(m.fn)}
                                    higherIsBetter={m.higher}
                                    decimals={m.dec}
                                />
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Detailed comparison table */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden transition-colors">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
                        Detailed Comparison
                    </h3>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        <span className="text-emerald-500 dark:text-emerald-400">green</span> = improvement ·{' '}
                        <span className="text-red-500 dark:text-red-400">red</span> = regression vs baseline
                    </span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                                <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase w-48">
                                    Metric
                                </th>
                                {columns.map(col => (
                                    <th key={col.run.runId} className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
                                            <span className={`text-[11px] font-semibold truncate max-w-[140px] ${
                                                col.isBaseline
                                                    ? 'text-cyan-600 dark:text-cyan-300'
                                                    : 'text-slate-700 dark:text-slate-300'
                                            }`}>
                                                {col.isBaseline && '★ '}{getLabel(col.run)}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                                            {stageLabel(col.stage)}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colSpan={columns.length + 1} className="px-4 pt-4 pb-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Request Performance
                                    </span>
                                </td>
                            </tr>
                            {perfMetrics.map(row => (
                                <tr key={row.title} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/20">
                                    <td className="px-4 py-2 text-[12px] text-slate-600 dark:text-slate-300">{row.title}</td>
                                    {columns.map(col => {
                                        const val = row.fn(col.stage);
                                        const diff = col.isBaseline ? null : pctDiff(row.fn(baselineCol?.stage), val);
                                        return (
                                            <td key={col.run.runId} className="px-4 py-2 text-center">
                                                <span className="text-[12px] font-mono text-slate-800 dark:text-slate-100">{fmt(val, row.dec)}</span>
                                                {row.unit && <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-0.5">{row.unit}</span>}
                                                {diff !== null && <DiffBadge diff={diff} higherIsBetter={row.higher} />}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}

                            {hasObs && (
                                <>
                                    <tr>
                                        <td colSpan={columns.length + 1} className="px-4 pt-4 pb-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                Observability
                                            </span>
                                        </td>
                                    </tr>
                                    {obsMetrics.map(row => {
                                        const anyData = columns.some(c => {
                                            const v = row.fn(c.stage);
                                            return v !== null && v !== undefined;
                                        });
                                        if (!anyData) return null;
                                        return (
                                            <tr key={row.title} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/20">
                                                <td className="px-4 py-2 text-[12px] text-slate-600 dark:text-slate-300">{row.title}</td>
                                                {columns.map(col => {
                                                    const val = row.fn(col.stage);
                                                    const diff = col.isBaseline ? null : pctDiff(row.fn(baselineCol?.stage), val);
                                                    return (
                                                        <td key={col.run.runId} className="px-4 py-2 text-center">
                                                            <span className="text-[12px] font-mono text-slate-800 dark:text-slate-100">{fmt(val, row.dec)}</span>
                                                            {row.unit && <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-0.5">{row.unit}</span>}
                                                            {diff !== null && <DiffBadge diff={diff} higherIsBetter={row.higher} />}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
