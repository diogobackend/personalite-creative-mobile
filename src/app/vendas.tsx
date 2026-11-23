import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
type DeadlineStatus = 'NO_DEADLINE' | 'ON_TIME' | 'DUE_TODAY' | 'OVERDUE';
type SaleItem = { id: string; productId: string; inventoryId: string | null; quantity: number; color: string | null; brand: string | null; model: string | null; size: string | null; material: string | null };
type Sale = {
  id: string; customerId: string; deliveryDeadline: string | null; totalAmount: number;
  downPaymentPercentage: number; downPaymentAmount: number; paidPercentage: number;
  paidAmount: number; remainingPercentage: number; remainingAmount: number;
  paymentMethod: string; paymentStatus: PaymentStatus; deadlineStatus: DeadlineStatus;
  observation: string | null; items: SaleItem[]; deliveredAt: string | null;
  createdAt: string; updatedAt: string;
};
type SalesResponse = {
  sales: Sale[];
  pagination: { page: number; size: number; totalElements: number; totalPages: number; hasNext: boolean; hasPrevious: boolean };
  summary: { totalSales: number; totalAmount: number; totalDownPayment: number; totalReceived: number; totalRemaining: number; unpaidSales: number; partiallyPaidSales: number; paidSales: number; overdueSales: number; dueTodaySales: number; upcomingSales: number };
};
type Filters = {
  productName: string; customer: string; minTotalAmount: string; maxTotalAmount: string;
  saleId: string; search: string; productCommercialCode: string; color: string;
  brand: string; model: string; size: string; material: string; observation: string;
  paymentMethod: string; paymentStatus: string; deadlineStatus: string;
  deliveryDeadlineFrom: string; deliveryDeadlineTo: string; createdAtFrom: string;
  createdAtTo: string; dueWithinDays: string; minRemainingAmount: string;
  maxRemainingAmount: string; downPaymentFrom: string; downPaymentTo: string;
  paidFrom: string; paidTo: string; remainingFrom: string; remainingTo: string; delivered: string;
};
const EMPTY_FILTERS: Filters = {
  productName: '', customer: '', minTotalAmount: '', maxTotalAmount: '', saleId: '', search: '',
  productCommercialCode: '', color: '', brand: '', model: '', size: '', material: '', observation: '',
  paymentMethod: '', paymentStatus: '', deadlineStatus: '', deliveryDeadlineFrom: '', deliveryDeadlineTo: '',
  createdAtFrom: '', createdAtTo: '', dueWithinDays: '', minRemainingAmount: '', maxRemainingAmount: '',
  downPaymentFrom: '', downPaymentTo: '', paidFrom: '', paidTo: '', remainingFrom: '', remainingTo: '', delivered: '',
};
const C = { bg: '#f8f6f2', card: '#fff', ink: '#342d27', muted: '#766d63', faint: '#968d83', gold: '#a98a58', border: '#e8e0d4', darkMenu: '#39342f' };
const PAYMENT_METHODS = [
  { value: '', label: 'Todas' }, { value: 'PIX', label: 'Pix' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' }, { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'CASH', label: 'Dinheiro' }, { value: 'BANK_TRANSFER', label: 'Transferência bancária' },
  { value: 'BOLETO', label: 'Boleto' },
];
const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Data de cadastro' }, { value: 'totalAmount', label: 'Valor total' },
  { value: 'remainingAmount', label: 'Valor restante' }, { value: 'deliveryDeadline', label: 'Prazo de entrega' },
  { value: 'paidPercentage', label: 'Percentual pago' },
];
const QUICK: { label: string; field: keyof Filters; value: string }[] = [
  { label: 'Não pagas', field: 'paymentStatus', value: 'UNPAID' },
  { label: 'Parcialmente pagas', field: 'paymentStatus', value: 'PARTIALLY_PAID' },
  { label: 'Pagas', field: 'paymentStatus', value: 'PAID' },
  { label: 'Atrasadas', field: 'deadlineStatus', value: 'OVERDUE' },
  { label: 'Vencem hoje', field: 'deadlineStatus', value: 'DUE_TODAY' },
  { label: 'Próximos 7 dias', field: 'dueWithinDays', value: '7' },
  { label: 'Próximos 30 dias', field: 'dueWithinDays', value: '30' },
  { label: 'Sem prazo', field: 'deadlineStatus', value: 'NO_DEADLINE' },
  { label: 'Entregues', field: 'delivered', value: 'true' },
  { label: 'Não entregues', field: 'delivered', value: 'false' },
];
const ADVANCED_TEXT: { field: keyof Filters; label: string; placeholder: string }[] = [
  { field: 'saleId', label: 'ID da venda', placeholder: 'Identificador da venda' },
  { field: 'search', label: 'Busca geral', placeholder: 'Cliente, produto ou observação' },
  { field: 'productCommercialCode', label: 'Código do produto', placeholder: 'Código comercial' },
  { field: 'color', label: 'Cor', placeholder: 'Cor do item' },
  { field: 'brand', label: 'Marca', placeholder: 'Marca do item' },
  { field: 'model', label: 'Modelo', placeholder: 'Modelo do item' },
  { field: 'size', label: 'Tamanho', placeholder: 'Tamanho do item' },
  { field: 'material', label: 'Material', placeholder: 'Material do item' },
  { field: 'observation', label: 'Observação', placeholder: 'Texto da observação' },
];
const ADVANCED_NUMBERS: { field: keyof Filters; label: string; percent?: boolean }[] = [
  { field: 'minRemainingAmount', label: 'Restante mínimo (R$)' },
  { field: 'maxRemainingAmount', label: 'Restante máximo (R$)' },
  { field: 'downPaymentFrom', label: 'Entrada (%) de', percent: true },
  { field: 'downPaymentTo', label: 'Entrada (%) até', percent: true },
  { field: 'paidFrom', label: 'Pago (%) de', percent: true },
  { field: 'paidTo', label: 'Pago (%) até', percent: true },
  { field: 'remainingFrom', label: 'Restante (%) de', percent: true },
  { field: 'remainingTo', label: 'Restante (%) até', percent: true },
];
const DATES: { field: keyof Filters; label: string }[] = [
  { field: 'deliveryDeadlineFrom', label: 'Entrega de' }, { field: 'deliveryDeadlineTo', label: 'Entrega até' },
  { field: 'createdAtFrom', label: 'Cadastro de' }, { field: 'createdAtTo', label: 'Cadastro até' },
];
const MENU: { label: string; icon: IconName; route?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' | '/estoque' | '/despesas' | '/relatorios' | '/perfil' }[] = [
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
const fmtMoney = (value: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));
const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : value;
};
const methodLabel = (value: string) => PAYMENT_METHODS.find(x => x.value === value)?.label ?? value;
const statusLabel = (value: PaymentStatus) => ({ UNPAID: 'Não paga', PARTIALLY_PAID: 'Parcialmente paga', PAID: 'Paga' })[value] ?? value;
const deadlineLabel = (value: DeadlineStatus) => ({ NO_DEADLINE: 'Sem prazo', ON_TIME: 'No prazo', DUE_TODAY: 'Vence hoje', OVERDUE: 'Atrasada' })[value] ?? value;
const errorLabel = (e: unknown) => {
  if (axios.isAxiosError(e)) {
    if (e.response?.status === 401) return 'Sessão expirada. Entre novamente.';
    if (typeof e.response?.data?.message === 'string') return e.response.data.message;
    return e.response ? `Não foi possível carregar as vendas (HTTP ${e.response.status}).` : 'Falha de conexão com o servidor.';
  }
  return e instanceof Error ? e.message : 'Não foi possível carregar as vendas.';
};

