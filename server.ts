import express from 'express';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

interface SystemLogEntry {
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

const MAX_SYSTEM_LOGS = 500;
const startedAt = new Date().toISOString();
const systemLogs: SystemLogEntry[] = [];
let totalRequests = 0;
let errorCount = 0;
let totalDurationMs = 0;

function pushSystemLog(entry: Omit<SystemLogEntry, 'id' | 'timestamp'>) {
  systemLogs.push({
    id: `syslog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (systemLogs.length > MAX_SYSTEM_LOGS) {
    systemLogs.splice(0, systemLogs.length - MAX_SYSTEM_LOGS);
  }
}

pushSystemLog({
  level: 'INFO',
  source: 'SYSTEM',
  message: 'EDUVANCE ERP Express runtime initialized and telemetry buffer ready.',
});

function buildServerMetrics() {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  return {
    status: 'ok',
    service: 'eduvance-erp',
    timestamp: new Date().toISOString(),
    startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: {
      rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      external: Math.round((mem.external / 1024 / 1024) * 10) / 10,
    },
    cpuLoad1m: Math.round((load[0] ?? 0) * 100) / 100,
    cpuLoad5m: Math.round((load[1] ?? 0) * 100) / 100,
    cpuCount: os.cpus().length,
    nodeVersion: process.version,
    totalRequests,
    errorCount,
    avgResponseMs: totalRequests > 0 ? Math.round((totalDurationMs / totalRequests) * 10) / 10 : 0,
  };
}

// Security headers & sanitized API/error telemetry middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const reqStart = performance.now();
  const cleanPath = (req.path || '/').slice(0, 120);

  res.on('finish', () => {
    const durationMs = Math.round((performance.now() - reqStart) * 10) / 10;
    const isApi = cleanPath.startsWith('/api');
    const isErr = res.statusCode >= 400;

    if (isApi) {
      totalRequests += 1;
      totalDurationMs += durationMs;
    }
    if (isErr) {
      errorCount += 1;
    }

    if (isApi || isErr) {
      pushSystemLog({
        level: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO',
        source: isApi ? 'API' : 'HTTP',
        method: req.method,
        path: cleanPath,
        statusCode: res.statusCode,
        durationMs,
        message: `${req.method} ${cleanPath} -> ${res.statusCode} (${durationMs} ms)`,
      });
    }
  });

  next();
});

// System Health, Telemetry & Logs Endpoints
app.get('/api/health', (_req, res) => {
  res.json(buildServerMetrics());
});

app.get('/api/system/logs', (_req, res) => {
  res.json({
    logs: [...systemLogs].reverse(),
    serverMetrics: buildServerMetrics(),
  });
});

app.post('/api/system/probe', (_req, res) => {
  pushSystemLog({
    level: 'INFO',
    source: 'SYSTEM',
    method: 'POST',
    path: '/api/system/probe',
    statusCode: 200,
    message: 'Super Admin ran manual server & database health diagnostic probe.',
  });
  res.json(buildServerMetrics());
});

app.post('/api/payroll/preview', (req, res) => {
  const { basicSalary = 0, allowances = 0, pension = 0, shifRate = 2.75, housingLevyRate = 1.5, nssfRate = 6, nssfTier1Limit = 8000, nssfTier2Limit = 72000, personalRelief = 2400 } = req.body ?? {};
  const gross = Math.max(0, Number(basicSalary) + Number(allowances));
  const tier1 = Math.min(gross, Number(nssfTier1Limit)) * (Number(nssfRate) / 100);
  const tier2Base = Math.max(0, Math.min(gross, Number(nssfTier2Limit)) - Number(nssfTier1Limit));
  const tier2 = tier2Base * (Number(nssfRate) / 100);
  const nssf = Math.round((tier1 + tier2) * 100) / 100;
  const shif = Math.round(gross * (Number(shifRate) / 100) * 100) / 100;
  const housingLevy = Math.round(gross * (Number(housingLevyRate) / 100) * 100) / 100;
  const allowablePension = Math.min(Number(pension), 30000);
  const taxablePay = Math.max(0, gross - nssf - shif - housingLevy - allowablePension);

  let remaining = taxablePay;
  let grossTax = 0;
  const bands = [
    { limit: 24000, rate: 0.10 },
    { limit: 8333, rate: 0.25 },
    { limit: 467667, rate: 0.30 },
    { limit: 300000, rate: 0.325 },
    { limit: Infinity, rate: 0.35 },
  ];
  for (const band of bands) {
    if (remaining <= 0) break;
    const chunk = Math.min(remaining, band.limit);
    grossTax += chunk * band.rate;
    remaining -= chunk;
  }
  const paye = Math.max(0, Math.round((grossTax - Number(personalRelief)) * 100) / 100);
  const totalDeductions = nssf + shif + housingLevy + Number(pension) + paye;
  const netPay = Math.max(0, Math.round((gross - totalDeductions) * 100) / 100);

  res.json({ gross, nssf, shif, housingLevy, taxablePay, paye, netPay });
});

async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EDUVANCE ERP running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
