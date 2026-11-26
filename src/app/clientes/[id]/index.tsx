import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';
type IconName = keyof typeof Ionicons.glyphMap;
type Client = { userId: string; name: string; email: string | null; phone: string | null; cpf: string | null; rg: string | null; address: string | null; birthDate: string | null; createdAt: string | null; updatedAt: string | null };
type Sale = { id: string; customerId: string; totalAmount: number; paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'; paymentMethod?: string | null; createdAt: string; observation?: string | null; deliveryDeadline?: string | null; deliveredAt?: string | null; remainingAmount?: number; items?: Array<{ productId: string; quantity: number; color?: string | null; brand?: string | null; model?: string | null; size?: string | null; material?: string | null }> };
type SalesResponse = { sales: Sale[]; pagination?: { totalPages: number } };
type ProductInfo = { id: string; name: string; category?: string | null; categoryId?: string | null };
type Category = { id: string; name: string; type: string };
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;
type Advanced = Record<string, string>;
const C = { bg: '#f8f6f2', card: '#fff', ink: '#342d27', muted: '#766d63', gold: '#a98a58', border: '#e8e0d4', menu: '#39342f' };
const EMAIL_GENERATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@gmail\.com$/i;
const PAYMENT_LABELS: Record<string, string> = { UNPAID: 'Não paga', PARTIALLY_PAID: 'Parcialmente paga', PAID: 'Paga' };
const METHODS: Record<string, string> = { DEBIT_CARD: 'Cartão de débito', CREDIT_CARD: 'Cartão de crédito', PIX: 'Pix', CASH: 'Dinheiro', BANK_TRANSFER: 'Transferência bancária', BOLETO: 'Boleto', BANK_SLIP: 'Boleto' };
const ADVANCED_TEXT: Array<[string, string]> = [['general', 'Busca geral'], ['observation', 'Observação'], ['color', 'Cor'], ['brand', 'Marca'], ['model', 'Modelo'], ['size', 'Tamanho'], ['material', 'Material'], ['productCode', 'Código do produto']];
const ADVANCED_DATE: Array<[string, string]> = [['deliveryFrom', 'Entrega de'], ['deliveryTo', 'Entrega até'], ['createdFrom', 'Cadastro de'], ['createdTo', 'Cadastro até']];
const NAV: { label: string; icon: IconName; route?: string }[] = [
  { label: 'Visão geral', icon: 'grid-outline', route: '/home' },
  { label: 'Produtos', icon: 'cube-outline', route: '/produtos' },
  { label: 'Categorias', icon: 'pricetags-outline', route: '/categorias' },
  { label: 'Vendas', icon: 'bag-handle-outline', route: '/vendas' },
  { label: 'Histórico Financeiro', icon: 'card-outline', route: '/movimentacoes' },
  { label: 'Clientes', icon: 'people-outline', route: '/clientes' },
  { label: 'Estoque', icon: 'layers-outline' },
  { label: 'Despesas', icon: 'wallet-outline' },
  { label: 'Relatórios', icon: 'stats-chart-outline' },
];
function SafeText({ children, style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[{ includeFontPadding: true, paddingRight: 4 }, style]}>{children}</Text>;
}
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const date = (value?: string | null) => { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? ''); return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'; };
const clean = (value?: string | null) => value?.trim() ?? '';
const matches = (value: string | null | undefined, term: string) => (value ?? '').toLocaleLowerCase('pt-BR').includes(term.trim().toLocaleLowerCase('pt-BR'));
const number = (value: string) => Number(value.replace(',', '.'));
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const maskDate = (value: string) => { const digits = value.replace(/\D/g, '').slice(0, 8); return digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`; };
const toIsoDate = (value: string) => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return '';
  const [day, month, year] = value.split('/').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const toBrazilian = (value: Date) => `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
const afterDate = (dateValue: string, filter: string) => !filter || Boolean(toIsoDate(filter)) && dateValue >= toIsoDate(filter);
const beforeDate = (dateValue: string, filter: string) => !filter || Boolean(toIsoDate(filter)) && dateValue <= toIsoDate(filter);
function Field({ label, value, onChange, placeholder, numeric = false }: { label: string; value: string; onChange: (next: string) => void; placeholder?: string; numeric?: boolean }) {
  return <View style={s.field}><SafeText style={s.label}>{label}</SafeText><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#a8a29e" keyboardType={numeric ? 'decimal-pad' : 'default'} style={s.input} autoCapitalize="none" /></View>;
}
function DateField({ label, value, onChange, onCalendar }: { label: string; value: string; onChange: (value: string) => void; onCalendar: () => void }) {
  return <View style={s.field}><SafeText style={s.label}>{label}</SafeText><View style={s.dateRow}><TextInput value={value} onChangeText={text => onChange(maskDate(text))} placeholder="DD/MM/AAAA" placeholderTextColor="#a8a29e" maxLength={10} keyboardType="number-pad" style={[s.input, s.dateInput]} /><Pressable accessibilityLabel={`Selecionar ${label} no calendário`} style={s.calendarButton} onPress={onCalendar}><Ionicons name="calendar-outline" size={23} color={C.gold} /></Pressable></View></View>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <View style={s.info}><SafeText style={s.infoLabel}>{label}</SafeText><SafeText style={s.infoValue}>{value}</SafeText></View>;
}
function Button({ label, icon, onPress, secondary = false }: { label: string; icon?: IconName; onPress: () => void; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[s.button, secondary ? s.secondary : s.primary]}>{icon && <Ionicons name={icon} size={18} color={secondary ? C.gold : '#fff'} />}<Text allowFontScaling={false} numberOfLines={1} style={[s.buttonLabel, { width: Math.ceil(label.length * 9.5) + 12, color: secondary ? C.ink : '#fff', textAlign: 'center' }]}>{label}</Text></Pressable>;
}
export default function ClienteDetalhesScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [productsById, setProductsById] = useState<Record<string, ProductInfo>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [valueFrom, setValueFrom] = useState('');
  const [valueTo, setValueTo] = useState('');
  const [status, setStatus] = useState('');
  const [advanced, setAdvanced] = useState<Advanced>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [calendarField, setCalendarField] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const getCalendarValue = (field: string) => field === 'dateFrom' ? dateFrom : field === 'dateTo' ? dateTo : advanced[field] ?? '';
  const openCalendar = (field: string) => {
    const iso = toIsoDate(getCalendarValue(field));
    const selected = iso ? new Date(`${iso}T12:00:00`) : new Date();
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarField(field);
  };
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const offset = new Date(year, month, 1).getDay();
    return [...Array.from({ length: offset }, () => null), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => index + 1)];
  }, [calendarMonth]);
  const selectCalendarDay = (selected: Date) => {
    const value = toBrazilian(selected);
    if (calendarField === 'dateFrom') setDateFrom(value);
    else if (calendarField === 'dateTo') setDateTo(value);
    else if (calendarField) setAdv(calendarField, value);
    setCalendarField(null);
  };
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const setAdv = (key: string, value: string) => setAdvanced(previous => ({ ...previous, [key]: value }));
  const openPicker = (title: string, value: string, options: Option[], onPick: (next: string) => void) => setPicker({ title, value, options, onPick });
  const select = (label: string, value: string, options: Option[], onPick: (next: string) => void) => <View style={s.field}><SafeText style={s.label}>{label}</SafeText><Pressable style={s.select} onPress={() => openPicker(label, value, options, onPick)}><SafeText style={s.selectText}>{options.find(option => option.value === value)?.label ?? 'Selecione'}</SafeText><Ionicons name="chevron-down-outline" color={C.gold} size={18} /></Pressable></View>;
  const load = useCallback(async (signal: AbortSignal) => {
    if (!id) { setError('Cliente não encontrado.'); setLoading(false); setSalesLoading(false); return; }
    setLoading(true); setSalesLoading(true); setError(null); setSalesError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') { router.replace('/'); return; }
      const headers = { Authorization: `Bearer ${token}` };
      const clientPromise = api.get<Client>('/users/id', { params: { userId: id }, headers, signal });
      const categoriesPromise = api.get<Category[]>('/categories', { headers, signal }).catch(() => null);
      const salesPromise = (async () => {
        const result: Sale[] = [];
        let page = 0; let totalPages = 1;
        do {
          const response = await api.get<SalesResponse>('/sales', { params: { page, size: 100, sortBy: 'createdAt', sortDirection: 'DESC' }, headers, signal });
          result.push(...(response.data.sales ?? []).filter(sale => sale.customerId === id));
          totalPages = response.data.pagination?.totalPages ?? 1;
          page++;
        } while (page < totalPages && !signal.aborted);
        return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      })();
      // A ficha do cliente não depende do histórico de vendas para aparecer.
      try {
        const response = await clientPromise;
        if (!signal.aborted) setClient(response.data);
      } catch (cause) {
        if (!signal.aborted) {
          setClient(null);
          setError(axios.isAxiosError(cause) && cause.response?.status === 404 ? 'Cliente não encontrado.' : axios.isAxiosError(cause) && cause.response?.status === 403 ? 'Você não possui permissão para visualizar este cliente.' : 'Não foi possível carregar o cliente.');
        }
      } finally { if (!signal.aborted) setLoading(false); }
      const categoryResult = await categoriesPromise;
      if (!signal.aborted) {
        setCategories(Array.isArray(categoryResult?.data) ? categoryResult.data.filter(item => item.type === 'PRODUCT') : []);
      }
      try {
        const purchased = await salesPromise;
        if (signal.aborted) return;
        setSales(purchased);
        const ids = [...new Set(purchased.flatMap(sale => (sale.items ?? []).map(item => item.productId)))];
        const resolved = await Promise.allSettled(ids.map(async productId => {
          const { data } = await api.get<ProductInfo>(`/products/${encodeURIComponent(productId)}`, { headers, signal });
          const product = (data as ProductInfo & { product?: ProductInfo }).product ?? data;
          return [productId, product] as const;
        }));
        if (!signal.aborted) setProductsById(Object.fromEntries(resolved.filter((item): item is PromiseFulfilledResult<readonly [string, ProductInfo]> => item.status === 'fulfilled').map(item => item.value)));
      } catch (cause) {
        if (!signal.aborted) setSalesError(axios.isAxiosError(cause) ? `Não foi possível carregar as compras${cause.response ? ` (HTTP ${cause.response.status})` : ''}.` : 'Não foi possível carregar as compras.');
      } finally { if (!signal.aborted) setSalesLoading(false); }
    } catch (cause) {
      if (!signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o cliente.');
        setLoading(false); setSalesLoading(false);
      }
    } finally { if (!signal.aborted) setRefreshing(false); }
  }, [id]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, reload]);
  const purchasedProducts = useMemo(() => Object.values(productsById).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [productsById]);
  const filteredSales = useMemo(() => sales.filter(sale => {
    const items = sale.items ?? [];
    if (selectedProductId && !items.some(item => item.productId === selectedProductId)) return false;
    const created = sale.createdAt.slice(0, 10);
    if (!afterDate(created, dateFrom) || !beforeDate(created, dateTo)) return false;
    if (valueFrom && sale.totalAmount < number(valueFrom) || valueTo && sale.totalAmount > number(valueTo)) return false;
    if (status && sale.paymentStatus !== status) return false;
    if (advanced.general && !matches(`${sale.observation ?? ''} ${sale.id}`, advanced.general)) return false;
    if (advanced.observation && !matches(sale.observation, advanced.observation)) return false;
    if (advanced.paymentMethod && sale.paymentMethod !== advanced.paymentMethod) return false;
    if (advanced.category && !items.some(item => {
      const product = productsById[item.productId];
      return product?.categoryId === advanced.category || categories.some(category => category.id === advanced.category && category.name === product?.category);
    })) return false;
    if (advanced.productCode && !items.some(item => matches(item.productId, advanced.productCode))) return false;
    for (const field of ['color', 'brand', 'model', 'size', 'material'] as const) {
      if (advanced[field] && !items.some(item => matches(item[field], advanced[field]))) return false;
    }
    if (advanced.remainingMin && (sale.remainingAmount ?? 0) < number(advanced.remainingMin)) return false;
    if (advanced.remainingMax && (sale.remainingAmount ?? 0) > number(advanced.remainingMax)) return false;
    if (advanced.deliveryFrom && (!sale.deliveryDeadline || !afterDate(sale.deliveryDeadline.slice(0, 10), advanced.deliveryFrom))) return false;
    if (advanced.deliveryTo && (!sale.deliveryDeadline || !beforeDate(sale.deliveryDeadline.slice(0, 10), advanced.deliveryTo))) return false;
    if (!afterDate(created, advanced.createdFrom ?? '') || !beforeDate(created, advanced.createdTo ?? '')) return false;
    if (advanced.delivered === 'yes' && !sale.deliveredAt || advanced.delivered === 'no' && sale.deliveredAt) return false;
    return true;
  }), [sales, selectedProductId, dateFrom, dateTo, valueFrom, valueTo, status, advanced, productsById, categories]);
  const totalSales = filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const totalUnits = filteredSales.reduce((sum, sale) => sum + (sale.items ?? []).reduce((count, item) => count + item.quantity, 0), 0);
  const menuNav = (label: string, route?: string) => { setMenuOpen(false); if (route) router.push(route as never); else Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.'); };
  const email = client?.email && !EMAIL_GENERATED.test(client.email) ? clean(client.email) : '';
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <View style={s.topbar}><Pressable style={s.iconButton} onPress={() => setMenuOpen(true)}><Ionicons name="menu-outline" size={26} color={C.ink} /></Pressable><SafeText style={s.topbarTitle}>Cliente</SafeText><Pressable style={s.iconButton} onPress={() => setReload(n => n + 1)}><Ionicons name="refresh-outline" size={21} color={C.gold} /></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReload(n => n + 1); }} colors={[C.gold]} tintColor={C.gold} />}>
      <View style={s.actions}><Button label="Voltar" icon="arrow-back-outline" secondary onPress={() => router.push('/clientes' as never)} />{client && <Button label="Editar cliente" icon="pencil-outline" onPress={() => router.push(`/clientes/${encodeURIComponent(id ?? '')}/editar` as never)} />}</View>
      {loading ? <View style={s.feedback}><ActivityIndicator color={C.gold} size="large" /></View> : error ? <View style={s.feedback}><SafeText style={s.error}>{error}</SafeText></View> : client ? <>
        <View style={s.panel}>
          <View style={s.clientTitleRow}><View style={s.avatar}><Ionicons name="person-outline" size={25} color={C.gold} /></View><SafeText style={s.clientTitle}>{client.name}</SafeText></View>
          {(!!clean(client.cpf) || !!clean(client.rg) || !!clean(client.birthDate)) && <><SafeText style={s.sectionTitle}>Dados pessoais</SafeText>
          {!!clean(client.cpf) && <Info label="CPF" value={client.cpf!} />}
          {!!clean(client.rg) && <Info label="RG" value={client.rg!} />}
          {!!clean(client.birthDate) && <Info label="Data de nascimento" value={date(client.birthDate)} />}</>}
          {!!email || !!clean(client.phone) ? <><SafeText style={s.sectionTitle}>Contato</SafeText>{!!email && <Info label="E-mail" value={email} />}{!!clean(client.phone) && <Info label="Telefone" value={client.phone!} />}</> : null}
          {!!clean(client.address) && <><SafeText style={s.sectionTitle}>Endereço</SafeText><Info label="Endereço cadastrado" value={client.address!} /></>}
          <SafeText style={s.sectionTitle}>Informações do cadastro</SafeText>
          <Info label="Data de cadastro" value={date(client.createdAt)} /><Info label="Última atualização" value={date(client.updatedAt)} />
        </View>
        {(salesLoading || !!salesError || sales.length > 0) && <View style={s.purchases}>
          <SafeText style={s.sectionTitle}>Histórico de compras ({filteredSales.length})</SafeText>
          <View style={s.actions}><Button label="Nova venda" icon="add-outline" onPress={() => router.push('/vendas/nova' as never)} /></View>
          {select('Produto comprado', selectedProductId, [{ value: '', label: 'Todos os produtos' }, ...purchasedProducts.filter(p => matches(p.name, productSearch)).map(product => ({ value: product.id, label: product.name }))], value => { setSelectedProductId(value); setProductSearch(''); })}
          <Field label="Pesquisar produto comprado" placeholder="Nome do produto" value={productSearch} onChange={setProductSearch} />
          {select('Status de pagamento', status, [{ value: '', label: 'Todos' }, ...Object.entries(PAYMENT_LABELS).map(([value, label]) => ({ value, label }))], setStatus)}
          <DateField label="Data da compra — de" value={dateFrom} onChange={setDateFrom} onCalendar={() => openCalendar('dateFrom')} />
          <DateField label="Data da compra — até" value={dateTo} onChange={setDateTo} onCalendar={() => openCalendar('dateTo')} />
          <View style={s.twoCol}><View style={s.column}><Field label="Valor da compra — de (R$)" value={valueFrom} onChange={setValueFrom} placeholder="0,00" numeric /></View><View style={s.column}><Field label="Valor da compra — até (R$)" value={valueTo} onChange={setValueTo} placeholder="Sem limite" numeric /></View></View>
          <Button label={showAdvanced ? 'Ocultar filtros avançados' : 'Filtros avançados'} secondary icon="options-outline" onPress={() => setShowAdvanced(value => !value)} />
          {showAdvanced && <View style={s.advanced}>
            {ADVANCED_TEXT.map(([key, label]) => <Field key={key} label={label} value={advanced[key] ?? ''} onChange={value => setAdv(key, value)} />)}
            {select('Categoria do produto', advanced.category ?? '', [{ value: '', label: 'Todas as categorias' }, ...categories.map(item => ({ value: item.id, label: item.name }))], value => setAdv('category', value))}
            {select('Forma de pagamento', advanced.paymentMethod ?? '', [{ value: '', label: 'Todas' }, ...[...new Set(sales.map(sale => sale.paymentMethod).filter((method): method is string => Boolean(method)))].map(method => ({ value: method, label: METHODS[method] ?? method }))], value => setAdv('paymentMethod', value))}
            <Field label="Restante mínimo (R$)" value={advanced.remainingMin ?? ''} onChange={value => setAdv('remainingMin', value)} numeric />
            <Field label="Restante máximo (R$)" value={advanced.remainingMax ?? ''} onChange={value => setAdv('remainingMax', value)} numeric />
            {ADVANCED_DATE.map(([key, label]) => <DateField key={key} label={`${label} (DD/MM/AAAA)`} value={advanced[key] ?? ''} onChange={value => setAdv(key, value)} onCalendar={() => openCalendar(key)} />)}
            {select('Entrega', advanced.delivered ?? '', [{ value: '', label: 'Todas' }, { value: 'yes', label: 'Entregues' }, { value: 'no', label: 'Não entregues' }], value => setAdv('delivered', value))}
          </View>}
          {salesLoading ? <View style={s.feedback}><ActivityIndicator color={C.gold} /><SafeText style={s.muted}>Carregando compras...</SafeText></View> : salesError ? <SafeText style={s.error}>{salesError}</SafeText> : filteredSales.length === 0 ? <SafeText style={s.empty}>Nenhuma compra encontrada.</SafeText> : filteredSales.map((sale, index) => {
            const items = sale.items ?? [];
            const name = items.length ? (productsById[items[0].productId]?.name ?? 'Produto indisponível') + (items.length > 1 ? ` +${items.length - 1}` : '') : '—';
            const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
            return <View key={sale.id} style={[s.sale, index % 2 === 1 && s.saleAlternate]}>
              <SafeText style={s.saleName}>{name}</SafeText>
              <Info label="Quantidade de unidades" value={String(quantity)} />
              <Info label="Valor da venda" value={money(sale.totalAmount)} />
              <Info label="Pagamento" value={PAYMENT_LABELS[sale.paymentStatus] ?? sale.paymentStatus} />
              <Info label="Data da venda" value={date(sale.createdAt)} />
              <View style={s.actions}><Button label="Visualizar" secondary icon="eye-outline" onPress={() => router.push(`/vendas/${sale.id}` as never)} /><Button label="Editar" secondary icon="pencil-outline" onPress={() => router.push(`/vendas/${sale.id}/atualizar` as never)} /></View>
            </View>;
          })}
          <View style={s.total}><SafeText style={s.totalLabel}>{totalUnits} unidade(s) · Total das compras deste cliente</SafeText><SafeText style={s.totalValue}>{money(totalSales)}</SafeText></View>
        </View>}
      </> : null}
    </ScrollView>
    <Modal visible={calendarField !== null} transparent animationType="fade" onRequestClose={() => setCalendarField(null)}>
      <View style={s.calendarBackdrop}><View style={s.calendarPanel}>
        <View style={s.calendarHeader}>
          <Pressable onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={s.calendarNav} accessibilityLabel="Mês anterior"><Ionicons name="chevron-back" size={23} color={C.gold} /></Pressable>
          <SafeText allowFontScaling={false} numberOfLines={1} style={s.calendarHeading}>{MONTH_NAMES[calendarMonth.getMonth()]} de {calendarMonth.getFullYear()}</SafeText>
          <Pressable onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={s.calendarNav} accessibilityLabel="Próximo mês"><Ionicons name="chevron-forward" size={23} color={C.gold} /></Pressable>
        </View>
        <View style={s.calendarGrid}>
          {WEEKDAYS.map((weekday, index) => <View key={`weekday-${index}`} style={s.calendarCell}><SafeText style={s.calendarWeekday}>{weekday}</SafeText></View>)}
          {calendarDays.map((day, index) => {
            const candidate = day ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day) : null;
            const selected = candidate && calendarField ? toBrazilian(candidate) === getCalendarValue(calendarField) : false;
            return <View key={`day-${index}`} style={s.calendarCell}>{candidate && <Pressable onPress={() => selectCalendarDay(candidate)} style={[s.calendarDay, selected && s.calendarDaySelected]} accessibilityLabel={`Selecionar ${toBrazilian(candidate)}`}><SafeText allowFontScaling={false} numberOfLines={1} style={[s.calendarDayText, selected && s.calendarDayTextSelected]}>{day}</SafeText></Pressable>}</View>;
          })}
        </View>
        <Pressable style={s.calendarClose} onPress={() => setCalendarField(null)}><SafeText allowFontScaling={false} numberOfLines={1} style={s.calendarCloseText}>Fechar</SafeText></Pressable>
      </View></View>
    </Modal>
    <Modal transparent animationType="fade" visible={picker !== null} onRequestClose={() => setPicker(null)}><View style={s.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} /><View style={s.pickerCard}><View style={s.pickerHeader}><SafeText style={s.pickerTitle}>{picker?.title}</SafeText><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={C.ink} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>{picker?.options.map(option => <Pressable key={option.value} style={s.pickerOption} onPress={() => { picker.onPick(option.value); setPicker(null); }}><SafeText style={s.pickerText}>{option.label}</SafeText>{picker?.value === option.value && <Ionicons name="checkmark" color={C.gold} size={18} />}</Pressable>)}</ScrollView></View></View></Modal>
    <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent><View style={s.drawerOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} /><SafeAreaView style={s.drawer} edges={['top', 'bottom']}><View style={s.drawerBrand}><Image source={require('../../../../assets/images/personalite-logo.png')} style={s.logo} resizeMode="contain" /><View style={{ flex: 1 }}><SafeText style={s.brandEyebrow}>PERSONALITÉ</SafeText><SafeText style={s.brandTitle}>Creative</SafeText></View><Pressable onPress={() => setMenuOpen(false)}><Ionicons name="close" size={24} color="#fff" /></Pressable></View><ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 13, paddingTop: 25 }}><SafeText style={s.drawerSection}>MENU PRINCIPAL</SafeText>{NAV.map(item => <Pressable key={item.label} style={[s.drawerItem, item.route === '/clientes' && s.drawerActive]} onPress={() => menuNav(item.label, item.route)}><Ionicons name={item.icon} size={19} color="#eee7db" /><SafeText style={s.drawerText}>{item.label}</SafeText></Pressable>)}</ScrollView><Pressable style={s.drawerLogout} onPress={async () => { await SecureStore.deleteItemAsync('access_token'); setMenuOpen(false); router.replace('/'); }}><Ionicons name="log-out-outline" size={20} color="#eee7db" /><SafeText style={s.drawerText}>Sair</SafeText></Pressable></SafeAreaView></View></Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, topbar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', paddingHorizontal: 15, minHeight: 62, borderBottomWidth: 1, borderBottomColor: C.border }, iconButton: { width: 40, height: 44, justifyContent: 'center', alignItems: 'center' }, topbarTitle: { flex: 1, fontSize: 21, fontWeight: '700', lineHeight: 32, color: C.ink }, content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 44 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 13 }, button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-start', gap: 5, minHeight: 44, paddingHorizontal: 9, paddingVertical: 10, borderRadius: 11 }, primary: { backgroundColor: C.gold }, secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border }, buttonLabel: { fontSize: 12.5, lineHeight: 22, fontWeight: '700', includeFontPadding: false, flexShrink: 0 },
  panel: { backgroundColor: C.card, padding: 17, borderWidth: 1, borderColor: C.border, borderRadius: 17, marginBottom: 18 }, clientTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 17, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 15 }, avatar: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: '#f7f0e6' }, clientTitle: { flex: 1, fontSize: 20, lineHeight: 31, fontWeight: '700', color: C.ink }, sectionTitle: { fontSize: 17, lineHeight: 29, fontWeight: '700', color: C.ink, marginTop: 14, marginBottom: 12 }, info: { borderWidth: 1, borderColor: '#eee8df', backgroundColor: '#fdfcfb', padding: 13, borderRadius: 12, marginBottom: 9, gap: 5 }, infoLabel: { color: C.muted, fontSize: 12, lineHeight: 20, fontWeight: '600' }, infoValue: { color: C.ink, fontSize: 14, lineHeight: 24, fontWeight: '600' }, muted: { color: C.muted, fontSize: 13, lineHeight: 22 },
  purchases: { backgroundColor: '#f8f3eb', borderRadius: 16, borderWidth: 1, borderColor: '#e8d9c4', padding: 15, marginBottom: 20 }, field: { marginBottom: 14 }, label: { fontSize: 13, lineHeight: 23, color: C.ink, fontWeight: '600', marginBottom: 6 }, input: { borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, minHeight: 47, backgroundColor: '#fff', fontSize: 14, color: C.ink, includeFontPadding: true }, select: { borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, minHeight: 47, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', gap: 10 }, selectText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 24 }, twoCol: { flexDirection: 'row', gap: 10 }, column: { flex: 1, minWidth: 0 }, advanced: { backgroundColor: '#fffcf7', borderWidth: 1, borderColor: '#e8d9c4', padding: 12, borderRadius: 12, marginTop: 13, marginBottom: 15 },
  sale: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', marginTop: 12 }, saleAlternate: { backgroundColor: '#eee8df' }, saleName: { color: C.ink, fontSize: 16, lineHeight: 27, fontWeight: '700', marginBottom: 13 }, total: { padding: 16, borderRadius: 12, backgroundColor: '#efe4d4', marginTop: 16, gap: 8 }, totalLabel: { fontSize: 13, lineHeight: 23, color: C.muted, fontWeight: '600' }, totalValue: { fontSize: 22, lineHeight: 33, color: C.ink, fontWeight: '700' }, empty: { paddingVertical: 20, fontSize: 13, lineHeight: 22, textAlign: 'center', color: C.muted }, error: { color: '#b91c1c', fontSize: 13, lineHeight: 22, textAlign: 'center' }, feedback: { justifyContent: 'center', alignItems: 'center', minHeight: 110, gap: 9 },
  overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0008' }, pickerCard: { backgroundColor: '#fff', borderRadius: 17, padding: 17, maxHeight: '80%' }, pickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }, pickerTitle: { flex: 1, fontSize: 18, lineHeight: 29, fontWeight: '700', color: C.ink }, pickerOption: { minHeight: 48, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 }, pickerText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 23 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dateInput: { flex: 1, minWidth: 0 },
  calendarButton: { width: 52, height: 47, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  calendarBackdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 20 },
  calendarPanel: { width: '100%', maxWidth: 380, backgroundColor: C.card, borderRadius: 17, padding: 15 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15, gap: 4 },
  calendarNav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  calendarHeading: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 14, lineHeight: 24, fontWeight: '700', color: C.ink, textTransform: 'capitalize' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: '14.285714%', height: 43, justifyContent: 'center', alignItems: 'center' },
  calendarWeekday: { color: C.muted, fontSize: 12, fontWeight: '700' },
  calendarDay: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  calendarDaySelected: { backgroundColor: C.gold },
  calendarDayText: { width: 33, fontSize: 13, lineHeight: 21, color: C.ink, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  calendarDayTextSelected: { color: C.card },
  calendarClose: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 12, marginTop: 12 },
  calendarCloseText: { width: 74, textAlign: 'center', color: C.gold, fontSize: 14, lineHeight: 22, fontWeight: '700' },
  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: '#0008' }, drawer: { width: '82%', maxWidth: 310, backgroundColor: C.menu, height: '100%' }, drawerBrand: { minHeight: 105, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 11, borderBottomWidth: 1, borderBottomColor: '#ffffff22' }, logo: { height: 65, width: 56 }, brandEyebrow: { color: '#d5bd91', fontSize: 10, lineHeight: 18, letterSpacing: 2 }, brandTitle: { color: '#fff', fontSize: 22, lineHeight: 32, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' }, drawerSection: { color: '#b1a698', fontSize: 11, lineHeight: 19, marginBottom: 15, letterSpacing: 1.5 }, drawerItem: { minHeight: 48, paddingHorizontal: 14, borderRadius: 11, marginBottom: 4, alignItems: 'center', flexDirection: 'row', gap: 12 }, drawerActive: { backgroundColor: '#665949' }, drawerText: { flex: 1, color: '#eee7db', fontSize: 14, lineHeight: 23 }, drawerLogout: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
