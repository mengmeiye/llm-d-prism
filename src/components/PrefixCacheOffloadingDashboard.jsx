// Copyright 2026 Google LLC
//
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

import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
    ArrowLeft, Menu, Share2, Download,
    ExternalLink, HardDrive, ChevronDown, ChevronUp, Check, MessageCircle
} from 'lucide-react';


const getMachineType = (gpu) => {
    if (!gpu) return 'a3-highgpu-8g';
    const upper = gpu.toUpperCase();
    if (upper.includes('H100')) return 'a3-highgpu-8g';
    if (upper.includes('A100')) return 'a2-highgpu-8g';
    if (upper.includes('L4')) return 'g2-standard-96';
    return 'a3-highgpu-8g';
};

const ThroughputBarTooltip = ({ active, payload, yMetric }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const yUnit = yMetric === 'qps' ? '' : 'tok/s';
    const formatVal = (v) => typeof v === 'number' ? (yMetric === 'qps' ? v.toFixed(2) : v.toFixed(0)) : v;
    return (
        <div className="bg-slate-900/95 border border-slate-700/50 rounded-lg shadow-xl p-3 min-w-[180px] backdrop-blur-md text-slate-100 z-[100]">
            <div className="text-[11px] font-bold text-white mb-1.5">{d.name}</div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: d.fill }} />
                <span className="text-sm font-mono font-bold" style={{ color: d.fill }}>
                    {formatVal(d.throughput)} {yUnit}
                </span>
            </div>
        </div>
    );
};

