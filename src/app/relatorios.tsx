import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { exportReport, type ReportExportFormat, type ReportExportType } from '../services/reportService';

type IconName = keyof typeof Ionicons.glyphMap;
type Preset = 'today' | 'last7' | 'last30' | 'last6Months' | 'currentMonth' | 'previousMonth' | 'custom';
type Period = { startDate: string; endDate: string };
type Format = 'currency' | 'number' | 'percentage';
type Overview = { expectedRevenue: number; receivedRevenue: number; expectedProfit: number; realizedProfit: number };
type Sales = { totalSales: number; averageTicket: number; outstandingAmount: number; receivedPercentage: number; totalRevenue: number; receivedAmount: number };
type Expenses = { totalExpenses: number; expectedAmount: number; paidAmount: number; outstandingAmount: number; pendingExpenses: number; paidPercentage: number };
type Transaction = { id: string; type: 'ENTRY' | 'EXIT'; description: string; referenceDate: string; amount: number };
type Transactions = { totalEntries: number; totalExits: number; balance: number; transactions: Transaction[] };
type CashFlow = { totalEntries: number; totalExits: number; balance: number; days: { date: string; entries: number; exits: number; balance: number }[] };
type Comparison = {
  currentPeriod: { revenue: number; expenses: number; profit: number };
  previousPeriod: { revenue: number; expenses: number; profit: number };
  variations: { revenuePercentage: number | null; expensesPercentage: number | null; profitPercentage: number | null };
};
type RevenueEvolution = { totalRevenue: number; months: { month: string; revenue: number }[] };
type Reports = { overview: Overview | null; sales: Sales | null; expenses: Expenses | null; transactions: Transactions | null; cashFlow: CashFlow | null; comparison: Comparison | null; evolution: RevenueEvolution | null };
type ReportKey = keyof Reports;

const C = { bg: '#f8f6f2', white: '#fff', ink: '#342d27', muted: '#766d63', gold: '#a98a58', border: '#e8e0d4', menu: '#39342f', green: '#047857', red: '#b91c1c' };
const PRESETS: { label: string; value: Preset }[] = [
  { label: 'Hoje', value: 'today' }, { label: 'Últimos 7 dias', value: 'last7' },
  { label: 'Últimos 30 dias', value: 'last30' }, { label: 'Últimos 6 meses', value: 'last6Months' },
  { label: 'Mês atual', value: 'currentMonth' }, { label: 'Mês anterior', value: 'previousMonth' },
  { label: 'Personalizado', value: 'custom' },
];
const EXPORT_LABELS: Record<ReportExportType, string> = {
  ALL: 'Todos os relatórios', OVERVIEW: 'Visão geral', SALES: 'Vendas',
  EXPENSES: 'Despesas', TRANSACTIONS: 'Movimentações', CASH_FLOW: 'Fluxo de caixa',
  COMPARISON: 'Comparação de períodos', REVENUE_EVOLUTION: 'Evolução dos recebimentos',
};
const MENU: { label: string; icon: IconName; route?: string }[] = [
  { label: 'Visão geral', icon: 'grid-outline', route: '/home' },
  { label: 'Produtos', icon: 'cube-outline', route: '/produtos' },
  { label: 'Categorias', icon: 'pricetags-outline', route: '/categorias' },
  { label: 'Vendas', icon: 'bag-handle-outline', route: '/vendas' },
  { label: 'Histórico Financeiro', icon: 'card-outline', route: '/movimentacoes' },
  { label: 'Clientes', icon: 'people-outline', route: '/clientes' },
  { label: 'Estoque', icon: 'layers-outline', route: '/estoque' },
  { label: 'Despesas', icon: 'wallet-outline', route: '/despesas' },
  { label: 'Relatórios', icon: 'stats-chart-outline', route: '/relatorios' },
];
// Validar estes caminhos com o reportService.ts da versão web.
const ENDPOINTS: Record<ReportKey, string> = {
  overview: '/reports/overview', sales: '/reports/sales', expenses: '/reports/expenses',
  transactions: '/reports/transactions', cashFlow: '/reports/cash-flow',
  comparison: '/reports/comparison', evolution: '/reports/revenue-evolution',
};
const EMPTY: Reports = { overview: null, sales: null, expenses: null, transactions: null, cashFlow: null, comparison: null, evolution: null };
const LABELS: Record<ReportKey, string> = { overview: 'resumo financeiro', sales: 'vendas', expenses: 'despesas', transactions: 'movimentações', cashFlow: 'fluxo de caixa', comparison: 'comparação de períodos', evolution: 'evolução dos recebimentos' };
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const formatValue = (value: number | null | undefined, format: Format = 'currency') =>
  value == null ? '—' : format === 'currency' ? money(value) : format === 'number'
    ? new Intl.NumberFormat('pt-BR').format(value)
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
const toYmd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const displayDate = (raw: string) => { const parts = raw.slice(0, 10).split('-'); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw; };
const monthLabel = (raw: string) => { const [year, month] = raw.split('-').map(Number); return year && month ? new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1)).replace('.', '') : raw; };
const dateFromString = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
function periodFor(preset: Preset): Period {
  const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()); const end = new Date(start);
  if (preset === 'last7') start.setDate(start.getDate() - 6);
  else if (preset === 'last30') start.setDate(start.getDate() - 29);
  else if (preset === 'last6Months') { start.setDate(1); start.setMonth(start.getMonth() - 5); }
  else if (preset === 'previousMonth') { start.setDate(1); start.setMonth(start.getMonth() - 1); end.setDate(0); }
  else if (preset !== 'today') start.setDate(1);
  return { startDate: toYmd(start), endDate: toYmd(end) };
}
function previousPeriod(period: Period): Period {
  const start = dateFromString(period.startDate), end = dateFromString(period.endDate);
  const duration = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - duration + 1);
  return { startDate: toYmd(previousStart), endDate: toYmd(previousEnd) };
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && toYmd(dateFromString(value)) === value;

