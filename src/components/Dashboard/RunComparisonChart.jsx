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

import React, { useEffect, useMemo, useState } from 'react';
import {
    BarChart, Bar, Cell, CartesianGrid, ReferenceLine,
    ResponsiveContainer, LabelList, Tooltip,
} from 'recharts';
import { ChartCard, CustomXAxis, CustomYAxis } from '../common';

// One-bar-per-run comparison chart. Metrics are grouped into families
// (TTFT / TPOT / ITL / E2E / observability) so the user picks the family
// once and then flips between mean / p50 / p99 in a sub-toggle. Single-stat
// metrics (Output Tput, Request rate, …) just render the family button.

const METRICS = [
    // Throughput family — single stat each
    { id: 'output_tput', label: 'Output Tput', unit: 'tok/s', dec: 0, higher: true,
      stats: [{ id: 'mean', label: 'mean',
                fn: d => d.metrics?.output_tput ?? d.throughput }] },
    { id: 'input_tput',  label: 'Input Tput',  unit: 'tok/s', dec: 0, higher: true,
      stats: [{ id: 'mean', label: 'mean',
                fn: d => d.metrics?.input_tput }] },
    { id: 'request_rate', label: 'Request rate', unit: 'req/s', dec: 2, higher: true,
      stats: [{ id: 'mean', label: 'mean',
                fn: d => d.metrics?.request_rate ?? d.qps }] },

    // Latency family — mean / p50 / p99 sub-toggles
    { id: 'ttft', label: 'TTFT', unit: 'ms', dec: 1, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => d.metrics?.ttft?.mean ?? d.ttft?.mean },
        { id: 'p50',  label: 'p50',  fn: d => d.metrics?.ttft?.p50  ?? d.ttft?.p50 },
        { id: 'p99',  label: 'p99',  fn: d => d.metrics?.ttft?.p99  ?? d.ttft?.p99 },
      ] },
    { id: 'tpot', label: 'TPOT', unit: 'ms', dec: 2, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => d.metrics?.tpot ?? d.time_per_output_token },
        { id: 'p50',  label: 'p50',  fn: d => d.metrics?.tpot_p50 },
        { id: 'p99',  label: 'p99',  fn: d => d.metrics?.tpot_p99 },
      ] },
    { id: 'itl', label: 'ITL', unit: 'ms', dec: 2, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => d.metrics?.itl ?? d.itl },
        { id: 'p50',  label: 'p50',  fn: d => d.metrics?.itl_p50 },
        { id: 'p99',  label: 'p99',  fn: d => d.metrics?.itl_p99 },
      ] },
    { id: 'e2e', label: 'E2E', unit: 'ms', dec: 1, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => d.metrics?.e2e_latency ?? d.latency?.mean },
        { id: 'p50',  label: 'p50',  fn: d => d.latency?.p50 ?? d.metrics?.latency?.p50 },
        { id: 'p99',  label: 'p99',  fn: d => d.latency?.p99 ?? d.metrics?.latency?.p99 },
      ] },

    // Observability — only present in v0.2 reports
    { id: 'kv_cache_usage', label: 'KV cache usage', unit: '%', dec: 1, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => pct(d.metrics?.observability?.kvCacheUsageMean) },
        { id: 'p50',  label: 'p50',  fn: d => pct(d.metrics?.observability?.kvCacheUsageP50) },
        { id: 'p99',  label: 'p99',  fn: d => pct(d.metrics?.observability?.kvCacheUsageP99) },
      ] },
    { id: 'prefix_cache_hit', label: 'Prefix cache hit', unit: '%', dec: 1, higher: true,
      stats: [
        { id: 'mean', label: 'mean', fn: d => pct(d.metrics?.observability?.prefixCacheHitMean) },
        { id: 'p50',  label: 'p50',  fn: d => pct(d.metrics?.observability?.prefixCacheHitP50) },
        { id: 'p99',  label: 'p99',  fn: d => pct(d.metrics?.observability?.prefixCacheHitP99) },
      ] },
    { id: 'epp_queue', label: 'EPP queue size', unit: '', dec: 1, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => d.metrics?.observability?.eppQueueMean },
        { id: 'p50',  label: 'p50',  fn: d => d.metrics?.observability?.eppQueueP50 },
        { id: 'p99',  label: 'p99',  fn: d => d.metrics?.observability?.eppQueueP99 },
      ] },
    { id: 'pod_startup', label: 'Pod startup', unit: 's', dec: 1, higher: false,
      stats: [
        { id: 'mean', label: 'mean', fn: d => d.metrics?.observability?.podStartupMeanS },
        { id: 'p50',  label: 'p50',  fn: d => d.metrics?.observability?.podStartupP50S },
        { id: 'p99',  label: 'p99',  fn: d => d.metrics?.observability?.podStartupP99S },
      ] },
];