const LatencyBarTooltip = ({ active, payload, xMetric }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const metricLabels = { ntpot: 'NTPOT', tpot: 'TPOT', ttft: 'TTFT', itl: 'ITL', e2e: 'E2E' };
    return (
        <div className="bg-slate-900/95 border border-slate-700/50 rounded-lg shadow-xl p-3 min-w-[180px] backdrop-blur-md text-slate-100 z-[100]">
            <div className="text-[11px] font-bold text-white mb-2">{d.name}</div>
            <div className="text-[10px] text-slate-400 mb-1.5">{metricLabels[xMetric] || 'Latency'}</div>
            <div className="space-y-1">
                {payload.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 text-[11px]">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: d.fill, opacity: entry.name === 'P50' ? 1 : entry.name === 'P90' ? 0.6 : 0.35 }} />
                            <span className="text-slate-400 font-medium">{entry.name}</span>
                        </div>
                        <span className="font-mono font-bold" style={{ color: d.fill }}>
                            {typeof entry.value === 'number' ? entry.value.toFixed(0) : entry.value} ms
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default function PrefixCacheOffloadingDashboard({ onNavigateBack, onToggleMobileNav }) {
    const [shareToast, setShareToast] = useState(false);

    // Primary Controls State
    const [workloadSize, setWorkloadSize] = useState('50k'); // '30k' | '50k' | '70k'
    const [selectedModel] = useState('qwen3_32b'); // single option; selector rendered as static text
    const [selectedConnector] = useState('all'); // single option; selector rendered as static text
    const [fetchedData, setFetchedData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let active = true;
        fetch('/api/prefix-cache/data')
            .then(res => res.json())
            .then(data => {
                if (active) {
                    // Hide Llama benchmarks and all LMCache benchmarks: not comparable
                    // to the current Qwen HBM/LLM-D-FS runs (different config baselines).
                    const filtered = (data || []).filter(
                        r => r.model !== 'llama_3_3_70b' && r.tech !== 'lm-cache'
                    );
                    setFetchedData(filtered);
                    setIsLoading(false);
                }
            })
            .catch(err => {
                console.error("Failed to load prefix cache reports data:", err);
                if (active) setIsLoading(false);
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!fetchedData || fetchedData.length === 0) return;
        const availableSizes = [...new Set(
            fetchedData
                .filter(r => r.model === selectedModel)
                .map(r => r.workloadSize)
        )];
        if (availableSizes.length > 0 && !availableSizes.includes(workloadSize)) {
            setWorkloadSize(availableSizes[0]);
        }
    }, [selectedModel, fetchedData]);

    const [activeTiers, setActiveTiers] = useState({
        baseline: true,
        cpu: true,
        cpuLustre: true
    });

    // Chart Filters Pattern State
    const [showChartFilters, setShowChartFilters] = useState(true);
    const [visiblePercentiles, setVisiblePercentiles] = useState(['P50', 'P90', 'P99']);
    const [xMetric, setXMetric] = useState('ttft'); // 'ntpot' | 'tpot' | 'ttft' | 'itl' | 'e2e'
    const [yMetric, setYMetric] = useState('output'); // 'output' | 'input' | 'total' | 'qps'

    const handleExportData = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(barChartData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `prefix_cache_telemetry_${workloadSize}_${yMetric}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    };

    const handleShareView = () => {
        navigator.clipboard.writeText(window.location.href);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
    };

    const { barChartData } = useMemo(() => {
        if (!fetchedData || fetchedData.length === 0) {
            return { barChartData: [] };
        }

        const modelRuns = fetchedData.filter(r =>
            r.model === selectedModel &&
            r.workloadSize === workloadSize
        );

        const connFiltered = modelRuns.filter(r => {
            if (r.tech === 'pure-vllm') return true;
            if (selectedConnector === 'all') return true;
            return r.tech === selectedConnector;
        });

        const tierFiltered = connFiltered.filter(r => {
            if (r.tech === 'pure-vllm' && r.setup === 'hbm') return activeTiers.baseline;
            if (r.setup === 'cpu') return activeTiers.cpu;
            if (r.setup === 'cpu-lustre') return activeTiers.cpuLustre;
            return true;
        });

        const getY = (run) => {
            if (yMetric === 'input') return run.inputRate || 0;
            if (yMetric === 'total') return run.totalRate || 0;
            if (yMetric === 'qps') return run.qps || 0;
            return run.throughput;
        };

        const getColor = (r) => {
            if (r.tech === 'pure-vllm' && r.setup === 'hbm') return '#a78bfa';
            if (r.tech === 'lm-cache' && r.setup === 'cpu') return '#fb923c';
            if (r.tech === 'lm-cache' && r.setup === 'cpu-lustre') return '#f472b6';
            if (r.tech === 'llm-d-fs' && r.setup === 'cpu') return '#38bdf8';
            if (r.tech === 'llm-d-fs' && r.setup === 'cpu-lustre') return '#4ade80';
            return '#94a3b8';
        };

        const getName = (r) => {
            if (r.tech === 'pure-vllm' && r.setup === 'hbm') return 'Baseline (HBM)';
            const techLabel = r.tech === 'lm-cache' ? 'LMCache' : 'LLM-D-FS';
            const tierLabel = r.setup === 'cpu-lustre' ? 'CPU + Lustre' : 'CPU';
            return `${techLabel}: ${tierLabel}`;
        };

        const sortOrder = ['pure-vllm:hbm', 'lm-cache:cpu', 'lm-cache:cpu-lustre', 'llm-d-fs:cpu', 'llm-d-fs:cpu-lustre'];
        const sorted = [...tierFiltered].sort((a, b) =>
            sortOrder.indexOf(`${a.tech}:${a.setup}`) - sortOrder.indexOf(`${b.tech}:${b.setup}`)
        );

        const barChartData = sorted.map(r => {
            const latSrc = xMetric === 'e2e' ? r.e2e : r[xMetric];
            return {
                name: getName(r),
                throughput: getY(r),
                latency_p50: (latSrc?.p50 || 0) * 1000,
                latency_p90: (latSrc?.p90 || 0) * 1000,
                latency_p99: (latSrc?.p99 || 0) * 1000,
                fill: getColor(r),
            };
        });

        return { barChartData };
    }, [fetchedData, selectedModel, workloadSize, xMetric, yMetric, selectedConnector, activeTiers]);

    const derivedHeatmapData = useMemo(() => {
        if (!fetchedData || fetchedData.length === 0) return [];

        const sizes = ['30k', '50k', '70k'].filter(size =>
            fetchedData.some(r => r.model === selectedModel && r.workloadSize === size)
        );

        return sizes.map(size => {
            const sizeRuns = fetchedData.filter(r => r.model === selectedModel && r.workloadSize === size);

            const baseline = sizeRuns.find(r => r.tech === 'pure-vllm' && r.setup === 'hbm');
            const lmCpu = sizeRuns.find(r => r.tech === 'lm-cache' && r.setup === 'cpu');
            const fsCpu = sizeRuns.find(r => r.tech === 'llm-d-fs' && r.setup === 'cpu');
            const lmLustre = sizeRuns.find(r => r.tech === 'lm-cache' && r.setup === 'cpu-lustre');
            const fsLustre = sizeRuns.find(r => r.tech === 'llm-d-fs' && r.setup === 'cpu-lustre');

            const refRun = baseline || lmCpu || fsCpu || lmLustre || fsLustre;

            const getValStr = (run) => {
                if (!run) return 'N/A';
                if (run === refRun) {
                    return `${Math.round(run.throughput)} T/s (TTFT ${Math.round(run.ttft.p50)}s)`;
                }
                const tputPct = ((run.throughput - refRun.throughput) / refRun.throughput) * 100;
                return `${Math.round(run.throughput)} T/s (${tputPct >= 0 ? '+' : ''}${Math.round(tputPct)}%)`;
            };

            const getColor = (run, isBest) => {
                if (!run) return 'bg-slate-950/40 text-slate-600';
                if (isBest) return 'bg-emerald-900/40 text-emerald-300 font-bold border border-emerald-500/30';
                return 'bg-slate-900 text-slate-300';
            };

            const candidates = [
                { run: baseline, label: 'Baseline (HBM)' },
                { run: lmCpu, label: 'CPU Offload (LMCache)' },
                { run: fsCpu, label: 'CPU Offload (LLM-D-FS)' },
                { run: lmLustre, label: 'CPU+Lustre (LMCache)' },
                { run: fsLustre, label: 'CPU+Lustre (LLM-D-FS)' }
            ].filter(c => c.run);
            const best = candidates.reduce((acc, c) => (!acc || c.run.throughput > acc.run.throughput) ? c : acc, null);

            return {
                context: size,
                baseline: { value: getValStr(baseline), color: getColor(baseline, best?.run === baseline) },
                lmCpu: { value: getValStr(lmCpu), color: getColor(lmCpu, best?.run === lmCpu) },
                fsCpu: { value: getValStr(fsCpu), color: getColor(fsCpu, best?.run === fsCpu) },
                lmLustre: { value: getValStr(lmLustre), color: getColor(lmLustre, best?.run === lmLustre) },
                fsLustre: { value: getValStr(fsLustre), color: getColor(fsLustre, best?.run === fsLustre) },
                sweetSpot: best ? best.label : 'No data'
            };
        });
    }, [fetchedData, selectedModel]);

    const derivedOutcomesMap = useMemo(() => {
        if (!fetchedData || fetchedData.length === 0) return {};

        const sizes = ['30k', '50k', '70k'];
        const map = {};

        sizes.forEach(size => {
            const sizeRuns = fetchedData.filter(r => r.model === selectedModel && r.workloadSize === size);
            if (sizeRuns.length === 0) return;

            const baseline = sizeRuns.find(r => r.tech === 'pure-vllm' && r.setup === 'hbm');
            const lmCpu = sizeRuns.find(r => r.tech === 'lm-cache' && r.setup === 'cpu');
            const fsCpu = sizeRuns.find(r => r.tech === 'llm-d-fs' && r.setup === 'cpu');
            const lmLustre = sizeRuns.find(r => r.tech === 'lm-cache' && r.setup === 'cpu-lustre');
            const fsLustre = sizeRuns.find(r => r.tech === 'llm-d-fs' && r.setup === 'cpu-lustre');

            const getPct = (run, refRun) => {
                if (!run || !refRun) return 'N/A';
                const pct = ((run.throughput - refRun.throughput) / refRun.throughput) * 100;
                return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
            };

            const getLatencyPct = (run, refRun) => {
                if (!run || !refRun) return 'N/A';
                const pct = ((run.ttft.p50 - refRun.ttft.p50) / refRun.ttft.p50) * 100;
                return `${pct <= 0 ? '' : '+'}${Math.round(pct)}%`;
            };

            map[size] = {
                reference: baseline ? 'vs Baseline (HBM)' : 'vs CPU offload',
                cpu: {
                    throughput: baseline ? getPct(fsCpu, baseline) : getPct(fsCpu, lmCpu),
                    latency: baseline ? getLatencyPct(fsCpu, baseline) : getLatencyPct(fsCpu, lmCpu)
                },
                ssd: {
                    throughput: baseline ? getPct(fsLustre, baseline) : getPct(fsLustre, lmLustre),
                    latency: baseline ? getLatencyPct(fsLustre, baseline) : getLatencyPct(fsLustre, lmLustre)
                }
            };
        });

        return map;
    }, [fetchedData, selectedModel]);

    const activeConfig = useMemo(() => {
        if (!fetchedData || fetchedData.length === 0) {
            return { tp: 8, replicas: 8, gpu: 'H100', engineLabel: 'vLLM', engineVersion: '' };
        }
        
        const run = fetchedData.find(r => r.model === selectedModel && r.workloadSize === workloadSize) 
            || fetchedData.find(r => r.model === selectedModel)
            || fetchedData[0];
            
        return {
            tp: run.tp || 1,
            replicas: run.replicas || 1,
            gpu: run.gpu || 'Unknown',
            engineLabel: run.engineLabel || 'vLLM',
            engineVersion: run.engineVersion || ''
        };
    }, [fetchedData, selectedModel, workloadSize]);


    const xLabels = {
        ntpot: 'Normalized TPOT (ms)',
        tpot: 'Time Per Output Token (ms)',
        ttft: 'Time To First Token (ms)',
        itl: 'Inter-Token Latency (ms)',
        e2e: 'E2E Latency (ms)'
    };

    const yLabels = {
        output: 'Output Tokens/sec',
        input: 'Input Tokens/sec',
        total: 'Total Tokens/sec',
        qps: 'Queries Per Second (QPS)'
    };

    const xAxisLabel = xLabels[xMetric] || 'Latency (ms)';
    const yAxisLabel = yLabels[yMetric] || 'Throughput';

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center w-full">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-sky-500 mb-4"></div>
                <p className="text-slate-400 font-mono text-xs animate-pulse">Loading telemetry database...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center pt-16 md:pl-24 w-full">
            
            {/* Top Navigation Bar */}
            <header className="w-full h-16 border-b border-slate-800 flex justify-between items-center px-6 bg-slate-900 fixed top-0 left-0 right-0 z-[9999]">
                <div className="flex items-center gap-4">
                    <button onClick={onToggleMobileNav} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors md:hidden">
                        <Menu className="h-6 w-6" />
                    </button>

                    {onNavigateBack && (
                        <button onClick={onNavigateBack} className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                            <ArrowLeft className="h-5 w-5" />
                        </button>
                    )}

                    <div className="flex items-center gap-2.5 border-r border-slate-500 pr-4">
                        <img src="https://llm-d.ai/img/llm-d-logotype-and-icon.png" alt="llm-d Logo" className="h-6 object-contain" />
                        <span className="text-lg font-bold tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 hidden sm:inline">
                            Prism
                        </span>
                    </div>

                    <div className="flex items-center">
                        <h1 className="text-sm sm:text-lg font-bold text-white tracking-wide truncate">Prefix cache offloading</h1>
                        <span className="ml-3 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hidden sm:inline">
                            Guided path
                        </span>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    <a
                        href="https://llm-d.ai/docs/community"
                        target="_blank"
                        rel="noreferrer"
                        className="px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors flex items-center border border-slate-700 cursor-pointer"
                        title="Contact us"
                    >
                        <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
                        <span className="hidden sm:inline">Contact us</span>
                    </a>

                    <button onClick={handleShareView} className="px-3.5 py-1.5 text-xs font-medium rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors flex items-center border border-slate-700 relative cursor-pointer">
                        <Share2 className="w-3.5 h-3.5 mr-1.5" />
                        <span>Share link</span>
                        {shareToast && (
                            <div className="absolute -bottom-10 right-0 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg z-50 whitespace-nowrap animate-in fade-in duration-200">
                                Link copied!
                            </div>
                        )}
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="w-full max-w-7xl px-6 py-8 flex flex-col space-y-6">
                
                {/* ROW 1: Description & Active Config (Aligned with Inference Scheduling) */}
                <div className="relative overflow-hidden border border-slate-800/80 rounded-2xl bg-gradient-to-br from-slate-900/90 via-slate-900/50 to-slate-950/90 p-5 shadow-2xl backdrop-blur-xl group transition-all duration-500 hover:border-sky-500/30">
                    <div className="absolute -top-24 -right-24 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl group-hover:bg-sky-500/20 transition-all duration-700 pointer-events-none" />
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
                        {/* Col 1: Overview */}
                        <div className="flex flex-col justify-between space-y-3">
                            <div>
                                <div className="text-[10px] font-extrabold text-cyan-400 uppercase tracking-widest mb-2">Overview</div>
                                <p className="text-xs text-slate-300 leading-relaxed">
                                    Evaluates dynamic capacity and saturation boundaries under Tiered Prefix Caching. 
                                    Unlike standard metrics that show static averages, these telemetry charts expose the exact load stage 
                                    where native HBM VRAM hits the <strong>"Memory Wall" (OOM)</strong> on long contexts, proving how offloading to Host CPU RAM 
                                    and CPU + Lustre storage extends serving capacity without latency degradation.
                                </p>
                            </div>
                        </div>

                        {/* Col 2: Selectable Optimizations (Active Overlays) */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-extrabold text-cyan-400/90 uppercase tracking-widest mb-1">
                                Selectable optimizations
                            </div>

                            {/* Baseline (HBM Only) */}
                            <button
                                onClick={() => setActiveTiers(prev => ({ ...prev, baseline: !prev.baseline }))}
                                className={`w-full text-left border rounded-lg p-2 flex items-center justify-between transition-all cursor-pointer ${
                                    activeTiers.baseline
                                        ? 'border-violet-500/30 bg-slate-900/60'
                                        : 'border-slate-800/50 bg-slate-900/20 opacity-60'
                                }`}
                            >
                                <div>
                                    <div className="text-xs font-semibold text-slate-200">Baseline (HBM only)</div>
                                    <p className="text-[10px] text-slate-500">Native HBM VRAM without offloading</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    {activeTiers.baseline ? (
                                        <span className="text-[9px] bg-violet-500/20 text-violet-300 border border-violet-500/40 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider select-none">Active</span>
                                    ) : (
                                        <span className="text-[9px] bg-slate-800 text-slate-500 border border-slate-700 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider select-none">Inactive</span>
                                    )}
                                </div>
                            </button>

                            {/* CPU Offloading */}
                            <button 
                                onClick={() => setActiveTiers(prev => ({ ...prev, cpu: !prev.cpu }))}
                                className={`w-full text-left border rounded-lg p-2 flex items-center justify-between transition-all cursor-pointer ${
                                    activeTiers.cpu 
                                        ? 'border-sky-500/30 bg-slate-900/60' 
                                        : 'border-slate-800/50 bg-slate-900/20 opacity-60'
                                }`}
                            >
                                <div>
                                    <div className="text-xs font-semibold text-slate-200">CPU Offloading (LLM-D-FS)</div>
                                    <p className="text-[10px] text-slate-500">Host CPU RAM offload via FS connector</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <a 
                                        href="https://llm-d.ai/docs/guides/tiered-prefix-cache" 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        onClick={e => e.stopPropagation()}
                                        className="text-slate-500 hover:text-slate-300 transition-colors flex items-center space-x-1"
                                    >
                                        <span className="text-[10px]">Guide</span>
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                    {activeTiers.cpu ? (
                                        <span className="text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider select-none">Active</span>
                                    ) : (
                                        <span className="text-[9px] bg-slate-800 text-slate-500 border border-slate-700 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider select-none">Inactive</span>
                                    )}
                                </div>
                            </button>

                            {/* CPU + Lustre */}
                            <button 
                                onClick={() => setActiveTiers(prev => ({ ...prev, cpuLustre: !prev.cpuLustre }))}
                                className={`w-full text-left border rounded-lg p-2 flex items-center justify-between transition-all cursor-pointer ${
                                    activeTiers.cpuLustre 
                                        ? 'border-emerald-500/30 bg-slate-900/60' 
                                        : 'border-slate-800/50 bg-slate-900/20 opacity-60'
                                }`}
                            >
                                <div>
                                    <div className="text-xs font-semibold text-slate-200">CPU + Lustre Offloading</div>
                                    <p className="text-[10px] text-slate-500">Multi-connector offload to Lustre storage</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <a
                                        href="https://llm-d.ai/docs/well-lit-paths/tiered-prefix-cache"
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="text-slate-500 hover:text-slate-300 transition-colors flex items-center space-x-1"
                                    >
                                        <span className="text-[10px]">Guide</span>
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                    {activeTiers.cpuLustre ? (
                                        <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider select-none">Active</span>
                                    ) : (
                                        <span className="text-[9px] bg-slate-800 text-slate-500 border border-slate-700 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider select-none">Inactive</span>
                                    )}
                                </div>
                            </button>
                        </div>

                        {/* Col 3: Upcoming / Contribute */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">
                                <span>Upcoming & roadmap</span>
                            </div>

                            {/* Opt 3: Local SSD */}
                            <div className="border border-slate-800/50 rounded-lg bg-slate-900/30 p-2 flex items-center justify-between">
                                <div>
                                    <div className="text-xs font-semibold text-slate-400">Tiered cache: local SSD</div>
                                    <p className="text-[10px] text-slate-500">Direct persistent NVMe offloading</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <a href="https://github.com/lmcache/lmcache" target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-300 transition-colors flex items-center space-x-1">
                                        <span className="text-[10px]">Specs</span>
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                    <span className="text-[9px] font-extrabold text-amber-600/70 uppercase tracking-widest border border-amber-600/30 px-1.5 py-0.5 rounded">Coming soon</span>
                                </div>
                            </div>

                            {/* Opt 4: Cloud Storage */}
                            <div className="border border-slate-800/50 rounded-lg bg-slate-900/30 p-2 flex items-center justify-between">
                                <div>
                                    <div className="text-xs font-semibold text-slate-400">Cloud storage rapid cache</div>
                                    <p className="text-[10px] text-slate-500">GCS / Object storage remote layer</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <a href="https://www.coreweave.com/news/coreweave-unveils-ai-object-storage-redefining-how-ai-workloads-access-and-scale-data" target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-300 transition-colors flex items-center space-x-1">
                                        <span className="text-[10px]">Specs</span>
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                    <span className="text-[9px] font-extrabold text-amber-600/70 uppercase tracking-widest border border-amber-600/30 px-1.5 py-0.5 rounded">Coming soon</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ROW 2: Benchmark Scenario, Primary Outcomes & Action */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* CARD 1: Benchmark Scenario */}
                    <div className="lg:col-span-6 border border-slate-800/80 rounded-xl bg-gradient-to-br from-slate-900 to-slate-950 p-4 flex flex-col justify-between shadow-lg relative overflow-hidden">
                        <div className="absolute -top-12 -left-12 w-32 h-32 bg-sky-500/5 rounded-full blur-2xl pointer-events-none" />

                        <div className="mb-3 flex justify-between items-center">
                            <span className="text-[11px] font-extrabold text-sky-400/90 uppercase tracking-widest block">
                                Benchmark scenario
                            </span>
                        </div>

                        <div className="grid grid-cols-12 gap-2">
                            {/* Column 1: Infra Layer (col-span-4) */}
                            <div className="flex flex-col gap-3 col-span-4 border-r border-slate-800/60 pr-2">
                                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider truncate">
                                    Infra layer
                                </div>
                                <div className="flex flex-col gap-2 text-xs">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Provider / machine</span>
                                        <span className="font-mono font-bold text-white truncate flex items-center gap-1.5">
                                            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                            </svg>
                                            {getMachineType(activeConfig.gpu)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Accelerator</span>
                                        <span className="font-mono font-bold text-white truncate block">{activeConfig.gpu}</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Replicas</span>
                                        <span className="font-mono font-bold text-white truncate block">{activeConfig.replicas}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Column 2: Model Serving Layer (col-span-4) */}
                            <div className="flex flex-col gap-3 col-span-4 border-r border-slate-800/60 pr-2">
                                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider truncate">
                                    Model serving
                                </div>
                                <div className="flex flex-col gap-2 text-xs">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Model name</span>
                                        <span className="font-mono font-bold text-white truncate block">Qwen3-32B</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Strategy</span>
                                        <span className="font-mono font-bold text-white truncate block">TP: {activeConfig.tp}</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Engine</span>
                                        <span className="font-mono font-bold text-white truncate block">{activeConfig.engineLabel} ({activeConfig.engineVersion ? activeConfig.engineVersion.split('/').pop() : ''})</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Plugin connector</span>
                                        <span className="font-mono font-bold text-white truncate block">llm-d-fs</span>
                                    </div>
                                </div>
                            </div>


                            {/* Column 3: Workload (col-span-4) */}
                            <div className="flex flex-col gap-3 col-span-4">
                                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider truncate">
                                    Workload
                                </div>
                                <div className="flex flex-col gap-2 text-xs">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Test harness</span>
                                        <span className="font-mono font-bold text-white truncate block">inference-perf</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Use case</span>
                                        <span className="font-mono font-bold text-white truncate block">Shared Prefix</span>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] text-slate-500 font-semibold mb-0.5 truncate">Context length</span>
                                        <span className="font-mono font-bold text-white truncate block">{workloadSize} tokens</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CARD 2: Primary Outcomes */}
                    <div className="lg:col-span-3 border border-slate-800 rounded-xl bg-slate-900 p-4 flex flex-col justify-between shadow-lg relative overflow-hidden group hover:border-emerald-500/30 transition-all">
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none transition-all group-hover:bg-emerald-500/10" />
                        <div>
                            <div className="text-[11px] font-extrabold text-emerald-400/90 uppercase tracking-widest mb-1 flex justify-between items-center">
                                Primary outcomes
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        document.getElementById('summary-table')?.scrollIntoView({ behavior: 'smooth' });
                                    }}
                                    className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer normal-case font-semibold"
                                >
                                    View table
                                </button>
                            </div>
                            {derivedOutcomesMap[workloadSize]?.reference && (
                                <p className="text-[10px] text-slate-500 mb-3">{derivedOutcomesMap[workloadSize].reference}</p>
                            )}
                            {(() => {
                                const activeOpts = [];
                                if (activeTiers.cpu) activeOpts.push({ id: 'cpu', label: 'CPU RAM', colorClass: 'text-sky-400', hoverBorderClass: 'hover:border-sky-500/20' });
                                if (activeTiers.cpuLustre) activeOpts.push({ id: 'ssd', label: 'CPU+Lustre', colorClass: 'text-emerald-400', hoverBorderClass: 'hover:border-emerald-500/20' });

                                if (activeOpts.length === 0) {
                                    return (
                                        <div className="h-full flex flex-col justify-center items-center text-slate-500 text-center py-6">
                                            <p className="text-xs">No optimizations selected</p>
                                            <p className="text-[10px] text-slate-650 mt-1">Enable optimizations in the sidebar to compare performance.</p>
                                        </div>
                                    );
                                }

                                if (activeOpts.length === 1) {
                                    const opt = activeOpts[0];
                                    const outcomes = derivedOutcomesMap[workloadSize]?.[opt.id] || { throughput: 'N/A', latency: 'N/A' };
                                    return (
                                        <div className="grid grid-cols-1 gap-2 font-sans text-xs">
                                            {/* Throughput Box */}
                                            <div className={`bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 flex justify-between items-center transition-all ${opt.hoverBorderClass}`}>
                                                <div>
                                                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-0.5 truncate">
                                                        Throughput increase
                                                    </h3>
                                                    <div className="text-[10px] text-slate-500 font-normal uppercase truncate">
                                                        (output tokens/sec)
                                                    </div>
                                                </div>
                                                <h4 className={`text-base font-black font-mono ${outcomes.throughput === 'OOM' ? 'text-red-500' : opt.colorClass}`}>
                                                    {outcomes.throughput}
                                                </h4>
                                            </div>

                                            {/* Latency Box */}
                                            <div className={`bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 flex justify-between items-center transition-all ${opt.hoverBorderClass}`}>
                                                <div>
                                                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-0.5 truncate">
                                                        Latency reduction
                                                    </h3>
                                                    <div className="text-[10px] text-slate-500 font-normal uppercase truncate">
                                                        (TTFT P50)
                                                    </div>
                                                </div>
                                                <h4 className={`text-base font-black font-mono ${outcomes.latency === 'OOM' ? 'text-red-500' : 'text-amber-400'}`}>
                                                    {outcomes.latency}
                                                </h4>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="flex flex-col space-y-3 font-sans text-xs pt-1">
                                        {/* Throughput section */}
                                        <div className="space-y-1.5">
                                            <div className="flex justify-between items-center text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                                                <span>Throughput increase</span>
                                                <span className="text-[8px] text-slate-500 lowercase font-normal">(output tokens/sec)</span>
                                            </div>
                                            <div className={`grid gap-2 ${activeOpts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                                {activeOpts.map(opt => {
                                                    const outcomes = derivedOutcomesMap[workloadSize]?.[opt.id] || { throughput: 'N/A' };
                                                    return (
                                                        <div key={opt.id} className={`bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 flex flex-col justify-center items-center transition-all ${opt.hoverBorderClass}`}>
                                                            <h4 className={`text-base font-black font-mono ${outcomes.throughput === 'OOM' ? 'text-red-500' : opt.colorClass}`}>
                                                                {outcomes.throughput}
                                                            </h4>
                                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5 truncate max-w-full">
                                                                {opt.label}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Latency section */}
                                        <div className="space-y-1.5">
                                            <div className="flex justify-between items-center text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                                                <span>Latency reduction</span>
                                                <span className="text-[8px] text-slate-500 lowercase font-normal">(TTFT P50)</span>
                                            </div>
                                            <div className={`grid gap-2 ${activeOpts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                                {activeOpts.map(opt => {
                                                    const outcomes = derivedOutcomesMap[workloadSize]?.[opt.id] || { latency: 'N/A' };
                                                    return (
                                                        <div key={opt.id} className={`bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5 flex flex-col justify-center items-center transition-all ${opt.hoverBorderClass}`}>
                                                            <h4 className={`text-base font-black font-mono ${outcomes.latency === 'OOM' ? 'text-red-500' : 'text-amber-400'}`}>
                                                                {outcomes.latency}
                                                            </h4>
                                                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5 truncate max-w-full">
                                                                {opt.label}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* CARD 3: Action */}
                    <div className="lg:col-span-3 border border-slate-800 rounded-xl bg-slate-900 p-4 flex flex-col justify-between shadow-lg relative overflow-hidden">
                        <div>
                            <p className="text-[11px] font-extrabold text-cyan-400 uppercase tracking-widest mb-2">
                                Action
                            </p>
                            <h3 className="text-base font-bold text-white mb-1 truncate">
                                Reproducibility guide
                            </h3>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Replicate these tiered caching benchmarks on your hardware.
                            </p>
                        </div>

                        <a 
                            href="https://llm-d.ai/docs/guides/tiered-prefix-cache"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full mt-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs rounded-lg shadow transition-all flex items-center justify-center gap-1.5 truncate cursor-pointer no-underline"
                        >
                            <span>View instructions</span>
                            <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
                        </a>
                    </div>
                </div>

                {/* Detailed Interactive Chart Container (Inference Scheduling Pattern) */}
                <div id="detailed-chart" className="bg-slate-900/80 border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col w-full min-h-[550px] overflow-visible backdrop-blur-sm relative">
                    <div className="flex flex-col w-full h-full">
                        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/80 flex justify-between items-start gap-6 shadow-sm">
                            <div className="flex flex-col gap-2.5">
                                <h3 className="text-lg font-bold text-white">
                                    Performance by Configuration
                                </h3>
                                
                                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px]">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-slate-500 font-semibold">Infra:</span>
                                        <div className="flex items-center gap-1.5 font-mono font-bold text-slate-200">
                                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                            </svg>
                                            <span>{getMachineType(activeConfig.gpu)}</span>
                                            <span>{activeConfig.gpu}</span>
                                            <span className="text-slate-400">({activeConfig.replicas} replicas)</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-slate-500 font-semibold">Model:</span>
                                        <div className="font-mono text-slate-200">
                                            <span className="font-bold">{selectedModel === 'llama_3_3_70b' ? 'Llama-3.3-70B' : 'Qwen3-32B'}</span>
                                            <span className="text-slate-400">{selectedModel === 'llama_3_3_70b' ? ' (FP8)' : ' (BF16)'}</span>
                                            <span className="mx-1">•</span>
                                            <span className="font-bold">{activeConfig.engineLabel} ({activeConfig.engineVersion ? activeConfig.engineVersion.split('/').pop() : ''})</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-slate-500 font-semibold">Prompt:</span>
                                        <div className="font-mono font-bold text-cyan-400">
                                            {workloadSize} Tokens
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={handleExportData} 
                                    title="Export Raw Telemetry JSON"
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-all text-[10px] font-extrabold uppercase tracking-widest border border-slate-700/50 cursor-pointer"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Export</span>
                                </button>
                                <button 
                                    onClick={() => setShowChartFilters(!showChartFilters)} 
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-all text-[10px] font-extrabold uppercase tracking-widest border border-slate-700/50 cursor-pointer"
                                >
                                    Filters
                                    {showChartFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                        </div>

                        {showChartFilters && (
                            <div className="bg-slate-800/40 border-b border-slate-700/50 px-6 py-3 flex items-center overflow-hidden">
                                <div className="flex items-center gap-4">
                                    <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest shrink-0">Throughput:</span>
                                    <div className="flex items-center bg-slate-900/50 border border-slate-700/50 rounded-lg p-0.5 gap-0.5 whitespace-nowrap">
                                        {[
                                            { id: 'output', label: 'Output' },
                                            { id: 'input', label: 'Input' },
                                            { id: 'total', label: 'Total' },
                                            { id: 'qps', label: 'QPS' },
                                        ].map(metric => (
                                            <button
                                                key={metric.id}
                                                onClick={() => setYMetric(metric.id)}
                                                className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer shrink-0 ${
                                                    yMetric === metric.id
                                                        ? 'bg-indigo-600 text-white shadow'
                                                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                                }`}
                                            >
                                                {metric.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="bg-slate-950/30 rounded-xl p-4 border border-slate-800/40 my-4 select-none overflow-hidden">
                            {/* Throughput Bar Chart */}
                            <div className="mb-2">
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2">
                                    {yAxisLabel}
                                </h4>
                                <div className="relative w-full h-[280px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={barChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }} barCategoryGap="25%">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} vertical={false} />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                                                axisLine={{ stroke: '#334155' }}
                                                tickLine={false}
                                                interval={0}
                                            />
                                            <YAxis
                                                tick={{ fill: '#64748b', fontSize: 10 }}
                                                axisLine={{ stroke: '#334155' }}
                                                tickLine={false}
                                                width={60}
                                            />
                                            <Tooltip
                                                isAnimationActive={false}
                                                content={<ThroughputBarTooltip yMetric={yMetric} />}
                                                wrapperStyle={{ outline: 'none', zIndex: 100 }}
                                                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                                            />
                                            <Bar dataKey="throughput" radius={[6, 6, 0, 0]} maxBarSize={80} isAnimationActive={false}>
                                                {barChartData.map((entry, index) => (
                                                    <Cell key={index} fill={entry.fill} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Latency Bar Chart */}
                            <div className="mt-6">
                                {/* Latency chart controls */}
                                {showChartFilters && (
                                    <div className="bg-slate-800/40 border-y border-slate-700/50 px-6 py-3 mb-4 -mx-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                                        <div className="flex items-center gap-4">
                                            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest shrink-0">Latency:</span>
                                            <div className="flex items-center bg-slate-900/50 border border-slate-700/50 rounded-lg p-0.5 gap-0.5 whitespace-nowrap overflow-x-auto no-scrollbar">
                                                {[
                                                    { id: 'ntpot', label: 'NTPOT' },
                                                    { id: 'tpot', label: 'TPOT' },
                                                    { id: 'ttft', label: 'TTFT' },
                                                    { id: 'itl', label: 'ITL' },
                                                    { id: 'e2e', label: 'E2E Latency' },
                                                ].map(mode => (
                                                    <button
                                                        key={mode.id}
                                                        onClick={() => setXMetric(mode.id)}
                                                        className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer shrink-0 ${
                                                            xMetric === mode.id
                                                                ? 'bg-teal-600 text-white shadow-sm'
                                                                : 'text-slate-400 hover:text-slate-250 hover:bg-slate-900'
                                                        }`}
                                                    >
                                                        {mode.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 ml-auto">
                                            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest shrink-0">Percentiles:</span>
                                            <div className="flex items-center gap-0.5 bg-slate-900/50 border border-slate-700/50 rounded-lg p-0.5 shrink-0">
                                                {['P50', 'P90', 'P99'].map(p => (
                                                    <button
                                                        key={p}
                                                        onClick={() => setVisiblePercentiles(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                                                        className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer ${visiblePercentiles.includes(p) ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                                    >
                                                        {p}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2">
                                    {xAxisLabel}
                                </h4>
                                <div className="relative w-full h-[250px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={barChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }} barCategoryGap="25%">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} vertical={false} />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                                                axisLine={{ stroke: '#334155' }}
                                                tickLine={false}
                                                interval={0}
                                            />
                                            <YAxis
                                                tick={{ fill: '#64748b', fontSize: 10 }}
                                                axisLine={{ stroke: '#334155' }}
                                                tickLine={false}
                                                width={60}
                                                unit=" ms"
                                            />
                                            <Tooltip
                                                isAnimationActive={false}
                                                content={<LatencyBarTooltip xMetric={xMetric} />}
                                                wrapperStyle={{ outline: 'none', zIndex: 100 }}
                                                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                                            />
                                            <Bar dataKey="latency_p50" name="P50" radius={[6, 6, 0, 0]} maxBarSize={50} isAnimationActive={false} hide={!visiblePercentiles.includes('P50')}>
                                                {barChartData.map((entry, index) => (
                                                    <Cell key={index} fill={entry.fill} fillOpacity={1} />
                                                ))}
                                            </Bar>
                                            <Bar dataKey="latency_p90" name="P90" radius={[6, 6, 0, 0]} maxBarSize={50} isAnimationActive={false} hide={!visiblePercentiles.includes('P90')}>
                                                {barChartData.map((entry, index) => (
                                                    <Cell key={index} fill={entry.fill} fillOpacity={0.6} />
                                                ))}
                                            </Bar>
                                            <Bar dataKey="latency_p99" name="P99" radius={[6, 6, 0, 0]} maxBarSize={50} isAnimationActive={false} hide={!visiblePercentiles.includes('P99')}>
                                                {barChartData.map((entry, index) => (
                                                    <Cell key={index} fill={entry.fill} fillOpacity={0.35} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Legend */}
                            <div className="mt-4 border-t border-slate-700/50 pt-4 px-2">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        Legend
                                    </h4>
                                </div>
                                <div className="flex flex-wrap gap-x-6 gap-y-3">
                                    {barChartData.map(entry => (
                                        <div key={entry.name} className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded-md shrink-0" style={{ backgroundColor: entry.fill }} />
                                            <span className="text-[11px] font-semibold text-slate-300">{entry.name}</span>
                                        </div>
                                    ))}
                                </div>
                                {visiblePercentiles.length > 0 && (
                                    <div className="flex items-center gap-4 mt-3 pt-2 border-t border-slate-800/40">
                                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">Latency bars:</span>
                                        {[
                                            { p: 'P50', opacity: 1 },
                                            { p: 'P90', opacity: 0.6 },
                                            { p: 'P99', opacity: 0.35 }
                                        ].filter(item => visiblePercentiles.includes(item.p)).map(item => (
                                            <div key={item.p} className="flex items-center gap-1.5">
                                                <div className="w-4 h-3 rounded-sm bg-slate-400" style={{ opacity: item.opacity }} />
                                                <span className="text-[10px] font-semibold text-slate-400">{item.p}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Secondary View: Context Length vs Storage Tier Heatmap (Deploy Planner) */}
                <div id="summary-table" className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
                    <div className="p-5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-4">
                        <div>
                            <h3 className="text-base font-bold text-white flex items-center gap-2">
                                <HardDrive className="w-4 h-4 text-cyan-400" />
                                <span>Summary metrics comparison</span>
                            </h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Comparing Tiered Cache offloading architectures side-by-side across prompt sizes.
                            </p>
                        </div>

                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-950 text-slate-400 font-mono border-b border-slate-800 uppercase tracking-wider text-[10px]">
                                    <th className="p-4">Context scale</th>
                                    <th className="p-4">Baseline (HBM)</th>
                                    <th className="p-4">LLM-D-FS: CPU</th>
                                    <th className="p-4">LLM-D-FS: CPU + Lustre</th>
                                    <th className="p-4 bg-slate-950/50">Recommended setup</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-medium font-mono">
                                {derivedHeatmapData.map((row, idx) => {
                                    const isCurrent = workloadSize === row.context;
                                    return (
                                        <tr 
                                            key={idx} 
                                            onClick={() => setWorkloadSize(row.context)}
                                            className={`hover:bg-slate-800/30 transition-colors cursor-pointer ${
                                                isCurrent ? 'bg-slate-800/70' : ''
                                            }`}
                                        >
                                            <td className="p-4 text-white font-sans flex items-center gap-2">
                                                <span>{row.context} Tokens</span>
                                                {isCurrent && <span className="text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-1.5 py-0.5 rounded font-sans font-black uppercase tracking-wider">Active</span>}
                                            </td>
                                            <td className={`p-4 font-mono ${row.baseline.color}`}>{row.baseline.value}</td>
                                            <td className={`p-4 font-mono ${row.fsCpu.color}`}>{row.fsCpu.value}</td>
                                            <td className={`p-4 font-mono ${row.fsLustre.color}`}>{row.fsLustre.value}</td>
                                            <td className="p-4 bg-slate-950/30 text-white font-sans flex items-center gap-1.5">
                                                <Check className="w-4 h-4 text-emerald-400" /> {row.sweetSpot}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

            </main>


        </div>
    );
}
