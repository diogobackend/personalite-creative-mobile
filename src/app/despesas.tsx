import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type ExpenseStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
type AllocationType = 'GENERAL' | 'SPECIFIC_PRODUCT' | 'CATEGORY_PRODUCTS';
type Expense = {
  id: string; name: string; description: string | null; value: number; paidAmount: number;
  category: string; allocationType: AllocationType; status: ExpenseStatus;
  quantity: number | null; products: { productId: string; allocatedValue: number }[];
  expenseDate: string; createdAt: string; updatedAt: string;
};
type ExpensesPage = {
  content: Expense[]; page: number; size: number; totalElements: number;
  totalElementsThisPage: number; totalPages: number;
};
type Category = { id: string; name: string; type: string };
type ProductSummary = { id: string; category?: string | { name?: string; label?: string } | null };
type Filters = {
  name: string; description: string; value: string; minValue: string; maxValue: string;
  category: string; allocationType: string; status: string; productId: string;
  quantity: string; minQuantity: string; maxQuantity: string;
  expenseDate: string; expenseDateFrom: string; expenseDateTo: string;
  createdAt: string; createdFrom: string; createdTo: string;
  updatedFrom: string; updatedTo: string;
};
type Option = { value: string; label: string };
type PickerState = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;
const C = { bg: '#f8f6f2', white: '#fff', ink: '#342d27', muted: '#766d63', gold: '#a98a58', border: '#e8e0d4', menu: '#39342f' };
const EMPTY: Filters = {
  name: '', description: '', value: '', minValue: '', maxValue: '', category: '',
  allocationType: '', status: '', productId: '', quantity: '', minQuantity: '', maxQuantity: '',
  expenseDate: '', expenseDateFrom: '', expenseDateTo: '', createdAt: '', createdFrom: '',
  createdTo: '', updatedFrom: '', updatedTo: '',
};
const ALLOCATIONS: Option[] = [
  { value: '', label: 'Todas as alocações' }, { value: 'GENERAL', label: 'Geral' },
  { value: 'SPECIFIC_PRODUCT', label: 'Produto específico' },
  { value: 'CATEGORY_PRODUCTS', label: 'Diversos produtos por categoria' },
];
const STATUSES: Option[] = [
  { value: '', label: 'Todos os status' }, { value: 'PARTIALLY_PAID', label: 'Parcialmente pago' },
  { value: 'PAID', label: '100% pago' }, { value: 'PENDING', label: '0% pago' },
  { value: 'CANCELLED', label: 'Cancelado' },
];
const SORT: Option[] = [
  { value: 'expenseDate', label: 'Data' }, { value: 'createdAt', label: 'Data de cadastro' },
  { value: 'updatedAt', label: 'Última atualização' }, { value: 'name', label: 'Nome' },
  { value: 'value', label: 'Valor' }, { value: 'category', label: 'Categoria' },
  { value: 'allocationType', label: 'Alocação' }, { value: 'status', label: 'Status' },
  { value: 'quantity', label: 'Quantidade' },
];
const ADVANCED: { key: keyof Filters; label: string; placeholder: string; numeric?: boolean }[] = [
  { key: 'description', label: 'Descrição', placeholder: 'Buscar pela descrição' },
  { key: 'value', label: 'Valor exato (R$)', placeholder: '0.00', numeric: true },
  { key: 'productId', label: 'ID do produto', placeholder: 'Identificador do produto' },
  { key: 'quantity', label: 'Quantidade exata', placeholder: 'Quantidade', numeric: true },
  { key: 'minQuantity', label: 'Quantidade mínima', placeholder: 'Mínima', numeric: true },
  { key: 'maxQuantity', label: 'Quantidade máxima', placeholder: 'Máxima', numeric: true },
  { key: 'expenseDate', label: 'Data exata da despesa', placeholder: 'AAAA-MM-DD' },
  { key: 'createdAt', label: 'Data exata do cadastro', placeholder: 'AAAA-MM-DD' },
  { key: 'createdFrom', label: 'Cadastro a partir de', placeholder: 'AAAA-MM-DDTHH:mm' },
  { key: 'createdTo', label: 'Cadastro até', placeholder: 'AAAA-MM-DDTHH:mm' },
  { key: 'updatedFrom', label: 'Atualização a partir de', placeholder: 'AAAA-MM-DDTHH:mm' },
  { key: 'updatedTo', label: 'Atualização até', placeholder: 'AAAA-MM-DDTHH:mm' },
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
  { label: 'Relatórios', icon: 'stats-chart-outline', route: '/relatorios' },
];
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const dateLabel = (value: string | null | undefined) => {
  if (!value) return '—';
  const parts = value.slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
};
const statusName = (value: string) => STATUSES.find(item => item.value === value)?.label ?? value;
const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não possui permissão para consultar despesas.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : `Erro ao consultar despesas (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Não foi possível carregar as despesas.';
};
async function authHeaders() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token || token === 'null' || token === 'undefined') throw new Error('Sessão inválida. Faça login novamente.');
  return { Authorization: `Bearer ${token}` };
}
function buildParams(filters: Filters, page: number, size: number, sortBy: string, sortDirection: string) {
  const params: Record<string, string | number> = { page, size, sortBy, sortDirection };
  (Object.entries(filters) as [keyof Filters, string][]).forEach(([key, raw]) => {
    const value = raw.trim();
    if (!value) return;
    if (['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'].includes(key)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) params[key] = parsed.toISOString();
    } else params[key] = value;
  });
  return params;
}
function Field({ title, value, onChange, placeholder, numeric = false }: {
  title: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean;
}) {
  return <View style={s.field}>
    <Text style={s.fieldLabel}>{title}</Text>
    <TextInput style={s.input} value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor="#a8a29e" autoCapitalize="none" keyboardType={numeric ? 'decimal-pad' : 'default'} />
  </View>;
}
function Button({ title, icon, onPress, secondary = false, disabled = false }: {
  title: string; icon?: IconName; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    style={[s.button, secondary ? s.buttonSecondary : s.buttonPrimary, disabled && s.disabled]}>
    {icon && <Ionicons name={icon} size={18} color={secondary ? C.gold : '#fff'} />}
    <Text style={[s.buttonLabel, secondary ? s.buttonLabelSecondary : s.buttonLabelPrimary]}>{title}</Text>
  </Pressable>;
}
function Summary({ label, value, icon }: { label: string; value: number; icon: IconName }) {
  return <View style={s.summary}>
    <View style={s.summaryHead}><Text style={s.summaryLabel}>{label}</Text><Ionicons name={icon} size={21} color={C.gold}/></View>
    <Text style={s.summaryValue}>{money(value)}</Text>
  </View>;
}
function Section({ children, title }: { children: ReactNode; title: string }) {
  return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}
export default function DespesasScreen() {
  const [draft, setDraft] = useState<Filters>({ ...EMPTY });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY });
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState('expenseDate');
  const [sortDirection, setSortDirection] = useState('DESC');
  const [result, setResult] = useState<ExpensesPage | null>(null);
  const [summary, setSummary] = useState({ total: 0, paid: 0, remaining: 0, cancelled: 0 });
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCategories, setProductCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);
  const [picker, setPicker] = useState<PickerState>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const update = (key: keyof Filters, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  const activeCount = useMemo(() => Object.values(applied).filter(value => value.trim()).length, [applied]);
  const total = result?.totalElements ?? 0;
  const currentPage = result?.page ?? page;
  const totalPages = result?.totalPages ?? 0;
  const first = total === 0 ? 0 : currentPage * size + 1;
  const last = total === 0 ? 0 : Math.min(currentPage * size + (result?.totalElementsThisPage ?? result?.content.length ?? 0), total);
  const openPicker = (title: string, value: string, options: Option[], onPick: (value: string) => void) =>
    setPicker({ title, value, options, onPick });
  const selectField = (title: string, value: string, options: Option[], onPick: (value: string) => void) =>
    <View style={s.field}>
      <Text style={s.fieldLabel}>{title}</Text>
      <Pressable style={s.select} onPress={() => openPicker(title, value, options, onPick)}>
        <Text style={s.selectText}>{options.find(option => option.value === value)?.label ?? 'Selecionar'}</Text>
        <Ionicons name="chevron-down-outline" size={18} color={C.gold}/>
      </Pressable>
    </View>;

  const fetchExpenses = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const headers = await authHeaders();
      const { data } = await api.get<ExpensesPage>('/expenses', {
        params: buildParams(applied, page, size, sortBy, sortDirection), headers, signal,
      });
      if (signal.aborted) return;
      setResult(data);
      const missingIds = new Set((data.content ?? []).flatMap(expense =>
        expense.allocationType === 'GENERAL' ? [] : (expense.products ?? []).map(product => product.productId)
      ));
      if (!missingIds.size) { setProductCategories({}); return; }
      try {
        const labels: Record<string, string> = {};
        let index = 0, totalProductPages = 1;
        while (index < totalProductPages && missingIds.size && !signal.aborted) {
          const response = await api.get<{ content: ProductSummary[]; totalPages: number }>('/products', {
            params: { page: index, size: 100 }, headers, signal,
          });
          for (const product of response.data.content ?? []) {
            if (!missingIds.has(product.id)) continue;
            const category = product.category;
            const label = typeof category === 'string' ? category : category?.name ?? category?.label;
            if (label) labels[product.id] = label;
            missingIds.delete(product.id);
          }
          totalProductPages = response.data.totalPages ?? 1;
          index++;
        }
        if (!signal.aborted) setProductCategories(labels);
      } catch (cause) {
        if (!signal.aborted && !axios.isCancel(cause)) setProductCategories({});
      }
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setResult(null); setError(errorMessage(cause));
      if (axios.isAxiosError(cause) && cause.response?.status === 401) {
        await SecureStore.deleteItemAsync('access_token'); router.replace('/');
      }
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [applied, page, size, sortBy, sortDirection]);
  useEffect(() => {
    const controller = new AbortController(); void fetchExpenses(controller.signal);
    return () => controller.abort();
  }, [fetchExpenses, reload]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const headers = await authHeaders();
        const { data } = await api.get<Category[] | { content: Category[] }>('/categories', {
          params: { type: 'EXPENSE' }, headers, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const list = Array.isArray(data) ? data : data.content ?? [];
        setCategories(list.filter(category => category.type === 'EXPENSE'));
      } catch { if (!controller.signal.aborted) setCategories([]); }
    })();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setSummaryLoading(true);
      try {
        const headers = await authHeaders();
        const totals = { total: 0, paid: 0, remaining: 0, cancelled: 0 };
        let index = 0, pages = 1;
        while (index < pages && !controller.signal.aborted) {
          const { data } = await api.get<ExpensesPage>('/expenses', {
            params: { page: index, size: 100 }, headers, signal: controller.signal,
          });
          for (const expense of data.content ?? []) {
            const value = Number(expense.value) || 0;
            const paid = Number(expense.paidAmount) || 0;
            if (expense.status === 'CANCELLED') totals.cancelled += value;
            else { totals.total += value; totals.paid += paid; totals.remaining += Math.max(0, value - paid); }
          }
          pages = data.totalPages ?? 1;
          index++;
        }
        if (!controller.signal.aborted) setSummary(totals);
      } catch {
        if (!controller.signal.aborted) setSummary({ total: 0, paid: 0, remaining: 0, cancelled: 0 });
      } finally { if (!controller.signal.aborted) setSummaryLoading(false); }
    })();
    return () => controller.abort();
  }, [reload]);
  const apply = () => { setPage(0); setApplied({ ...draft }); };
  const clear = () => { setDraft({ ...EMPTY }); setApplied({ ...EMPTY }); setPage(0); };
  const navigate = (label: string, route?: string) => {
    setMenuOpen(false);
    if (route) { if (route !== '/despesas') router.push(route as never); return; }
    Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  };
  const logout = async () => {
    setMenuOpen(false); await SecureStore.deleteItemAsync('access_token'); router.replace('/');
  };
  const allocationLabel = (expense: Expense) => {
    if (expense.allocationType === 'GENERAL') return 'Gerais';
    const category = (expense.products ?? []).map(p => productCategories[p.productId]).find(Boolean);
    return category ?? 'Categoria não identificada';
  };
  const renderExpense = ({ item, index }: { item: Expense; index: number }) => (
    <View style={[s.expenseCard, index % 2 === 1 && s.expenseAlt]}>
      <View style={s.expenseTop}>
        <View style={s.expenseTitleBlock}>
          <Text style={s.expenseId}>#{item.id.slice(0, 5).toUpperCase()}</Text>
          <Text style={s.expenseName}>{item.name}</Text>
        </View>
        <View style={[s.statusBadge,
          item.status === 'PAID' ? s.paid : item.status === 'CANCELLED' ? s.cancelled : item.status === 'PARTIALLY_PAID' ? s.partial : s.pending]}>
          <Text style={s.statusText}>{statusName(item.status)}</Text>
        </View>
      </View>
      <View style={s.infoRow}><Text style={s.infoLabel}>Categoria</Text><Text style={s.infoValue}>{item.category}</Text></View>
      <View style={s.infoRow}><Text style={s.infoLabel}>Valor</Text><Text style={s.expenseValue}>{money(Number(item.value ?? 0))}</Text></View>
      <View style={s.infoRow}><Text style={s.infoLabel}>Alocação</Text><Text style={s.infoValue}>{allocationLabel(item)}</Text></View>
      <View style={s.infoRow}><Text style={s.infoLabel}>Data</Text><Text style={s.infoValue}>{dateLabel(item.expenseDate)}</Text></View>
      <View style={s.expenseActions}>
        <Button title="Visualizar" icon="eye-outline" secondary onPress={() => router.push(`/despesas/${item.id}` as never)}/>
        <Button title="Editar" icon="pencil-outline" secondary onPress={() => router.push(`/despesas/${item.id}/editar` as never)}/>
      </View>
    </View>
  );

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={!loading && !error ? result?.content ?? [] : []}
        keyExtractor={item => item.id}
        renderItem={renderExpense}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReload(n => n + 1); }} tintColor={C.gold} colors={[C.gold]}/>}
        ListHeaderComponent={<>
          <View style={s.topbar}>
            <Pressable onPress={() => setMenuOpen(true)} style={s.topbarIcon} accessibilityLabel="Abrir menu">
              <Ionicons name="menu-outline" size={27} color={C.ink}/>
            </Pressable>
            <Text style={s.topbarTitle}>Despesas</Text>
            <Pressable onPress={() => setReload(n => n + 1)} style={s.topbarIcon} accessibilityLabel="Atualizar despesas">
              <Ionicons name="refresh-outline" size={22} color={C.gold}/>
            </Pressable>
          </View>
          <View style={s.headingRow}>
            <Text style={s.heading}>Gestão de despesas</Text>
            <Button title="Cadastrar despesa" icon="add" onPress={() => router.push('/despesas/nova' as never)}/>
          </View>
          <View style={s.metrics}>
            <Summary label="Valor total" value={summary.total} icon="wallet-outline" />
            <Summary label="Total pago" value={summary.paid} icon="cash-outline" />
            <Summary label="Valor pendente" value={summary.remaining} icon="time-outline" />
            <Summary label="Despesas canceladas" value={summary.cancelled} icon="ban-outline" />
            {summaryLoading && <ActivityIndicator color={C.gold} />}
          </View>
          <Section title="Buscar despesas">
            <Field title="Nome" value={draft.name} onChange={v => update('name', v)} placeholder="Buscar despesa"/>
            <Field title="Despesa a partir de (AAAA-MM-DD)" value={draft.expenseDateFrom} onChange={v => update('expenseDateFrom', v)} placeholder="2026-11-01"/>
            <Field title="Despesa até (AAAA-MM-DD)" value={draft.expenseDateTo} onChange={v => update('expenseDateTo', v)} placeholder="2026-11-30"/>
            <View style={s.twoColumns}>
              <View style={s.column}><Field title="Valor mínimo" value={draft.minValue} onChange={v => update('minValue', v)} placeholder="0.00" numeric /></View>
              <View style={s.column}><Field title="Valor máximo" value={draft.maxValue} onChange={v => update('maxValue', v)} placeholder="0.00" numeric /></View>
            </View>
            <View style={s.actions}>
              <Button title="Buscar" icon="search-outline" onPress={apply}/>
              <Button title={advanced ? 'Ocultar filtros' : 'Filtros'} icon="options-outline" secondary onPress={() => setAdvanced(x => !x)}/>
            </View>
            {advanced && <View style={s.advanced}>
              <Text style={s.subTitle}>Filtros avançados</Text>
              {selectField('Categoria', draft.category,
                [{ value: '', label: 'Todas as categorias' }, ...categories.map(c => ({ value: c.name, label: c.name }))], v => update('category', v))}
              {selectField('Status', draft.status, STATUSES, v => update('status', v))}
              {selectField('Tipo de alocação', draft.allocationType, ALLOCATIONS, v => update('allocationType', v))}
              {ADVANCED.map(field => <Field key={field.key} title={field.label} value={draft[field.key]}
                onChange={v => update(field.key, v)} placeholder={field.placeholder} numeric={field.numeric}/>)}
              <View style={s.actions}><Button title="Limpar filtros" icon="close-outline" secondary onPress={clear}/><Button title="Aplicar filtros" icon="search-outline" onPress={apply}/></View>
            </View>}
          </Section>
          <Section title="Despesas cadastradas">
            <Text style={s.helper}>{loading ? 'Carregando despesas...' : `${total} ${total === 1 ? 'despesa encontrada' : 'despesas encontradas'}`}{activeCount ? ` · ${activeCount} filtro(s) aplicado(s)` : ''}</Text>
            {selectField('Ordenar por', sortBy, SORT, v => { setSortBy(v); setPage(0); })}
            <View style={s.twoColumns}>
              <View style={s.column}>{selectField('Direção', sortDirection, [{ value: 'DESC', label: 'Decrescente' }, { value: 'ASC', label: 'Crescente' }], v => { setSortDirection(v); setPage(0); })}</View>
              <View style={s.column}>{selectField('Por página', String(size), [10, 20, 50, 100].map(n => ({ value: String(n), label: String(n) })), v => { setSize(Number(v)); setPage(0); })}</View>
            </View>
            <View style={s.refreshRow}><Button title="Atualizar" icon="refresh-outline" secondary disabled={loading} onPress={() => setReload(n => n + 1)} /></View>
            {loading && <View style={s.feedback}><ActivityIndicator size="large" color={C.gold}/><Text style={s.helper}>Carregando...</Text></View>}
            {error && <View style={s.feedback}><Text style={s.errorText}>{error}</Text><Button title="Tentar novamente" secondary onPress={() => setReload(n => n + 1)}/></View>}
            {!loading && !error && !result?.content?.length && <View style={s.feedback}><Ionicons name="wallet-outline" size={38} color={C.gold}/><Text style={s.helper}>Nenhuma despesa encontrada.</Text></View>}
          </Section>
        </>}
        ListFooterComponent={!loading && !error && result ? (
          <View style={s.pagination}>
            <Text style={s.helper}>Exibindo {first} a {last} de {total} resultados</Text>
            <Text style={s.pageLabel}>Página {totalPages === 0 ? 0 : currentPage + 1} de {totalPages}</Text>
            <View style={s.actions}>
              <Button title="Anterior" icon="chevron-back-outline" secondary disabled={page === 0} onPress={() => setPage(p => Math.max(0, p - 1))}/>
              <Button title="Próxima" icon="chevron-forward-outline" secondary disabled={totalPages === 0 || page >= totalPages - 1} onPress={() => setPage(p => p + 1)}/>
            </View>
          </View>
        ) : undefined}
      />
    </KeyboardAvoidingView>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)}/>
        <View style={s.pickerCard}>
          <View style={s.pickerHeader}><Text style={s.pickerTitle}>{picker?.title}</Text><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={C.ink}/></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" style={s.pickerScroll}>
            {picker?.options.map(option => <Pressable key={option.value} style={s.pickerOption} onPress={() => { picker.onPick(option.value); setPicker(null); }}>
              <Text style={s.pickerOptionText}>{option.label}</Text>
              {picker?.value === option.value && <Ionicons name="checkmark" size={20} color={C.gold}/>}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={s.drawerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)}/>
        <SafeAreaView style={s.drawer} edges={['top', 'bottom']}>
          <View style={s.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} style={s.drawerLogo} resizeMode="contain"/>
            <View style={s.drawerBrandText}><Text style={s.drawerEyebrow}>PERSONALITÉ</Text><Text style={s.drawerTitle}>Creative</Text></View>
            <Pressable onPress={() => setMenuOpen(false)}><Ionicons name="close" size={23} color="#fff"/></Pressable>
          </View>
          <ScrollView style={s.drawerScroll} contentContainerStyle={s.drawerContent}>
            <Text style={s.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} style={[s.drawerItem, item.route === '/despesas' && s.drawerActive]} onPress={() => navigate(item.label, item.route)}>
              <Ionicons name={item.icon} size={19} color="#eee7db"/>
              <Text style={s.drawerItemText}>{item.label}</Text>
            </Pressable>)}
            <Text style={s.drawerSection}>SISTEMA</Text>
            <Pressable style={s.drawerItem} onPress={() => navigate('Meu Perfil')}><Ionicons name="settings-outline" size={19} color="#eee7db"/><Text style={s.drawerItemText}>Meu Perfil</Text></Pressable>
          </ScrollView>
          <Pressable style={s.drawerLogout} onPress={() => void logout()}><Ionicons name="log-out-outline" size={20} color="#eee7db"/><Text style={s.drawerItemText}>Sair</Text></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, flexGrow: 1 },
  topbar: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 13, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 60, marginBottom: 19 },
  topbarIcon: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  topbarTitle: { flex: 1, fontWeight: '700', fontSize: 21, lineHeight: 32, color: C.ink, includeFontPadding: true },
  headingRow: { marginBottom: 20, gap: 12, alignItems: 'flex-start' },
  heading: { color: C.ink, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 28, lineHeight: 40, includeFontPadding: true },
  metrics: { gap: 11, marginBottom: 22 },
  summary: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 17 },
  summaryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 11 },
  summaryLabel: { fontSize: 14, lineHeight: 23, color: C.muted, flex: 1, includeFontPadding: true },
  summaryValue: { fontSize: 23, lineHeight: 35, fontWeight: '700', color: C.ink, marginTop: 10, includeFontPadding: true },
  section: { backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 17 },
  sectionTitle: { fontSize: 18, lineHeight: 29, fontWeight: '700', color: C.ink, marginBottom: 14, includeFontPadding: true },
  subTitle: { fontSize: 15, lineHeight: 25, fontWeight: '700', color: C.ink, marginBottom: 12 },
  helper: { color: C.muted, fontSize: 12, lineHeight: 21, marginBottom: 8, includeFontPadding: true },
  field: { marginBottom: 13, minWidth: 0 },
  fieldLabel: { color: C.ink, fontSize: 13, lineHeight: 22, fontWeight: '600', marginBottom: 7, includeFontPadding: true },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 11, color: C.ink, paddingHorizontal: 13, paddingVertical: 9, fontSize: 14, includeFontPadding: true },
  twoColumns: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9, marginTop: 9 },
  button: { minHeight: 45, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11 },
  buttonPrimary: { backgroundColor: C.gold }, buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  buttonLabel: { fontSize: 13, lineHeight: 22, fontWeight: '700', includeFontPadding: true },
  buttonLabelPrimary: { color: '#fff' }, buttonLabelSecondary: { color: '#80623d' }, disabled: { opacity: 0.4 },
  advanced: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, marginTop: 17 },
  select: { borderRadius: 11, borderWidth: 1, borderColor: C.border, minHeight: 49, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  selectText: { flex: 1, fontSize: 13, lineHeight: 22, color: C.ink, includeFontPadding: true },
  refreshRow: { alignItems: 'flex-end', marginBottom: 7 },
  feedback: { paddingVertical: 23, gap: 12, alignItems: 'center' },
  errorText: { fontSize: 13, lineHeight: 22, color: '#b91c1c', textAlign: 'center' },
  expenseCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, marginBottom: 12, gap: 8 },
  expenseAlt: { backgroundColor: '#eee9e2' },
  expenseTop: { gap: 8 }, expenseTitleBlock: { gap: 4 },
  expenseId: { fontSize: 11, lineHeight: 19, color: C.gold, fontWeight: '700' },
  expenseName: { fontSize: 17, lineHeight: 29, fontWeight: '700', color: C.ink, includeFontPadding: true },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  statusText: { fontSize: 12, lineHeight: 21, color: C.ink, fontWeight: '700', includeFontPadding: true },
  paid: { backgroundColor: '#d1fae5' }, pending: { backgroundColor: '#fef3c7' },
  partial: { backgroundColor: '#dbeafe' }, cancelled: { backgroundColor: '#fee2e2' },
  infoRow: { gap: 4 }, infoLabel: { color: C.muted, fontSize: 12, lineHeight: 20 },
  infoValue: { color: C.ink, fontSize: 14, lineHeight: 23, fontWeight: '600', includeFontPadding: true },
  expenseValue: { color: C.ink, fontSize: 19, lineHeight: 31, fontWeight: '700', includeFontPadding: true },
  expenseActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9, marginTop: 8 },
  pagination: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, marginTop: 5, gap: 9 },
  pageLabel: { color: C.ink, fontSize: 13, lineHeight: 22, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 },
  pickerCard: { backgroundColor: '#fff', padding: 18, borderRadius: 18, maxHeight: '80%' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  pickerTitle: { flex: 1, fontSize: 18, lineHeight: 29, color: C.ink, fontWeight: '700' },
  pickerScroll: { flexGrow: 0 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerOptionText: { flex: 1, fontSize: 14, lineHeight: 24, color: C.ink },
  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: '#0008' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: C.menu },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 19, gap: 10, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  drawerLogo: { width: 56, height: 66 }, drawerBrandText: { flex: 1 },
  drawerEyebrow: { fontSize: 10, lineHeight: 18, letterSpacing: 2, fontWeight: '700', color: '#d5bd91' },
  drawerTitle: { fontFamily: 'serif', fontSize: 21, lineHeight: 29, color: '#fff' },
  drawerScroll: { flex: 1 }, drawerContent: { paddingHorizontal: 13, paddingTop: 24, paddingBottom: 27 },
  drawerSection: { color: '#b1a698', fontSize: 10, lineHeight: 19, fontWeight: '700', letterSpacing: 1.7, marginBottom: 14, marginTop: 18 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, minHeight: 49, gap: 12, borderRadius: 10, marginBottom: 3 },
  drawerActive: { backgroundColor: '#665949' }, drawerItemText: { flex: 1, color: '#eee7db', fontSize: 14, lineHeight: 23, fontWeight: '600', includeFontPadding: true },
  drawerLogout: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 27, paddingVertical: 20, gap: 12, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