// vllm cache rates are emitted as fractions for kv_cache_usage but as
// percentages for prefix_cache_hit_rate. Detect and normalize to 0-100.
function pct(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    return v <= 1 ? v * 100 : v;
}

const aggregateValue = (entries, statFn, higher) => {
    const vals = entries
        .map(statFn)
        .filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);
    if (vals.length === 0) return null;
    if (vals.length === 1) return vals[0];
    return higher ? Math.max(...vals) : Math.min(...vals);
};

const formatVal = (v, dec) => {
    if (v === null || v === undefined) return '—';
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: dec });
};

const truncateLabel = (s, n = 22) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

const buildBenchmarkLabel = (key, sample, brv02CustomLabels) => {
    // brv02 uploads — use the user's custom label or runLabel
    if (sample?.source?.startsWith('brv02:')) {
        const runId = sample.source.slice('brv02:'.length);
        if (brv02CustomLabels?.[runId]) return brv02CustomLabels[runId];
        // Fall back to model · QPS · stage
        const qps = sample.workload?.target_qps;
        const stage = sample.workload?.stage;
        const parts = [sample.model_name || sample.model || 'run'];
        if (stage != null) parts.push(`stage ${stage}`);
        if (qps != null) parts.push(`${qps} QPS`);
        return parts.join(' · ');
    }
    // Other sources — model · short source tag
    return sample?.model_name || sample?.model || key.slice(0, 30);
};

const BarTooltip = ({ active, payload, metric, stat, view, baselineSet }) => {
    if (!active || !payload || !payload.length) return null;
    const d = payload[0].payload;
    const metricLabel = `${metric.label}${metric.stats.length > 1 ? ` ${stat.label}` : ''}`;
    return (
        <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700/50 rounded-xl shadow-2xl px-3 py-2 backdrop-blur-md text-slate-900 dark:text-slate-100 text-xs min-w-[200px]">
            <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                <span className="font-semibold truncate">{d.fullLabel}</span>
                {d.isBaseline && <span className="text-cyan-500 dark:text-cyan-400 text-[10px] shrink-0">★ baseline</span>}
            </div>
            <div className="space-y-0.5 font-mono">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">{metricLabel}</span>
                    <span className="text-sm">
                        {formatVal(d.rawValue, metric.dec)}
                        <span className="text-slate-500 dark:text-slate-400 text-[10px] ml-1">{metric.unit}</span>
                    </span>
                </div>
                {baselineSet && d.diff !== null && d.diff !== undefined && (
                    <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                        <span className="text-slate-500 dark:text-slate-400 text-[11px]">vs baseline</span>
                        <span className={`text-sm font-bold ${
                            d.isImprovement === null ? 'text-slate-400'
                                : d.isImprovement ? 'text-emerald-500 dark:text-emerald-400'
                                : 'text-red-500 dark:text-red-400'
                        }`}>
                            {d.diff > 0 ? '+' : ''}{d.diff.toFixed(1)}%
                        </span>
                    </div>
                )}
                {view === 'diff' && !baselineSet && (
                    <span className="text-[10px] text-slate-400">no baseline</span>
                )}
            </div>
        </div>
    );
};

