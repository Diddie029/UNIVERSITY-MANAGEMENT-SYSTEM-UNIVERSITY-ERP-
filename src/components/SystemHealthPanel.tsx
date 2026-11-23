import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDocFromServer } from 'firebase/firestore';
import {
  Activity,
  Cpu,
  Database,
  Download,
  FileJson,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import firebaseConfig from '../../firebase-applet-config.json';
import { ErpDataset } from '../hooks/useErpData';
import { db } from '../lib/firebase';
import { exportToCSV } from '../lib/pdfGenerator';
import { useToast } from './Toast';

interface ServerMetrics {
  status: string;
  service: string;
  timestamp: string;
  startedAt: string;
  uptimeSeconds: number;
  memoryMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuLoad1m: number;
  cpuLoad5m: number;
  cpuCount: number;
  nodeVersion: string;
  totalRequests: number;
  errorCount: number;
  avgResponseMs: number;
}

interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: 'HTTP' | 'API' | 'SYSTEM';
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  message: string;
}

interface TelemetrySample {
  timeLabel: string;
  apiLatencyMs: number;
  dbLatencyMs: number;
  heapMb: number;
}

interface SystemHealthPanelProps {
  data: ErpDataset;
}

function formatUptime(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function SystemHealthPanel({ data }: SystemHealthPanelProps) {
  const { showToast } = useToast();

  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverLatencyMs, setServerLatencyMs] = useState<number | null>(null);
  const [dbOnline, setDbOnline] = useState<boolean | null>(null);
  const [dbLatencyMs, setDbLatencyMs] = useState<number | null>(null);
  const [dbCheckedAt, setDbCheckedAt] = useState<string>('');
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [probing, setProbing] = useState(false);

  // Combined log filter state
  const [sourceFilter, setSourceFilter] = useState<'all' | 'server' | 'audit'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | 'INFO' | 'WARN' | 'ERROR'>('all');
  const [logSearch, setLogSearch] = useState('');

  const runHealthCheck = useCallback(async (manualProbe = false) => {
    setProbing(true);
    try {
      const apiStart = performance.now();
      let latestMetrics: ServerMetrics | null = null;
      let logsPayload: ServerLogEntry[] = [];
      let apiOk = false;

      try {
        if (manualProbe) {
          await fetch('/api/system/probe', { method: 'POST' });
        }
        const res = await fetch('/api/system/logs');
        if (res.ok) {
          const json = (await res.json()) as {
            logs: ServerLogEntry[];
            serverMetrics: ServerMetrics;
          };
          latestMetrics = json.serverMetrics;
          logsPayload = json.logs || [];
          apiOk = true;
        }
      } catch {
        apiOk = false;
      }
      const apiRtt = Math.round((performance.now() - apiStart) * 10) / 10;

      const dbStart = performance.now();
      let firestoreOk = false;
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        firestoreOk = true;
      } catch {
        firestoreOk = false;
      }
      const dbRtt = Math.round((performance.now() - dbStart) * 10) / 10;

      setServerOnline(apiOk);
      setServerLatencyMs(apiOk ? apiRtt : null);
      if (latestMetrics) setMetrics(latestMetrics);
      if (logsPayload.length > 0) setServerLogs(logsPayload);

      setDbOnline(firestoreOk);
      setDbLatencyMs(firestoreOk ? dbRtt : null);
      setDbCheckedAt(new Date().toISOString());

      const label = new Date().toLocaleTimeString('en-KE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      setSamples((prev) => [
        ...prev.slice(-19),
        {
          timeLabel: label,
          apiLatencyMs: apiOk ? apiRtt : 0,
          dbLatencyMs: firestoreOk ? dbRtt : 0,
          heapMb: latestMetrics?.memoryMb.heapUsed ?? 0,
        },
      ]);

      if (manualProbe) {
        showToast(
          apiOk && firestoreOk
            ? `Health probe passed — Server ${apiRtt} ms · Firestore ${dbRtt} ms.`
            : 'Diagnostic check completed with warnings.',
          apiOk && firestoreOk ? 'success' : 'info'
        );
      }
    } finally {
      setProbing(false);
    }
  }, [showToast]);

  useEffect(() => {
    runHealthCheck(false);
    const interval = window.setInterval(() => runHealthCheck(false), 30000);
    return () => window.clearInterval(interval);
  }, [runHealthCheck]);

  const combinedLogs = useMemo(() => {
    const mappedServer = serverLogs.map((l) => ({
      id: l.id,
      timestamp: l.timestamp,
      origin: 'server' as const,
      source: l.source,
      level: l.level,
      actor: l.method ? `${l.method} ${l.path || ''}` : 'Express Runtime',
      details: l.message,
    }));

    const mappedAudit = data.auditLogs.map((a) => ({
      id: a.id,
      timestamp: a.createdAt,
      origin: 'audit' as const,
      source: a.action,
      level: (a.action.includes('REJECT') || a.action.includes('SUSPEND') || a.action.includes('DELETE')
        ? 'WARN'
        : 'INFO') as 'INFO' | 'WARN' | 'ERROR',
      actor: `${a.actorName} (${a.actorRole})`,
      details: `${a.entityPath} — ${a.details}`,
    }));

    return [...mappedServer, ...mappedAudit]
      .filter((entry) => {
        if (sourceFilter === 'server' && entry.origin !== 'server') return false;
        if (sourceFilter === 'audit' && entry.origin !== 'audit') return false;
        if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
        if (logSearch.trim()) {
          const q = logSearch.toLowerCase();
          return (
            entry.source.toLowerCase().includes(q) ||
            entry.actor.toLowerCase().includes(q) ||
            entry.details.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [serverLogs, data.auditLogs, sourceFilter, levelFilter, logSearch]);

  const handleDownloadJsonLogs = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      service: 'eduvance-erp',
      serverMetrics: metrics,
      databaseStatus: {
        connected: dbOnline,
        latencyMs: dbLatencyMs,
        checkedAt: dbCheckedAt,
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
      },
      logs: combinedLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EDUVANCE_System_Logs_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded full system diagnostics & audit logs (.json).', 'success');
  };

  const handleExportCsvLogs = () => {
    exportToCSV(
      `EDUVANCE_System_Logs_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Timestamp', 'Origin', 'Level', 'Source', 'Actor / Endpoint', 'Details'],
      combinedLogs.map((l) => [l.timestamp, l.origin, l.level, l.source, l.actor, l.details])
    );
    showToast('Exported filtered system logs (.csv).', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Live Infrastructure Health, Database Connectivity &amp; Audit Telemetry
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time Express runtime probes, Firestore server round-trip checks, and downloadable system logs (auto-refreshes every 30s).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={probing}
            onClick={() => runHealthCheck(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
            <span>{probing ? 'Probing...' : 'Run Diagnostic Probe'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadJsonLogs}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
          >
            <FileJson className="w-3.5 h-3.5 text-amber-500" />
            <span>Download Logs (.json)</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsvLogs}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
          >
            <Download className="w-3.5 h-3.5 text-amber-500" />
            <span>Export Logs (.csv)</span>
          </button>
        </div>
      </div>

      {/* 4 Telemetry Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Application Server</span>
            <Server className="w-4 h-4 text-amber-500" />
          </div>
          <p
            className={`text-lg font-bold ${
              serverOnline === true
                ? 'text-emerald-600 dark:text-emerald-400'
                : serverOnline === false
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-500'
            }`}
          >
            {serverOnline === true ? 'Operational' : serverOnline === false ? 'Unreachable' : 'Checking...'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            RTT {serverLatencyMs ?? '—'} ms · Uptime {metrics ? formatUptime(metrics.uptimeSeconds) : '—'}
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Firestore Database</span>
            <Database className="w-4 h-4 text-amber-500" />
          </div>
          <p
            className={`text-lg font-bold ${
              dbOnline === true
                ? 'text-emerald-600 dark:text-emerald-400'
                : dbOnline === false
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-500'
            }`}
          >
            {dbOnline === true ? 'Connected' : dbOnline === false ? 'Disconnected' : 'Checking...'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            RTT {dbLatencyMs ?? '—'} ms · {firebaseConfig.projectId}
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Server Memory &amp; CPU</span>
            <Cpu className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-lg font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {metrics ? `${metrics.memoryMb.heapUsed} / ${metrics.memoryMb.heapTotal} MB` : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            RSS {metrics?.memoryMb.rss ?? '—'} MB · Load {metrics?.cpuLoad1m ?? '—'} ({metrics?.cpuCount ?? '—'} vCPU)
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>API Throughput &amp; Errors</span>
            <Activity className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-lg font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {metrics ? `${metrics.totalRequests} reqs · ${metrics.errorCount} errs` : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Avg {metrics?.avgResponseMs ?? 0} ms · {metrics?.nodeVersion || 'Node.js'}
          </p>
        </div>
      </div>

      {/* Live Latency & Performance Chart */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Measured Response Latency (Server API vs Firestore Round-Trip)
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live telemetry samples captured from diagnostic probes ({samples.length} sample{samples.length === 1 ? '' : 's'} recorded)
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            DB ID: {firebaseConfig.firestoreDatabaseId}
          </span>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={samples} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.25} />
              <XAxis dataKey="timeLabel" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis unit="ms" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  borderColor: '#334155',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                  color: '#F8FAFC',
                }}
              />
              <Area
                type="monotone"
                dataKey="apiLatencyMs"
                name="Server API (ms)"
                stroke="#D97706"
                fill="#D97706"
                fillOpacity={0.18}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="dbLatencyMs"
                name="Firestore DB (ms)"
                stroke="#10B981"
                fill="#10B981"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* System & Audit Logs Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
            System Runtime &amp; Audit Logs ({combinedLogs.length})
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search logs..."
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'all' | 'server' | 'audit')}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Sources</option>
              <option value="server">Server API &amp; HTTP</option>
              <option value="audit">Firestore Audit Trail</option>
            </select>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as 'all' | 'INFO' | 'WARN' | 'ERROR')}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Levels</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th className="py-2.5 px-4 font-medium">Timestamp</th>
                <th className="py-2.5 px-4 font-medium">Level</th>
                <th className="py-2.5 px-4 font-medium">Source</th>
                <th className="py-2.5 px-4 font-medium">Actor / Endpoint</th>
                <th className="py-2.5 px-4 font-medium">Event Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {combinedLogs.slice(0, 150).map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                    {new Date(entry.timestamp).toLocaleString('en-KE')}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono font-bold whitespace-nowrap ${
                      entry.level === 'ERROR'
                        ? 'text-red-600 dark:text-red-400'
                        : entry.level === 'WARN'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {entry.level}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {entry.source}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {entry.actor}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{entry.details}</td>
                </tr>
              ))}
              {combinedLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No logs match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
