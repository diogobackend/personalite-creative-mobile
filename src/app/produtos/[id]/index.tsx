import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type Price = { id: string; minimumQuantity: number; unitPrice: number };
type Fee = { id: string; name: string; amount: number; chargeType: string; required: boolean; active: boolean };
type Product = {
  id: string; code: string; name: string; category: string; description: string | null;
  minimumQuantity: number | null; pricingType: string; shelfLifeDays: number | null;
  productionLeadTimeMinDays: number | null; productionLeadTimeMaxDays: number | null;
  active: boolean; prices: Price[]; fees: Fee[]; colors: string[]; sizes: string[];
  brands: string[]; models: string[]; materials: string[];
};
type InventoryItem = {
  id: string; name: string; productId: string | null; sku: string | null;
  quantity: number; minimumQuantity: number | null;
  color?: string | null; size?: string | null; material?: string | null;
  brand?: string | null; model?: string | null;
};
type SaleItem = { productId: string; quantity: number; unitPrice?: number; additionalAmount?: number; totalPrice?: number; color?: string | null; brand?: string | null; model?: string | null; size?: string | null; material?: string | null };
type Sale = {
  id: string; customerId: string; createdAt: string; paymentStatus: string;
  items: SaleItem[]; observation?: string | null; paymentMethod?: string; deliveryDeadline?: string | null;
  deliveredAt?: string | null; remainingAmount?: number; downPaymentPercentage?: number;
  paidPercentage?: number; remainingPercentage?: number; deadlineStatus?: string;
};
type ProductSale = Sale & { date: string; status: string; quantity: number; total: number };
type Expense = {
  id: string; name: string; status: string; expenseDate: string; category?: string;
  description?: string | null; allocationType?: string; quantity?: number | null; createdAt?: string;
  products?: Array<{ productId: string; allocatedValue: number }>;
};
type ProductExpense = Expense & { date: string; value: number };
type InventoryPage = { content: InventoryItem[]; totalPages: number };
type ExpensePage = { content: Expense[]; totalPages: number };
type SalePage = { sales: Sale[]; pagination?: { totalPages: number } };
type SectionName = 'sales' | 'expenses' | 'inventory';
type IconName = keyof typeof Ionicons.glyphMap;

const C = {
  background: '#f8f6f2', white: '#ffffff', text: '#342d27', gold: '#a98a58',
  muted: '#78716c', soft: '#f8f3eb', border: '#ece6dc', green: '#047857', red: '#b91c1c',
};
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
const display = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? '—' : String(value);
const dateBR = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
};
const pricingLabel: Record<string, string> = { FIXED: 'Preço fixo', TIERED: 'Por quantidade', QUOTE: 'Sob consulta' };
const feeLabel: Record<string, string> = { PER_ORDER: 'Por pedido', PER_UNIT: 'Por unidade', FIRST_PURCHASE: 'Primeira compra' };
const paymentLabel: Record<string, string> = { UNPAID: 'Não paga', PARTIALLY_PAID: 'Parcialmente paga', PAID: 'Paga' };
const expenseLabel: Record<string, string> = { PENDING: 'Pendente', PAID: 'Pago', CANCELLED: 'Cancelado' };
const characteristics = [
  ['colors', 'Cores'], ['sizes', 'Tamanhos'], ['brands', 'Marcas'],
  ['models', 'Modelos'], ['materials', 'Materiais'],
] as const;

