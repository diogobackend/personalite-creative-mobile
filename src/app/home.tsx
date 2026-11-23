import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import {
  exportReport,
  getCashFlowReport, getComparisonReport,
  getExpensesReport,
  getReportOverview,
  getRevenueEvolutionReport,
  getSalesReport,
  getTransactionsReport,
  type ExpensesReport,
  type ReportCashFlow, type ReportComparison,
  type ReportExportFormat,
  type ReportExportType,
  type ReportOverview,
  type ReportRevenueEvolution,
  type ReportTransactions,
  type SalesReport,
} from '../services/reportService';

type IconName = keyof typeof Ionicons.glyphMap;
type ValueFormat = 'currency' | 'number' | 'percentage';
type Metric = {
  title: string;
  description: string;
  icon: IconName;
  value?: number | null;
  format?: ValueFormat;
};

const COLORS = {
  background: '#f8f6f2',
  card: '#ffffff',
  dark: '#342d27',
  gold: '#a98a58',
  goldBackground: '#f7f2e9',
  border: '#ece6dc',
  muted: '#78716c',
  subdued: '#a8a29e',
  green: '#047857',
  red: '#dc2626',
};

// A Home utiliza apenas dados reais. Os valores serão preenchidos quando
// o serviço de relatórios do frontend for adaptado para o mobile.
const overviewMetrics: Metric[] = [
  { title: 'Faturamento bruto', description: 'Total vendido, incluindo valores pendentes', icon: 'bag-outline' },
  { title: 'Dinheiro recebido', description: 'Recebimentos efetivos no mês', icon: 'wallet-outline' },
  { title: 'Lucro líquido previsto', description: 'Vendas menos despesas previstas', icon: 'analytics-outline' },
  { title: 'Lucro líquido realizado', description: 'Recebimentos menos pagamentos efetivos', icon: 'trending-up-outline' },
];

const salesMetrics: Metric[] = [
  { title: 'Vendas realizadas', description: 'Quantidade de vendas do mês', icon: 'receipt-outline', format: 'number' },
  { title: 'Valor médio por venda', description: 'Valor médio das vendas', icon: 'wallet-outline' },
  { title: 'Falta receber', description: 'Valor ainda não recebido', icon: 'time-outline' },
  { title: 'Recebimentos sobre vendas', description: 'Relação entre recebimentos e vendas', icon: 'pie-chart-outline', format: 'percentage' },
];

const expenseMetrics: Metric[] = [
  { title: 'Despesas registradas', description: 'Quantidade de despesas lançadas', icon: 'receipt-outline', format: 'number' },
  { title: 'Total de despesas', description: 'Gastos previstos para o mês', icon: 'cash-outline' },
  { title: 'Despesas já pagas', description: 'Pagamentos efetivos do mês', icon: 'arrow-down-outline' },
  { title: 'Falta pagar', description: 'Despesas ainda pendentes', icon: 'time-outline' },
  { title: 'Contas em aberto', description: 'Despesas ainda não quitadas', icon: 'clipboard-outline', format: 'number' },
  { title: 'Pagamentos sobre despesas', description: 'Relação entre pagamentos e despesas', icon: 'pie-chart-outline', format: 'percentage' },
];

const movementMetrics: Metric[] = [
  { title: 'Entradas', description: 'Recebimentos efetivos do mês', icon: 'arrow-up-outline' },
  { title: 'Saídas', description: 'Pagamentos efetivos do mês', icon: 'arrow-down-outline' },
  { title: 'Saldo das movimentações', description: 'Entradas menos saídas', icon: 'wallet-outline' },
];

const cashFlowMetrics: Metric[] = [
  { title: 'Entradas do período', description: 'Valores recebidos', icon: 'arrow-up-outline' },
  { title: 'Saídas do período', description: 'Valores pagos', icon: 'arrow-down-outline' },
  { title: 'Saldo do período', description: 'Diferença entre entradas e saídas', icon: 'wallet-outline' },
];