// Não aplicar flexShrink, ellipsizeMode, adjustsFontSizeToFit ou numberOfLines
// aos textos comuns. Isso evita o corte de glifos observado no Android.
function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}
function FilterInput({ label, value, onChange, placeholder, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean;
}) {
  return <View style={styles.field}><Label>{label}</Label><TextInput style={styles.input} value={value} onChangeText={onChange}
    placeholder={placeholder} placeholderTextColor={C.faint} keyboardType={numeric ? 'decimal-pad' : 'default'}
    autoCapitalize="none" /></View>;
}
function SummaryCard({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  return <View style={styles.summaryCard}>
    <View style={styles.summaryHead}><Text style={styles.summaryLabel}>{label}</Text><Ionicons name={icon} size={21} color={C.gold} /></View>
    <Text style={styles.summaryValue}>{value}</Text>
  </View>;
}
function OutlineButton({ title, icon, onPress, disabled = false }: { title: string; icon?: IconName; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.outlineButton, disabled && styles.disabled]}>
    {icon ? <Ionicons name={icon} size={17} color={C.gold} /> : null}<Text style={styles.outlineButtonText}>{title}</Text>
  </Pressable>;
}
function PrimaryButton({ title, icon, onPress, disabled = false }: { title: string; icon?: IconName; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryButton, disabled && styles.disabled]}>
    {icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}<Text style={styles.primaryButtonText}>{title}</Text>
  </Pressable>;
}

