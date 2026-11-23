import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type Direction = 'IN' | 'OUT' | null;
type Origin = 'SALE' | 'EXPENSE';
type Movement = {
  id: string;
  originId: string;
  originCode: string;
  origin: Origin;
  operation: string;
  direction: Direction;
  status: string | null;
  previousValue: number | null;
  currentValue: number | null;
  amount: number;
  description: string | null;
  createdAt: string;
};
type MovementPage = {
  content: Movement[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  empty: boolean;
};
type Detail = { name: string; customer: string; additionalProducts: number };
type Filters = {
  createdFrom: string;
  createdTo: string;
  minAmount: string;
  maxAmount: string;
  originId: string;
  origin: string;
  direction: string;
  operation: string;
  status: string;
  description: string;
};
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; select: (value: string) => void } | null;

const COLORS = {
  bg: '#f8f6f2', paper: '#ffffff', ink: '#342d27', muted: '#766d63',
  gold: '#a98a58', border: '#e8e0d4', menu: '#39342f',
};
const EMPTY: Filters = {
  createdFrom: '', createdTo: '', minAmount: '', maxAmount: '', originId: '',
  origin: '', direction: '', operation: '', status: '', description: '',
};
const OPERATIONS: Record<string, string> = {
  CREATED: 'Registro de venda', UPDATED: 'Atualização',
  PAYMENT: 'Pagamento / recebimento', REFUND: 'Estorno',
  VALUE_ADJUSTMENT_INCREASE: 'Aumento de valor',
  VALUE_ADJUSTMENT_DECREASE: 'Redução de valor', CANCELLED: 'Cancelamento',
};
const STATUS: Record<string, string> = {
  PENDING: 'Pendente', PARTIALLY_PAID: 'Parcialmente paga',
  PAID: 'Paga', CANCELLED: 'Cancelada',
};
const SORT: Option[] = [
  { value: 'createdAt', label: 'Data da movimentação' },
  { value: 'amount', label: 'Valor' },
  { value: 'origin', label: 'Origem' },
  { value: 'operation', label: 'Operação' },
  { value: 'status', label: 'Status' },
];
const QUICK: { label: string; field: keyof Filters; value: string }[] = [
  { label: 'Entradas', field: 'direction', value: 'IN' },
  { label: 'Saídas', field: 'direction', value: 'OUT' },
  { label: 'Vendas', field: 'origin', value: 'SALE' },
  { label: 'Despesas', field: 'origin', value: 'EXPENSE' },
  { label: 'Pagamentos', field: 'operation', value: 'PAYMENT' },
];
const MENU: { label: string; icon: IconName; route?: string }[] = [
  { label: 'Visão geral', icon: 'grid-outline', route: '/home' },
  { label: 'Produtos', icon: 'cube-outline', route: '/produtos' },
  { label: 'Categorias', icon: 'pricetags-outline', route: '/categorias' },
  { label: 'Vendas', icon: 'bag-handle-outline', route: '/vendas' },
  { label: 'Histórico Financeiro', icon: 'card-outline', route: '/movimentacoes' },
  { label: 'Clientes', icon: 'people-outline', route: '/clientes' },
  { label: 'Estoque', icon: 'layers-outline', route: '/estoque' },
  { label: 'Despesas', icon: 'wallet-outline', route: '/despesas' },
  { label: 'Relatórios', icon: 'stats-chart-outline' },
];
const money = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const dateTime = (raw: string) => {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
// A API utiliza instantes ISO. O fim de período inclui o dia inteiro no fuso do aparelho.
const apiDate = (value: string, end: boolean) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
};
const errorMessage = (e: unknown) => {
  if (axios.isAxiosError(e)) {
    if (e.response?.status === 401) return 'Sessão expirada. Faça login novamente.';
    const message: unknown = e.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    return e.response ? `Não foi possível carregar as movimentações (HTTP ${e.response.status}).` : 'Falha de conexão com o servidor.';
  }
  return e instanceof Error ? e.message : 'Não foi possível carregar as movimentações.';
};

