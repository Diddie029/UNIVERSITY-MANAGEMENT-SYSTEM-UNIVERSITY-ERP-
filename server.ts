import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Kenyan Statutory Payroll Reference & Calculation Endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pust-university-erp',
    timestamp: new Date().toISOString(),
  });
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
    console.log(`PUST University ERP running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