type Picker = { title: string; value: string; options: { value: string; label: string }[]; onPick: (value: string) => void } | null;
export default function VendasScreen() {
  const [draft, setDraft] = useState<Filters>({ ...EMPTY_FILTERS });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY_FILTERS });
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('DESC');
  const [result, setResult] = useState<SalesResponse | null>(null);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [picker, setPicker] = useState<Picker>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const update = (field: keyof Filters, value: string) => setDraft(previous => ({ ...previous, [field]: value }));
  const choose = (title: string, value: string, options: { value: string; label: string }[], onPick: (v: string) => void) => setPicker({ title, value, options, onPick });
  const activeCount = useMemo(() => Object.values(applied).filter(value => value.trim()).length, [applied]);

  const fetchSales = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') { router.replace('/'); return; }
      const params: Record<string, string | number> = { page, size, sortBy, sortDirection };
      (Object.keys(applied) as (keyof Filters)[]).forEach(key => { if (applied[key].trim()) params[key] = applied[key].trim(); });
      const headers = { Authorization: `Bearer ${token}` };
      const { data } = await api.get<SalesResponse>('/sales', { params, headers, signal });
      if (signal.aborted) return;
      setResult(data);
      const ids = [...new Set((data.sales ?? []).map(sale => sale.customerId))].filter(id => !customers[id]);
      if (ids.length) {
        const responses = await Promise.allSettled(ids.map(async userId => {
          const response = await api.get<{ name: string }>('/users/id', { params: { userId }, headers, signal });
          return { userId, name: response.data.name };
        }));
        if (!signal.aborted) setCustomers(previous => ({ ...previous, ...Object.fromEntries(responses.filter((r): r is PromiseFulfilledResult<{ userId: string; name: string }> => r.status === 'fulfilled').map(r => [r.value.userId, r.value.name])) }));
      }
    } catch (e) {
      if (signal.aborted || axios.isCancel(e)) return;
      setResult(null);
      setError(errorLabel(e));
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  // customers is intentionally not a dependency: resolving names must not re-fetch sales.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, page, size, sortBy, sortDirection]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchSales(controller.signal);
    return () => controller.abort();
  }, [fetchSales, reloadKey]);
  const applyFilters = () => { setPage(0); setApplied({ ...draft }); };
  const clearFilters = () => { setDraft({ ...EMPTY_FILTERS }); setApplied({ ...EMPTY_FILTERS }); setPage(0); };
  const quickFilter = (field: keyof Filters, value: string) => {
    const next: Filters = { ...draft, [field]: applied[field] === value ? '' : value };
    if (field === 'deadlineStatus' || field === 'dueWithinDays') {
      next.deadlineStatus = field === 'deadlineStatus' ? next.deadlineStatus : '';
      next.dueWithinDays = field === 'dueWithinDays' ? next.dueWithinDays : '';
      next.delivered = 'false';
    }
    if (field === 'delivered' && value === 'true') { next.deadlineStatus = ''; next.dueWithinDays = ''; }
    setDraft(next); setApplied(next); setPage(0);
  };
  const pagination = result?.pagination;
  const summary = result?.summary;
  const total = pagination?.totalElements ?? 0;
  const currentPage = pagination?.page ?? page;
  const first = total ? currentPage * size + 1 : 0;
  const last = total ? Math.min(first + (result?.sales?.length ?? 0) - 1, total) : 0;
  const navigate = (label: string, route?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' | '/estoque' | '/despesas' | '/relatorios' | '/perfil') => {
    setMenuOpen(false);
    if (route) router.push(route);
    else Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  };
  const logout = async () => { await SecureStore.deleteItemAsync('access_token'); setMenuOpen(false); router.replace('/'); };
  const pickerField = (label: string, value: string, options: { value: string; label: string }[], onPick: (v: string) => void) => (
    <View style={styles.field}><Label>{label}</Label>
      <Pressable style={styles.select} onPress={() => choose(label, value, options, onPick)}>
        <Text style={styles.selectText}>{options.find(option => option.value === value)?.label ?? value ?? 'Selecionar'}</Text>
        <Ionicons name="chevron-down-outline" size={17} color={C.gold} />
      </Pressable>
    </View>
  );
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.topbar}>
        <Pressable style={styles.headerIcon} onPress={() => setMenuOpen(true)} accessibilityLabel="Abrir menu"><Ionicons name="menu-outline" size={27} color={C.ink} /></Pressable>
        <Text style={styles.topbarTitle}>Vendas</Text>
        <Pressable style={styles.headerIcon} onPress={() => setReloadKey(n => n + 1)} accessibilityLabel="Atualizar vendas"><Ionicons name="refresh-outline" size={22} color={C.gold} /></Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey(n => n + 1); }} colors={[C.gold]} tintColor={C.gold} />}
        contentContainerStyle={styles.content}>
        <View style={styles.pageHead}>
          <Text style={styles.heading}>Gestão de vendas</Text>
          <PrimaryButton title="Nova venda" icon="add" onPress={() => router.push('/vendas/nova' as never)} />
        </View>
        <View style={styles.metrics}>
          <SummaryCard label="Valor total" value={fmtMoney(summary?.totalAmount)} icon="bag-outline" />
          <SummaryCard label="Total recebido" value={fmtMoney(summary?.totalReceived)} icon="cash-outline" />
          <SummaryCard label="Valor a receber" value={fmtMoney(summary?.totalRemaining)} icon="wallet-outline" />
          <SummaryCard label="Entradas previstas" value={fmtMoney(summary?.totalDownPayment)} icon="calendar-outline" />
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Filtrar vendas</Text>
          <FilterInput label="Produto" value={draft.productName} onChange={v => update('productName', v)} placeholder="Qualquer produto da venda" />
          <FilterInput label="Cliente" value={draft.customer} onChange={v => update('customer', v)} placeholder="Nome, CPF, e-mail ou telefone" />
          <View style={styles.twoColumns}>
            <View style={styles.column}><FilterInput label="Valor mínimo (R$)" value={draft.minTotalAmount} onChange={v => update('minTotalAmount', v)} numeric placeholder="0,00" /></View>
            <View style={styles.column}><FilterInput label="Valor máximo (R$)" value={draft.maxTotalAmount} onChange={v => update('maxTotalAmount', v)} numeric placeholder="Sem limite" /></View>
          </View>
          <Label>Filtros rápidos</Label>
          <View style={styles.chipWrap}>{QUICK.map(item => {
            const selected = applied[item.field] === item.value;
            return <Pressable key={`${item.field}-${item.value}`} onPress={() => quickFilter(item.field, item.value)} style={[styles.chip, selected && styles.chipSelected]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{item.label}</Text>
            </Pressable>;
          })}</View>
          <OutlineButton title={advanced ? 'Ocultar filtros avançados' : 'Filtros avançados'} icon="options-outline" onPress={() => setAdvanced(x => !x)} />
          {advanced ? <View style={styles.advancedPanel}>
            <Text style={styles.subheading}>Filtros avançados</Text>
            {ADVANCED_TEXT.map(x => <FilterInput key={x.field} label={x.label} placeholder={x.placeholder} value={draft[x.field]} onChange={v => update(x.field, v)} />)}
            {pickerField('Forma de pagamento', draft.paymentMethod, PAYMENT_METHODS, value => update('paymentMethod', value))}
            {pickerField('Status do pagamento', draft.paymentStatus, [
              { value: '', label: 'Todos' }, { value: 'UNPAID', label: 'Não paga' },
              { value: 'PARTIALLY_PAID', label: 'Parcialmente paga' }, { value: 'PAID', label: 'Paga' },
            ], value => update('paymentStatus', value))}
            {pickerField('Status da entrega', draft.deadlineStatus, [
              { value: '', label: 'Todos' }, { value: 'NO_DEADLINE', label: 'Sem prazo' },
              { value: 'ON_TIME', label: 'No prazo' }, { value: 'DUE_TODAY', label: 'Vence hoje' }, { value: 'OVERDUE', label: 'Atrasada' },
            ], value => update('deadlineStatus', value))}
            {pickerField('Entregue', draft.delivered, [
              { value: '', label: 'Todas' }, { value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' },
            ], value => update('delivered', value))}
            {ADVANCED_NUMBERS.map(x => <FilterInput key={x.field} label={x.label} placeholder={x.percent ? '0 a 100' : '0,00'}
              value={draft[x.field]} onChange={v => update(x.field, v)} numeric />)}
            {DATES.map(x => <FilterInput key={x.field} label={`${x.label} (AAAA-MM-DD)`} placeholder="2026-11-21"
              value={draft[x.field]} onChange={v => update(x.field, v)} />)}
            <FilterInput label="Vence em até (dias)" value={draft.dueWithinDays} onChange={v => update('dueWithinDays', v)} numeric placeholder="Ex.: 15" />
          </View> : null}
          <View style={styles.filterActions}>
            <OutlineButton title={activeCount ? `Limpar (${activeCount})` : 'Limpar'} icon="close-outline" onPress={clearFilters} />
            <PrimaryButton title="Buscar vendas" icon="search-outline" onPress={applyFilters} />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Histórico de vendas</Text>
          <Text style={styles.helper}>{loading ? 'Carregando vendas...' : `${total} ${total === 1 ? 'venda encontrada' : 'vendas encontradas'}`}{activeCount ? ` · ${activeCount} filtros aplicados` : ''}</Text>
          {pickerField('Ordenar por', sortBy, SORT_OPTIONS, value => { setSortBy(value); setPage(0); })}
          <View style={styles.twoColumns}>
            <View style={styles.column}>{pickerField('Direção', sortDirection, [{ label: 'Decrescente', value: 'DESC' }, { label: 'Crescente', value: 'ASC' }], value => { setSortDirection(value); setPage(0); })}</View>
            <View style={styles.column}>{pickerField('Por página', String(size), [10, 20, 50, 100].map(n => ({ label: String(n), value: String(n) })), value => { setSize(Number(value)); setPage(0); })}</View>
          </View>
          {loading ? <View style={styles.feedback}><ActivityIndicator size="large" color={C.gold} /><Text style={styles.helper}>Carregando...</Text></View>
            : error ? <View style={styles.feedback}><Text style={styles.error}>{error}</Text><OutlineButton title="Tentar novamente" icon="refresh-outline" onPress={() => setReloadKey(n => n + 1)} /></View>
            : !result?.sales?.length ? <Text style={styles.empty}>Nenhuma venda encontrada.</Text>
            : result.sales.map(sale => {
              const customer = customers[sale.customerId] ?? 'Cliente indisponível';
              const delivered = Boolean(sale.deliveredAt);
              const deadline = delivered ? 'Entregue' : deadlineLabel(sale.deadlineStatus);
              const qty = (sale.items ?? []).reduce((n, item) => n + item.quantity, 0);
              return <View key={sale.id} style={styles.saleCard}>
                <View style={styles.saleHead}>
                  <View style={styles.saleHeadText}><Text style={styles.customerName}>{customer}</Text>
                    <Text style={styles.meta}>Venda {sale.id.slice(0, 8).toUpperCase()} · {fmtDate(sale.createdAt)}</Text></View>
                  <View style={[styles.statusPill, sale.paymentStatus === 'PAID' ? styles.pillPaid : sale.paymentStatus === 'UNPAID' ? styles.pillUnpaid : styles.pillPartial]}>
                    <Text style={styles.statusText}>{statusLabel(sale.paymentStatus)}</Text>
                  </View>
                </View>
                <View style={styles.saleInfoRow}><Text style={styles.saleInfoLabel}>Produtos</Text>
                  <Text style={styles.saleInfoValue}>{sale.items?.length ?? 0} item(ns) · {qty} unidades</Text></View>
                <View style={styles.saleInfoRow}><Text style={styles.saleInfoLabel}>Valor total</Text><Text style={styles.totalValue}>{fmtMoney(sale.totalAmount)}</Text></View>
                <View style={styles.moneyPair}>
                  <View style={styles.moneyCell}><Text style={styles.smallLabel}>Recebido</Text><Text style={styles.moneyValue}>{fmtMoney(sale.paidAmount)}</Text></View>
                  <View style={styles.moneyCell}><Text style={styles.smallLabel}>Restante</Text><Text style={styles.moneyValue}>{fmtMoney(sale.remainingAmount)}</Text></View>
                </View>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, sale.paidPercentage ?? 0))}%` as `${number}%` }]} /></View>
                <Text style={styles.meta}>{sale.paidPercentage ?? 0}% pago · {methodLabel(sale.paymentMethod)}</Text>
                <Text style={styles.meta}>Entrega: {deadline}{sale.deliveryDeadline && !delivered ? ` · ${fmtDate(sale.deliveryDeadline)}` : ''}</Text>
                <View style={styles.saleActions}>
                  <OutlineButton title="Visualizar" icon="eye-outline" onPress={() => router.push(`/vendas/${sale.id}` as never)} />
                  <OutlineButton title="Editar" icon="pencil-outline" onPress={() => router.push(`/vendas/${sale.id}/atualizar` as never)} />
                </View>
              </View>;
            })}
          {!loading && !error && result ? <View style={styles.pagination}>
            <Text style={styles.helper}>Exibindo {first} a {last} de {total} resultados</Text>
            <Text style={styles.pageLabel}>Página {pagination?.totalPages ? currentPage + 1 : 0} de {pagination?.totalPages ?? 0}</Text>
            <View style={styles.pageActions}>
              <OutlineButton title="Anterior" icon="chevron-back-outline" disabled={!pagination?.hasPrevious} onPress={() => setPage(p => Math.max(0, p - 1))} />
              <OutlineButton title="Próxima" icon="chevron-forward-outline" disabled={!pagination?.hasNext} onPress={() => setPage(p => p + 1)} />
            </View>
          </View> : null}
        </View>
        <Text style={styles.footer}>Personalité Creative · Sistema de gestão</Text>
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} accessibilityLabel="Fechar seleção" />
        <View style={styles.pickerCard}>
          <View style={styles.pickerHead}><Text style={styles.pickerTitle}>{picker?.title}</Text><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={C.ink} /></Pressable></View>
          <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">{picker?.options.map(option => <Pressable key={option.value} style={styles.pickerOption} onPress={() => { picker.onPick(option.value); setPicker(null); }}>
            <Text style={styles.pickerOptionText}>{option.label}</Text>{picker.value === option.value ? <Ionicons name="checkmark" size={20} color={C.gold} /> : null}
          </Pressable>)}</ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={styles.drawerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
        <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
          <View style={styles.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} style={styles.drawerLogo} resizeMode="contain" />
            <View style={styles.drawerBrandText}><Text style={styles.drawerEyebrow}>PERSONALITÉ</Text><Text style={styles.drawerTitle}>Creative</Text></View>
            <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu"><Ionicons name="close" size={24} color="#fff" /></Pressable>
          </View>
          <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerContent}>
            <Text style={styles.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} style={[styles.drawerItem, item.route === '/vendas' && styles.drawerActive]} onPress={() => navigate(item.label, item.route)}>
              <Ionicons name={item.icon} size={19} color="#eee7db" /><Text style={styles.drawerItemText}>{item.label}</Text>
            </Pressable>)}
            <Text style={styles.drawerSection}>SISTEMA</Text>
            <Pressable style={styles.drawerItem} onPress={() => navigate('Meu Perfil', '/perfil')}><Ionicons name="settings-outline" size={19} color="#eee7db" /><Text style={styles.drawerItemText}>Meu Perfil</Text></Pressable>
          </ScrollView>
          <Pressable style={styles.drawerLogout} onPress={() => void logout()}><Ionicons name="log-out-outline" size={20} color="#eee7db" /><Text style={styles.drawerItemText}>Sair</Text></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  topbar: { backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.border, minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12 },
  headerIcon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  topbarTitle: { flex: 1, fontSize: 22, lineHeight: 32, fontWeight: '700', color: C.ink, includeFontPadding: true },
  content: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 35 },
  pageHead: { gap: 14, alignItems: 'flex-start', marginBottom: 19 },
  heading: { color: C.ink, fontSize: 28, lineHeight: 40, fontWeight: '700', includeFontPadding: true },
  metrics: { gap: 10, marginBottom: 18 },
  summaryCard: { borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, padding: 17 },
  summaryHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  summaryLabel: { flex: 1, color: C.muted, fontSize: 14, lineHeight: 23, includeFontPadding: true },
  summaryValue: { color: C.ink, fontSize: 23, lineHeight: 35, fontWeight: '700', marginTop: 9, includeFontPadding: true },
  section: { borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 18 },
  sectionTitle: { color: C.ink, fontSize: 19, lineHeight: 29, fontWeight: '700', marginBottom: 15, includeFontPadding: true },
  subheading: { color: C.ink, fontSize: 16, lineHeight: 26, fontWeight: '700', marginBottom: 12 },
  label: { color: C.ink, fontSize: 13, lineHeight: 22, fontWeight: '600', marginBottom: 7, includeFontPadding: true },
  field: { marginBottom: 13, minWidth: 0 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fff', color: C.ink, minHeight: 48, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, includeFontPadding: true },
  twoColumns: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  select: { borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 12, minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectText: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 21, includeFontPadding: true },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 11, backgroundColor: '#fff' },
  chipSelected: { backgroundColor: '#f4ead8', borderColor: C.gold },
  chipText: { color: C.muted, fontSize: 12, lineHeight: 22, fontWeight: '600', includeFontPadding: true },
  chipTextSelected: { color: '#76592e' },
  advancedPanel: { backgroundColor: '#fcfaf7', borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, marginTop: 14, marginBottom: 16 },
  filterActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, justifyContent: 'flex-end', marginTop: 15 },
  outlineButton: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', minHeight: 44 },
  outlineButtonText: { color: '#80623d', fontSize: 13, lineHeight: 22, fontWeight: '600', includeFontPadding: true },
  primaryButton: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 11, backgroundColor: C.gold, minHeight: 46 },
  primaryButtonText: { color: '#fff', fontSize: 13, lineHeight: 23, fontWeight: '700', includeFontPadding: true },
  disabled: { opacity: 0.45 },
  helper: { color: C.muted, fontSize: 12, lineHeight: 21, marginBottom: 13, includeFontPadding: true },
  feedback: { alignItems: 'center', gap: 14, paddingVertical: 28 }, error: { color: '#b91c1c', fontSize: 13, lineHeight: 23, textAlign: 'center' },
  empty: { textAlign: 'center', paddingVertical: 22, color: C.muted, fontSize: 13, lineHeight: 22 },
  saleCard: { backgroundColor: '#fdfbf8', borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 15, marginBottom: 13, gap: 7 },
  saleHead: { gap: 8, marginBottom: 5 }, saleHeadText: { gap: 3 },
  customerName: { color: C.ink, fontSize: 17, lineHeight: 28, fontWeight: '700', includeFontPadding: true },
  meta: { color: C.muted, fontSize: 12, lineHeight: 21, includeFontPadding: true },
  statusPill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  pillPaid: { backgroundColor: '#d1fae5' }, pillUnpaid: { backgroundColor: '#fee2e2' }, pillPartial: { backgroundColor: '#fef3c7' },
  statusText: { fontSize: 12, lineHeight: 21, color: C.ink, fontWeight: '700', includeFontPadding: true },
  saleInfoRow: { gap: 4, marginTop: 3 }, saleInfoLabel: { color: C.muted, fontSize: 12, lineHeight: 20 },
  saleInfoValue: { color: C.ink, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  totalValue: { color: C.ink, fontSize: 20, lineHeight: 31, fontWeight: '700' },
  moneyPair: { flexDirection: 'row', gap: 10, marginTop: 5 },
  moneyCell: { flex: 1, minWidth: 0, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  smallLabel: { color: C.muted, fontSize: 12, lineHeight: 20, marginBottom: 5 },
  moneyValue: { color: C.ink, fontSize: 14, lineHeight: 24, fontWeight: '700', includeFontPadding: true },
  progressTrack: { backgroundColor: '#eae4d9', borderRadius: 8, height: 7, overflow: 'hidden', marginTop: 6 },
  progressFill: { height: 7, borderRadius: 8, backgroundColor: C.gold },
  saleActions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end' },
  pagination: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 17, gap: 9 },
  pageLabel: { fontSize: 13, lineHeight: 22, color: C.ink, fontWeight: '700', includeFontPadding: true },
  pageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { borderTopWidth: 1, borderTopColor: C.border, textAlign: 'center', color: C.muted, paddingTop: 18, marginTop: 8, fontSize: 12, lineHeight: 20 },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 20 },
  pickerCard: { backgroundColor: '#fff', borderRadius: 17, padding: 18, maxHeight: '78%' },
  pickerHead: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  pickerTitle: { flex: 1, color: C.ink, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  pickerScroll: { flexGrow: 0 },
  pickerOption: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickerOptionText: { flex: 1, fontSize: 14, lineHeight: 23, color: C.ink },
  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: '#0008' },
  drawer: { width: '82%', maxWidth: 310, backgroundColor: C.darkMenu, height: '100%' },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 18, gap: 10, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  drawerLogo: { height: 65, width: 56 }, drawerBrandText: { flex: 1 },
  drawerEyebrow: { fontSize: 11, lineHeight: 18, letterSpacing: 2, fontWeight: '700', color: '#d5bd91' },
  drawerTitle: { color: '#fff', fontFamily: 'serif', fontSize: 21, lineHeight: 29 },
  drawerScroll: { flex: 1 }, drawerContent: { padding: 14, paddingBottom: 25 },
  drawerSection: { color: '#b1a698', fontSize: 10, lineHeight: 19, fontWeight: '700', letterSpacing: 1.7, marginBottom: 14, marginTop: 18 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 15, minHeight: 49, gap: 12, marginBottom: 4 },
  drawerActive: { backgroundColor: '#665949' }, drawerItemText: { color: '#eee7db', fontSize: 14, lineHeight: 23, fontWeight: '600', includeFontPadding: true },
  drawerLogout: { paddingHorizontal: 27, paddingVertical: 21, flexDirection: 'row', alignItems: 'center', gap: 13, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