// Textos podem ocupar mais de uma linha. Não usar numberOfLines,
// ellipsizeMode, adjustsFontSizeToFit ou largura fixa para rótulos.
function Field({ label, value, onChange, placeholder, numeric = false, maxLength }: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; numeric?: boolean; maxLength?: number;
}) {
  return <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput style={s.input} value={value} onChangeText={onChange}
      placeholder={placeholder} placeholderTextColor="#9f978d" maxLength={maxLength}
      autoCapitalize="none" keyboardType={numeric ? 'decimal-pad' : 'default'} />
  </View>;
}
function Button({ label, icon, onPress, secondary = false, disabled = false }: {
  label: string; icon?: IconName; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={[s.button, secondary ? s.buttonSecondary : s.buttonPrimary, disabled && s.disabled]}>
    {icon && <Ionicons name={icon} size={18} color={secondary ? COLORS.gold : '#fff'} />}
    <Text style={[s.buttonText, secondary ? s.buttonTextSecondary : s.buttonTextPrimary]}>{label}</Text>
  </Pressable>;
}
function Metric({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  return <View style={s.metric}>
    <View style={s.metricHead}>
      <Text style={s.metricLabel}>{label}</Text>
      <Ionicons name={icon} size={22} color={COLORS.gold} />
    </View>
    <Text style={s.metricValue}>{value}</Text>
  </View>;
}

export default function MovimentacoesScreen() {
  const [draft, setDraft] = useState<Filters>({ ...EMPTY });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY });
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('DESC');
  const [result, setResult] = useState<MovementPage | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [picker, setPicker] = useState<Picker>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const update = (key: keyof Filters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const choose = (title: string, value: string, options: Option[], select: (v: string) => void) =>
    setPicker({ title, value, options, select });
  const activeCount = useMemo(() => Object.values(applied).filter(Boolean).length, [applied]);

  const fetchMovements = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'null' || token === 'undefined') {
        if (!signal.aborted) router.replace('/');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const params: Record<string, string | number> = { page, size, sortBy, sortDirection };
      (Object.keys(applied) as (keyof Filters)[]).forEach(key => {
        const value = applied[key].trim();
        if (!value) return;
        params[key] = key === 'createdFrom' || key === 'createdTo'
          ? apiDate(value, key === 'createdTo') : value;
      });
      const { data } = await api.get<MovementPage>('/moviments', { params, headers, signal });
      if (signal.aborted) return;
      setResult(data);
      setDetails({});

      // Consultas opcionais não devem prejudicar o histórico principal.
      // Usa cliente/produto/despesa apenas uma vez para cada origem distinta.
      const extraApi = axios.create({ baseURL: api.defaults.baseURL, headers });
      const unique = [...new Map((data.content ?? []).map(m => [`${m.origin}:${m.originId}`, m])).values()];
      const settled = await Promise.allSettled(unique.map(async (movement): Promise<[string, Detail]> => {
        if (movement.origin === 'EXPENSE') {
          const { data: expense } = await extraApi.get<{ name: string }>(`/expenses/${encodeURIComponent(movement.originId)}`, { signal });
          return [movement.originId, { name: expense.name ?? 'Despesa', customer: '', additionalProducts: 0 }];
        }
        const { data: sale } = await extraApi.get<{
          customerId: string; items?: { productId: string }[]
        }>(`/sales/${encodeURIComponent(movement.originId)}`, { signal });
        const first = sale.items?.[0];
        const [product, customer] = await Promise.allSettled([
          first ? extraApi.get<{ name: string }>(`/products/${encodeURIComponent(first.productId)}`, { signal }) : Promise.resolve(null),
          extraApi.get<{ name: string }>('/users/id', { params: { userId: sale.customerId }, signal }),
        ]);
        return [movement.originId, {
          name: product.status === 'fulfilled' ? product.value?.data?.name ?? 'Produto indisponível' : 'Produto indisponível',
          customer: customer.status === 'fulfilled' ? customer.value.data.name : 'Cliente indisponível',
          additionalProducts: Math.max(0, (sale.items?.length ?? 0) - 1),
        }];
      }));
      if (!signal.aborted) {
        setDetails(Object.fromEntries(settled.filter((item): item is PromiseFulfilledResult<[string, Detail]> => item.status === 'fulfilled').map(item => item.value)));
      }
    } catch (e) {
      if (signal.aborted || axios.isCancel(e)) return;
      setResult(null);
      setError(errorMessage(e));
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        await SecureStore.deleteItemAsync('access_token');
        router.replace('/');
      }
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [applied, page, size, sortBy, sortDirection]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMovements(controller.signal);
    return () => controller.abort();
  }, [fetchMovements, reloadKey]);

  const movements = result?.content ?? [];
  const pageSummary = useMemo(() => {
    const entries = movements.filter(item => item.direction === 'IN').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const exits = movements.filter(item => item.direction === 'OUT').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { entries, exits, balance: entries - exits };
  }, [movements]);
  const totalElements = result?.totalElements ?? 0;
  const currentPage = result?.page ?? page;
  const first = totalElements ? currentPage * size + 1 : 0;
  const last = totalElements ? Math.min(first + movements.length - 1, totalElements) : 0;

  function apply() {
    if (draft.createdFrom && draft.createdTo && draft.createdFrom > draft.createdTo) {
      Alert.alert('Datas inválidas', 'A data inicial não pode ser posterior à data final.'); return;
    }
    if (draft.minAmount && draft.maxAmount && Number(draft.minAmount.replace(',', '.')) > Number(draft.maxAmount.replace(',', '.'))) {
      Alert.alert('Valores inválidos', 'O valor mínimo não pode ultrapassar o valor máximo.'); return;
    }
    setApplied({ ...draft }); setPage(0);
  }
  function clear() { setDraft({ ...EMPTY }); setApplied({ ...EMPTY }); setPage(0); setError(null); }
  function quick(field: keyof Filters, value: string) {
    const next = { ...draft, [field]: applied[field] === value ? '' : value };
    setDraft(next); setApplied(next); setPage(0);
  }
  function openMenu(label: string, route?: string) {
    setMenuOpen(false);
    if (route) { if (route !== '/movimentacoes') router.push(route as never); return; }
    Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  }
  async function logout() {
    setMenuOpen(false);
    await SecureStore.deleteItemAsync('access_token');
    router.replace('/');
  }
  const selectField = (label: string, value: string, options: Option[], onPick: (v: string) => void) =>
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Pressable style={s.select} onPress={() => choose(label, value, options, onPick)}>
        <Text style={s.selectValue}>{options.find(option => option.value === value)?.label ?? 'Selecione'}</Text>
        <Ionicons name="chevron-down-outline" size={19} color={COLORS.gold} />
      </Pressable>
    </View>;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.topbar}>
        <Pressable onPress={() => setMenuOpen(true)} style={s.topbarButton} accessibilityLabel="Abrir menu">
          <Ionicons name="menu-outline" size={27} color={COLORS.ink} />
        </Pressable>
        <Text style={s.topbarTitle}>Movimentações</Text>
        <Pressable onPress={() => setReloadKey(n => n + 1)} style={s.topbarButton} accessibilityLabel="Atualizar movimentações">
          <Ionicons name="refresh-outline" size={21} color={COLORS.gold} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey(n => n + 1); }} colors={[COLORS.gold]} tintColor={COLORS.gold} />}>
        <Text style={s.heading}>Movimentações financeiras</Text>
        <Text style={s.helper}>Valores referentes somente à página carregada.</Text>
        <View style={s.metrics}>
          <Metric label="Entradas" value={money(pageSummary.entries)} icon="arrow-down-circle-outline" />
          <Metric label="Saídas" value={money(pageSummary.exits)} icon="arrow-up-circle-outline" />
          <Metric label="Saldo" value={money(pageSummary.balance)} icon="wallet-outline" />
          <Metric label="Movimentações" value={String(totalElements)} icon="swap-horizontal-outline" />
        </View>

        <View style={s.panel}>
          <View style={s.titleRow}><Ionicons name="calendar-outline" size={21} color={COLORS.gold} /><Text style={s.sectionTitle}>Filtrar</Text></View>
          <Field label="Data da movimentação — De (AAAA-MM-DD)" value={draft.createdFrom} onChange={v => update('createdFrom', v)} placeholder="2026-11-01" />
          <Field label="Data da movimentação — Até (AAAA-MM-DD)" value={draft.createdTo} onChange={v => update('createdTo', v)} placeholder="2026-11-30" />
          <Field label="ID da venda / despesa" value={draft.originId} onChange={v => update('originId', v)} maxLength={36} />
          <View style={s.twoCol}>
            <View style={s.column}><Field label="Valor — A partir de" value={draft.minAmount} onChange={v => update('minAmount', v)} placeholder="0,00" numeric /></View>
            <View style={s.column}><Field label="Valor — Até" value={draft.maxAmount} onChange={v => update('maxAmount', v)} placeholder="Sem limite" numeric /></View>
          </View>
          <Text style={s.fieldLabel}>Filtros rápidos</Text>
          <View style={s.chips}>{QUICK.map(item => {
            const selected = applied[item.field] === item.value;
            return <Pressable key={`${item.field}-${item.value}`} onPress={() => quick(item.field, item.value)}
              style={[s.chip, selected && s.chipActive]}>
              <Text style={[s.chipText, selected && s.chipTextActive]}>{item.label}</Text>
            </Pressable>;
          })}</View>
          <Button secondary label={advanced ? 'Ocultar filtros avançados' : 'Filtros avançados'} icon="options-outline" onPress={() => setAdvanced(v => !v)} />
          {advanced && <View style={s.advanced}>
            <Text style={s.sectionTitle}>Filtros avançados</Text>
            {selectField('Origem', draft.origin, [
              { value: '', label: 'Todas' }, { value: 'SALE', label: 'Vendas' }, { value: 'EXPENSE', label: 'Despesas' },
            ], v => update('origin', v))}
            {selectField('Direção', draft.direction, [
              { value: '', label: 'Todas' }, { value: 'IN', label: 'Entradas' }, { value: 'OUT', label: 'Saídas' },
            ], v => update('direction', v))}
            {selectField('Operação', draft.operation, [
              { value: '', label: 'Todas' }, ...Object.entries(OPERATIONS).map(([value, label]) => ({ value, label })),
            ], v => update('operation', v))}
            {selectField('Status', draft.status, [
              { value: '', label: 'Todos' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label })),
            ], v => update('status', v))}
            <Field label="Descrição" value={draft.description} onChange={v => update('description', v)} placeholder="Buscar na descrição" />
          </View>}
          <View style={s.actions}>
            <Button secondary label={`Limpar${activeCount ? ` (${activeCount})` : ''}`} icon="close-outline" onPress={clear} />
            <Button label="Buscar movimentações" icon="search-outline" onPress={apply} />
          </View>
        </View>

        <View style={s.panel}>
          <Text style={s.sectionTitle}>Histórico</Text>
          <Text style={s.helper}>{loading ? 'Carregando movimentações...' : `${totalElements} ${totalElements === 1 ? 'movimentação encontrada' : 'movimentações encontradas'}`}{activeCount ? ` · ${activeCount} filtros aplicados` : ''}</Text>
          {selectField('Ordenar por', sortBy, SORT, v => { setSortBy(v); setPage(0); })}
          <View style={s.twoCol}>
            <View style={s.column}>{selectField('Direção da ordem', sortDirection, [
              { value: 'DESC', label: 'Decrescente' }, { value: 'ASC', label: 'Crescente' },
            ], v => { setSortDirection(v); setPage(0); })}</View>
            <View style={s.column}>{selectField('Por página', String(size), [10, 20, 50, 100].map(n => ({ value: String(n), label: String(n) })), v => { setSize(Number(v)); setPage(0); })}</View>
          </View>
          <View style={s.refreshRow}><Button secondary label="Atualizar" icon="refresh-outline" disabled={loading} onPress={() => setReloadKey(n => n + 1)} /></View>
          {loading ? <View style={s.feedback}><ActivityIndicator size="large" color={COLORS.gold} /><Text style={s.helper}>Carregando...</Text></View>
            : error ? <View style={s.feedback}><Text style={s.error}>{error}</Text><Button secondary label="Tentar novamente" onPress={() => setReloadKey(n => n + 1)} /></View>
            : movements.length === 0 ? <Text style={s.empty}>Nenhuma movimentação encontrada.</Text>
            : movements.map((item, index) => {
              const entry = item.direction === 'IN';
              const exit = item.direction === 'OUT';
              const isSale = item.origin === 'SALE';
              const extra = details[item.originId];
              const operation = item.operation === 'CREATED'
                ? (isSale ? 'Venda registrada' : 'Despesa registrada')
                : item.operation === 'PAYMENT' ? (entry ? 'Recebimento' : 'Pagamento')
                  : OPERATIONS[item.operation] ?? item.operation;
              const originRoute = isSale ? `/vendas/${item.originId}` : `/despesas/${item.originId}`;
              return <View key={item.id} style={[s.movement, index % 2 === 1 && s.movementAlternate]}>
                <View style={s.movementTop}>
                  <View style={s.movementTopText}>
                    <Text style={s.movementCode}>{item.originCode?.toUpperCase() || item.originId}</Text>
                    <Text style={s.movementKind}>{isSale ? 'Venda' : 'Despesa'}</Text>
                  </View>
                  <View style={[s.directionPill, entry ? s.inPill : exit ? s.outPill : s.neutralPill]}>
                    <Ionicons name={entry ? 'arrow-down-outline' : exit ? 'arrow-up-outline' : 'swap-horizontal-outline'} size={15} color={entry ? '#047857' : exit ? '#b91c1c' : COLORS.muted} />
                    <Text style={[s.directionText, { color: entry ? '#047857' : exit ? '#b91c1c' : COLORS.muted }]}>{entry ? 'Entrada' : exit ? 'Saída' : 'Venda'}</Text>
                  </View>
                </View>
                <Text style={[s.movementAmount, entry && s.entryValue, exit && s.exitValue]}>
                  {entry ? '+ ' : exit ? '− ' : ''}{money(Number(item.amount ?? 0))}
                </Text>
                <View style={s.detailBlock}>
                  <Text style={s.detailLabel}>Produto / Despesa</Text>
                  <Text style={s.detailValue}>{extra?.name ?? '—'}{extra?.additionalProducts ? ` +${extra.additionalProducts}` : ''}</Text>
                </View>
                {isSale && <View style={s.detailBlock}>
                  <Text style={s.detailLabel}>Cliente</Text>
                  <Text style={s.detailValue}>{extra?.customer ?? '—'}</Text>
                </View>}
                <View style={s.detailBlock}><Text style={s.detailLabel}>Operação</Text><Text style={s.detailValue}>{operation}</Text></View>
                <View style={s.detailBlock}><Text style={s.detailLabel}>Data</Text><Text style={s.detailValue}>{dateTime(item.createdAt)}</Text></View>
                <View style={s.movementActions}>
                  <Button secondary label={isSale ? 'Visualizar venda' : 'Visualizar despesa'} icon="eye-outline"
                    onPress={() => router.push(originRoute as never)} />
                </View>
              </View>;
            })}
          {!loading && !error && result && <View style={s.pagination}>
            <Text style={s.helper}>Exibindo {first} a {last} de {totalElements} resultados</Text>
            <Text style={s.pageText}>Página {result.totalPages ? currentPage + 1 : 0} de {result.totalPages}</Text>
            <View style={s.actions}>
              <Button secondary label="Anterior" icon="chevron-back-outline" disabled={loading || result.first} onPress={() => setPage(p => Math.max(0, p - 1))} />
              <Button secondary label="Próxima" icon="chevron-forward-outline" disabled={loading || result.last} onPress={() => setPage(p => p + 1)} />
            </View>
          </View>}
        </View>
        <Text style={s.footer}>Personalité Creative · Sistema de gestão</Text>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} accessibilityLabel="Fechar seleção" />
        <View style={s.pickerCard}>
          <View style={s.pickerHeader}>
            <Text style={s.pickerTitle}>{picker?.title}</Text>
            <Pressable onPress={() => setPicker(null)} accessibilityLabel="Fechar"><Ionicons name="close" size={24} color={COLORS.ink} /></Pressable>
          </View>
          <ScrollView style={s.pickerList} keyboardShouldPersistTaps="handled">
            {picker?.options.map(option => <Pressable key={option.value} style={s.pickerItem} onPress={() => { picker?.select(option.value); setPicker(null); }}>
              <Text style={s.pickerItemText}>{option.label}</Text>
              {option.value === picker?.value && <Ionicons name="checkmark" size={20} color={COLORS.gold} />}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>

    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={s.drawerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" />
        <SafeAreaView style={s.drawer} edges={['top', 'bottom']}>
          <View style={s.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} style={s.drawerLogo} resizeMode="contain" />
            <View style={s.drawerBrandText}>
              <Text style={s.drawerEyebrow}>PERSONALITÉ</Text>
              <Text style={s.drawerTitle}>Creative</Text>
            </View>
            <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu"><Ionicons name="close" size={24} color="#fff" /></Pressable>
          </View>
          <ScrollView style={s.drawerScroll} contentContainerStyle={s.drawerContent}>
            <Text style={s.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} onPress={() => openMenu(item.label, item.route)}
              style={[s.drawerItem, item.route === '/movimentacoes' && s.drawerActive]}>
              <Ionicons name={item.icon} size={19} color="#eee7db" />
              <Text style={s.drawerItemText}>{item.label}</Text>
            </Pressable>)}
            <Text style={s.drawerSection}>SISTEMA</Text>
            <Pressable onPress={() => openMenu('Meu Perfil')} style={s.drawerItem}>
              <Ionicons name="settings-outline" size={19} color="#eee7db" /><Text style={s.drawerItemText}>Meu Perfil</Text>
            </Pressable>
          </ScrollView>
          <Pressable style={s.drawerLogout} onPress={() => void logout()}>
            <Ionicons name="log-out-outline" size={20} color="#eee7db" /><Text style={s.drawerItemText}>Sair</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: COLORS.bg },
  topbar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border, minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  topbarButton: { width: 39, height: 44, alignItems: 'center', justifyContent: 'center' },
  topbarTitle: { flex: 1, fontSize: 20, lineHeight: 31, fontWeight: '700', color: COLORS.ink, includeFontPadding: true },
  content: { padding: 16, paddingBottom: 42 },
  heading: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 27, lineHeight: 39, color: COLORS.ink, includeFontPadding: true, marginBottom: 4 },
  helper: { fontSize: 12, lineHeight: 21, color: COLORS.muted, includeFontPadding: true },
  metrics: { gap: 10, marginTop: 15, marginBottom: 18 },
  metric: { backgroundColor: '#fff', padding: 16, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15 },
  metricHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  metricLabel: { flex: 1, color: COLORS.muted, fontSize: 14, lineHeight: 23, includeFontPadding: true },
  metricValue: { fontSize: 23, lineHeight: 35, color: COLORS.ink, fontWeight: '700', includeFontPadding: true, marginTop: 9 },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, marginBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 15 },
  sectionTitle: { color: COLORS.ink, fontSize: 18, lineHeight: 29, fontWeight: '700', includeFontPadding: true, marginBottom: 9 },
  field: { marginBottom: 14, minWidth: 0 },
  fieldLabel: { fontSize: 13, lineHeight: 23, color: COLORS.ink, fontWeight: '600', marginBottom: 7, includeFontPadding: true },
  input: { minHeight: 49, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 10, color: COLORS.ink, fontSize: 14, includeFontPadding: true },
  twoCol: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, column: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11 },
  chipActive: { backgroundColor: '#f2e9da', borderColor: COLORS.gold },
  chipText: { color: COLORS.muted, fontSize: 12, lineHeight: 22, fontWeight: '600', includeFontPadding: true },
  chipTextActive: { color: '#725934' },
  advanced: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 17, paddingTop: 16, marginBottom: 9 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 49, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 10 },
  selectValue: { flex: 1, fontSize: 13, lineHeight: 22, color: COLORS.ink, includeFontPadding: true },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14, justifyContent: 'flex-end' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 15, paddingVertical: 11, minHeight: 45, borderRadius: 11 },
  buttonPrimary: { backgroundColor: COLORS.ink },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  buttonText: { fontSize: 13, lineHeight: 23, fontWeight: '700', includeFontPadding: true },
  buttonTextPrimary: { color: '#fff' }, buttonTextSecondary: { color: '#80623d' }, disabled: { opacity: 0.4 },
  refreshRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  feedback: { paddingVertical: 28, gap: 12, alignItems: 'center' },
  error: { color: '#b91c1c', fontSize: 13, lineHeight: 23, textAlign: 'center' },
  empty: { color: COLORS.muted, fontSize: 13, lineHeight: 23, paddingVertical: 24, textAlign: 'center' },
  movement: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, padding: 15, marginBottom: 12, gap: 7 },
  movementAlternate: { backgroundColor: '#f0ece6' },
  movementTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 },
  movementTopText: { gap: 3, minWidth: 0, flexGrow: 1 },
  movementCode: { color: COLORS.ink, fontSize: 15, lineHeight: 25, fontWeight: '700', includeFontPadding: true },
  movementKind: { color: COLORS.muted, fontSize: 12, lineHeight: 21, includeFontPadding: true },
  directionPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: 10, gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  inPill: { backgroundColor: '#d1fae5' }, outPill: { backgroundColor: '#fee2e2' }, neutralPill: { backgroundColor: '#eee8df' },
  directionText: { fontSize: 12, lineHeight: 21, fontWeight: '700', includeFontPadding: true },
  movementAmount: { fontSize: 22, lineHeight: 34, fontWeight: '700', color: COLORS.ink, includeFontPadding: true },
  entryValue: { color: '#047857' }, exitValue: { color: '#b91c1c' },
  detailBlock: { gap: 3 }, detailLabel: { fontSize: 11, lineHeight: 19, color: COLORS.muted, includeFontPadding: true },
  detailValue: { fontSize: 14, lineHeight: 24, color: COLORS.ink, fontWeight: '600', includeFontPadding: true },
  movementActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 7 },
  pagination: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14, gap: 9 },
  pageText: { color: COLORS.ink, fontSize: 13, lineHeight: 22, fontWeight: '700', includeFontPadding: true },
  footer: { fontSize: 12, lineHeight: 21, textAlign: 'center', color: COLORS.muted, paddingTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: '#0008', padding: 20, justifyContent: 'center' },
  pickerCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, maxHeight: '80%' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  pickerTitle: { flex: 1, color: COLORS.ink, fontSize: 18, lineHeight: 29, fontWeight: '700' },
  pickerList: { flexGrow: 0 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  pickerItemText: { flex: 1, fontSize: 14, lineHeight: 24, color: COLORS.ink, includeFontPadding: true },
  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: '#0008' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: COLORS.menu },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  drawerLogo: { width: 56, height: 67 }, drawerBrandText: { flex: 1 },
  drawerEyebrow: { fontSize: 10, lineHeight: 18, color: '#d5bd91', letterSpacing: 2, fontWeight: '700' },
  drawerTitle: { fontFamily: 'serif', fontSize: 21, lineHeight: 30, color: '#fff' },
  drawerScroll: { flex: 1 }, drawerContent: { paddingHorizontal: 13, paddingTop: 24, paddingBottom: 25 },
  drawerSection: { color: '#b1a698', fontSize: 10, lineHeight: 19, fontWeight: '700', letterSpacing: 1.7, marginBottom: 14, marginTop: 18 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', minHeight: 49, paddingHorizontal: 15, marginBottom: 3, gap: 12, borderRadius: 10 },
  drawerActive: { backgroundColor: '#665949' },
  drawerItemText: { flex: 1, fontSize: 14, lineHeight: 23, color: '#eee7db', fontWeight: '600', includeFontPadding: true },
  drawerLogout: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 20, paddingHorizontal: 27, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
