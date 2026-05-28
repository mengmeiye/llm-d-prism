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

import React from "react";
import { FileJson, X, AlertCircle, Pencil, Star } from "lucide-react";

const stageSummary = (stage) => {
    if (!stage) return '—';
    const idx = stage.stageIndex !== null ? `Stage ${stage.stageIndex}` : 'Stage —';
    const qps = stage.scenario?.rateQps != null ? ` · ${stage.scenario.rateQps} QPS` : '';
    return `${idx}${qps}`;
};

export const BenchmarkReportPanel = ({
    runs, error, setError, onUpload, onRemoveRun,
    customLabels, setCustomLabels,
    getRunBenchmarkKey, baselineBenchmarkKey, setBaselineBenchmarkKey,
}) => {
    const [editingRunId, setEditingRunId] = React.useState(null);
    const [editingValue, setEditingValue] = React.useState('');
    const [collisionEdit, setCollisionEdit] = React.useState(false);

    const getLabel = (run) => customLabels[run.runId] || run.runLabel;

    const startEdit = (run) => {
        setEditingRunId(run.runId);
        setEditingValue(getLabel(run));
    };

    const commitEdit = () => {
        if (editingRunId) {
            const trimmed = editingValue.trim();
            if (trimmed) {
                setCustomLabels(prev => ({ ...prev, [editingRunId]: trimmed }));
            }
        }
        setEditingRunId(null);
        setCollisionEdit(false);
    };

    const cancelEdit = () => {
        setEditingRunId(null);
        setCollisionEdit(false);
    };

    // Track which run IDs were present on the previous render so we can
    // identify newly added runs.
    const prevRunIdsRef = React.useRef(new Set());

    // When new runs are added, check for label collisions and auto-trigger
    // rename mode on any new run whose label matches an existing one.
    React.useEffect(() => {
        const prevIds = prevRunIdsRef.current;
        const newRuns = runs.filter(r => !prevIds.has(r.runId));

        if (newRuns.length > 0 && !editingRunId) {
            for (const newRun of newRuns) {
                const newLabel = getLabel(newRun);
                const hasCollision = runs.some(
                    r => r.runId !== newRun.runId && getLabel(r) === newLabel
                );
                if (hasCollision) {
                    setEditingRunId(newRun.runId);
                    setEditingValue(newLabel);
                    setCollisionEdit(true);
                    break;
                }
            }
        }

        prevRunIdsRef.current = new Set(runs.map(r => r.runId));
    }, [runs, editingRunId]);

    return (
        <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 p-4 animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-3">

                {/* Error banner */}
                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 px-3 py-2 rounded text-xs flex items-start gap-2">
                        <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                        <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={10} /></button>
                    </div>
                )}

                {/* Drop zone — always visible, additive uploads */}
                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-2">Upload Report Files</label>
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-5 flex flex-col items-center justify-center text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative group cursor-pointer">
                        <input
                            type="file"
                            multiple
                            accept=".yaml,.yml"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={onUpload}
                        />
                        <FileJson size={20} className="text-slate-400 mb-1.5 group-hover:text-cyan-500 transition-colors" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Drag & drop files or <span className="text-cyan-500">browse</span>
                        </span>
                        <span className="text-[10px] text-slate-400 mt-1">
                            benchmark_report_v0.2,_*.yaml — new files are added to existing
                        </span>
                    </div>
                </div>

                {/* Uploaded runs list */}
                {runs.length > 0 && (
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase block">
                            Uploaded Runs ({runs.length})
                        </label>
                        {runs.map(run => {
                            const runKey = getRunBenchmarkKey ? getRunBenchmarkKey(run.runId) : null;
                            const isBaseline = !!runKey && runKey === baselineBenchmarkKey;
                            const canSetBaseline = !!runKey && !!setBaselineBenchmarkKey;
                            return (
                                <div
                                    key={run.runId}
                                    className={`rounded-md border px-3 py-2 text-xs flex flex-col gap-1.5 ${
                                        isBaseline
                                            ? 'border-purple-400 dark:border-purple-500 ring-1 ring-purple-400/40 bg-purple-50/40 dark:bg-purple-950/30'
                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        {/* Inline label — click to rename */}
                                        {editingRunId === run.runId ? (
                                            <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                                                <input
                                                    autoFocus
                                                    value={editingValue}
                                                    onChange={e => setEditingValue(e.target.value)}
                                                    onBlur={commitEdit}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') commitEdit();
                                                        if (e.key === 'Escape') cancelEdit();
                                                    }}
                                                    className="w-full text-xs font-medium bg-white dark:bg-slate-800 border border-cyan-400 rounded px-1.5 py-0.5 text-slate-800 dark:text-slate-200 focus:outline-none"
                                                />
                                                {collisionEdit && (
                                                    <span className="text-[9px] text-amber-500">
                                                        Duplicate name — give this run a unique name
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => startEdit(run)}
                                                title="Click to rename"
                                                className="flex-1 flex items-center gap-1.5 min-w-0 text-left group"
                                            >
                                                <span className="font-medium text-slate-800 dark:text-slate-200 truncate text-xs">
                                                    {getLabel(run)}
                                                </span>
                                                <Pencil size={10} className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-cyan-400 transition-colors" />
                                            </button>
                                        )}
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => {
                                                    if (!canSetBaseline) return;
                                                    setBaselineBenchmarkKey(isBaseline ? null : runKey);
                                                }}
                                                disabled={!canSetBaseline}
                                                title={
                                                    !canSetBaseline
                                                        ? 'Run not yet selected — open Benchmark Browser to enable baseline'
                                                        : isBaseline
                                                            ? 'Click to clear baseline'
                                                            : 'Set as baseline (★) for Δ% comparison'
                                                }
                                                className={`p-1 rounded transition-colors ${
                                                    !canSetBaseline
                                                        ? 'text-slate-200 dark:text-slate-700 cursor-not-allowed'
                                                        : isBaseline
                                                            ? 'text-purple-500 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300'
                                                            : 'text-slate-300 dark:text-slate-600 hover:text-purple-500 dark:hover:text-purple-400'
                                                }`}
                                            >
                                                <Star size={14} fill={isBaseline ? 'currentColor' : 'none'} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    onRemoveRun(run.runId);
                                                    setCustomLabels(prev => {
                                                        const next = { ...prev };
                                                        delete next[run.runId];
                                                        return next;
                                                    });
                                                }}
                                                title="Remove run"
                                                className="p-1 rounded text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 transition-colors"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Stage summary — read-only since each stage now renders as its own scatter point */}
                                    <div className="text-[10px] text-slate-400">
                                        {run.stages.length === 1
                                            ? stageSummary(run.stages[0])
                                            : `${run.stages.length} stages plotted on chart`}
                                    </div>

                                    {/* Scenario summary */}
                                    {run.stages[0] && (
                                        <div className="text-[9px] text-slate-400 flex flex-wrap gap-x-2">
                                            <span>{run.stages[0].scenario.model || '—'}</span>
                                            <span>{run.stages[0].scenario.hardware || '—'}</span>
                                            {run.stages[0].scenario.acceleratorCount != null && (
                                                <span>×{run.stages[0].scenario.acceleratorCount} GPUs</span>
                                            )}
                                            {run.stages[0].scenario.tp != null && (
                                                <span>TP{run.stages[0].scenario.tp}</span>
                                            )}
                                            {run.stages[0].timestamp && (
                                                <span className="ml-auto font-mono text-slate-300 dark:text-slate-600">
                                                    {new Date(run.stages[0].timestamp).toLocaleString(undefined, {
                                                        month: 'short', day: 'numeric',
                                                        hour: '2-digit', minute: '2-digit',
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Hint pointing at the chart */}
                {runs.length > 0 && (
                    <p className="text-[10px] text-slate-400 text-center py-1">
                        Open the Benchmark Browser and pick a baseline (★) on a row to compare runs.
                    </p>
                )}
            </div>
        </div>
    );
};
