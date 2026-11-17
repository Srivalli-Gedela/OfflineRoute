import React, { useState, useEffect } from 'react';
import {
  Activity,
  Wifi,
  WifiOff,
  Clock,
  Database,
  ArrowRightLeft,
  Server,
  ShieldCheck,
  AlertOctagon,
  Layers,
  Zap,
  Info,
  TrendingDown,
  Gauge
} from 'lucide-react';
import { networkManager } from '../services/cnNetworkManager.js';

export default function CNDashboard() {
  const [telemetry, setTelemetry] = useState({
    isOnline: networkManager.getEffectiveOnlineStatus(),
    simulatedMode: networkManager.simulatedMode,
    stats: networkManager.stats,
    logs: networkManager.requestLogs,
    pendingSyncCount: networkManager.pendingSyncCount
  });

  const [activeTab, setActiveTab] = useState('telemetry'); // 'telemetry' | 'comparison' | 'protocols'

  useEffect(() => {
    const unsubscribe = networkManager.subscribe((data) => {
      setTelemetry(data);
    });
    return () => unsubscribe();
  }, []);

  const handleModeChange = (mode) => {
    networkManager.setSimulatedMode(mode);
  };

  const stats = telemetry.stats;
  const total = stats.totalRequests || 1;
  const cacheHitPct = Math.round(((stats.cacheHits || 0) / total) * 100);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-5">
      {/* Dashboard Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">CN Network Telemetry & Inspector</h3>
            <p className="text-xs text-slate-400">
              HTTP/1.1 Caching • TCP Latency • Intermittent Connectivity Simulation
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-800/80 p-1 rounded-lg border border-slate-700/80">
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab === 'telemetry' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Live Stream
          </button>
          <button
            onClick={() => setActiveTab('comparison')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab === 'comparison' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Performance Comparison
          </button>
          <button
            onClick={() => setActiveTab('protocols')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab === 'protocols' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            CN Protocol Docs
          </button>
        </div>
      </div>

      {/* Network Simulator Controls */}
      <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Network Environment Simulation
          </span>
          <span className="text-xs text-slate-400 font-mono">
            Status: {telemetry.isOnline ? '🟢 Connected' : '🔴 Disconnected'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => handleModeChange('normal')}
            className={`p-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${
              telemetry.simulatedMode === 'normal'
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
            }`}
          >
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span>Normal (Fast)</span>
            <span className="text-[10px] text-slate-400 font-mono">0ms delay • 0% drop</span>
          </button>

          <button
            onClick={() => handleModeChange('slow3g')}
            className={`p-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${
              telemetry.simulatedMode === 'slow3g'
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
            }`}
          >
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Slow 3G / Satellite</span>
            <span className="text-[10px] text-slate-400 font-mono">+650ms RTT</span>
          </button>

          <button
            onClick={() => handleModeChange('flaky')}
            className={`p-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${
              telemetry.simulatedMode === 'flaky'
                ? 'bg-orange-500/20 border-orange-500/50 text-orange-300 shadow-sm'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
            }`}
          >
            <ArrowRightLeft className="w-4 h-4 text-orange-400" />
            <span>Flaky Network</span>
            <span className="text-[10px] text-slate-400 font-mono">35% Packet Loss</span>
          </button>

          <button
            onClick={() => handleModeChange('offline')}
            className={`p-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${
              telemetry.simulatedMode === 'offline'
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-sm'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
            }`}
          >
            <WifiOff className="w-4 h-4 text-rose-400" />
            <span>Simulate Offline</span>
            <span className="text-[10px] text-slate-400 font-mono">100% Disconnected</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Live Request Stream */}
      {activeTab === 'telemetry' && (
        <div className="flex flex-col gap-3">
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 flex flex-col">
              <span className="text-[11px] text-slate-400">Total HTTP Requests</span>
              <span className="text-lg font-bold text-white font-mono mt-0.5">{stats.totalRequests}</span>
            </div>

            <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 flex flex-col">
              <span className="text-[11px] text-slate-400">HTTP 304 Revalidations</span>
              <span className="text-lg font-bold text-emerald-400 font-mono mt-0.5">{stats.conditional304s}</span>
            </div>

            <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 flex flex-col">
              <span className="text-[11px] text-slate-400">Bandwidth Saved</span>
              <span className="text-lg font-bold text-cyan-400 font-mono mt-0.5">
                {(stats.totalBytesSaved / 1024).toFixed(1)} KB
              </span>
            </div>

            <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 flex flex-col">
              <span className="text-[11px] text-slate-400">Average RTT Latency</span>
              <span className="text-lg font-bold text-indigo-400 font-mono mt-0.5">{stats.avgLatencyMs} ms</span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border border-slate-800 rounded-xl max-h-72">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/90 text-slate-400 uppercase tracking-wider text-[10px] font-semibold sticky top-0 border-b border-slate-700">
                <tr>
                  <th className="py-2.5 px-3">Method & URL</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Cache State</th>
                  <th className="py-2.5 px-3">Latency Breakdown</th>
                  <th className="py-2.5 px-3">Data Transfer</th>
                  <th className="py-2.5 px-3">ETag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/50">
                {telemetry.logs.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-6 text-center text-slate-500">
                      No network transactions recorded yet. Search or calculate a route to observe traffic!
                    </td>
                  </tr>
                ) : (
                  telemetry.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className={`px-1 rounded text-[10px] font-bold ${
                            log.method === 'GET' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {log.method}
                          </span>
                          <span className="truncate max-w-[140px] text-slate-200" title={log.url}>{log.url}</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                          log.status === 200
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : log.status === 304
                            ? 'bg-cyan-500/20 text-cyan-400'
                            : log.status === 0
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {log.status === 0 ? 'OFFLINE' : `${log.status} ${log.statusText || ''}`}
                        </span>
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="text-[11px] font-medium text-slate-300">
                          {log.cacheStatus}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        <div className="flex items-center gap-1 text-slate-200">
                          <strong className="text-white">{log.latencyMs}ms</strong>
                          <span className="text-[10px] text-slate-500">
                            (DNS {log.dnsMs} • TCP {log.tcpHandshakeMs} • TTFB {log.ttfbMs})
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {log.bytesSaved > 0 ? (
                          <span className="text-emerald-400 font-semibold" title={`Transferred ${log.bytesTransferred}B`}>
                            +{log.bytesSaved}B Saved!
                          </span>
                        ) : (
                          <span className="text-slate-400">{log.bytesTransferred} bytes</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400">
                        {log.etag ? (
                          <span className="truncate max-w-[80px] inline-block" title={log.etag}>
                            {log.etag}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Performance Comparison */}
      {activeTab === 'comparison' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Latency Comparison Card */}
            <div className="p-4 bg-slate-800/70 border border-slate-700/60 rounded-xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Gauge className="w-4 h-4 text-emerald-400" />
                  Latency Comparison: Uncached vs Cached
                </span>
                <span className="text-[10px] font-mono text-emerald-400">~98% Faster</span>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Uncached Network Request (DNS + TCP + TTFB)</span>
                    <span className="font-mono text-white">~180ms</span>
                  </div>
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                    <div className="bg-rose-500 h-full w-[90%]" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>HTTP 304 Conditional GET (Header Only)</span>
                    <span className="font-mono text-cyan-300">~22ms</span>
                  </div>
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                    <div className="bg-cyan-500 h-full w-[15%]" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Offline IndexedDB / Local Cache Hit</span>
                    <span className="font-mono text-emerald-400">0 - 2ms</span>
                  </div>
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full w-[2%]" />
                  </div>
                </div>
              </div>
            </div>

            {/* Bandwidth Savings Card */}
            <div className="p-4 bg-slate-800/70 border border-slate-700/60 rounded-xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-cyan-400" />
                  Data Usage & Network Traffic Reduction
                </span>
                <span className="text-[10px] font-mono text-cyan-400">High Efficiency</span>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Full Road Graph Payload (Uncached 200 OK)</span>
                    <span className="font-mono text-white">45.0 KB</span>
                  </div>
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                    <div className="bg-amber-500 h-full w-[95%]" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Conditional GET (HTTP 304 Not Modified)</span>
                    <span className="font-mono text-emerald-300">0.18 KB</span>
                  </div>
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full w-[2%]" />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Offline Client A* Path Calculation</span>
                    <span className="font-mono text-emerald-400">0.00 KB (0 packets)</span>
                  </div>
                  <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full w-[0%]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CN Protocols Explained */}
      {activeTab === 'protocols' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold">
              <Zap className="w-4 h-4" />
              <span>1. HTTP Caching (RFC 7232)</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              When a client requests a route or region, the server computes an <strong>ETag</strong> (entity tag digest). On subsequent queries, the client transmits an <code className="text-indigo-300">If-None-Match</code> header. If unchanged, the server returns <strong className="text-emerald-400">HTTP 304 Not Modified</strong> with an empty body, saving 99% of bandwidth.
            </p>
          </div>

          <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold">
              <ArrowRightLeft className="w-4 h-4" />
              <span>2. TCP & Resilience</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Demonstrates connection handshakes, round-trip times (RTT), and intermittent socket dropouts. When packets drop or times out, the client falls back seamlessly to the locally downloaded road graph stored in <strong>IndexedDB</strong> and queues actions for eventual consistency.
            </p>
          </div>

          <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <Server className="w-4 h-4" />
              <span>3. Edge-First Hybrid Routing</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Unlike traditional mapping systems that fail completely when connectivity drops, OfflineRoute implements a hybrid architecture: online server OSRM calculation when connected, and client-side <strong>A* pathfinding</strong> directly in JavaScript when offline.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
