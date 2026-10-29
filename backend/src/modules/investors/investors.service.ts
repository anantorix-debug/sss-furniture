import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PdfService } from '../pdf/pdf.service';
import { CreateInvestorDto } from './dto/create-investor.dto';
import { UpdateInvestorDto } from './dto/update-investor.dto';
import { CreateInvestorTransactionDto, InvestorTransactionTypeDto } from './dto/create-investor-transaction.dto';
import { UpdateInvestorTransactionDto } from './dto/update-investor-transaction.dto';
import { DistributeProfitDto } from './dto/distribute-profit.dto';
import { escapeHtml, renderGeneratedFooter, renderReportHeader, REPORT_PDF_STYLES } from '../../common/utils/pdf-report.util';

const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  };
}

@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
  ) {}

  // ---------------------------------------------------------------------------
  // Investors CRUD
  // ---------------------------------------------------------------------------

  async create(dto: CreateInvestorDto, userId: string, userEmail?: string) {
    const { initialInvestment, initialPaymentMode, initialReference, joinedDate, ...rest } = dto;

    const investor = await this.prisma.$transaction(async (tx) => {
      const created = await tx.investor.create({
        data: {
          name: rest.name.trim(),
          phone: rest.phone?.trim() || null,
          email: rest.email?.trim() || null,
          address: rest.address?.trim() || null,
          panNumber: rest.panNumber?.trim() || null,
          bankDetails: rest.bankDetails?.trim() || null,
          sharePercentage: rest.sharePercentage != null ? new Prisma.Decimal(rest.sharePercentage) : null,
          expectedRoi: rest.expectedRoi != null ? new Prisma.Decimal(rest.expectedRoi) : null,
          status: rest.status ?? 'ACTIVE',
          joinedDate: joinedDate ? new Date(joinedDate) : new Date(),
          notes: rest.notes?.trim() || null,
        },
      });

      if (initialInvestment && initialInvestment > 0) {
        await tx.investorTransaction.create({
          data: {
            investorId: created.id,
            type: 'INVESTMENT',
            date: joinedDate ? new Date(joinedDate) : new Date(),
            amount: new Prisma.Decimal(initialInvestment),
            paymentMode: initialPaymentMode?.trim() || 'BANK_TRANSFER',
            reference: initialReference?.trim() || 'Initial Capital Investment',
            notes: 'Initial capital investment on onboarding',
            createdById: userId,
          },
        });
      }

      return created;
    });

    await this.audit.log({
      userId,
      userEmail,
      action: 'INVESTOR_CREATED',
      targetType: 'Investor',
      targetId: investor.id,
      metadata: { name: investor.name, initialInvestment },
    });

    return this.findOne(investor.id);
  }

  async findAll(params: { search?: string; status?: string }) {
    const where: Prisma.InvestorWhereInput = {};

    if (params.status && params.status !== 'ALL') {
      where.status = params.status;
    }

    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { email: { contains: q } },
        { panNumber: { contains: q } },
      ];
    }

    const investors = await this.prisma.investor.findMany({
      where,
      include: {
        transactions: {
          orderBy: { date: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate system-wide active capital to compute dynamic share if needed
    let totalSystemActiveCapital = 0;
    const computed = investors.map((inv) => {
      let totalInvested = 0;
      let totalPayouts = 0;

      for (const tx of inv.transactions) {
        const amt = num(tx.amount);
        if (tx.type === 'INVESTMENT') totalInvested += amt;
        else if (tx.type === 'PAYOUT') totalPayouts += amt;
      }

      const currentBalance = totalInvested - totalPayouts;
      if (inv.status === 'ACTIVE' && currentBalance > 0) {
        totalSystemActiveCapital += currentBalance;
      }

      return {
        ...inv,
        totalInvested: round(totalInvested),
        totalPayouts: round(totalPayouts),
        currentBalance: round(currentBalance),
        roi: totalInvested > 0 ? round((totalPayouts / totalInvested) * 100) : 0,
        transactionsCount: inv.transactions.length,
      };
    });

    return computed.map((inv) => {
      const explicitShare = inv.sharePercentage ? num(inv.sharePercentage) : null;
      const dynamicShare =
        totalSystemActiveCapital > 0 && inv.currentBalance > 0
          ? round((inv.currentBalance / totalSystemActiveCapital) * 100)
          : 0;

      return {
        ...inv,
        effectiveSharePercentage: explicitShare ?? dynamicShare,
        isDynamicShare: explicitShare == null,
      };
    });
  }

  async findOne(id: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { id },
      include: {
        transactions: {
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!investor) throw new NotFoundException('Investor not found');

    let totalInvested = 0;
    let totalPayouts = 0;

    for (const tx of investor.transactions) {
      const amt = num(tx.amount);
      if (tx.type === 'INVESTMENT') totalInvested += amt;
      else if (tx.type === 'PAYOUT') totalPayouts += amt;
    }

    const currentBalance = totalInvested - totalPayouts;
    const roi = totalInvested > 0 ? round((totalPayouts / totalInvested) * 100) : 0;

    return {
      ...investor,
      totalInvested: round(totalInvested),
      totalPayouts: round(totalPayouts),
      currentBalance: round(currentBalance),
      roi,
    };
  }

  async update(id: string, dto: UpdateInvestorDto, userId: string, userEmail?: string) {
    const existing = await this.prisma.investor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Investor not found');

    const updated = await this.prisma.investor.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim() : undefined,
        phone: dto.phone !== undefined ? (dto.phone?.trim() || null) : undefined,
        email: dto.email !== undefined ? (dto.email?.trim() || null) : undefined,
        address: dto.address !== undefined ? (dto.address?.trim() || null) : undefined,
        panNumber: dto.panNumber !== undefined ? (dto.panNumber?.trim() || null) : undefined,
        bankDetails: dto.bankDetails !== undefined ? (dto.bankDetails?.trim() || null) : undefined,
        sharePercentage:
          dto.sharePercentage !== undefined
            ? dto.sharePercentage != null
              ? new Prisma.Decimal(dto.sharePercentage)
              : null
            : undefined,
        expectedRoi:
          dto.expectedRoi !== undefined
            ? dto.expectedRoi != null
              ? new Prisma.Decimal(dto.expectedRoi)
              : null
            : undefined,
        status: dto.status ?? undefined,
        joinedDate: dto.joinedDate ? new Date(dto.joinedDate) : undefined,
        notes: dto.notes !== undefined ? (dto.notes?.trim() || null) : undefined,
      },
    });

    await this.audit.log({
      userId,
      userEmail,
      action: 'INVESTOR_UPDATED',
      targetType: 'Investor',
      targetId: id,
      metadata: { dto },
    });

    return this.findOne(updated.id);
  }

  async remove(id: string, userId: string, userEmail?: string) {
    const existing = await this.prisma.investor.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });
    if (!existing) throw new NotFoundException('Investor not found');

    // If investor has existing transactions, mark as INACTIVE rather than hard delete to protect financial audit history
    if (existing._count.transactions > 0) {
      await this.prisma.investor.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });

      await this.audit.log({
        userId,
        userEmail,
        action: 'INVESTOR_DEACTIVATED',
        targetType: 'Investor',
        targetId: id,
        metadata: { reason: 'Has existing financial transactions' },
      });

      return { success: true, message: 'Investor has transaction history and has been deactivated.' };
    }

    await this.prisma.investor.delete({ where: { id } });

    await this.audit.log({
      userId,
      userEmail,
      action: 'INVESTOR_DELETED',
      targetType: 'Investor',
      targetId: id,
      metadata: { name: existing.name },
    });

    return { success: true, message: 'Investor deleted successfully.' };
  }

  // ---------------------------------------------------------------------------
  // Investor Transactions CRUD
  // ---------------------------------------------------------------------------

  async createTransaction(investorId: string, dto: CreateInvestorTransactionDto, userId: string, userEmail?: string) {
    const investor = await this.prisma.investor.findUnique({ where: { id: investorId } });
    if (!investor) throw new NotFoundException('Investor not found');

    const tx = await this.prisma.investorTransaction.create({
      data: {
        investorId,
        type: dto.type,
        date: new Date(dto.date),
        amount: new Prisma.Decimal(dto.amount),
        paymentMode: dto.paymentMode?.trim() || 'BANK_TRANSFER',
        reference: dto.reference?.trim() || null,
        notes: dto.notes?.trim() || null,
        periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : null,
        periodTo: dto.periodTo ? new Date(dto.periodTo) : null,
        createdById: userId,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit.log({
      userId,
      userEmail,
      action: dto.type === 'INVESTMENT' ? 'INVESTOR_CAPITAL_ADDED' : 'INVESTOR_PAYOUT_LOGGED',
      targetType: 'InvestorTransaction',
      targetId: tx.id,
      metadata: { investorId, amount: dto.amount, type: dto.type },
    });

    return tx;
  }

  async updateTransaction(txId: string, dto: UpdateInvestorTransactionDto, userId: string, userEmail?: string) {
    const existing = await this.prisma.investorTransaction.findUnique({ where: { id: txId } });
    if (!existing) throw new NotFoundException('Transaction not found');

    const updated = await this.prisma.investorTransaction.update({
      where: { id: txId },
      data: {
        type: dto.type ?? undefined,
        date: dto.date ? new Date(dto.date) : undefined,
        amount: dto.amount != null ? new Prisma.Decimal(dto.amount) : undefined,
        paymentMode: dto.paymentMode !== undefined ? (dto.paymentMode?.trim() || null) : undefined,
        reference: dto.reference !== undefined ? (dto.reference?.trim() || null) : undefined,
        notes: dto.notes !== undefined ? (dto.notes?.trim() || null) : undefined,
        periodFrom: dto.periodFrom !== undefined ? (dto.periodFrom ? new Date(dto.periodFrom) : null) : undefined,
        periodTo: dto.periodTo !== undefined ? (dto.periodTo ? new Date(dto.periodTo) : null) : undefined,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await this.audit.log({
      userId,
      userEmail,
      action: 'INVESTOR_TRANSACTION_UPDATED',
      targetType: 'InvestorTransaction',
      targetId: txId,
      metadata: { dto },
    });

    return updated;
  }

  async removeTransaction(txId: string, userId: string, userEmail?: string) {
    const existing = await this.prisma.investorTransaction.findUnique({ where: { id: txId } });
    if (!existing) throw new NotFoundException('Transaction not found');

    await this.prisma.investorTransaction.delete({ where: { id: txId } });

    await this.audit.log({
      userId,
      userEmail,
      action: 'INVESTOR_TRANSACTION_DELETED',
      targetType: 'InvestorTransaction',
      targetId: txId,
      metadata: { investorId: existing.investorId, amount: Number(existing.amount), type: existing.type },
    });

    return { success: true, message: 'Transaction deleted successfully.' };
  }

  async distributeProfit(dto: DistributeProfitDto, userId: string, userEmail?: string) {
    return this.createTransaction(
      dto.investorId,
      {
        type: InvestorTransactionTypeDto.PAYOUT,
        amount: dto.amount,
        date: dto.date,
        paymentMode: dto.paymentMode ?? 'BANK_TRANSFER',
        reference: dto.reference ?? 'Profit Share Distribution',
        notes: dto.notes ?? 'Profit Share Distribution for Period',
        periodFrom: dto.periodFrom,
        periodTo: dto.periodTo,
      },
      userId,
      userEmail,
    );
  }

  // ---------------------------------------------------------------------------
  // Overall High-Level Stats
  // ---------------------------------------------------------------------------

  async getStats() {
    const [investors, transactions, customerPays, partyPays, supplierPays, workerPays, expenses] = await Promise.all([
      this.prisma.investor.findMany(),
      this.prisma.investorTransaction.findMany(),
      this.prisma.customerOrderPayment.findMany({ select: { amount: true } }),
      this.prisma.partyOrderPayment.findMany({ select: { amount: true } }),
      this.prisma.supplierPayment.findMany({ select: { amount: true } }),
      this.prisma.carpenterPayment.findMany({ where: { paymentType: { not: 'DEDUCTION' } }, select: { amount: true } }),
      this.prisma.expense.findMany({ where: { status: 'ACTIVE', scope: 'COMPANY' }, select: { amount: true } }),
    ]);

    let totalCapitalInvested = 0;
    let totalPayoutsDistributed = 0;

    for (const tx of transactions) {
      const amt = num(tx.amount);
      if (tx.type === 'INVESTMENT') totalCapitalInvested += amt;
      else if (tx.type === 'PAYOUT') totalPayoutsDistributed += amt;
    }

    const netActiveCapital = totalCapitalInvested - totalPayoutsDistributed;
    const totalInvestors = investors.length;
    const activeInvestors = investors.filter((i) => i.status === 'ACTIVE').length;

    // Company Lifetime Financial Totals
    const totalRevenue = customerPays.reduce((s, p) => s + num(p.amount), 0) + partyPays.reduce((s, p) => s + num(p.amount), 0);
    const totalCosts =
      supplierPays.reduce((s, p) => s + num(p.amount), 0) +
      workerPays.reduce((s, p) => s + num(p.amount), 0) +
      expenses.reduce((s, e) => s + num(e.amount), 0);
    const lifetimeNetProfit = totalRevenue - totalCosts;

    return {
      totalInvestors,
      activeInvestors,
      totalCapitalInvested: round(totalCapitalInvested),
      totalPayoutsDistributed: round(totalPayoutsDistributed),
      netActiveCapital: round(netActiveCapital),
      overallRoi: totalCapitalInvested > 0 ? round((totalPayoutsDistributed / totalCapitalInvested) * 100) : 0,
      lifetimeCompanyRevenue: round(totalRevenue),
      lifetimeCompanyCosts: round(totalCosts),
      lifetimeCompanyNetProfit: round(lifetimeNetProfit),
    };
  }

  // ---------------------------------------------------------------------------
  // Profit & Loss Calculation & Investor Share Allocation
  // ---------------------------------------------------------------------------

  async calculatePnl(params: { from?: string; to?: string }) {
    const range = dateRange(params.from, params.to);

    const [
      customerPays,
      partyPays,
      supplierPays,
      workerPays,
      expenses,
      activeInvestors,
      periodPayouts,
    ] = await Promise.all([
      this.prisma.customerOrderPayment.findMany({ where: { date: range }, select: { amount: true } }),
      this.prisma.partyOrderPayment.findMany({ where: { date: range }, select: { amount: true } }),
      this.prisma.supplierPayment.findMany({ where: { date: range }, select: { amount: true } }),
      this.prisma.carpenterPayment.findMany({ where: { date: range, paymentType: { not: 'DEDUCTION' } }, select: { amount: true } }),
      this.prisma.expense.findMany({ where: { date: range, status: 'ACTIVE', scope: 'COMPANY' }, select: { amount: true } }),
      this.prisma.investor.findMany({
        where: { status: 'ACTIVE' },
        include: { transactions: true },
      }),
      this.prisma.investorTransaction.findMany({
        where: { type: 'PAYOUT', date: range },
        select: { investorId: true, amount: true },
      }),
    ]);

    const retailRevenue = round(customerPays.reduce((s, p) => s + num(p.amount), 0));
    const wholesaleRevenue = round(partyPays.reduce((s, p) => s + num(p.amount), 0));
    const totalRevenue = round(retailRevenue + wholesaleRevenue);

    const materialCosts = round(supplierPays.reduce((s, p) => s + num(p.amount), 0));
    const labourCosts = round(workerPays.reduce((s, p) => s + num(p.amount), 0));
    const operatingExpenses = round(expenses.reduce((s, e) => s + num(e.amount), 0));
    const totalCosts = round(materialCosts + labourCosts + operatingExpenses);

    const netProfit = round(totalRevenue - totalCosts);
    const profitMargin = totalRevenue > 0 ? round((netProfit / totalRevenue) * 100) : 0;

    // Map period payouts per investor
    const periodPayoutsMap = new Map<string, number>();
    for (const p of periodPayouts) {
      periodPayoutsMap.set(p.investorId, (periodPayoutsMap.get(p.investorId) || 0) + num(p.amount));
    }

    // Compute total active capital across all active investors
    let totalActiveCapital = 0;
    const investorCapitals = activeInvestors.map((inv) => {
      let invested = 0;
      let payouts = 0;
      for (const tx of inv.transactions) {
        if (tx.type === 'INVESTMENT') invested += num(tx.amount);
        else if (tx.type === 'PAYOUT') payouts += num(tx.amount);
      }
      const net = Math.max(0, invested - payouts);
      totalActiveCapital += net;
      return { id: inv.id, invested, payouts, net };
    });

    const capitalMap = new Map(investorCapitals.map((c) => [c.id, c]));

    // Build investor allocation breakdown
    let totalAllocatedProfit = 0;
    let totalAllocatedPayoutsInPeriod = 0;

    const investorBreakdown = activeInvestors.map((inv) => {
      const cap = capitalMap.get(inv.id);
      const explicitShare = inv.sharePercentage ? num(inv.sharePercentage) : null;
      const dynamicShare =
        totalActiveCapital > 0 && cap && cap.net > 0 ? round((cap.net / totalActiveCapital) * 100) : 0;

      const sharePercentage = explicitShare ?? dynamicShare;
      const allocatedProfit = round(netProfit * (sharePercentage / 100));
      const payoutsInPeriod = round(periodPayoutsMap.get(inv.id) || 0);
      const balanceToDistribute = round(allocatedProfit - payoutsInPeriod);

      totalAllocatedProfit += allocatedProfit;
      totalAllocatedPayoutsInPeriod += payoutsInPeriod;

      return {
        id: inv.id,
        name: inv.name,
        phone: inv.phone,
        totalInvested: round(cap?.invested || 0),
        activeCapital: round(cap?.net || 0),
        sharePercentage,
        isDynamicShare: explicitShare == null,
        allocatedProfit,
        payoutsInPeriod,
        balanceToDistribute,
        allTimePayouts: round(cap?.payouts || 0),
      };
    });

    return {
      period: { from: params.from || null, to: params.to || null },
      revenue: {
        retail: retailRevenue,
        wholesale: wholesaleRevenue,
        total: totalRevenue,
      },
      costs: {
        materials: materialCosts,
        labour: labourCosts,
        expenses: operatingExpenses,
        total: totalCosts,
      },
      companyNetProfit: netProfit,
      profitMargin,
      totalActiveCapital: round(totalActiveCapital),
      totalAllocatedProfit: round(totalAllocatedProfit),
      totalPayoutsInPeriod: round(totalAllocatedPayoutsInPeriod),
      retainedCompanyProfit: round(netProfit - totalAllocatedProfit),
      investors: investorBreakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // PDF Statement Generator
  // ---------------------------------------------------------------------------

  async generateStatementPdf(investorId: string): Promise<Buffer> {
    const investor = await this.findOne(investorId);

    const rows = investor.transactions.map((tx) => `
      <tr>
        <td>${tx.date.toISOString().slice(0, 10)}</td>
        <td>
          <span style="font-weight: 600; color: ${tx.type === 'INVESTMENT' ? '#1baf7a' : '#eb6834'};">
            ${tx.type}
          </span>
        </td>
        <td style="text-align: right; font-weight: 600;">₹${Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td>${escapeHtml(tx.paymentMode || '—')}</td>
        <td>${escapeHtml(tx.reference || '—')}</td>
        <td>${escapeHtml(tx.notes || '—')}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Investor Statement - ${escapeHtml(investor.name)}</title>
        <style>
          ${REPORT_PDF_STYLES}
          .investor-card {
            border: 1px solid #e3e1d9;
            background: #faf9f6;
            border-radius: 8px;
            padding: 14px 18px;
            margin-bottom: 20px;
          }
          .investor-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        ${renderReportHeader(`Investor Statement: ${investor.name}`)}
        <div class="body">
          <div class="investor-card">
            <div class="investor-grid">
              <div><strong>Name:</strong> ${escapeHtml(investor.name)}</div>
              <div><strong>Status:</strong> ${escapeHtml(investor.status)}</div>
              <div><strong>Phone:</strong> ${escapeHtml(investor.phone || '—')}</div>
              <div><strong>Email:</strong> ${escapeHtml(investor.email || '—')}</div>
              <div><strong>PAN / Tax ID:</strong> ${escapeHtml(investor.panNumber || '—')}</div>
              <div><strong>Share %:</strong> ${investor.sharePercentage ? `${investor.sharePercentage}%` : 'Dynamic'}</div>
              <div><strong>Joined Date:</strong> ${investor.joinedDate.toISOString().slice(0, 10)}</div>
              <div><strong>Bank / UPI:</strong> ${escapeHtml(investor.bankDetails || '—')}</div>
            </div>
          </div>

          <div class="summary">
            <div>
              <div class="label">Total Capital Injected</div>
              <div class="value" style="color: #1baf7a;">₹${investor.totalInvested.toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div class="label">Total Returns Paid</div>
              <div class="value" style="color: #2a78d6;">₹${investor.totalPayouts.toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div class="label">Net Current Capital</div>
              <div class="value">₹${investor.currentBalance.toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div class="label">Total ROI</div>
              <div class="value" style="color: #6250d6;">${investor.roi}%</div>
            </div>
          </div>

          <h3 style="font-size: 14px; margin: 18px 0 8px 0; color: #80011f;">Transaction History</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th style="text-align: right;">Amount</th>
                <th>Mode</th>
                <th>Reference</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 18px;">No transactions recorded yet.</td></tr>'}
            </tbody>
          </table>

          ${renderGeneratedFooter(investor.transactions.length, 'transaction')}
        </div>
      </body>
      </html>
    `;

    return this.pdf.renderHtmlToPdf(html);
  }

  async generatePnlPdf(params: { from?: string; to?: string; periodLabel?: string }): Promise<Buffer> {
    const pnl = await this.calculatePnl(params);
    const periodDisplay = params.periodLabel || (params.from && params.to ? `${params.from} to ${params.to}` : 'All Time');

    const investorRows = pnl.investors.map((inv) => `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(inv.name)}</td>
        <td>₹${inv.activeCapital.toLocaleString('en-IN')}</td>
        <td style="text-align: center;">
          <span style="background: #eef2ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">
            ${inv.sharePercentage}% ${inv.isDynamicShare ? '(Dynamic)' : '(Fixed)'}
          </span>
        </td>
        <td style="text-align: right; font-weight: 600; color: #166534;">₹${inv.allocatedProfit.toLocaleString('en-IN')}</td>
        <td style="text-align: right; color: #2563eb;">₹${inv.payoutsInPeriod.toLocaleString('en-IN')}</td>
        <td style="text-align: right; font-weight: 700; color: ${inv.balanceToDistribute > 0 ? '#b91c1c' : '#166534'};">
          ₹${inv.balanceToDistribute.toLocaleString('en-IN')}
        </td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Company Profit &amp; Loss &amp; Investor Statement - ${escapeHtml(periodDisplay)}</title>
        <style>
          ${REPORT_PDF_STYLES}
          .pnl-header-card {
            border: 1px solid #e3e1d9;
            background: #faf9f6;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 20px;
          }
          .kpi-card {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px 14px;
            background: #ffffff;
          }
          .kpi-card.green { border-left: 4px solid #16a34a; }
          .kpi-card.orange { border-left: 4px solid #ea580c; }
          .kpi-card.blue { border-left: 4px solid #2563eb; }
          .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
          .kpi-val { font-size: 18px; font-weight: 800; margin: 3px 0 6px; }
          .kpi-sub { font-size: 10.5px; color: #4b5563; line-height: 1.4; }
        </style>
      </head>
      <body>
        ${renderReportHeader('Company Profit & Loss & Investor Statement')}
        <div class="body">
          <div class="pnl-header-card">
            <div>
              <span style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 700;">Calculation Period:</span>
              <strong style="font-size: 13px; color: #80011f; margin-left: 6px;">${escapeHtml(periodDisplay)}</strong>
              ${pnl.period.from && pnl.period.to ? `<div style="font-size: 10.5px; color: #6b7280; margin-top: 2px;">Dates: ${pnl.period.from} to ${pnl.period.to}</div>` : ''}
            </div>
            <div style="text-align: right; font-size: 11px; color: #6b7280;">
              <div>Generated: <strong>${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>
              <div>Status: <span style="color: #16a34a; font-weight: 700;">AUDITED / LIVE</span></div>
            </div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-card green">
              <div class="kpi-label">Total Revenue (Money In)</div>
              <div class="kpi-val" style="color: #166534;">₹${pnl.revenue.total.toLocaleString('en-IN')}</div>
              <div class="kpi-sub">
                Retail Sales: ₹${pnl.revenue.retail.toLocaleString('en-IN')}<br/>
                Wholesale (Party): ₹${pnl.revenue.wholesale.toLocaleString('en-IN')}
              </div>
            </div>

            <div class="kpi-card orange">
              <div class="kpi-label">Total Costs &amp; Expenses (Money Out)</div>
              <div class="kpi-val" style="color: #c2410c;">₹${pnl.costs.total.toLocaleString('en-IN')}</div>
              <div class="kpi-sub">
                Materials: ₹${pnl.costs.materials.toLocaleString('en-IN')}<br/>
                Labour / Wages: ₹${pnl.costs.labour.toLocaleString('en-IN')}<br/>
                Operating Expenses: ₹${pnl.costs.expenses.toLocaleString('en-IN')}
              </div>
            </div>

            <div class="kpi-card blue">
              <div class="kpi-label">Net Company Profit</div>
              <div class="kpi-val" style="color: ${pnl.companyNetProfit >= 0 ? '#1e40af' : '#b91c1c'};">₹${pnl.companyNetProfit.toLocaleString('en-IN')}</div>
              <div class="kpi-sub">
                Profit Margin: <strong>${pnl.profitMargin}%</strong><br/>
                Total Investors Share: ₹${pnl.totalAllocatedProfit.toLocaleString('en-IN')}<br/>
                Retained by Company: ₹${pnl.retainedCompanyProfit.toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          <h3 style="font-size: 13px; margin: 18px 0 8px 0; color: #80011f; text-transform: uppercase; letter-spacing: 0.5px;">
            Investor Profit &amp; Loss Distribution Matrix
          </h3>
          <table>
            <thead>
              <tr>
                <th>Investor Name</th>
                <th>Active Capital</th>
                <th style="text-align: center;">Share %</th>
                <th style="text-align: right;">Calculated Profit</th>
                <th style="text-align: right;">Paid in Period</th>
                <th style="text-align: right;">Balance to Pay</th>
              </tr>
            </thead>
            <tbody>
              ${investorRows || '<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 18px;">No active investors registered in this calculation period.</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="background: #f9fafb; font-weight: 700; border-top: 2px solid #e5e7eb;">
                <td>Total Active Investors (${pnl.investors.length})</td>
                <td>₹${pnl.totalActiveCapital.toLocaleString('en-IN')}</td>
                <td style="text-align: center;">—</td>
                <td style="text-align: right; color: #166534;">₹${pnl.totalAllocatedProfit.toLocaleString('en-IN')}</td>
                <td style="text-align: right; color: #2563eb;">₹${pnl.totalPayoutsInPeriod.toLocaleString('en-IN')}</td>
                <td style="text-align: right; color: #80011f;">₹${(pnl.totalAllocatedProfit - pnl.totalPayoutsInPeriod).toLocaleString('en-IN')}</td>
              </tr>
            </tfoot>
          </table>

          ${renderGeneratedFooter(pnl.investors.length, 'investor record')}
        </div>
      </body>
      </html>
    `;

    return this.pdf.renderHtmlToPdf(html);
  }
}
