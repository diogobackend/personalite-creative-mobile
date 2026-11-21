import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';
import { env } from '../config/env';

export interface ReportPeriod { startDate?: string; endDate?: string }
export interface ReportComparisonPeriodParams { startDate: string; endDate: string; previousStartDate: string; previousEndDate: string }
export interface ReportOverview { expectedRevenue: number; receivedRevenue: number; outstandingRevenue: number; expectedExpenses: number; paidExpenses: number; outstandingExpenses: number; expectedProfit: number; realizedProfit: number }
export interface SalesReport { totalRevenue: number; totalSales: number; averageTicket: number; receivedAmount: number; outstandingAmount: number; receivedPercentage: number }
export interface ExpensesReport { totalExpenses: number; expectedAmount: number; paidAmount: number; outstandingAmount: number; paidPercentage: number; pendingExpenses: number }
export type ReportTransactionType = 'ENTRY' | 'EXIT';
export interface ReportTransaction { id: string; type: ReportTransactionType; description: string; referenceDate: string; amount: number }
export interface ReportTransactions { totalEntries: number; totalExits: number; balance: number; transactions: ReportTransaction[] }
export interface ReportCashFlowDay { date: string; entries: number; exits: number; balance: number }
export interface ReportCashFlow { totalEntries: number; totalExits: number; balance: number; days: ReportCashFlowDay[] }
export interface ReportComparisonPeriod { startDate: string; endDate: string; revenue: number; expenses: number; profit: number }
export interface ReportComparisonVariations { revenuePercentage: number | null; expensesPercentage: number | null; profitPercentage: number | null }
export interface ReportComparison { currentPeriod: ReportComparisonPeriod; previousPeriod: ReportComparisonPeriod; variations: ReportComparisonVariations }
export interface ReportRevenueEvolutionMonth { month: string; revenue: number }
export interface ReportRevenueEvolution { totalRevenue: number; months: ReportRevenueEvolutionMonth[] }
export type ReportExportFormat = 'PDF' | 'XLSX';
export type ReportExportType = 'ALL' | 'OVERVIEW' | 'SALES' | 'EXPENSES' | 'TRANSACTIONS' | 'CASH_FLOW' | 'COMPARISON' | 'REVENUE_EVOLUTION';

export async function getReportOverview(period: ReportPeriod = {}): Promise<ReportOverview> {
  const { data } = await api.get<ReportOverview>('/reports/overview', { params: period }); return data;
}
export async function getSalesReport(period: ReportPeriod = {}): Promise<SalesReport> {
  const { data } = await api.get<SalesReport>('/reports/sales', { params: period }); return data;
}
export async function getExpensesReport(period: ReportPeriod = {}): Promise<ExpensesReport> {
  const { data } = await api.get<ExpensesReport>('/reports/expenses', { params: period }); return data;
}
export async function getTransactionsReport(period: ReportPeriod = {}): Promise<ReportTransactions> {
  const { data } = await api.get<ReportTransactions>('/reports/transactions', { params: period }); return data;
}
export async function getCashFlowReport(period: ReportPeriod = {}): Promise<ReportCashFlow> {
  const { data } = await api.get<ReportCashFlow>('/reports/cash-flow', { params: period }); return data;
}
export async function getComparisonReport(period: ReportComparisonPeriodParams): Promise<ReportComparison> {
  const { data } = await api.get<ReportComparison>('/reports/comparison', { params: period }); return data;
}
export async function getRevenueEvolutionReport(period: Required<ReportPeriod>): Promise<ReportRevenueEvolution> {
  const { data } = await api.get<ReportRevenueEvolution>('/reports/revenue-evolution', { params: period }); return data;
}
export async function exportReport(period: Required<ReportPeriod>, format: ReportExportFormat, type: ReportExportType): Promise<void> {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  if (!FileSystem.cacheDirectory) throw new Error('Armazenamento temporário indisponível.');
  const params = new URLSearchParams({ ...period, format, type });
  const url = `${env.apiUrl}/reports/export?${params.toString()}`;
  const path = `${FileSystem.cacheDirectory}relatorio-${type.toLowerCase()}-${Date.now()}.${format.toLowerCase()}`;
  const result = await FileSystem.downloadAsync(url, path, { headers: { Authorization: `Bearer ${token}` } });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(path, { idempotent: true });
    throw new Error(`Falha na exportação: HTTP ${result.status}`);
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartilhamento de arquivos não disponível neste dispositivo.');
  await Sharing.shareAsync(result.uri, {
    mimeType: format === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: 'Salvar ou compartilhar relatório',
    UTI: format === 'PDF' ? 'com.adobe.pdf' : 'org.openxmlformats.spreadsheetml.sheet',
  });
}