export const RunComparisonChart = ({
    filteredBySource,
    selectedBenchmarks,
    getBenchmarkKey,
    baselineBenchmarkKey,
    brv02CustomLabels,
    theme,
}) => {
    const [metricId, setMetricId] = useState('output_tput');
    const [statId, setStatId] = useState('mean');
    const [viewOverride, setViewOverride] = useState(null); // null = follow baseline default

    // When the baseline is cleared, drop the manual view override so the chart
    // falls back to the natural default ("absolute"). The user can flip back
    // to "diff" manually once they pick a baseline.
    useEffect(() => {
        if (!baselineBenchmarkKey) setViewOverride(null);
    }, [baselineBenchmarkKey]);

    const canDiff = !!baselineBenchmarkKey;
    const view = viewOverride ?? (canDiff ? 'diff' : 'absolute');

    const metric = METRICS.find(m => m.id === metricId) || METRICS[0];
    const stat = metric.stats.find(s => s.id === statId) || metric.stats[0];

    // If the user picks a metric without the current stat, fall back to mean.
    useEffect(() => {
        if (!metric.stats.find(s => s.id === statId)) setStatId('mean');
    }, [metricId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Group entries by benchmarkKey, build one bar per selected benchmark.
    const chartData = useMemo(() => {
        if (selectedBenchmarks.size < 2) return [];

        const byKey = new Map();
        filteredBySource.forEach(d => {
            const key = getBenchmarkKey(d);
            if (!selectedBenchmarks.has(key)) return;
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(d);
        });

        const list = [];
        byKey.forEach((entries, key) => {
            const value = aggregateValue(entries, stat.fn, metric.higher);
            if (value === null) return;
            const sample = entries[0];
            const fullLabel = buildBenchmarkLabel(key, sample, brv02CustomLabels);
            list.push({
                key,
                fullLabel,
                label: truncateLabel(fullLabel, 24),
                rawValue: value,
                isBaseline: key === baselineBenchmarkKey,
            });
        });

        // Compute %diff vs baseline.
        const baselineEntry = list.find(b => b.isBaseline);
        const baselineVal = baselineEntry?.rawValue ?? null;

        return list
            .map(b => {
                const diff = (baselineVal !== null && baselineVal !== 0 && !b.isBaseline)
                    ? ((b.rawValue - baselineVal) / Math.abs(baselineVal)) * 100
                    : null;
                const isImprovement = diff === null
                    ? null
                    : Math.abs(diff) < 0.1 ? null
                        : (metric.higher ? diff > 0 : diff < 0);
                return { ...b, diff, isImprovement };
            })
            // Stable order: baseline first, then by raw value descending.
            .sort((a, b) => {
                if (a.isBaseline && !b.isBaseline) return -1;
                if (b.isBaseline && !a.isBaseline) return 1;
                return (b.rawValue ?? 0) - (a.rawValue ?? 0);
            });
    }, [filteredBySource, selectedBenchmarks, getBenchmarkKey, metric, stat, baselineBenchmarkKey, brv02CustomLabels]);

    // Don't render the panel at all until the user picks at least 2 benchmarks.
    // (Once they have, we always render so the toggles remain accessible even
    // when a chosen metric has no data for the current selection.)
    if (selectedBenchmarks.size < 2) return null;

    const plotData = chartData.map(d => ({
        ...d,
        value: view === 'diff' ? (d.isBaseline ? 0 : d.diff) : d.rawValue,
        // Recharts cell `fill` per bar.
        fill: d.isBaseline
            ? (theme === 'dark' ? '#06b6d4' : '#0891b2')
            : view === 'diff' && d.isImprovement !== null
                ? (d.isImprovement ? '#10b981' : '#ef4444')
                : '#3b82f6',
    }));

    const hasPlotData = plotData.length >= 2;

    // Render labels above each bar. In absolute view the percentage diff
    // sits ABOVE the absolute number (so the eye reads regression first,
    // value second). High-contrast colors keep the text legible on dark bg.
    const ABS_COLOR_DARK   = '#f8fafc';
    const ABS_COLOR_LIGHT  = '#0f172a';
    const BL_COLOR_DARK    = '#22d3ee';
    const BL_COLOR_LIGHT   = '#0e7490';
    const POS_COLOR        = '#34d399'; // emerald-400 (improvement)
    const NEG_COLOR        = '#f87171'; // red-400 (regression)

    const renderTopLabel = (props) => {
        const { x, y, width, index } = props;
        if (x == null || y == null || width == null) return null;
        const entry = plotData[index];
        if (!entry) return null;

        const cx = x + width / 2;
        const isAbove = (entry.value ?? 0) >= 0;

        if (view === 'diff') {
            // Diff view: put a single, prominent label above each bar.
            const cy = isAbove ? y - 8 : y + 16;
            if (entry.isBaseline) {
                return (
                    <text x={cx} y={cy} textAnchor="middle" fontSize={12} fontWeight={800}
                          fill={theme === 'dark' ? BL_COLOR_DARK : BL_COLOR_LIGHT}>
                        ★ baseline
                    </text>
                );
            }
            if (entry.diff === null) return null;
            const sign = entry.diff > 0 ? '+' : '';
            const fill = entry.isImprovement === null ? (theme === 'dark' ? '#cbd5e1' : '#475569')
                : entry.isImprovement ? POS_COLOR : NEG_COLOR;
            return (
                <text x={cx} y={cy} textAnchor="middle" fontSize={13} fontWeight={800} fill={fill}>
                    {sign}{entry.diff.toFixed(1)}%
                </text>
            );
        }

        // Absolute view — %diff stacked ABOVE absolute number, both clear of bar.
        const valStr = formatVal(entry.rawValue, metric.dec);
        const absFill = theme === 'dark' ? ABS_COLOR_DARK : ABS_COLOR_LIGHT;
        const blFill  = theme === 'dark' ? BL_COLOR_DARK  : BL_COLOR_LIGHT;
        const TOP_Y = y - 22; // %diff or ★ baseline
        const ABS_Y = y - 6;  // absolute number, just above bar
        return (
            <g>
                {canDiff && !entry.isBaseline && entry.diff !== null && (
                    <text x={cx} y={TOP_Y} textAnchor="middle" fontSize={12} fontWeight={800}
                          fill={entry.isImprovement === null ? (theme === 'dark' ? '#cbd5e1' : '#475569')
                              : entry.isImprovement ? POS_COLOR : NEG_COLOR}>
                        {entry.diff > 0 ? '+' : ''}{entry.diff.toFixed(1)}%
                    </text>
                )}
                {entry.isBaseline && (
                    <text x={cx} y={TOP_Y} textAnchor="middle" fontSize={12} fontWeight={800}
                          fill={blFill}>
                        ★ baseline
                    </text>
                )}
                <text x={cx} y={ABS_Y} textAnchor="middle" fontSize={12} fontWeight={700}
                      fill={absFill}>
                    {valStr}
                </text>
            </g>
        );
    };

    const metricLabelFull = `${metric.label}${metric.stats.length > 1 ? ` ${stat.label}` : ''}`;
    const yLabel = view === 'diff'
        ? `Δ ${metricLabelFull} vs baseline (%)`
        : `${metricLabelFull}${metric.unit ? ` (${metric.unit})` : ''}`;

    // Tailwind purges class names not present in source, so we keep the
    // active-state classnames explicit (no dynamic bg-${color}-600).
    const activeClass = (kind) => kind === 'cyan'
        ? 'bg-cyan-600 text-white shadow-sm'
        : kind === 'emerald'
            ? 'bg-emerald-600 text-white shadow-sm'
            : kind === 'purple'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-blue-600 text-white shadow-sm';

    const baseTogglesClass = 'px-3 py-1 text-xs font-medium rounded-md transition-all';
    const inactiveToggleClass = 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700/50';

    return (
        <ChartCard title="Run Comparison">
            {/* Toggle row */}
            <div className="flex items-center gap-3 flex-wrap mb-4">
                <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-200 dark:border-slate-700/50 flex-wrap">
                    <span className="text-[10px] text-slate-700 dark:text-slate-500 font-bold uppercase tracking-wider mr-1">Metric</span>
                    <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mr-1" />
                    {METRICS.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setMetricId(opt.id)}
                            className={`${baseTogglesClass} ${metricId === opt.id ? activeClass('blue') : inactiveToggleClass}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                {metric.stats.length > 1 && (
                    <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-200 dark:border-slate-700/50">
                        <span className="text-[10px] text-slate-700 dark:text-slate-500 font-bold uppercase tracking-wider mr-1">Stat</span>
                        <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mr-1" />
                        {metric.stats.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setStatId(opt.id)}
                                className={`${baseTogglesClass} ${statId === opt.id ? activeClass('purple') : inactiveToggleClass}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-200 dark:border-slate-700/50">
                    <span className="text-[10px] text-slate-700 dark:text-slate-500 font-bold uppercase tracking-wider mr-1">View</span>
                    <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mr-1" />
                    <button
                        onClick={() => setViewOverride('absolute')}
                        className={`${baseTogglesClass} ${view === 'absolute' ? activeClass('emerald') : inactiveToggleClass}`}
                    >
                        Absolute
                    </button>
                    <button
                        onClick={() => canDiff && setViewOverride('diff')}
                        disabled={!canDiff}
                        title={canDiff ? '' : 'Set a baseline (★) on a row in the table to enable Δ% view'}
                        className={`${baseTogglesClass} ${
                            !canDiff
                                ? 'text-slate-600 cursor-not-allowed opacity-50'
                                : view === 'diff'
                                    ? activeClass('cyan')
                                    : inactiveToggleClass
                        }`}
                    >
                        Δ% vs baseline
                    </button>
                </div>
            </div>

            <div className="h-72">
                {hasPlotData ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={plotData}
                            margin={{ top: 36, right: 20, left: 30, bottom: 60 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#475569" opacity={0.3} vertical={false} />
                            <CustomXAxis
                                dataKey="label"
                                type="category"
                                interval={0}
                                height={60}
                                angle={-15}
                                textAnchor="end"
                                theme={theme}
                                label={null}
                                // CustomXAxis defaults to a numeric tickFormatter, which turns
                                // category strings into NaN. Override with identity.
                                tickFormatter={(v) => v}
                            />
                            <CustomYAxis
                                label={yLabel}
                                theme={theme}
                                width={68}
                                tickFormatter={(v) => view === 'diff'
                                    ? `${v > 0 ? '+' : ''}${v}%`
                                    : (Math.abs(v) >= 1000
                                        ? Number(v).toFixed(0)
                                        : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }))}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                                content={<BarTooltip metric={metric} stat={stat} view={view} baselineSet={canDiff} />}
                            />
                            {view === 'diff' && (
                                <ReferenceLine
                                    y={0}
                                    stroke={theme === 'dark' ? '#22d3ee' : '#0891b2'}
                                    strokeWidth={1.5}
                                    strokeDasharray="4 4"
                                />
                            )}
                            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
                                {plotData.map((entry, i) => (
                                    <Cell
                                        key={i}
                                        fill={entry.fill}
                                        stroke={entry.isBaseline ? (theme === 'dark' ? '#67e8f9' : '#0e7490') : 'none'}
                                        strokeWidth={entry.isBaseline ? 1.5 : 0}
                                    />
                                ))}
                                <LabelList dataKey="value" content={renderTopLabel} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex items-center justify-center text-center px-6">
                        <div className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
                            <p className="font-medium mb-1">No data for {metricLabelFull}</p>
                            <p className="text-xs">
                                The selected benchmarks don't include this metric. Try a different
                                metric (observability metrics like KV cache usage and pod startup
                                are only available in v0.2 reports), or select more benchmarks.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 text-center">
                One bar per selected benchmark · multi-point benchmarks aggregate to{' '}
                {metric.higher ? 'max' : 'min'} {metricLabelFull.toLowerCase()}
                {canDiff
                    ? ' · Δ% in green = improvement, red = regression'
                    : ' · set a baseline (★) on a row to enable Δ% comparison'}
            </p>
        </ChartCard>
    );
};