const sidebarNavigation: {
  label: string;
  icon: IconName;
  route?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' | '/estoque' | '/despesas' | '/relatorios';
}[] = [
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

const shortcuts: { title: string; description: string; icon: IconName }[] = [
  { title: 'Cadastrar produto', description: 'Adicionar novo item', icon: 'gift-outline' },
  { title: 'Registrar venda', description: 'Criar novo pedido', icon: 'bag-outline' },
  { title: 'Lançar despesa', description: 'Registrar um gasto', icon: 'clipboard-outline' },
  { title: 'Ver relatórios', description: 'Analisar resultados', icon: 'analytics-outline' },
];

function isTokenExpired(token: string): boolean {
  const payload = token.split('.')[1];
  if (!payload) return false; // Tokens opacos são validados pela API.

  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const encoded = payload.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    let bits = 0;
    let buffer = 0;
    let decoded = '';

    for (const character of encoded) {
      const digit = alphabet.indexOf(character);
      if (digit < 0) return false;
      buffer = (buffer << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded += String.fromCharCode((buffer >>> bits) & 255);
      }
    }

    const expiry = decoded.match(/"exp"\s*:\s*(\d+)/);
    return expiry ? Number(expiry[1]) <= Math.floor(Date.now() / 1000) : false;
  } catch {
    return false;
  }
}

function getJwtSubject(token: string): string | null {
  const encoded = token.split('.')[1];
  if (!encoded) return null;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0, buffer = 0, data = '';
    for (const ch of encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
      const digit = alphabet.indexOf(ch);
      if (digit < 0) return null;
      buffer = (buffer << 6) | digit;
      bits += 6;
      if (bits >= 8) { bits -= 8; data += String.fromCharCode((buffer >>> bits) & 255); }
    }
    const payload = JSON.parse(data) as { sub?: string };
    return payload.sub || null;
  } catch { return null; }
}

