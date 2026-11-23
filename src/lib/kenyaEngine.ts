import { Employee, GradingRule, PayeBand, Payslip, StatutoryConfig } from '../types/erp';

export const DEFAULT_PAYE_BANDS: PayeBand[] = [
  { upTo: 24000, rate: 10, label: 'First KES 24,000 (10%)' },
  { upTo: 32333, rate: 25, label: 'Next KES 8,333 (25%)' },
  { upTo: 500000, rate: 30, label: 'Next KES 467,667 (30%)' },
  { upTo: 800000, rate: 32.5, label: 'Next KES 300,000 (32.5%)' },
  { upTo: null, rate: 35, label: 'Above KES 800,000 (35%)' },
];

export const DEFAULT_GRADING_SCALE: GradingRule[] = [
  { grade: 'A', minScore: 70, maxScore: 100, points: 4.0, remark: 'Distinction' },
  { grade: 'B', minScore: 60, maxScore: 69.99, points: 3.0, remark: 'Credit' },
  { grade: 'C', minScore: 50, maxScore: 59.99, points: 2.0, remark: 'Pass' },
  { grade: 'D', minScore: 40, maxScore: 49.99, points: 1.0, remark: 'Pass (Marginal)' },
  { grade: 'E', minScore: 0, maxScore: 39.99, points: 0.0, remark: 'Fail / Supplementary' },
];

export const DEFAULT_STATUTORY_CONFIG: Omit<StatutoryConfig, 'id' | 'updatedAt'> = {
  shifRate: 2.75,
  housingLevyRate: 1.5,
  nssfTier1Limit: 8000,
  nssfTier2Limit: 72000,
  nssfRate: 6.0,
  personalRelief: 2400,
  payeBandsJson: JSON.stringify(DEFAULT_PAYE_BANDS),
  gradingScaleJson: JSON.stringify(DEFAULT_GRADING_SCALE),
};

export function evaluateKenyanGrade(
  catScore: number,
  examScore: number,
  customScale?: GradingRule[]
): { totalScore: number; grade: string; gradePoints: number; remark: string } {
  const cat = Math.min(30, Math.max(0, Number(catScore) || 0));
  const exam = Math.min(70, Math.max(0, Number(examScore) || 0));
  const totalScore = Math.round((cat + exam) * 100) / 100;
  const scale = customScale && customScale.length > 0 ? customScale : DEFAULT_GRADING_SCALE;
  const matched =
    scale.find((rule) => totalScore >= rule.minScore && totalScore <= rule.maxScore) ??
    scale[scale.length - 1];
  return {
    totalScore,
    grade: matched.grade,
    gradePoints: matched.points,
    remark: matched.remark,
  };
}

export function calculateEmployeePayslip(
  employee: Employee,
  runId: string,
  monthLabel: string,
  config: StatutoryConfig
): Omit<Payslip, 'id'> {
  const basicSalary = Math.max(0, Number(employee.basicSalary) || 0);
  const allowances =
    Math.max(0, Number(employee.houseAllowance) || 0) +
    Math.max(0, Number(employee.commuterAllowance) || 0);
  const grossPay = Math.round((basicSalary + allowances) * 100) / 100;

  const tier1Cap = Number(config.nssfTier1Limit) || 8000;
  const tier2Cap = Number(config.nssfTier2Limit) || 72000;
  const nssfRate = (Number(config.nssfRate) || 6) / 100;

  const tier1 = Math.min(grossPay, tier1Cap) * nssfRate;
  const tier2 = Math.max(0, Math.min(grossPay, tier2Cap) - tier1Cap) * nssfRate;
  const nssf = Math.round((tier1 + tier2) * 100) / 100;

  const shif = Math.round(grossPay * ((Number(config.shifRate) || 2.75) / 100) * 100) / 100;
  const housingLevy =
    Math.round(grossPay * ((Number(config.housingLevyRate) || 1.5) / 100) * 100) / 100;
  const pension = Math.max(0, Number(employee.pensionContribution) || 0);
  const allowablePension = Math.min(pension, 30000);

  // Under Kenya Finance Act / Tax Laws Amendment, NSSF, SHIF, Housing Levy & allowable pension are deductible before PAYE
  const taxablePay = Math.max(
    0,
    Math.round((grossPay - nssf - shif - housingLevy - allowablePension) * 100) / 100
  );

  let bands: PayeBand[] = DEFAULT_PAYE_BANDS;
  try {
    if (config.payeBandsJson) {
      const parsed = JSON.parse(config.payeBandsJson);
      if (Array.isArray(parsed) && parsed.length > 0) bands = parsed;
    }
  } catch {
    bands = DEFAULT_PAYE_BANDS;
  }

  let prevCap = 0;
  let grossTax = 0;
  for (const band of bands) {
    if (taxablePay <= prevCap) break;
    const upper = band.upTo === null ? Infinity : band.upTo;
    const slice = Math.max(0, Math.min(taxablePay, upper) - prevCap);
    grossTax += slice * (band.rate / 100);
    prevCap = upper;
  }

  const personalRelief = Number(config.personalRelief) || 2400;
  const paye = Math.max(0, Math.round((grossTax - personalRelief) * 100) / 100);
  const totalDeductions = nssf + shif + housingLevy + pension + paye;
  const netPay = Math.max(0, Math.round((grossPay - totalDeductions) * 100) / 100);

  return {
    runId,
    monthLabel,
    employeeId: employee.id,
    employeeUid: employee.uid || '',
    staffNo: employee.staffNo,
    employeeName: employee.fullName,
    jobTitle: employee.jobTitle,
    basicSalary,
    allowances,
    grossPay,
    nssf,
    shif,
    housingLevy,
    pension,
    taxablePay,
    paye,
    netPay,
    bankName: employee.bankName || '',
    bankAccountMasked: employee.bankAccountMasked || '',
    createdAt: new Date().toISOString(),
  };
}

export function formatKes(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

export function generateAdmissionNumber(progCode: string, sequence: number): string {
  const year = new Date().getFullYear();
  const cleanCode = progCode.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10) || 'GEN';
  const padded = String(sequence).padStart(4, '0');
  return `EDU/${cleanCode}/${year}/${padded}`;
}

export function generateReceiptNumber(): string {
  const year = new Date().getFullYear();
  const token = Math.floor(100000 + Math.random() * 900000);
  return `EDU-RCT-${year}-${token}`;
}