function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) return 'Produto não encontrado.';
    if (error.response?.status === 401) return 'Sessão expirada. Faça login novamente.';
    if (error.response?.status === 403) return 'Você não possui permissão para consultar este produto.';
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : `Falha na consulta (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
}

function Label({ children, style }: { children: ReactNode; style?: object }) {
  return <Text allowFontScaling style={[styles.label, style]}>{children}</Text>;
}
function Body({ children, style }: { children: ReactNode; style?: object }) {
  return <Text allowFontScaling style={[styles.body, style]}>{children}</Text>;
}
function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: IconName }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeader}>
      {icon && <Ionicons name={icon} size={19} color={C.gold} />}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>;
}
function Detail({ title, value }: { title: string; value: string | number }) {
  return <View style={styles.detail}>
    <Label>{title}</Label>
    <Body style={styles.detailValue}>{value}</Body>
  </View>;
}
function HeaderButton({ label, icon, onPress, primary = false }: {
  label: string; icon: IconName; onPress: () => void; primary?: boolean;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={[styles.headerButton, primary && styles.primaryButton]}>
    <Ionicons name={icon} size={18} color={primary ? '#fff' : C.gold} />
    <Text style={[styles.headerButtonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}
function Variation({ item }: { item: InventoryItem }) {
  const value = [item.color, item.size, item.material, item.brand, item.model].map(s => s?.trim()).filter(Boolean).join(' · ');
  return <Body style={styles.mutedText}>{value || 'Sem variação'}</Body>;
}

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = typeof id === 'string' ? id : '';
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [relatedOpen, setRelatedOpen] = useState<Record<SectionName, boolean>>({ sales: false, expenses: false, inventory: false });
  const [relatedLoading, setRelatedLoading] = useState<Record<SectionName, boolean>>({ sales: false, expenses: false, inventory: false });
  const [relatedError, setRelatedError] = useState<Partial<Record<SectionName, string>>>({});
  const [sales, setSales] = useState<ProductSale[]>([]);
  const [expenses, setExpenses] = useState<ProductExpense[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [filterSales, setFilterSales] = useState('');
  const [filterExpenses, setFilterExpenses] = useState('');
  const [filterInventory, setFilterInventory] = useState('');
  const [salesFiltersOpen, setSalesFiltersOpen] = useState(false);
  const [expensesFiltersOpen, setExpensesFiltersOpen] = useState(false);
  const [saleFilters, setSaleFilters] = useState<Record<string, string>>({});
  const [expenseFilters, setExpenseFilters] = useState<Record<string, string>>({});
  const changeSaleFilter = (key: string, value: string) => setSaleFilters(current => ({ ...current, [key]: value }));
  const changeExpenseFilter = (key: string, value: string) => setExpenseFilters(current => ({ ...current, [key]: value }));

  const auth = useCallback(async () => {
    const token = await SecureStore.getItemAsync('access_token');
    if (!token) { router.replace('/'); throw new Error('Sessão não encontrada.'); }
    return { Authorization: `Bearer ${token}` };
  }, []);

  const handleFailure = useCallback(async (cause: unknown) => {
    if (axios.isAxiosError(cause) && cause.response?.status === 401) {
      await SecureStore.deleteItemAsync('access_token');
      router.replace('/');
    }
    return errorText(cause);
  }, []);

  useEffect(() => {
    if (!productId) { setLoading(false); setError('ID do produto não informado.'); return; }
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(null);
      try {
        const headers = await auth();
        const { data } = await api.get<Product>(`/products/${encodeURIComponent(productId)}`, { headers, signal: controller.signal });
        if (!controller.signal.aborted) setProduct(data);
      } catch (cause) {
        if (!controller.signal.aborted && !axios.isCancel(cause)) {
          setProduct(null); setError(await handleFailure(cause));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [productId, refreshKey, auth, handleFailure]);

  const loadRelated = useCallback(async (section: SectionName) => {
    if (!productId) return;
    setRelatedLoading(current => ({ ...current, [section]: true }));
    setRelatedError(current => ({ ...current, [section]: undefined }));
    try {
      const headers = await auth();
      const MAX_PAGES = 100;
      if (section === 'inventory') {
        const collected: InventoryItem[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data } = await api.get<InventoryPage>('/inventory', {
            headers, params: { page, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' },
          });
          collected.push(...(data.content ?? []).filter(item => item.productId === productId));
          if (page + 1 >= (data.totalPages ?? 1)) break;
        }
        setInventory(collected);
      } else if (section === 'expenses') {
        const collected: ProductExpense[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data } = await api.get<ExpensePage>('/expenses', { headers, params: { page, size: 100 } });
          for (const item of data.content ?? []) {
            const allocation = item.products?.find(p => p.productId === productId);
            if (allocation) collected.push({ ...item, date: item.expenseDate, value: Number(allocation.allocatedValue) });
          }
          if (page + 1 >= (data.totalPages ?? 1)) break;
        }
        setExpenses(collected.sort((a, b) => b.date.localeCompare(a.date)));
      } else {
        const collected: ProductSale[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data } = await api.get<SalePage>('/sales', {
            headers, params: { page, size: 100, sortBy: 'createdAt', sortDirection: 'DESC' },
          });
          for (const sale of data.sales ?? []) {
            const items = (sale.items ?? []).filter(item => item.productId === productId);
            if (items.length) collected.push({
              ...sale, date: sale.createdAt, status: sale.paymentStatus,
              quantity: items.reduce((sum, item) => sum + item.quantity, 0),
              total: items.reduce((sum, item) => sum + (item.totalPrice ?? item.quantity * (item.unitPrice ?? 0) + (item.additionalAmount ?? 0)), 0),
            });
          }
          if (page + 1 >= (data.pagination?.totalPages ?? 1)) break;
        }
        collected.sort((a, b) => b.date.localeCompare(a.date));
        setSales(collected);
        const unique = [...new Set(collected.map(sale => sale.customerId))];
        const names = await Promise.allSettled(unique.map(async userId => {
          const { data } = await api.get<{ name: string }>('/users/id', { headers, params: { userId } });
          return [userId, data.name] as const;
        }));
        setCustomerNames(Object.fromEntries(names.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])));
      }
    } catch (cause) {
      setRelatedError(current => ({ ...current, [section]: errorText(cause) }));
      await handleFailure(cause);
    } finally {
      setRelatedLoading(current => ({ ...current, [section]: false }));
    }
  }, [auth, handleFailure, productId]);

  const toggleRelated = (section: SectionName) => {
    const opening = !relatedOpen[section];
    setRelatedOpen(current => ({ ...current, [section]: opening }));
    if (opening) void loadRelated(section);
  };
  const reload = () => {
    setRefreshKey(i => i + 1);
    (Object.keys(relatedOpen) as SectionName[]).forEach(key => {
      if (relatedOpen[key]) void loadRelated(key);
    });
  };

  const contains = (value: string | null | undefined, query: string) =>
    (value ?? '').toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'));
  const within = (value: number | null | undefined, min?: string, max?: string) => {
    if (min?.trim() && (value == null || value < Number(min.replace(',', '.')))) return false;
    if (max?.trim() && (value == null || value > Number(max.replace(',', '.')))) return false;
    return true;
  };
  const isDateWithin = (value: string | null | undefined, from?: string, to?: string) => {
    const date = value?.slice(0, 10) ?? '';
    if (from?.trim() && (!date || date < from.trim())) return false;
    if (to?.trim() && (!date || date > to.trim())) return false;
    return true;
  };
  const visibleSales = sales.filter(item => {
    const f = saleFilters;
    if (filterSales.trim() && ![customerNames[item.customerId], item.customerId, paymentLabel[item.status], item.status, item.observation].some(value => contains(value, filterSales))) return false;
    if (f.customer && item.customerId !== f.customer) return false;
    if (f.status && item.status !== f.status) return false;
    if (!isDateWithin(item.date, f.dateFrom, f.dateTo)) return false;
    if (!within(item.total, f.valueFrom, f.valueTo)) return false;
    if (f.search && ![customerNames[item.customerId], item.observation].some(value => contains(value, f.search))) return false;
    if (f.observation && !contains(item.observation, f.observation)) return false;
    if (f.paymentMethod && item.paymentMethod !== f.paymentMethod) return false;
    for (const key of ['color', 'brand', 'model', 'size', 'material'] as const) {
      if (f[key] && !item.items.some(product => contains(product[key], f[key]))) return false;
    }
    if (!within(item.remainingAmount, f.minRemainingAmount, f.maxRemainingAmount)) return false;
    if (!within(item.downPaymentPercentage, f.downPaymentFrom, f.downPaymentTo)) return false;
    if (!within(item.paidPercentage, f.paidFrom, f.paidTo)) return false;
    if (!within(item.remainingPercentage, f.remainingFrom, f.remainingTo)) return false;
    if (!isDateWithin(item.deliveryDeadline, f.deliveryDeadlineFrom, f.deliveryDeadlineTo)) return false;
    if (!isDateWithin(item.date, f.createdAtFrom, f.createdAtTo)) return false;
    if (f.delivered === 'yes' && !item.deliveredAt) return false;
    if (f.delivered === 'no' && item.deliveredAt) return false;
    if (f.deadlineStatus && item.deadlineStatus !== f.deadlineStatus) return false;
    if (f.dueWithinDays?.trim()) {
      if (!item.deliveryDeadline) return false;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const deadline = new Date(`${item.deliveryDeadline.slice(0, 10)}T00:00:00`);
      const days = Math.ceil((deadline.getTime() - start.getTime()) / 86400000);
      if (days < 0 || days > Number(f.dueWithinDays)) return false;
    }
    return true;
  });
  const visibleExpenses = expenses.filter(item => {
    const f = expenseFilters;
    if (filterExpenses.trim() && !contains(item.name, filterExpenses)) return false;
    if (!isDateWithin(item.date, f.dateFrom, f.dateTo)) return false;
    if (!within(item.value, f.valueFrom, f.valueTo)) return false;
    if (f.category && item.category !== f.category) return false;
    if (f.status && item.status !== f.status) return false;
    if (f.description && !contains(item.description, f.description)) return false;
    if (f.allocationType && item.allocationType !== f.allocationType) return false;
    if (f.exactValue?.trim() && item.value !== Number(f.exactValue.replace(',', '.'))) return false;
    if (f.quantity?.trim() && item.quantity !== Number(f.quantity)) return false;
    if (!within(item.quantity, f.minQuantity, f.maxQuantity)) return false;
    if (f.exactDate && item.date.slice(0, 10) !== f.exactDate) return false;
    if (!isDateWithin(item.createdAt, f.createdFrom, f.createdTo)) return false;
    return true;
  });
  const visibleInventory = useMemo(() => inventory.filter(item =>
    [item.name, item.sku, item.color, item.size, item.material, item.brand, item.model].some(value =>
      (value ?? '').toLocaleLowerCase('pt-BR').includes(filterInventory.trim().toLocaleLowerCase('pt-BR')),
    ),
  ), [inventory, filterInventory]);

  const filterInput = (label: string, value: string, onChangeText: (value: string) => void, placeholder = '', numeric = false) => (
    <View style={styles.filterField} key={label}>
      <Text style={styles.filterLabel}>{label}</Text>
      <TextInput style={styles.searchInput} value={value} onChangeText={onChangeText}
        placeholder={placeholder || label} placeholderTextColor="#a8a29e"
        keyboardType={numeric ? 'decimal-pad' : 'default'} />
    </View>
  );
  const filterChoices = (label: string, value: string, options: Array<[string, string]>, onChange: (value: string) => void) => (
    <View style={styles.filterField} key={label}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.filterChips}>
        {options.map(([v, text]) => <Pressable key={v} onPress={() => onChange(v)}
          style={[styles.filterChip, value === v && styles.filterChipSelected]}>
          <Text style={[styles.filterChipText, value === v && styles.filterChipTextSelected]}>{text}</Text>
        </Pressable>)}
      </View>
    </View>
  );
  const salesFilterFields = () => <View style={styles.filtersPanel}>
    <Text style={styles.filterSubtitle}>Filtros principais</Text>
    {filterInput('Cliente', saleFilters.customerSearch ?? '', value => {
      setSaleFilters(current => ({ ...current, customerSearch: value, customer: '' }));
    }, 'Buscar cliente pelo nome')}
    <View style={styles.filterChips}>
      <Pressable style={[styles.filterChip, !saleFilters.customer && styles.filterChipSelected]}
        onPress={() => { setSaleFilters(current => ({ ...current, customer: '', customerSearch: '' })); }}>
        <Text style={styles.filterChipText}>Todos os clientes</Text>
      </Pressable>
      {Object.entries(customerNames).filter(([, name]) => contains(name, saleFilters.customerSearch ?? ''))
        .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([id, name]) => <Pressable
          key={id} style={[styles.filterChip, saleFilters.customer === id && styles.filterChipSelected]}
          onPress={() => { setSaleFilters(current => ({ ...current, customer: id, customerSearch: name })); }}>
          <Text style={styles.filterChipText}>{name}</Text>
        </Pressable>)}
    </View>
    {filterChoices('Status do pagamento', saleFilters.status ?? '',
      [['', 'Todos'], ['UNPAID', 'Não paga'], ['PARTIALLY_PAID', 'Parcialmente paga'], ['PAID', 'Paga']],
      value => changeSaleFilter('status', value))}
    {([['dateFrom', 'Compra a partir de', 'AAAA-MM-DD'], ['dateTo', 'Compra até', 'AAAA-MM-DD'],
      ['valueFrom', 'Valor mínimo (R$)', '0,00'], ['valueTo', 'Valor máximo (R$)', '0,00']] as const)
      .map(([key, label, placeholder]) => filterInput(label, saleFilters[key] ?? '', value => changeSaleFilter(key, value), placeholder, key.startsWith('value')))}
    <Text style={styles.filterSubtitle}>Filtros avançados</Text>
    {([['search', 'Busca geral'], ['observation', 'Observação'], ['color', 'Cor'], ['brand', 'Marca'],
      ['model', 'Modelo'], ['size', 'Tamanho'], ['material', 'Material'],
      ['minRemainingAmount', 'Restante mínimo (R$)'], ['maxRemainingAmount', 'Restante máximo (R$)'],
      ['downPaymentFrom', 'Entrada (%) de'], ['downPaymentTo', 'Entrada (%) até'],
      ['paidFrom', 'Pago (%) de'], ['paidTo', 'Pago (%) até'],
      ['remainingFrom', 'Restante (%) de'], ['remainingTo', 'Restante (%) até'],
      ['deliveryDeadlineFrom', 'Entrega a partir de (AAAA-MM-DD)'], ['deliveryDeadlineTo', 'Entrega até (AAAA-MM-DD)'],
      ['createdAtFrom', 'Cadastro a partir de (AAAA-MM-DD)'], ['createdAtTo', 'Cadastro até (AAAA-MM-DD)'],
      ['dueWithinDays', 'Vence em até (dias)']] as const).map(([key, label]) =>
      filterInput(label, saleFilters[key] ?? '', value => changeSaleFilter(key, value), '',
        /Amount|From$|To$|Days$/.test(key) && !key.includes('created') && !key.includes('Deadline')))}
    {filterChoices('Forma de pagamento', saleFilters.paymentMethod ?? '',
      [['', 'Todas'], ...Array.from(new Set(sales.map(s => s.paymentMethod).filter((v): v is string => !!v))).map(v =>
        [v, ({ CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', PIX: 'Pix', CASH: 'Dinheiro', BANK_TRANSFER: 'Transferência', BOLETO: 'Boleto' } as Record<string,string>)[v] ?? v] as [string,string])],
      value => changeSaleFilter('paymentMethod', value))}
    {filterChoices('Prazo de entrega', saleFilters.deadlineStatus ?? '',
      [['', 'Todos'], ['OVERDUE', 'Atrasada'], ['DUE_TODAY', 'Vence hoje'], ['NO_DEADLINE', 'Sem prazo'], ['ON_TIME', 'No prazo']],
      value => changeSaleFilter('deadlineStatus', value))}
    {filterChoices('Entrega', saleFilters.delivered ?? '', [['', 'Todas'], ['yes', 'Entregues'], ['no', 'Não entregues']],
      value => changeSaleFilter('delivered', value))}
    <Pressable style={styles.clearFilters} onPress={() => { setSaleFilters({}); setFilterSales(''); }}>
      <Ionicons name="close-circle-outline" size={18} color={C.gold}/><Text style={styles.clearText}>Limpar filtros de vendas</Text>
    </Pressable>
  </View>;
  const expensesFilterFields = () => <View style={styles.filtersPanel}>
    <Text style={styles.filterSubtitle}>Filtros principais</Text>
    {([['dateFrom', 'Despesa a partir de', 'AAAA-MM-DD'], ['dateTo', 'Despesa até', 'AAAA-MM-DD'],
      ['valueFrom', 'Valor mínimo (R$)', '0,00'], ['valueTo', 'Valor máximo (R$)', '0,00']] as const)
      .map(([key, label, placeholder]) => filterInput(label, expenseFilters[key] ?? '', value => changeExpenseFilter(key, value), placeholder, key.startsWith('value')))}
    {filterChoices('Status', expenseFilters.status ?? '', [['', 'Todos'], ['PENDING', 'Pendente'], ['PAID', 'Pago'], ['CANCELLED', 'Cancelado']], value => changeExpenseFilter('status', value))}
    <Text style={styles.filterSubtitle}>Filtros avançados</Text>
    {filterChoices('Categoria', expenseFilters.category ?? '',
      [['', 'Todas'], ...Array.from(new Set(expenses.map(e => e.category).filter((v): v is string => !!v))).map(v => [v, v] as [string,string])], value => changeExpenseFilter('category', value))}
    {filterChoices('Tipo de alocação', expenseFilters.allocationType ?? '',
      [['', 'Todos'], ['GENERAL', 'Geral'], ['SPECIFIC_PRODUCT', 'Produto específico'], ['CATEGORY_PRODUCTS', 'Produtos por categoria']], value => changeExpenseFilter('allocationType', value))}
    {([['description', 'Descrição'], ['exactValue', 'Valor exato (R$)'], ['quantity', 'Quantidade exata'],
      ['minQuantity', 'Quantidade mínima'], ['maxQuantity', 'Quantidade máxima'],
      ['exactDate', 'Data exata (AAAA-MM-DD)'], ['createdFrom', 'Cadastrado a partir de (AAAA-MM-DD)'],
      ['createdTo', 'Cadastrado até (AAAA-MM-DD)']] as const)
      .map(([key, label]) => filterInput(label, expenseFilters[key] ?? '', value => changeExpenseFilter(key, value), '',
        ['exactValue', 'quantity', 'minQuantity', 'maxQuantity'].includes(key)))}
    <Pressable style={styles.clearFilters} onPress={() => { setExpenseFilters({}); setFilterExpenses(''); }}>
      <Ionicons name="close-circle-outline" size={18} color={C.gold}/><Text style={styles.clearText}>Limpar filtros de despesas</Text>
    </Pressable>
  </View>;

  const relatedPanel = (section: SectionName, label: string, icon: IconName, count: number) =>
    <View style={styles.related} key={section}>
      <Pressable onPress={() => toggleRelated(section)} style={styles.relatedHeading} accessibilityRole="button">
        <Ionicons name={icon} size={21} color={C.gold} />
        <Text style={styles.relatedTitle}>{label}{relatedOpen[section] && !relatedLoading[section] ? ` (${count})` : ''}</Text>
        <Ionicons name={relatedOpen[section] ? 'chevron-up' : 'chevron-down'} size={20} color={C.gold} />
      </Pressable>
      {relatedOpen[section] && <View style={styles.relatedContent}>
        {relatedLoading[section] ? <ActivityIndicator size="small" color={C.gold} style={styles.loader} /> : null}
        {relatedError[section] ? <Pressable onPress={() => void loadRelated(section)}>
          <Text style={styles.errorText}>{relatedError[section]} Toque para tentar novamente.</Text>
        </Pressable> : null}
        {!relatedLoading[section] && !relatedError[section] && <>
          <TextInput
            value={section === 'sales' ? filterSales : section === 'expenses' ? filterExpenses : filterInventory}
            onChangeText={section === 'sales' ? setFilterSales : section === 'expenses' ? setFilterExpenses : setFilterInventory}
            placeholder={section === 'sales' ? 'Buscar cliente ou status' : section === 'expenses' ? 'Buscar despesa' : 'Buscar item, SKU ou variação'}
            placeholderTextColor="#a8a29e" style={styles.searchInput}
          />
          {(section === 'sales' || section === 'expenses') && <Pressable style={styles.filterToggle}
            onPress={() => section === 'sales' ? setSalesFiltersOpen(v => !v) : setExpensesFiltersOpen(v => !v)}>
            <Ionicons name="options-outline" size={19} color={C.gold}/>
            <Text style={styles.filterToggleText}>Filtros {section === 'sales' ? 'de vendas' : 'de despesas'}</Text>
            <Ionicons name={((section === 'sales' && salesFiltersOpen) || (section === 'expenses' && expensesFiltersOpen)) ? 'chevron-up' : 'chevron-down'} size={18} color={C.gold}/>
          </Pressable>}
          {section === 'sales' && salesFiltersOpen && salesFilterFields()}
          {section === 'expenses' && expensesFiltersOpen && expensesFilterFields()}
          {section === 'sales' && <>
            {visibleSales.map(item => <View key={item.id} style={styles.relatedItem}>
              <Body style={styles.itemTitle}>{customerNames[item.customerId] ?? 'Cliente indisponível'}</Body>
              <Body style={styles.mutedText}>{dateBR(item.date)} · {paymentLabel[item.status] ?? item.status}</Body>
              <View style={styles.twoColumns}>
                <Detail title="Quantidade" value={integer(item.quantity)} />
                <Detail title="Total vendido" value={money(item.total)} />
              </View>
            </View>)}
            <Body style={styles.summary}>Total de {integer(visibleSales.reduce((sum, item) => sum + item.quantity, 0))} unidade(s) · {money(visibleSales.reduce((sum, item) => sum + item.total, 0))}</Body>
          </>}
          {section === 'expenses' && <>
            {visibleExpenses.map(item => <View key={item.id} style={styles.relatedItem}>
              <Body style={styles.itemTitle}>{item.name}</Body>
              <Body style={styles.mutedText}>{dateBR(item.date)} · {expenseLabel[item.status] ?? item.status}</Body>
              <Body style={styles.amount}>{money(item.value)}</Body>
            </View>)}
            <Body style={styles.summary}>Total de despesas: {money(visibleExpenses.reduce((sum, item) => sum + item.value, 0))}</Body>
          </>}
          {section === 'inventory' && visibleInventory.map(item => <View key={item.id} style={styles.relatedItem}>
            <Body style={styles.itemTitle}>{item.name}</Body>
            <Body style={styles.mutedText}>SKU: {display(item.sku)}</Body>
            <Variation item={item} />
            <View style={styles.twoColumns}>
              <Detail title="Disponível" value={integer(item.quantity)} />
              <Detail title="Mínimo" value={display(item.minimumQuantity)} />
            </View>
          </View>)}
          {(section === 'sales' ? visibleSales.length : section === 'expenses' ? visibleExpenses.length : visibleInventory.length) === 0 &&
            <Body style={styles.empty}>Nenhum registro encontrado.</Body>}
        </>}
      </View>}
    </View>;

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.gold} colors={[C.gold]} />}>
      <View style={styles.topActions}>
        <HeaderButton icon="arrow-back-outline" label="Produtos" onPress={() => router.replace('/produtos')} />
        {product && <HeaderButton icon="pencil-outline" label="Editar" primary onPress={() => router.push(`/produtos/${productId}/editar`)} />}
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={C.gold} /><Body>Carregando produto...</Body></View> : null}
      {!loading && error ? <View style={styles.center}>
        <Ionicons name="alert-circle-outline" color={C.red} size={32} />
        <Body style={styles.errorText}>{error}</Body>
        <HeaderButton label="Tentar novamente" icon="refresh-outline" onPress={reload} />
      </View> : null}
      {!loading && product && <>
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.productIcon}><Ionicons name="cube-outline" size={26} color={C.gold} /></View>
            <View style={styles.heroText}>
              <Text style={styles.title}>{product.name}</Text>
              <Text style={styles.subtitle}>Código {product.code} · {product.active ? 'Ativo' : 'Inativo'}</Text>
            </View>
          </View>
          <Section title="Informações gerais" icon="information-circle-outline">
            <View style={styles.twoColumns}>
              <Detail title="Categoria" value={display(product.category)} />
              <Detail title="Precificação" value={pricingLabel[product.pricingType] ?? display(product.pricingType)} />
            </View>
            {product.description?.trim() ? <Detail title="Descrição" value={product.description} /> : null}
          </Section>
          {[
            product.minimumQuantity, product.shelfLifeDays,
            product.productionLeadTimeMinDays, product.productionLeadTimeMaxDays,
          ].some(value => value !== null && value !== undefined && value !== 0) &&
            <Section title="Informações adicionais" icon="time-outline">
              <View style={styles.twoColumns}>
                {product.minimumQuantity != null && product.minimumQuantity !== 0 && <Detail title="Quantidade mínima" value={integer(product.minimumQuantity)} />}
                {product.shelfLifeDays != null && product.shelfLifeDays !== 0 && <Detail title="Validade (dias)" value={integer(product.shelfLifeDays)} />}
                {product.productionLeadTimeMinDays != null && product.productionLeadTimeMinDays !== 0 && <Detail title="Produção mínima (dias)" value={integer(product.productionLeadTimeMinDays)} />}
                {product.productionLeadTimeMaxDays != null && product.productionLeadTimeMaxDays !== 0 && <Detail title="Produção máxima (dias)" value={integer(product.productionLeadTimeMaxDays)} />}
              </View>
            </Section>}
          <Section title={`Faixas de preço (${product.prices?.length ?? 0})`} icon="pricetag-outline">
            {product.prices?.length ? [...product.prices].sort((a, b) => a.minimumQuantity - b.minimumQuantity).map((price, index) =>
              <View key={price.id ?? String(index)} style={styles.priceRow}>
                <View style={styles.priceColumn}><Label>Quantidade mínima</Label><Body style={styles.priceValue}>{integer(price.minimumQuantity)}</Body></View>
                <View style={styles.priceColumn}><Label>Preço unitário</Label><Body style={styles.priceValue}>{money(price.unitPrice)}</Body></View>
              </View>) : <Body style={styles.empty}>Nenhuma faixa de preço cadastrada.</Body>}
          </Section>
          {!!product.fees?.length && <Section title={`Taxas adicionais (${product.fees.length})`} icon="receipt-outline">
            {product.fees.map((fee, index) => <View key={fee.id ?? String(index)} style={styles.feeItem}>
              <Body style={styles.itemTitle}>{fee.name}</Body>
              <Body style={styles.amount}>{money(fee.amount)}</Body>
              <Body style={styles.mutedText}>{feeLabel[fee.chargeType] ?? fee.chargeType} · {fee.required ? 'Obrigatória' : 'Opcional'} · {fee.active ? 'Ativa' : 'Inativa'}</Body>
            </View>)}
          </Section>}
          {characteristics.some(([key]) => (product[key] ?? []).some(v => v.trim())) &&
            <Section title="Características" icon="color-palette-outline">
              {characteristics.map(([key, label]) => {
                const values = (product[key] ?? []).filter(value => value.trim());
                return values.length ? <View key={key} style={styles.characteristicGroup}>
                  <Label>{label}</Label>
                  <View style={styles.tagWrap}>{values.map((value, index) => <View key={`${key}-${index}`} style={styles.tag}><Body style={styles.tagText}>{value}</Body></View>)}</View>
                </View> : null;
              })}
            </Section>}
        </View>
        {relatedPanel('sales', 'Histórico de vendas', 'bag-outline', sales.length)}
        {relatedPanel('expenses', 'Histórico de despesas', 'wallet-outline', expenses.length)}
        {relatedPanel('inventory', 'Estoque vinculado', 'layers-outline', inventory.length)}
        <Text style={styles.footer}>Personalité Creative · Sistema de gestão</Text>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 48 },
  topActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 },
  headerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, paddingVertical: 11, paddingHorizontal: 15, borderRadius: 12, minHeight: 45 },
  headerButtonText: { color: C.gold, fontSize: 14, lineHeight: 22, fontWeight: '700', includeFontPadding: true },
  primaryButton: { borderColor: C.gold, backgroundColor: C.gold },
  primaryText: { color: C.white },
  center: { backgroundColor: C.white, borderRadius: 16, padding: 25, gap: 12, alignItems: 'center', marginTop: 20 },
  errorText: { color: C.red, textAlign: 'center', fontSize: 13, lineHeight: 21, includeFontPadding: true },
  hero: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 16, marginBottom: 16 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 20, marginBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  productIcon: { width: 48, height: 48, backgroundColor: '#f7f0e6', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, minWidth: 0 },
  title: { fontSize: 21, lineHeight: 30, fontWeight: '700', color: C.text, includeFontPadding: true, paddingRight: 4 },
  subtitle: { fontSize: 12, lineHeight: 20, color: C.muted, marginTop: 5, includeFontPadding: true },
  section: { marginBottom: 24, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  sectionTitle: { color: C.text, fontSize: 16, lineHeight: 26, fontWeight: '700', includeFontPadding: true, flexGrow: 1 },
  detail: { flexGrow: 1, flexBasis: '45%', minWidth: 0, borderWidth: 1, borderColor: '#eee8df', backgroundColor: '#fdfcfb', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 12, gap: 6 },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  label: { color: C.muted, fontSize: 12, lineHeight: 21, fontWeight: '600', includeFontPadding: true },
  body: { color: C.text, fontSize: 14, lineHeight: 23, includeFontPadding: true },
  detailValue: { fontWeight: '600' },
  mutedText: { color: C.muted, fontSize: 12, lineHeight: 20 },
  priceRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#eee8df', borderRadius: 11, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 3, gap: 12, backgroundColor: '#fdfcfb' },
  priceColumn: { flex: 1, minWidth: 0, gap: 4 },
  priceValue: { fontSize: 15, lineHeight: 25, fontWeight: '700' },
  feeItem: { borderWidth: 1, borderColor: '#eee8df', backgroundColor: '#fdfcfb', borderRadius: 12, padding: 13, gap: 5 },
  itemTitle: { fontWeight: '700', color: C.text, fontSize: 14, lineHeight: 23 },
  amount: { fontWeight: '700', color: C.text, fontSize: 16, lineHeight: 25 },
  characteristicGroup: { gap: 8, marginBottom: 5 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: C.soft, borderWidth: 1, borderColor: '#e8d9c4', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9 },
  tagText: { color: C.text, fontSize: 13, lineHeight: 22 },
  related: { backgroundColor: C.soft, borderWidth: 1, borderColor: '#e8d9c4', borderRadius: 16, overflow: 'hidden', marginBottom: 14 },
  relatedHeading: { padding: 16, flexDirection: 'row', gap: 11, alignItems: 'center' },
  relatedTitle: { flex: 1, color: C.text, fontSize: 15, lineHeight: 24, fontWeight: '700', includeFontPadding: true },
  relatedContent: { paddingHorizontal: 14, paddingBottom: 15, gap: 10 },
  relatedItem: { backgroundColor: C.white, borderRadius: 11, borderWidth: 1, borderColor: C.border, padding: 12, gap: 5 },
  searchInput: { backgroundColor: C.white, borderColor: C.border, borderWidth: 1, borderRadius: 11, minHeight: 48, paddingHorizontal: 14, color: C.text, fontSize: 14, includeFontPadding: true },
  loader: { marginVertical: 20 },
  empty: { textAlign: 'center', color: C.muted, paddingVertical: 12 },
  summary: { fontWeight: '700', backgroundColor: '#efe4d4', borderRadius: 10, padding: 13 },
  filterToggle: { flexDirection: 'row', gap: 9, alignItems: 'center', borderWidth: 1, borderColor: '#e8d9c4', borderRadius: 11, backgroundColor: C.white, paddingHorizontal: 13, paddingVertical: 12 },
  filterToggleText: { flex: 1, fontSize: 14, lineHeight: 23, color: C.text, fontWeight: '700', includeFontPadding: true },
  filtersPanel: { padding: 13, borderRadius: 12, backgroundColor: C.white, borderWidth: 1, borderColor: '#e8d9c4', gap: 12 },
  filterSubtitle: { fontSize: 14, lineHeight: 23, fontWeight: '700', color: C.text, marginTop: 7, includeFontPadding: true },
  filterField: { gap: 7 },
  filterLabel: { color: C.text, fontSize: 13, lineHeight: 22, fontWeight: '600', includeFontPadding: true },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 9, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 10 },
  filterChipSelected: { backgroundColor: '#f3e8d5', borderColor: C.gold },
  filterChipText: { fontSize: 12, lineHeight: 20, color: C.muted, includeFontPadding: true },
  filterChipTextSelected: { color: '#806036', fontWeight: '700' },
  clearFilters: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, marginTop: 4 },
  clearText: { color: C.gold, fontSize: 13, fontWeight: '700', lineHeight: 21 },
  footer: { marginTop: 16, paddingTop: 22, borderTopWidth: 1, borderTopColor: C.border, textAlign: 'center', color: C.muted, fontSize: 12, lineHeight: 20 },
});