function ValueText({ value, format = 'currency', emphasis = false }: {
  value?: number | null;
  format?: ValueFormat;
  emphasis?: boolean;
}) {
  let formatted = '—';
  if (typeof value === 'number') {
    if (format === 'currency') {
      formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    } else if (format === 'percentage') {
      formatted = `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
    } else {
      formatted = new Intl.NumberFormat('pt-BR').format(value);
    }
  }
  return <Text style={emphasis ? styles.largeValue : styles.value} adjustsFontSizeToFit numberOfLines={1}>{formatted}</Text>;
}

function Section({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      {children}
    </View>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardLabel}>{metric.title}</Text>
        <View style={styles.iconBox}><Ionicons name={metric.icon} size={21} color={COLORS.gold} /></View>
      </View>
      <ValueText value={metric.value} format={metric.format} emphasis />
      <Text style={styles.cardDescription}>{metric.description}</Text>
    </View>
  );
}

function MetricList({ metrics }: { metrics: Metric[] }) {
  return <View style={styles.metricList}>{metrics.map((metric) => <MetricCard key={metric.title} metric={metric} />)}</View>;
}

function FinancialLine({ label, icon, value }: { label: string; icon: IconName; value?: number | null }) {
  return (
    <View style={styles.financialLine}>
      <View style={styles.financialLabel}>
        <View style={styles.smallIcon}><Ionicons name={icon} size={18} color={COLORS.gold} /></View>
        <Text style={styles.financialText}>{label}</Text>
      </View>
      <ValueText value={value} />
    </View>
  );
}

function DetailCard({ title, labels }: { title: string; labels: { label: string; icon: IconName; value?: number | null }[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.detailTitle}>{title}</Text>
      {labels.map((item) => <FinancialLine key={item.label} label={item.label} icon={item.icon} value={item.value} />)}
    </View>
  );
}

const EXPORT_LABELS: Record<ReportExportType, string> = {
  ALL: 'Todos os relatórios', OVERVIEW: 'Visão geral', SALES: 'Vendas',
  EXPENSES: 'Despesas', TRANSACTIONS: 'Movimentações', CASH_FLOW: 'Fluxo de caixa',
  COMPARISON: 'Comparação de períodos', REVENUE_EVOLUTION: 'Evolução dos recebimentos',
};
function formatMoney(value: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
function formatPercent(value: number | null) { return value == null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`; }

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function periods() {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    startDate: dateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: dateString(now),
    previousStartDate: dateString(previous),
    previousEndDate: dateString(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}
function evolutionPeriod() {
  const now = new Date();
  return { startDate: dateString(new Date(now.getFullYear(), now.getMonth() - 5, 1)), endDate: dateString(now) };
}
function populate(metrics: Metric[], values: (number | null | undefined)[]) {
  return metrics.map((metric, index) => ({ ...metric, value: values[index] }));
}
function Progress({ value, color }: { value?: number | null; color: string }) {
  const width = `${Math.max(0, Math.min(100, value ?? 0))}%` as `${number}%`;
  return <View style={styles.progressTrack}><View style={{ width, height: '100%', backgroundColor: color, borderRadius: 10 }} /></View>;
}
function ErrorNotice({ visible, onRetry }: { visible: boolean; onRetry: () => void }) {
  return visible ? <Pressable onPress={onRetry} style={styles.errorBox}>
    <Text style={styles.errorMessage}>Não foi possível carregar alguns relatórios. Toque para tentar novamente.</Text>
  </Pressable> : null;
}

export default function HomeScreen() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [overview, setOverview] = useState<ReportOverview | null>(null);
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [expenses, setExpenses] = useState<ExpensesReport | null>(null);
  const [transactions, setTransactions] = useState<ReportTransactions | null>(null);
  const [cashFlow, setCashFlow] = useState<ReportCashFlow | null>(null);
  const [comparison, setComparison] = useState<ReportComparison | null>(null);
  const [evolution, setEvolution] = useState<ReportRevenueEvolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState<ReportExportType>('ALL');
  const [exportFormat, setExportFormat] = useState<ReportExportFormat>('PDF');
  const [exportDialog, setExportDialog] = useState<'type' | 'format' | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    const period = periods();
    const tasks = [
      getReportOverview(), getSalesReport(), getExpensesReport(), getTransactionsReport(),
      getCashFlowReport(), getComparisonReport(period), getRevenueEvolutionReport(evolutionPeriod()),
    ] as const;
    const results = await Promise.allSettled(tasks);
    const labels = ['Visão geral', 'Vendas', 'Despesas', 'Movimentações', 'Fluxo de caixa', 'Comparação', 'Evolução'];
    setFailed(results.flatMap((result, i) => result.status === 'rejected' ? [labels[i]] : []));
    const assign = <T,>(index: number, setter: (value: T | null) => void) => {
      const result = results[index];
      setter(result.status === 'fulfilled' ? result.value as T : null);
    };
    assign(0, setOverview); assign(1, setSales); assign(2, setExpenses);
    assign(3, setTransactions); assign(4, setCashFlow); assign(5, setComparison); assign(6, setEvolution);
    setLoading(false);
  }, []);

  useEffect(() => { void loadReports(); }, [loadReports]);

  async function downloadReport() {
    if (exporting) return;
    setExporting(true);
    try {
      const { startDate, endDate } = periods();
      await exportReport({ startDate, endDate }, exportFormat, exportType);
    } catch (error) {
      Alert.alert('Erro na exportação', error instanceof Error ? error.message : 'Não foi possível exportar o relatório.');
    } finally {
      setExporting(false);
    }
  }


  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (!token || isTokenExpired(token)) {
          if (active) router.replace('/');
          return;
        }
        const userId = getJwtSubject(token);
        if (userId) {
          try {
            const { data } = await api.get<{ name: string }>('/users/id', { params: { userId } });
            if (active) setUserName(data.name);
          } catch { /* A identificação visual não impede o Dashboard. */ }
        }
      } catch {
        if (active) router.replace('/');
      } finally {
        if (active) setCheckingSession(false);
      }
    };
    void checkSession();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkSession();
    });
    return () => { active = false; subscription.remove(); };
  }, []);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await SecureStore.deleteItemAsync('access_token');
      router.replace('/');
    } finally {
      setLoggingOut(false);
    }
  };

  const openPage = (
  label: string,
  route?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' | '/estoque' | '/despesas' | '/relatorios'
) => {
  setMenuOpen(false);

  if (route) {
    router.push(route);
    return;
  }

  Alert.alert(
    label,
    'Esta seção ainda não foi implementada no aplicativo mobile.'
  );
};

  if (checkingSession) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color={COLORS.gold} />
      </SafeAreaView>
    );
  }

  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadReports()} tintColor={COLORS.gold} colors={[COLORS.gold]} />}>
        <View style={styles.header}>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Abrir menu">
            <Ionicons name="menu" size={27} color={COLORS.dark} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>PAINEL DE CONTROLE</Text>
            <Text style={styles.pageTitle}>Personalité Creative</Text>
          </View>
          <Pressable onPress={() => void logout()} disabled={loggingOut} style={styles.logoutButton} accessibilityLabel="Sair da conta">
            {loggingOut ? <ActivityIndicator color={COLORS.gold} /> : <Ionicons name="log-out-outline" size={23} color={COLORS.gold} />}
          </Pressable>
        </View>

        <View style={styles.periodBlock}>
          <Ionicons name="calendar-outline" size={19} color={COLORS.gold} />
          <View style={styles.periodCopy}>
            <Text style={styles.periodTitle}>{month.charAt(0).toUpperCase() + month.slice(1)}</Text>
            <Text style={styles.periodCaption}>Resumo das vendas, despesas e resultados do mês</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable style={styles.controlButton} onPress={() => void loadReports()} disabled={loading}>
            <Ionicons name="refresh-outline" size={18} color={COLORS.gold} /><Text style={styles.controlText}>Atualizar</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.detailTitle}>Exportar relatórios</Text>
          <Text style={styles.cardDescription}>Baixe os dados financeiros do mês em PDF ou Excel.</Text>
          <Pressable style={styles.selectButton} onPress={() => setExportDialog('type')}><Text style={styles.selectText}>Relatório: {EXPORT_LABELS[exportType]}</Text><Ionicons name="chevron-down" size={17} color={COLORS.gold}/></Pressable>
          <Pressable style={styles.selectButton} onPress={() => setExportDialog('format')}><Text style={styles.selectText}>Formato: {exportFormat === 'PDF' ? 'PDF' : 'Excel'}</Text><Ionicons name="chevron-down" size={17} color={COLORS.gold}/></Pressable>
          <Pressable style={styles.exportButton} disabled={exporting} onPress={() => void downloadReport()}>
            {exporting ? <ActivityIndicator color="#fff"/> : <Ionicons name="download-outline" size={18} color="#fff"/>}
            <Text style={styles.exportButtonText}>{exporting ? 'Exportando...' : 'Baixar relatório'}</Text>
          </Pressable>
        </View>
        <ErrorNotice visible={failed.length > 0} onRetry={() => void loadReports()} />

        <Section title="Visão geral do negócio" subtitle="Quanto você vendeu, recebeu e teve de resultado">
          <MetricList metrics={populate(overviewMetrics, [overview?.expectedRevenue, overview?.receivedRevenue, overview?.expectedProfit, overview?.realizedProfit])} />
        </Section>

        <Section title="Evolução dos recebimentos" subtitle="Recebimentos efetivos das vendas nos últimos seis meses">
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardLabel}>Total no período</Text>
              <View style={styles.iconBox}><Ionicons name="trending-up-outline" size={21} color={COLORS.gold} /></View>
            </View>
            <ValueText emphasis value={evolution?.totalRevenue} />
            <View style={styles.chart}>
              {evolution?.months?.length ? evolution.months.map((item) => {
                const maximum = Math.max(1, ...evolution.months.map(m => m.revenue));
                const height = Math.max(3, (Math.max(0, item.revenue) / maximum) * 135);
                const [, monthNumber] = item.month.split('-').map(Number);
                const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(2024, monthNumber - 1, 1)).replace('.', '');
                return <View style={styles.chartColumn} key={item.month}>
                  <Text style={styles.chartValue} numberOfLines={1} adjustsFontSizeToFit>{new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(item.revenue)}</Text>
                  <View style={[styles.chartBar, { height }]} />
                  <Text style={styles.chartMonth}>{monthName}</Text>
                </View>;
              }) : <Text style={styles.emptyText}>{loading ? 'Carregando recebimentos...' : 'Nenhum recebimento encontrado.'}</Text>}
            </View>
            <Text style={styles.cardDescription}>Valores recebidos por mês, conforme as movimentações financeiras.</Text>
          </View>
        </Section>

        <Section title="Como estão as vendas?" subtitle="Quantidade, valor médio e recebimentos">
          <MetricList metrics={populate(salesMetrics, [sales?.totalSales, sales?.averageTicket, sales?.outstandingAmount, sales?.receivedPercentage])} />
        </Section>

        <Section title="Como estão as despesas?" subtitle="O que foi registrado, pago e ainda falta pagar">
          <MetricList metrics={populate(expenseMetrics, [expenses?.totalExpenses, expenses?.expectedAmount, expenses?.paidAmount, expenses?.outstandingAmount, expenses?.pendingExpenses, expenses?.paidPercentage])} />
        </Section>

        <Section title="Dinheiro das vendas" subtitle="O que já entrou e o que ainda falta receber">
          <View style={styles.card}>
            <FinancialLine label="Já recebido" icon="arrow-up-outline" value={sales?.receivedAmount} />
            <FinancialLine label="Ainda a receber" icon="time-outline" value={sales?.outstandingAmount} />
            <Text style={styles.cardDescription}>Recebimentos em relação às vendas do mês</Text>
            <Progress value={sales?.receivedPercentage} color={COLORS.green} />
          </View>
        </Section>

        <Section title="Pagamento das despesas" subtitle="O que já foi pago e o que continua pendente">
          <View style={styles.card}>
            <FinancialLine label="Já pago" icon="checkmark-circle-outline" value={expenses?.paidAmount} />
            <FinancialLine label="Ainda a pagar" icon="time-outline" value={expenses?.outstandingAmount} />
            <Text style={styles.cardDescription}>Pagamentos em relação às despesas do mês</Text>
            <Progress value={expenses?.paidPercentage} color={COLORS.red} />
          </View>
        </Section>

        <Section title="Movimentações financeiras" subtitle="Entradas e saídas efetivas registradas no mês">
          <MetricList metrics={populate(movementMetrics, [transactions?.totalEntries, transactions?.totalExits, transactions?.balance])} />
        </Section>

        <Section title="Fluxo de caixa" subtitle="Entradas, saídas e saldo pelas datas das movimentações">
          <MetricList metrics={populate(cashFlowMetrics, [cashFlow?.totalEntries, cashFlow?.totalExits, cashFlow?.balance])} />
          <View style={styles.card}>
            <Text style={styles.detailTitle}>Movimentação por dia</Text>
            {cashFlow?.days?.length ? cashFlow.days.map((day) => <View style={styles.dayRow} key={day.date}>
              <Text style={styles.dayDate}>{day.date.split('-').reverse().join('/')}</Text>
              <Text style={styles.dayData}>Entradas: {formatMoney(day.entries)}   Saídas: {formatMoney(day.exits)}   Saldo: {formatMoney(day.balance)}</Text>
            </View>) : <Text style={styles.emptyText}>{loading ? 'Carregando...' : 'Nenhuma movimentação encontrada.'}</Text>}
          </View>
        </Section>

        <Section title="Detalhamento do resultado" subtitle="Como vendas e despesas compõem o resultado">
          <DetailCard title="Valores das vendas" labels={[
            { label: 'Total vendido', icon: 'bag-outline', value: overview?.expectedRevenue },
            { label: 'Já recebido', icon: 'wallet-outline', value: overview?.receivedRevenue },
            { label: 'Pendente de recebimento', icon: 'time-outline', value: overview?.outstandingRevenue },
          ]} />
          <DetailCard title="Valores das despesas" labels={[
            { label: 'Total previsto', icon: 'cash-outline', value: overview?.expectedExpenses },
            { label: 'Já pago', icon: 'arrow-down-outline', value: overview?.paidExpenses },
            { label: 'Pendente de pagamento', icon: 'time-outline', value: overview?.outstandingExpenses },
          ]} />
          <MetricList metrics={[
            { title: 'Lucro líquido previsto', description: 'Faturamento menos despesas previstas', icon: 'analytics-outline', value: overview?.expectedProfit },
            { title: 'Lucro líquido realizado', description: 'Recebimentos menos despesas pagas', icon: 'trending-up-outline', value: overview?.realizedProfit },
          ]} />
        </Section>

        <Section title="Comparação de períodos" subtitle="Desempenho do mês atual em relação ao anterior">
          <MetricList metrics={[
            { title: 'Recebimentos', description: 'Mês atual versus mês anterior', icon: 'bag-outline', value: comparison?.currentPeriod.revenue },
            { title: 'Pagamentos', description: 'Mês atual versus mês anterior', icon: 'cash-outline', value: comparison?.currentPeriod.expenses },
            { title: 'Lucro realizado', description: 'Mês atual versus mês anterior', icon: 'trending-up-outline', value: comparison?.currentPeriod.profit },
          ]} />
          {comparison && <View style={styles.card}>
            <Text style={styles.detailTitle}>Variação em relação ao mês anterior</Text>
            <Text style={styles.cardDescription}>Recebimentos: {formatPercent(comparison.variations.revenuePercentage)}</Text>
            <Text style={styles.cardDescription}>Pagamentos: {formatPercent(comparison.variations.expensesPercentage)}</Text>
            <Text style={styles.cardDescription}>Lucro: {formatPercent(comparison.variations.profitPercentage)}</Text>
          </View>}
        </Section>

        <Section title="Vendas recentes" subtitle="Acesse as últimas vendas cadastradas">
          <View style={[styles.card, styles.centerCard]}>
            <Ionicons name="bag-outline" size={28} color="#cbb58e" />
            <Text style={styles.detailTitle}>Consulte as vendas registradas</Text>
            <Text style={styles.emptyText}>O histórico será exibido quando o módulo de vendas estiver disponível no mobile.</Text>
          </View>
        </Section>

        <Section title="Acesso rápido" subtitle="Principais operações do negócio">
          {shortcuts.map((item) => (
            <View key={item.title} style={styles.shortcutCard}>
              <View style={styles.iconBox}><Ionicons name={item.icon} size={21} color={COLORS.gold} /></View>
              <View style={styles.shortcutContent}>
                <Text style={styles.shortcutTitle}>{item.title}</Text>
                <Text style={styles.shortcutDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </Section>

        <Text style={styles.footer}>Personalité Creative · Sistema de gestão</Text>
      </ScrollView>

      <Modal transparent visible={exportDialog !== null} animationType="fade" onRequestClose={() => setExportDialog(null)}>
        <View style={styles.pickerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setExportDialog(null)} />
          <View style={styles.pickerCard}>
            <Text style={styles.detailTitle}>Selecionar {exportDialog === 'type' ? 'relatório' : 'formato'}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {exportDialog === 'type' ? (Object.keys(EXPORT_LABELS) as ReportExportType[]).map(type =>
                <Pressable key={type} style={styles.pickerItem} onPress={() => { setExportType(type); setExportDialog(null); }}><Text style={styles.selectText}>{EXPORT_LABELS[type]}</Text></Pressable>
              ) : (['PDF', 'XLSX'] as ReportExportFormat[]).map(format =>
                <Pressable key={format} style={styles.pickerItem} onPress={() => { setExportFormat(format); setExportDialog(null); }}><Text style={styles.selectText}>{format === 'PDF' ? 'PDF' : 'Excel'}</Text></Pressable>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" />
          <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
            <View style={styles.drawerBrand}>
              <Image source={require('../../assets/images/personalite-logo.png')} resizeMode="contain" style={styles.drawerLogo} />
              <View style={styles.drawerBrandText}>
                <Text style={styles.drawerEyebrow}>PERSONALITÉ</Text>
                <Text style={styles.drawerTitle}>Creative</Text>
              </View>
              <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" hitSlop={10}>
                <Ionicons name="close" size={23} color="#fff" />
              </Pressable>
            </View>

            <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerScrollContent}>
              <Text style={styles.drawerSection}>MENU PRINCIPAL</Text>
              {sidebarNavigation.map((item) => (
                <Pressable key={item.label} onPress={() => openPage(item.label, item.route)}
                  style={[styles.drawerItem, item.route === '/home' && styles.drawerItemActive]}
                  accessibilityRole="button">
                  <Ionicons name={item.icon} size={19} color={item.route === '/home' ? '#fff' : '#d8d0c6'} />
                  <Text style={[styles.drawerItemText, item.route === '/home' && styles.drawerItemTextActive]}>{item.label}</Text>
                </Pressable>
              ))}
              <Text style={[styles.drawerSection, styles.drawerSystem]}>SISTEMA</Text>
              <Pressable style={styles.drawerItem} onPress={() => openPage('Meu Perfil')}>
                <Ionicons name="settings-outline" size={19} color="#d8d0c6" />
                <Text style={styles.drawerItemText}>Meu Perfil</Text>
              </Pressable>
            </ScrollView>

            <View style={styles.drawerFooter}>
              <View style={styles.drawerAvatar}>{userName ? <Text style={{ color: '#e3c99a', fontWeight: '700' }}>{userName.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase()}</Text> : <Ionicons name="person-outline" size={19} color="#e3c99a" />}</View>
              <View style={styles.drawerAccount}>
                <Text style={styles.drawerAccountTitle}>{userName || 'Personalité Creative'}</Text>
                <Text style={styles.drawerAccountSubtitle}>Sistema de gestão</Text>
              </View>
              <Pressable onPress={() => {setMenuOpen(false); void logout();}} accessibilityLabel="Sair da conta" disabled={loggingOut}>
                <Ionicons name="log-out-outline" size={22} color="#d8d0c6" />
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 },
  controlButton: { flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  controlText: { color: COLORS.gold, fontWeight: '700', fontSize: 13 },
  selectButton: { minHeight: 46, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectText: { fontSize: 13, lineHeight: 20, color: COLORS.dark, flexShrink: 1 },
  exportButton: { backgroundColor: COLORS.gold, borderRadius: 11, minHeight: 47, marginTop: 12, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center' },
  exportButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pickerOverlay: { flex: 1, justifyContent: 'center', padding: 22 },
  pickerCard: { padding: 20, borderRadius: 20, backgroundColor: '#fff', maxHeight: '80%' },
  pickerItem: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  chart: { minHeight: 180, marginTop: 16, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 5, paddingVertical: 12 },
  chartColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  chartBar: { width: '80%', maxWidth: 38, minHeight: 3, backgroundColor: COLORS.gold, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  chartMonth: { fontSize: 10, color: COLORS.muted, marginTop: 7 },
  chartValue: { fontSize: 10, color: COLORS.dark, marginBottom: 5, width: '100%', textAlign: 'center' },
  errorBox: { padding: 14, borderRadius: 12, backgroundColor: '#fef2f2', marginBottom: 19 },
  errorMessage: { color: '#b91c1c', lineHeight: 20, fontSize: 12 },
  dayRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  dayDate: { color: COLORS.dark, fontWeight: '700', marginBottom: 5 },
  dayData: { color: COLORS.muted, fontSize: 12, lineHeight: 19 },
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  content: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26, gap: 10 },
  headerText: { flex: 1 },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: '#fff' },
  drawerOverlay: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.52)' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: '#39342f' },
  drawerBrand: { paddingHorizontal: 17, paddingVertical: 22, minHeight: 114, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: '#ffffff1b' },
  drawerLogo: { width: 61, height: 70 },
  drawerBrandText: { flex: 1 },
  drawerEyebrow: { fontSize: 10, letterSpacing: 2.4, color: '#d5bd91', fontWeight: '700', lineHeight: 17 },
  drawerTitle: { fontSize: 21, lineHeight: 28, color: '#fff', fontFamily: 'serif' },
  drawerScroll: { flex: 1 },
  drawerScrollContent: { paddingHorizontal: 13, paddingTop: 25, paddingBottom: 35 },
  drawerSection: { paddingHorizontal: 12, color: '#a99e90', letterSpacing: 2, fontSize: 10, fontWeight: '700', marginBottom: 14 },
  drawerSystem: { marginTop: 32 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 47, paddingHorizontal: 15, marginBottom: 3, borderRadius: 11 },
  drawerItemActive: { backgroundColor: '#b99b66' },
  drawerItemText: { fontSize: 14, lineHeight: 22, color: '#d8d0c6', flexShrink: 1 },
  drawerItemTextActive: { color: '#fff', fontWeight: '700' },
  drawerFooter: { borderTopWidth: 1, borderTopColor: '#ffffff1b', paddingHorizontal: 17, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 11 },
  drawerAvatar: { width: 39, height: 39, backgroundColor: '#b99b6629', borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  drawerAccount: { flex: 1 },
  drawerAccountTitle: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 20 },
  drawerAccountSubtitle: { color: '#bcb0a0', fontSize: 11, lineHeight: 17 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: COLORS.gold, letterSpacing: 1.7, marginBottom: 8 },
  pageTitle: { fontSize: 29, color: COLORS.dark, fontFamily: 'serif', lineHeight: 36 },
  logoutButton: { borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, width: 45, height: 45, alignItems: 'center', justifyContent: 'center' },
  periodBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 17, paddingHorizontal: 16, backgroundColor: COLORS.goldBackground, borderRadius: 14, marginBottom: 29 },
  periodCopy: { flex: 1 },
  periodTitle: { fontWeight: '700', color: COLORS.dark, fontSize: 15, marginBottom: 6 },
  periodCaption: { fontSize: 12, lineHeight: 19, color: COLORS.muted },
  section: { marginBottom: 31 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.dark, lineHeight: 26, marginBottom: 5 },
  sectionSubtitle: { fontSize: 12, lineHeight: 19, color: COLORS.subdued, marginBottom: 16 },
  metricList: { gap: 12 },
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 19, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardLabel: { fontSize: 14, lineHeight: 21, color: COLORS.muted, flex: 1 },
  iconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.goldBackground, alignItems: 'center', justifyContent: 'center' },
  largeValue: { fontSize: 26, lineHeight: 35, fontWeight: '700', color: COLORS.dark, marginTop: 14, minWidth: 60 },
  value: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: COLORS.dark, minWidth: 25 },
  cardDescription: { fontSize: 12, lineHeight: 19, color: COLORS.subdued, marginTop: 10 },
  emptyChart: { minHeight: 180, backgroundColor: '#faf8f5', borderRadius: 12, marginTop: 20, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 14 },
  emptyText: { fontSize: 12, lineHeight: 19, color: COLORS.muted, textAlign: 'center' },
  financialLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 12 },
  financialLabel: { flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 },
  smallIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: COLORS.goldBackground, alignItems: 'center', justifyContent: 'center' },
  financialText: { color: COLORS.muted, fontSize: 13, lineHeight: 20, flex: 1 },
  progressTrack: { height: 11, backgroundColor: '#f0ece5', borderRadius: 10, marginTop: 12 },
  detailTitle: { fontSize: 15, fontWeight: '700', color: COLORS.dark, lineHeight: 23, marginBottom: 10 },
  centerCard: { alignItems: 'center', gap: 9, paddingVertical: 29 },
  shortcutCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 17, marginBottom: 10 },
  shortcutContent: { flex: 1 },
  shortcutTitle: { fontSize: 14, lineHeight: 23, color: COLORS.dark, fontWeight: '700' },
  shortcutDescription: { fontSize: 12, lineHeight: 19, color: COLORS.subdued, marginTop: 2 },
  footer: { fontSize: 12, textAlign: 'center', color: COLORS.subdued, paddingTop: 20, borderTopWidth: 1, borderTopColor: COLORS.border },
});