function Metric({ title, value, description, icon, format = 'currency', positive = false, loading = false }: {
  title: string; value: number | null | undefined; description: string; icon: IconName; format?: Format; positive?: boolean; loading?: boolean;
}) {
  return <View style={s.metric}>
    <View style={s.metricHeader}><Text style={s.metricTitle}>{title}</Text><Ionicons name={icon} size={22} color={C.gold}/></View>
    {loading ? <ActivityIndicator color={C.gold} style={s.metricSpinner}/> : <Text style={[s.metricValue, positive && value != null && { color: value < 0 ? C.red : C.green }]}>{formatValue(value, format)}</Text>}
    <Text style={s.metricDescription}>{description}</Text>
  </View>;
}
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <View style={s.sectionWrap}><Text style={s.sectionTitle}>{title}</Text>{subtitle ? <Text style={s.sectionSubtitle}>{subtitle}</Text> : null}{children}</View>;
}
function Panel({ children }: { children: ReactNode }) { return <View style={s.panel}>{children}</View>; }
function StatRow({ title, value, loading, highlighted = false }: { title: string; value: number | null | undefined; loading: boolean; highlighted?: boolean }) {
  return <View style={[s.statRow, highlighted && s.statHighlight]}><Text style={[s.statName, highlighted && s.strong]}>{title}</Text>
    {loading ? <ActivityIndicator color={C.gold} size="small"/> : <Text style={s.statValue}>{formatValue(value)}</Text>}</View>;
}
function Progress({ title, value, color, loading }: { title: string; value: number | null | undefined; color: string; loading: boolean }) {
  const percent = loading || value == null ? 0 : Math.max(0, Math.min(100, value));
  return <View style={s.progressBlock}><View style={s.progressHead}><Text style={s.progressLabel}>{title}</Text><Text style={s.progressPercent}>{loading ? '—' : formatValue(value, 'percentage')}</Text></View>
    <View style={s.progressTrack}><View style={[s.progressFill, { width: `${percent}%` as `${number}%`, backgroundColor: color }]}/></View></View>;
}
export default function RelatoriosScreen() {
  const [preset, setPreset] = useState<Preset>('currentMonth');
  const [period, setPeriod] = useState<Period>(() => periodFor('currentMonth'));
  const [reports, setReports] = useState<Reports>(EMPTY);
  const [failed, setFailed] = useState<ReportKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportType, setExportType] = useState<ReportExportType>('ALL');
  const [exportFormat, setExportFormat] = useState<ReportExportFormat>('PDF');
  const [exporting, setExporting] = useState(false);
  const [exportDialog, setExportDialog] = useState<'type' | 'format' | null>(null);
  const valid = validDate(period.startDate) && validDate(period.endDate) && period.startDate <= period.endDate;
  const previous = useMemo(() => valid ? previousPeriod(period) : null, [period.startDate, period.endDate, valid]);

  const loadReports = useCallback(async (signal: AbortSignal) => {
    if (!valid) { setLoading(false); setRefreshing(false); return; }
    setLoading(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'null' || token === 'undefined') { router.replace('/'); return; }
      const headers = { Authorization: `Bearer ${token}` };
      const keys = Object.keys(ENDPOINTS) as ReportKey[];
      const old = previousPeriod(period);
      const results = await Promise.allSettled(keys.map(key => api.get(ENDPOINTS[key], {
        headers, signal, params: key === 'comparison'
          ? { ...period, previousStartDate: old.startDate, previousEndDate: old.endDate }
          : period,
      })));
      if (signal.aborted) return;
      const data: Reports = { ...EMPTY };
      const errors: ReportKey[] = [];
      results.forEach((item, index) => {
        const key = keys[index];
        if (item.status === 'fulfilled') (data as Record<ReportKey, unknown>)[key] = item.value.data;
        else errors.push(key);
      });
      setReports(data); setFailed(errors);
      if (results.every(item => item.status === 'rejected')) {
        const authFailure = results.some(item => item.status === 'rejected' && axios.isAxiosError(item.reason) && item.reason.response?.status === 401);
        if (authFailure) { await SecureStore.deleteItemAsync('access_token'); router.replace('/'); }
      }
    } catch (error) {
      if (!signal.aborted && !axios.isCancel(error)) { setReports(EMPTY); setFailed(Object.keys(ENDPOINTS) as ReportKey[]); }
    } finally { if (!signal.aborted) { setLoading(false); setRefreshing(false); } }
  }, [period.startDate, period.endDate, valid]);
  useEffect(() => { const controller = new AbortController(); void loadReports(controller.signal); return () => controller.abort(); }, [loadReports, reload]);
  const downloadReport = async () => {
    if (exporting || !valid) return;
    setExporting(true);
    try {
      await exportReport(period, exportFormat, exportType);
    } catch (error) {
      Alert.alert('Erro na exportação', error instanceof Error ? error.message : 'Não foi possível exportar o relatório.');
    } finally {
      setExporting(false);
    }
  };
  const refresh = () => { if (loading || !valid) return; setRefreshing(true); setReload(v => v + 1); };
  const choosePreset = (next: Preset) => { setPreset(next); if (next !== 'custom') setPeriod(periodFor(next)); };
  const navigate = (route?: string, label?: string) => {
    setMenuOpen(false);
    if (!route) { Alert.alert(label ?? 'Página', 'Esta seção ainda não foi implementada no aplicativo mobile.'); return; }
    if (route !== '/relatorios') router.push(route as never);
  };
  const logout = async () => { setMenuOpen(false); await SecureStore.deleteItemAsync('access_token'); router.replace('/'); };
  const evolution = reports.evolution?.months ?? [];
  const maxRevenue = Math.max(1, ...evolution.map(item => Number(item.revenue) || 0));
  const transactions = reports.transactions?.transactions?.slice(0, 10) ?? [];
  const cmpItems = [
    { label: 'Recebimentos', key: 'revenue' as const, variation: 'revenuePercentage' as const },
    { label: 'Pagamentos', key: 'expenses' as const, variation: 'expensesPercentage' as const },
    { label: 'Lucro realizado', key: 'profit' as const, variation: 'profitPercentage' as const },
  ];
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.gold} colors={[C.gold]}/> } keyboardShouldPersistTaps="handled">
      <View style={s.topbar}>
        <Pressable style={s.iconButton} onPress={() => setMenuOpen(true)} accessibilityLabel="Abrir menu"><Ionicons name="menu-outline" size={27} color={C.ink}/></Pressable>
        <Text style={s.topbarTitle}>Relatórios</Text>
        <Pressable style={s.iconButton} onPress={refresh} accessibilityLabel="Atualizar"><Ionicons name="refresh-outline" size={21} color={C.gold}/></Pressable>
      </View>
      <Text style={s.eyebrow}>Gestão financeira</Text>
      <Text style={s.heading}>Relatórios</Text>
      <Text style={s.intro}>Entenda quanto o negócio vendeu, recebeu, gastou e teve de resultado.</Text>
      <Pressable style={s.backButton} onPress={() => navigate('/home')}><Ionicons name="arrow-back-outline" size={17} color={C.gold}/><Text style={s.backText}>Visão geral</Text></Pressable>

      <Panel>
        <View style={s.panelHeading}><Ionicons name="calendar-outline" size={22} color={C.gold}/><Text style={s.panelTitle}>Período de análise</Text></View>
        <Text style={s.muted}>Escolha as datas dos relatórios.</Text>
        <View style={s.chips}>{PRESETS.map(item => <Pressable key={item.value} onPress={() => choosePreset(item.value)} style={[s.chip, preset === item.value && s.chipActive]}><Text style={[s.chipText, preset === item.value && s.chipTextActive]}>{item.label}</Text></Pressable>)}</View>
        {preset === 'custom' && <View style={s.customPeriod}>
          <Text style={s.fieldLabel}>Data inicial (AAAA-MM-DD)</Text>
          <TextInput style={s.input} placeholder="2026-11-01" value={period.startDate} onChangeText={value => setPeriod(old => ({ ...old, startDate: value }))} keyboardType="numbers-and-punctuation" maxLength={10}/>
          <Text style={s.fieldLabel}>Data final (AAAA-MM-DD)</Text>
          <TextInput style={s.input} placeholder="2026-11-30" value={period.endDate} onChangeText={value => setPeriod(old => ({ ...old, endDate: value }))} keyboardType="numbers-and-punctuation" maxLength={10}/>
        </View>}
        {valid ? <Text style={s.periodLabel}><Ionicons name="time-outline" size={15} color={C.gold}/> {displayDate(period.startDate)} até {displayDate(period.endDate)}</Text>
          : <Text style={s.error}>Informe datas válidas. A data inicial não pode ser posterior à final.</Text>}
        <Pressable style={[s.outlineButton, (loading || !valid) && s.disabled]} disabled={loading || !valid} onPress={refresh}><Ionicons name="refresh-outline" size={17} color={C.gold}/><Text style={s.outlineText}>Atualizar</Text></Pressable>
      </Panel>

      <Panel>
        <View style={s.panelHeading}><Ionicons name="download-outline" size={22} color={C.gold}/><Text style={s.panelTitle}>Exportar relatórios</Text></View>
        <Text style={s.muted}>Exporte os dados do período selecionado em PDF ou Excel.</Text>
        <Pressable style={s.exportSelect} onPress={() => setExportDialog('type')} disabled={exporting} accessibilityRole="button">
          <Text style={s.exportSelectText}>Relatório: {EXPORT_LABELS[exportType]}</Text><Ionicons name="chevron-down" size={18} color={C.gold}/>
        </Pressable>
        <Pressable style={s.exportSelect} onPress={() => setExportDialog('format')} disabled={exporting} accessibilityRole="button">
          <Text style={s.exportSelectText}>Formato: {exportFormat === 'PDF' ? 'PDF' : 'Excel'}</Text><Ionicons name="chevron-down" size={18} color={C.gold}/>
        </Pressable>
        <Pressable style={[s.exportButton, (exporting || !valid) && s.disabled]} disabled={exporting || !valid} onPress={() => void downloadReport()} accessibilityRole="button">
          {exporting ? <ActivityIndicator color="#fff"/> : <Ionicons name="download-outline" size={19} color="#fff"/>}
          <Text style={s.exportButtonText}>{exporting ? 'Exportando...' : 'Baixar relatório'}</Text>
        </Pressable>
      </Panel>

      {failed.length > 0 && !loading && <View style={s.errorCard}><Text style={s.error}>Não foi possível carregar: {failed.map(key => LABELS[key]).join(', ')}.</Text><Pressable onPress={refresh}><Text style={s.retry}>Tentar novamente</Text></Pressable></View>}

      <Section title="Resultado do negócio" subtitle="Os principais valores financeiros do período">
        <Metric title="Faturamento bruto" description="Valor total das vendas, mesmo as ainda não recebidas" icon="bag-outline" value={reports.overview?.expectedRevenue} loading={loading}/>
        <Metric title="Dinheiro recebido" description="Valor das vendas que já foi recebido" icon="wallet-outline" value={reports.overview?.receivedRevenue} loading={loading}/>
        <Metric title="Lucro líquido previsto" description="Total vendido menos as despesas previstas" icon="trending-up-outline" value={reports.overview?.expectedProfit} loading={loading} positive/>
        <Metric title="Lucro líquido realizado" description="Dinheiro recebido menos despesas pagas" icon="analytics-outline" value={reports.overview?.realizedProfit} loading={loading} positive/>
      </Section>

      <Section title="Evolução dos recebimentos" subtitle="Dinheiro efetivamente recebido das vendas em cada mês">
        <Panel>
          <Text style={s.muted}>Total recebido no período</Text>
          <Text style={s.bigValue}>{loading ? 'Carregando...' : formatValue(reports.evolution?.totalRevenue)}</Text>
          {loading ? <ActivityIndicator color={C.gold} style={s.loader}/> : !evolution.length ? <Text style={s.empty}>Nenhum dado de faturamento encontrado neste período.</Text> : <View style={s.chart}>
            {evolution.map(item => <View key={item.month} style={s.chartItem}>
              <Text style={s.chartValue}>{new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(item.revenue)}</Text>
              <View style={s.chartTrack}><View style={[s.chartBar, { height: `${Math.max(2, Math.min(100, item.revenue / maxRevenue * 100))}%` as `${number}%` }]}/></View>
              <Text style={s.chartMonth}>{monthLabel(item.month)}</Text>
            </View>)}
          </View>}
          <Text style={s.muted}>Valores efetivamente recebidos em cada mês, considerando as datas das movimentações financeiras.</Text>
        </Panel>
      </Section>

      <Section title="Desempenho das vendas" subtitle="Quantidade de vendas e valores ainda a receber">
        <Metric title="Vendas realizadas" description="Quantidade de vendas registradas" icon="receipt-outline" value={reports.sales?.totalSales} format="number" loading={loading}/>
        <Metric title="Valor médio por venda" description="Quanto cada venda representa, em média" icon="wallet-outline" value={reports.sales?.averageTicket} loading={loading}/>
        <Metric title="Falta receber" description="Valor que os clientes ainda precisam pagar" icon="time-outline" value={reports.sales?.outstandingAmount} loading={loading}/>
        <Metric title="Recebimentos sobre vendas" description="Relação entre recebimentos do período e vendas registradas" icon="pie-chart-outline" value={reports.sales?.receivedPercentage} format="percentage" loading={loading}/>
        <Pressable style={s.sectionLink} onPress={() => navigate('/vendas')}><Text style={s.linkText}>Ver vendas</Text><Ionicons name="arrow-forward-outline" size={16} color={C.gold}/></Pressable>
      </Section>

      <Section title="Controle de despesas" subtitle="Gastos registrados e pagamentos pendentes">
        <Metric title="Despesas registradas" description="Quantidade de despesas lançadas" icon="receipt-outline" value={reports.expenses?.totalExpenses} format="number" loading={loading}/>
        <Metric title="Total de despesas" description="Soma de todos os gastos previstos" icon="cash-outline" value={reports.expenses?.expectedAmount} loading={loading}/>
        <Metric title="Despesas já pagas" description="Valor efetivamente pago" icon="arrow-down-outline" value={reports.expenses?.paidAmount} loading={loading}/>
        <Metric title="Falta pagar" description="Valor que ainda precisa ser pago" icon="time-outline" value={reports.expenses?.outstandingAmount} loading={loading}/>
        <Metric title="Contas em aberto" description="Despesas ainda não quitadas" icon="document-text-outline" value={reports.expenses?.pendingExpenses} format="number" loading={loading}/>
        <Metric title="Pagamentos sobre despesas" description="Relação entre pagamentos e despesas previstas" icon="pie-chart-outline" value={reports.expenses?.paidPercentage} format="percentage" loading={loading}/>
        <Pressable style={s.sectionLink} onPress={() => navigate('/despesas')}><Text style={s.linkText}>Ver despesas</Text><Ionicons name="arrow-forward-outline" size={16} color={C.gold}/></Pressable>
      </Section>

      <Section title="Recebimentos das vendas" subtitle="Dinheiro recebido e valores pendentes">
        <Panel>
          <StatRow title="Total vendido" value={reports.sales?.totalRevenue} loading={loading}/>
          <StatRow title="Já recebido" value={reports.sales?.receivedAmount} loading={loading}/>
          <StatRow title="Ainda a receber" value={reports.sales?.outstandingAmount} loading={loading} highlighted/>
          <Progress title="Recebimentos do período sobre vendas registradas" value={reports.sales?.receivedPercentage} loading={loading} color={C.green}/>
        </Panel>
      </Section>
      <Section title="Pagamentos das despesas" subtitle="Dinheiro pago e contas pendentes">
        <Panel>
          <StatRow title="Total de despesas" value={reports.expenses?.expectedAmount} loading={loading}/>
          <StatRow title="Já pago" value={reports.expenses?.paidAmount} loading={loading}/>
          <StatRow title="Ainda a pagar" value={reports.expenses?.outstandingAmount} loading={loading} highlighted/>
          <Progress title="Pagamentos do período sobre despesas previstas" value={reports.expenses?.paidPercentage} loading={loading} color={C.red}/>
        </Panel>
      </Section>

      <Section title="Movimentações financeiras" subtitle="Entradas e saídas vinculadas às operações do período">
        <Metric title="Entradas" description="Valores recebidos das vendas" icon="arrow-down-circle-outline" value={reports.transactions?.totalEntries} loading={loading}/>
        <Metric title="Saídas" description="Valores pagos em despesas" icon="arrow-up-circle-outline" value={reports.transactions?.totalExits} loading={loading}/>
        <Metric title="Saldo das movimentações" description="Entradas menos saídas" icon="wallet-outline" value={reports.transactions?.balance} loading={loading} positive/>
        <Panel><Text style={s.panelTitle}>Últimas movimentações do período</Text><Text style={s.muted}>Até 10 registros, ordenados pela data efetiva</Text>
          {loading ? <ActivityIndicator color={C.gold} style={s.loader}/> : !transactions.length ? <Text style={s.empty}>Nenhuma movimentação encontrada neste período.</Text> : transactions.map(item => <View style={s.transaction} key={`${item.type}-${item.id}`}>
            <View style={s.transactionHead}><Ionicons name={item.type === 'ENTRY' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={23} color={item.type === 'ENTRY' ? C.green : C.red}/><Text style={s.transactionTitle}>{item.description}</Text></View>
            <Text style={s.muted}>{item.type === 'ENTRY' ? 'Entrada' : 'Saída'} · {displayDate(item.referenceDate)}</Text>
            <Text style={[s.transactionAmount, { color: item.type === 'ENTRY' ? C.green : C.red }]}>{item.type === 'ENTRY' ? '+' : '−'} {formatValue(item.amount)}</Text>
          </View>)}
          <Pressable style={s.sectionLink} onPress={() => navigate('/movimentacoes')}><Text style={s.linkText}>Ver histórico financeiro</Text><Ionicons name="arrow-forward-outline" size={16} color={C.gold}/></Pressable>
        </Panel>
      </Section>

      <Section title="Fluxo de caixa" subtitle="Entradas, saídas e saldo pelas datas efetivas das movimentações financeiras">
        <Metric title="Entradas do período" description="Total das entradas consideradas no fluxo" icon="arrow-down-outline" value={reports.cashFlow?.totalEntries} loading={loading}/>
        <Metric title="Saídas do período" description="Total das saídas consideradas no fluxo" icon="arrow-up-outline" value={reports.cashFlow?.totalExits} loading={loading}/>
        <Metric title="Saldo do período" description="Diferença entre entradas e saídas" icon="wallet-outline" value={reports.cashFlow?.balance} loading={loading} positive/>
        <Panel><Text style={s.panelTitle}>Fluxo diário</Text><Text style={s.muted}>Movimentações agrupadas pela data efetiva de cada pagamento ou recebimento</Text>
          {loading ? <ActivityIndicator color={C.gold} style={s.loader}/> : !reports.cashFlow?.days?.length ? <Text style={s.empty}>Nenhuma movimentação encontrada neste período.</Text> : reports.cashFlow.days.map(day => <View key={day.date} style={s.day}>
            <Text style={s.dayTitle}>{displayDate(day.date)}</Text><StatRow title="Entradas" value={day.entries} loading={false}/><StatRow title="Saídas" value={day.exits} loading={false}/><StatRow title="Saldo diário" value={day.balance} loading={false} highlighted/>
          </View>)}
        </Panel>
      </Section>

      <Section title="Comparação de períodos" subtitle="Compare o período selecionado com o intervalo imediatamente anterior de mesma duração">
        {previous && <Text style={s.muted}>Atual: {displayDate(period.startDate)} a {displayDate(period.endDate)} · Anterior: {displayDate(previous.startDate)} a {displayDate(previous.endDate)}</Text>}
        {cmpItems.map(item => <Panel key={item.key}><Text style={s.panelTitle}>{item.label}</Text>
          <Text style={s.statName}>Período atual</Text><Text style={s.cmpValue}>{loading ? 'Carregando...' : formatValue(reports.comparison?.currentPeriod?.[item.key])}</Text>
          <Text style={s.statName}>Período anterior</Text><Text style={s.cmpValue}>{loading ? 'Carregando...' : formatValue(reports.comparison?.previousPeriod?.[item.key])}</Text>
          <Text style={s.statName}>Variação</Text><Text style={[s.cmpValue, { color: (reports.comparison?.variations?.[item.variation] ?? 0) < 0 ? C.red : C.green }]}>{loading ? 'Carregando...' : formatValue(reports.comparison?.variations?.[item.variation], 'percentage')}</Text>
        </Panel>)}
      </Section>

      <Section title="Como o resultado é calculado?" subtitle="Comparação entre o que está previsto e o que já foi recebido ou pago">
        <Panel><Text style={s.panelTitle}>Lucro líquido previsto</Text><Text style={[s.bigValue, { color: (reports.overview?.expectedProfit ?? 0) < 0 ? C.red : C.green }]}>{loading ? 'Carregando...' : formatValue(reports.overview?.expectedProfit)}</Text><Text style={s.muted}>Faturamento total menos todas as despesas previstas.</Text></Panel>
        <Panel><Text style={s.panelTitle}>Lucro líquido realizado</Text><Text style={[s.bigValue, { color: (reports.overview?.realizedProfit ?? 0) < 0 ? C.red : C.green }]}>{loading ? 'Carregando...' : formatValue(reports.overview?.realizedProfit)}</Text><Text style={s.muted}>Valores recebidos das vendas menos despesas já pagas.</Text></Panel>
      </Section>
      <Pressable style={s.backButton} onPress={() => navigate('/home')}><Text style={s.backText}>Voltar ao início</Text><Ionicons name="arrow-forward-outline" size={17} color={C.gold}/></Pressable>
      <Text style={s.footer}>Personalité Creative · Sistema de gestão</Text>
    </ScrollView>

    <Modal visible={exportDialog !== null} transparent animationType="fade" onRequestClose={() => setExportDialog(null)}>
      <View style={s.exportOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setExportDialog(null)} accessibilityLabel="Fechar seleção"/>
        <View style={s.exportPicker}>
          <View style={s.exportPickerHead}><Text style={s.panelTitle}>Selecionar {exportDialog === 'type' ? 'relatório' : 'formato'}</Text><Pressable onPress={() => setExportDialog(null)}><Ionicons name="close" size={23} color={C.ink}/></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" style={s.exportPickerList}>
            {exportDialog === 'type'
              ? (Object.keys(EXPORT_LABELS) as ReportExportType[]).map(type => <Pressable key={type} style={s.exportPickerOption} onPress={() => { setExportType(type); setExportDialog(null); }}><Text style={s.exportSelectText}>{EXPORT_LABELS[type]}</Text>{exportType === type && <Ionicons name="checkmark" size={19} color={C.gold}/>}</Pressable>)
              : (['PDF', 'XLSX'] as ReportExportFormat[]).map(format => <Pressable key={format} style={s.exportPickerOption} onPress={() => { setExportFormat(format); setExportDialog(null); }}><Text style={s.exportSelectText}>{format === 'PDF' ? 'PDF' : 'Excel'}</Text>{exportFormat === format && <Ionicons name="checkmark" size={19} color={C.gold}/>}</Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>

    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={s.drawerOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu"/>
        <SafeAreaView edges={['top', 'bottom']} style={s.drawer}>
          <View style={s.drawerBrand}><Image source={require('../../assets/images/personalite-logo.png')} resizeMode="contain" style={s.drawerLogo}/>
            <View style={s.drawerBrandText}><Text style={s.drawerEyebrow}>PERSONALITÉ</Text><Text style={s.drawerTitle}>Creative</Text></View>
            <Pressable onPress={() => setMenuOpen(false)}><Ionicons name="close" size={24} color="#fff"/></Pressable></View>
          <ScrollView style={s.drawerScroll} contentContainerStyle={s.drawerContent}><Text style={s.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} onPress={() => navigate(item.route, item.label)} style={[s.drawerItem, item.route === '/relatorios' && s.drawerActive]}>
              <Ionicons name={item.icon} size={20} color="#eee7db"/><Text style={s.drawerItemText}>{item.label}</Text></Pressable>)}
            <Text style={s.drawerSection}>SISTEMA</Text><Pressable style={s.drawerItem} onPress={() => navigate('/perfil', 'Meu Perfil')}><Ionicons name="settings-outline" size={20} color="#eee7db"/><Text style={s.drawerItemText}>Meu Perfil</Text></Pressable>
          </ScrollView>
          <Pressable style={s.drawerLogout} onPress={() => void logout()}><Ionicons name="log-out-outline" size={20} color="#eee7db"/><Text style={s.drawerItemText}>Sair</Text></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  exportSelect: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 13, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  exportSelectText: { fontSize: 13, color: C.ink, lineHeight: 21, flexShrink: 1 },
  exportButton: { backgroundColor: C.gold, borderRadius: 11, minHeight: 48, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  exportButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  exportOverlay: { flex: 1, backgroundColor: '#0008', padding: 20, justifyContent: 'center' },
  exportPicker: { backgroundColor: '#fff', borderRadius: 16, padding: 17, maxHeight: '75%' },
  exportPickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  exportPickerList: { flexGrow: 0 },
  exportPickerOption: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  safe: { flex: 1, backgroundColor: C.bg }, content: { padding: 16, paddingBottom: 44 },
  topbar: { minHeight: 62, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10, marginBottom: 22 },
  iconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }, topbarTitle: { flex: 1, fontSize: 20, lineHeight: 30, fontWeight: '700', color: C.ink },
  eyebrow: { fontSize: 13, color: C.gold, fontWeight: '700', marginBottom: 6 }, heading: { fontSize: 30, lineHeight: 42, color: C.ink, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  intro: { fontSize: 14, lineHeight: 23, color: C.muted, marginTop: 6, marginBottom: 14 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 15, paddingVertical: 11, backgroundColor: C.white, marginBottom: 20 },
  backText: { color: C.gold, fontSize: 13, fontWeight: '700' },
  panel: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 17, marginBottom: 14 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 }, panelTitle: { color: C.ink, fontSize: 16, lineHeight: 26, fontWeight: '700', marginBottom: 7 },
  muted: { color: C.muted, fontSize: 12, lineHeight: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 16 }, chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.gold, borderColor: C.gold }, chipText: { color: C.muted, fontSize: 12, fontWeight: '700', lineHeight: 19 }, chipTextActive: { color: '#fff' },
  customPeriod: { gap: 7, marginBottom: 12 }, fieldLabel: { fontSize: 13, lineHeight: 22, fontWeight: '600', color: C.ink }, input: { borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 48, paddingHorizontal: 13, color: C.ink, fontSize: 14, marginBottom: 7 },
  periodLabel: { color: C.muted, fontSize: 12, marginVertical: 14 }, error: { color: C.red, fontSize: 13, lineHeight: 21 }, errorCard: { backgroundColor: '#fff2f2', borderWidth: 1, borderColor: '#fecaca', padding: 14, borderRadius: 12, marginBottom: 18 },
  retry: { color: C.red, fontWeight: '700', marginTop: 9 }, outlineButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', gap: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 10 },
  outlineText: { color: C.gold, fontWeight: '700', fontSize: 13 }, disabled: { opacity: 0.45 },
  sectionWrap: { marginTop: 21 }, sectionTitle: { fontSize: 20, lineHeight: 30, fontWeight: '700', color: C.ink, marginBottom: 4 }, sectionSubtitle: { color: C.muted, fontSize: 12, lineHeight: 20, marginBottom: 15 },
  metric: { backgroundColor: C.white, borderRadius: 15, borderWidth: 1, borderColor: C.border, padding: 17, marginBottom: 10 },
  metricHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, metricTitle: { flex: 1, fontSize: 14, lineHeight: 23, color: C.muted },
  metricValue: { fontSize: 24, lineHeight: 35, color: C.ink, fontWeight: '700', marginTop: 12 }, metricDescription: { fontSize: 12, lineHeight: 20, color: C.muted, marginTop: 10 }, metricSpinner: { alignSelf: 'flex-start', marginTop: 17 },
  bigValue: { fontSize: 24, lineHeight: 35, color: C.ink, fontWeight: '700', marginBottom: 13 }, loader: { marginVertical: 22 }, empty: { textAlign: 'center', color: C.muted, fontSize: 13, lineHeight: 22, paddingVertical: 20 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, minHeight: 240, marginVertical: 18, paddingBottom: 8 }, chartItem: { flex: 1, minWidth: 0, alignItems: 'center' },
  chartValue: { fontSize: 9, color: C.muted, marginBottom: 5 }, chartTrack: { height: 178, width: '100%', justifyContent: 'flex-end', alignItems: 'center' }, chartBar: { backgroundColor: C.gold, width: '78%', borderTopLeftRadius: 6, borderTopRightRadius: 6 }, chartMonth: { fontSize: 9, color: C.muted, marginTop: 7, textAlign: 'center' },
  sectionLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginVertical: 9 }, linkText: { color: C.gold, fontSize: 13, fontWeight: '700' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 14 }, statHighlight: { borderTopWidth: 1, borderColor: C.border }, statName: { color: C.muted, fontSize: 13, lineHeight: 22, flex: 1 }, statValue: { color: C.ink, fontSize: 13, fontWeight: '700', lineHeight: 22, textAlign: 'right' }, strong: { fontWeight: '700', color: C.ink },
  progressBlock: { marginTop: 17 }, progressHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 12 }, progressLabel: { flex: 1, fontSize: 12, color: C.muted, lineHeight: 20 }, progressPercent: { fontSize: 12, fontWeight: '700', color: C.ink }, progressTrack: { height: 12, backgroundColor: '#f0ece5', overflow: 'hidden', borderRadius: 8 }, progressFill: { height: 12, borderRadius: 8 },
  transaction: { borderTopWidth: 1, borderColor: C.border, paddingVertical: 15 }, transactionHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, transactionTitle: { flex: 1, fontSize: 14, lineHeight: 24, color: C.ink, fontWeight: '600' }, transactionAmount: { fontSize: 15, lineHeight: 25, fontWeight: '700' },
  day: { borderTopWidth: 1, borderColor: C.border, paddingVertical: 12 }, dayTitle: { fontSize: 14, fontWeight: '700', color: C.ink, marginBottom: 6 }, cmpValue: { fontSize: 17, lineHeight: 29, fontWeight: '700', color: C.ink, marginBottom: 12 },
  footer: { textAlign: 'center', marginTop: 15, color: C.muted, fontSize: 12 },
  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: '#0008' }, drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: C.menu },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 19, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  drawerLogo: { width: 56, height: 65 }, drawerBrandText: { flex: 1 }, drawerEyebrow: { color: '#d5bd91', fontSize: 10, letterSpacing: 2, fontWeight: '700' }, drawerTitle: { color: '#fff', fontSize: 21, fontFamily: 'serif' },
  drawerScroll: { flex: 1 }, drawerContent: { paddingHorizontal: 13, paddingTop: 22, paddingBottom: 28 }, drawerSection: { fontSize: 10, fontWeight: '700', color: '#b1a698', letterSpacing: 1.7, marginBottom: 12, marginTop: 18 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, minHeight: 49, borderRadius: 10, marginBottom: 4 }, drawerActive: { backgroundColor: '#665949' }, drawerItemText: { fontSize: 14, lineHeight: 24, fontWeight: '600', color: '#eee7db' },
  drawerLogout: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 26, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
