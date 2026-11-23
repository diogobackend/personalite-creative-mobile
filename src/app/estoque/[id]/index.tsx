import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
    ActivityIndicator, Alert, Image, Modal, Platform, Pressable, RefreshControl,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type Inventory = {
  id: string; name: string; category: string; description: string | null;
  productId: string | null; quantity: number; minimumQuantity: number | null;
  unit: string | null; color: string | null; size: string | null;
  material: string | null; brand: string | null; model: string | null;
  sku: string | null; createdAt: string; updatedAt: string;
};
type Expense = {
  id: string; inventoryId: string | null; name: string; value: number;
  quantity: number | null; status: string; expenseDate: string;
  category?: string; description?: string | null; allocationType?: string;
  createdAt?: string;
};
type ExpensePage = { content: Expense[]; totalPages: number };
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;

const C = { bg: '#f8f6f2', card: '#fff', ink: '#342d27', muted: '#81766b', gold: '#a98a58', border: '#ece6dc', menu: '#39342f', error: '#b91c1c' };
const UNITS: Record<string, string> = {
  UN: 'Unidade (un)', PAR: 'Par', KIT: 'Kit', CX: 'Caixa', PCT: 'Pacote',
  DZ: 'Dúzia', M: 'Metro (m)', CM: 'Centímetro (cm)', M2: 'Metro quadrado (m²)',
  KG: 'Quilograma (kg)', G: 'Grama (g)', L: 'Litro (L)', ML: 'Mililitro (mL)',
  ROLO: 'Rolo', FOLHA: 'Folha',
};
const STATUSES: Option[] = [
  { value: '', label: 'Todos' }, { value: 'PAID', label: 'Pago' },
  { value: 'PENDING', label: 'Pendente' }, { value: 'CANCELLED', label: 'Cancelado' },
];
const ALLOCATIONS: Option[] = [
  { value: '', label: 'Todas' }, { value: 'GENERAL', label: 'Geral' },
  { value: 'SPECIFIC_PRODUCT', label: 'Produto específico' },
  { value: 'CATEGORY_PRODUCTS', label: 'Diversos produtos por categoria' },
];
const NAV: { label: string; icon: IconName; route?: string }[] = [
  { label: 'Visão geral', icon: 'grid-outline', route: '/home' },
  { label: 'Produtos', icon: 'cube-outline', route: '/produtos' },
  { label: 'Categorias', icon: 'pricetags-outline', route: '/categorias' },
  { label: 'Vendas', icon: 'bag-handle-outline', route: '/vendas' },
  { label: 'Histórico Financeiro', icon: 'card-outline', route: '/movimentacoes' },
  { label: 'Clientes', icon: 'people-outline', route: '/clientes' },
  { label: 'Estoque', icon: 'layers-outline', route: '/estoque' },
  { label: 'Despesas', icon: 'wallet-outline' },
  { label: 'Relatórios', icon: 'stats-chart-outline' },
];
const clean = (value?: string | null) => value?.trim() ?? '';
const display = (value?: string | number | null) => value === undefined || value === null || value === '' ? '—' : String(value);
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
function dateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function expenseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : display(value);
}
function getError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não possui permissão para consultar este item.';
    if (error.response.status === 404) return 'Item do estoque não encontrado.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
function SafeText({ children, style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[{ includeFontPadding: true, paddingRight: 4 }, style]}>{children}</Text>;
}
function Field({ label, value, onChange, placeholder, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean;
}) {
  return <View style={s.field}><SafeText style={s.label}>{label}</SafeText>
    <TextInput style={s.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#a8a29e"
      keyboardType={numeric ? 'decimal-pad' : 'default'} autoCapitalize="none" />
  </View>;
}
function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <View style={s.detail}><SafeText style={s.detailLabel}>{label}</SafeText><SafeText style={s.detailValue}>{display(value)}</SafeText></View>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={s.section}><SafeText style={s.sectionTitle}>{title}</SafeText><View style={s.sectionBody}>{children}</View></View>;
}
function Button({ title, icon, onPress, secondary = false, disabled = false }: {
  title: string; icon?: IconName; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable disabled={disabled} accessibilityRole="button" onPress={onPress}
    style={[s.button, secondary ? s.secondary : s.primary, disabled && s.disabled]}>
    {icon && <Ionicons name={icon} size={17} color={secondary ? C.gold : '#fff'} />}
    <SafeText style={[s.buttonText, { color: secondary ? C.ink : '#fff' }]}>{title}</SafeText>
  </Pressable>;
}

export default function VisualizarEstoqueScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [item, setItem] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [advanced, setAdvanced] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const updateAdvanced = (key: string, value: string) => setAdvanced(previous => ({ ...previous, [key]: value }));
  const openPicker = (title: string, value: string, options: Option[], onPick: (next: string) => void) => setPicker({ title, value, options, onPick });
  const select = (label: string, value: string, options: Option[], onPick: (next: string) => void) =>
    <View style={s.field}><SafeText style={s.label}>{label}</SafeText>
      <Pressable onPress={() => openPicker(label, value, options, onPick)} style={s.select}>
        <SafeText style={s.selectValue}>{options.find(option => option.value === value)?.label ?? 'Selecionar'}</SafeText>
        <Ionicons name="chevron-down" size={18} color={C.gold} />
      </Pressable>
    </View>;

  const load = useCallback(async (signal: AbortSignal) => {
    if (!id) { setLoading(false); setLoadingExpenses(false); setError('Identificador do item inválido.'); return; }
    setLoading(true); setError(null); setLoadingExpenses(true); setExpenseError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') { if (!signal.aborted) router.replace('/'); return; }
      const headers = { Authorization: `Bearer ${token}` };
      const result = await Promise.allSettled([
        api.get<Inventory>(`/inventory/${encodeURIComponent(id)}`, { headers, signal }),
        (async () => {
          const first = await api.get<ExpensePage>('/expenses', { params: { page: 0, size: 100 }, headers, signal });
          const pages = first.data.totalPages;
          if (!Number.isInteger(pages) || pages < 0) throw new Error('Paginação de despesas inválida.');
          const all = [...first.data.content];
          for (let page = 1; page < pages; page++) {
            if (signal.aborted) return all;
            const response = await api.get<ExpensePage>('/expenses', { params: { page, size: 100 }, headers, signal });
            all.push(...response.data.content);
          }
          return all.filter(expense => expense.inventoryId === id);
        })(),
      ]);
      if (signal.aborted) return;
      if (result[0].status === 'fulfilled') setItem(result[0].value.data);
      else { setItem(null); setError(getError(result[0].reason, 'Não foi possível consultar o item.')); }
      if (result[1].status === 'fulfilled') setExpenses(result[1].value);
      else { setExpenses([]); setExpenseError(getError(result[1].reason, 'Não foi possível carregar o histórico de compras.')); }
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setError(getError(cause, 'Não foi possível consultar o item.'));
    } finally {
      if (!signal.aborted) { setLoading(false); setLoadingExpenses(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const filtered = useMemo(() => expenses.filter(expense => {
    const contains = (value: string | null | undefined, term: string) => (value ?? '').toLocaleLowerCase('pt-BR').includes(term.trim().toLocaleLowerCase('pt-BR'));
    if (name.trim() && !contains(expense.name, name)) return false;
    const date = expense.expenseDate.slice(0, 10);
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    const numeric = (value: string) => Number(value.replace(',', '.'));
    if (minValue.trim() && expense.value < numeric(minValue)) return false;
    if (maxValue.trim() && expense.value > numeric(maxValue)) return false;
    if (advanced.description?.trim() && !contains(expense.description, advanced.description)) return false;
    if (advanced.category && expense.category !== advanced.category) return false;
    if (advanced.status && expense.status !== advanced.status) return false;
    if (advanced.allocationType && expense.allocationType !== advanced.allocationType) return false;
    if (advanced.exactValue?.trim() && expense.value !== numeric(advanced.exactValue)) return false;
    if (advanced.quantity?.trim() && expense.quantity !== numeric(advanced.quantity)) return false;
    if (advanced.minQuantity?.trim() && (expense.quantity == null || expense.quantity < numeric(advanced.minQuantity))) return false;
    if (advanced.maxQuantity?.trim() && (expense.quantity == null || expense.quantity > numeric(advanced.maxQuantity))) return false;
    if (advanced.exactDate && date !== advanced.exactDate) return false;
    const created = expense.createdAt?.slice(0, 10) ?? '';
    if (advanced.createdFrom && (!created || created < advanced.createdFrom)) return false;
    if (advanced.createdTo && (!created || created > advanced.createdTo)) return false;
    return true;
  }), [expenses, name, dateFrom, dateTo, minValue, maxValue, advanced]);
  const total = filtered.reduce((sum, expense) => sum + Number(expense.value || 0), 0);
  const lowStock = !!item && item.minimumQuantity != null && item.quantity <= item.minimumQuantity;
  const characteristics = item ? [
    ['Cor', item.color], ['Tamanho', item.size], ['Material', item.material], ['Marca', item.brand], ['Modelo', item.model],
  ].filter(([, value]) => clean(value)) : [];
  const categories = [...new Set(expenses.map(expense => expense.category).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const go = (route: string) => router.push(route as never);

  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey(k => k + 1); }} colors={[C.gold]} tintColor={C.gold} />}>
      <View style={s.header}>
        <Pressable onPress={() => setMenuOpen(true)} style={s.headerIcon} accessibilityLabel="Abrir menu"><Ionicons name="menu-outline" size={26} color={C.ink} /></Pressable>
        <SafeText style={s.headerTitle}>Visualizar estoque</SafeText>
        <Pressable onPress={() => setReloadKey(k => k + 1)} style={s.headerIcon} accessibilityLabel="Atualizar"><Ionicons name="refresh-outline" size={21} color={C.gold} /></Pressable>
      </View>
      <View style={s.headerActions}>
        <Button secondary icon="arrow-back" title="Voltar ao estoque" onPress={() => go('/estoque')} />
        {!!item && !loading && <Button icon="pencil-outline" title="Editar item" onPress={() => go(`/estoque/${item.id}/editar`)} />}
      </View>
      {loading ? <View style={s.feedback}><ActivityIndicator color={C.gold} size="large" /><SafeText style={s.muted}>Carregando item...</SafeText></View>
        : error ? <View style={s.feedback}><Ionicons name="cube-outline" size={35} color={C.gold} /><SafeText style={s.error}>{error}</SafeText><Button secondary icon="refresh-outline" title="Tentar novamente" onPress={() => setReloadKey(k => k + 1)} /></View>
        : item ? <>
          <View style={s.itemCard}>
            <SafeText style={s.itemName}>{item.name}</SafeText>
            <SafeText style={s.muted}>Categoria: {display(item.category)}</SafeText>
            <SafeText style={s.muted}>SKU: {display(item.sku)}</SafeText>
            {lowStock && <View style={s.lowBadge}><SafeText style={s.lowText}>Estoque baixo</SafeText></View>}
          </View>
          {!!clean(item.description) && <Section title="Descrição"><SafeText style={s.description}>{item.description}</SafeText></Section>}
          <Section title="Controle de estoque">
            <Detail label="Qtd disponível" value={item.quantity} />
            {item.minimumQuantity != null && <Detail label="Qtd mínima p/ alertar" value={item.minimumQuantity} />}
            {!!clean(item.unit) && <Detail label="Unidade de medida" value={UNITS[item.unit!] ?? item.unit} />}
          </Section>
          {characteristics.length > 0 && <Section title="Detalhes do item">
            {characteristics.map(([label, value]) => <Detail key={label} label={label!} value={value} />)}
          </Section>}
          <Section title="Registro">
            <Detail label="Data de cadastro" value={dateTime(item.createdAt)} />
            <Detail label="Última atualização" value={dateTime(item.updatedAt)} />
          </Section>
          {!loadingExpenses && !expenseError && expenses.length > 0 && <View style={s.expenseSection}>
            <View style={s.expenseHead}>
              <SafeText style={s.expenseTitle}>Histórico de compras ({expenses.length})</SafeText>
              <Button title="Nova despesa" icon="add" onPress={() => go('/despesas/nova')} />
            </View>
            <Field label="Nome" value={name} onChange={setName} placeholder="Buscar pelo nome da despesa" />
            <View style={s.twoCol}>
              <View style={s.column}><Field label="Data da despesa — de" value={dateFrom} onChange={setDateFrom} placeholder="AAAA-MM-DD" /></View>
              <View style={s.column}><Field label="Data da despesa — até" value={dateTo} onChange={setDateTo} placeholder="AAAA-MM-DD" /></View>
            </View>
            <View style={s.twoCol}>
              <View style={s.column}><Field label="Valor mínimo (R$)" value={minValue} onChange={setMinValue} numeric placeholder="0,00" /></View>
              <View style={s.column}><Field label="Valor máximo (R$)" value={maxValue} onChange={setMaxValue} numeric placeholder="Sem limite" /></View>
            </View>
            <Pressable style={s.expand} onPress={() => setAdvancedOpen(v => !v)}>
              <Ionicons name="options-outline" size={18} color={C.gold} /><SafeText style={s.expandText}>Filtros avançados</SafeText>
              <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.gold} />
            </Pressable>
            {advancedOpen && <View style={s.advanced}>
              {select('Categoria', advanced.category ?? '', [{ value: '', label: 'Todas as categorias' }, ...categories.map(value => ({ value, label: value }))], value => updateAdvanced('category', value))}
              <Field label="Descrição" value={advanced.description ?? ''} onChange={value => updateAdvanced('description', value)} placeholder="Buscar pela descrição" />
              {select('Status', advanced.status ?? '', STATUSES, value => updateAdvanced('status', value))}
              {select('Tipo de alocação', advanced.allocationType ?? '', ALLOCATIONS, value => updateAdvanced('allocationType', value))}
              {([
                ['exactValue', 'Valor exato (R$)'], ['quantity', 'Quantidade exata'], ['minQuantity', 'Quantidade mínima'], ['maxQuantity', 'Quantidade máxima'],
              ] as const).map(([key, label]) => <Field key={key} label={label} value={advanced[key] ?? ''} onChange={value => updateAdvanced(key, value)} numeric placeholder="0" />)}
              {([
                ['exactDate', 'Data exata da despesa'], ['createdFrom', 'Cadastro a partir de'], ['createdTo', 'Cadastro até'],
              ] as const).map(([key, label]) => <Field key={key} label={label} value={advanced[key] ?? ''} onChange={value => updateAdvanced(key, value)} placeholder="AAAA-MM-DD" />)}
            </View>}
            <View style={s.purchaseList}>
              {filtered.length ? filtered.map((expense, index) => <View key={expense.id} style={[s.purchaseCard, index % 2 === 1 && s.purchaseAlternate]}>
                <SafeText style={s.purchaseName}>{expense.name}</SafeText>
                <View style={s.purchaseMeta}><Detail label="Valor" value={money(Number(expense.value))} /><Detail label="Qtd" value={expense.quantity} /></View>
                <Detail label="Status" value={{ PAID: 'Pago', PENDING: 'Pendente', CANCELLED: 'Cancelado' }[expense.status] ?? expense.status} />
                <Detail label="Data" value={expenseDate(expense.expenseDate)} />
                <View style={s.purchaseActions}>
                  <Button secondary icon="eye-outline" title="Visualizar" onPress={() => go(`/despesas/${expense.id}`)} />
                  <Button secondary icon="pencil-outline" title="Editar" onPress={() => go(`/despesas/${expense.id}/editar`)} />
                </View>
              </View>) : <SafeText style={s.empty}>Nenhuma despesa encontrada para este item.</SafeText>}
            </View>
            <View style={s.totalRow}><SafeText style={s.totalLabel}>Valor total das compras</SafeText><SafeText style={s.totalAmount}>{money(total)}</SafeText></View>
          </View>}
        </> : null}
      <SafeText style={s.footer}>Personalité Creative · Sistema de gestão</SafeText>
    </ScrollView>
    <Modal transparent animationType="fade" visible={picker !== null} onRequestClose={() => setPicker(null)}>
      <View style={s.modalOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={s.pickerCard}>
          <View style={s.pickerHeader}><SafeText style={s.sectionTitle}>{picker?.title}</SafeText><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={C.ink} /></Pressable></View>
          <ScrollView style={{ maxHeight: 380 }}>{picker?.options.map(option => <Pressable key={option.value} style={s.pickerOption} onPress={() => { picker?.onPick(option.value); setPicker(null); }}>
            <SafeText style={s.selectValue}>{option.label}</SafeText>{picker.value === option.value && <Ionicons name="checkmark" size={18} color={C.gold} />}
          </Pressable>)}</ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={s.drawerOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
        <SafeAreaView style={s.drawer} edges={['top', 'bottom']}>
          <View style={s.drawerBrand}><Image source={require('../../../../assets/images/personalite-logo.png')} resizeMode="contain" style={s.drawerLogo} />
            <View style={s.drawerBrandCopy}><SafeText style={s.drawerEyebrow}>PERSONALITÉ</SafeText><SafeText style={s.drawerTitle}>Creative</SafeText></View>
            <Pressable onPress={() => setMenuOpen(false)}><Ionicons name="close" size={23} color="#fff" /></Pressable>
          </View>
          <ScrollView style={s.drawerScroll} contentContainerStyle={s.drawerContent}>
            <SafeText style={s.drawerSection}>MENU PRINCIPAL</SafeText>
            {NAV.map(nav => <Pressable key={nav.label} onPress={() => { setMenuOpen(false); nav.route ? go(nav.route) : Alert.alert(nav.label, 'Esta seção ainda não foi implementada no aplicativo mobile.'); }} style={[s.drawerItem, nav.route === '/estoque' && s.drawerActive]}>
              <Ionicons name={nav.icon} color={nav.route === '/estoque' ? '#fff' : '#d8d0c6'} size={19} /><SafeText style={s.drawerItemText}>{nav.label}</SafeText>
            </Pressable>)}
            <SafeText style={s.drawerSection}>SISTEMA</SafeText>
            <Pressable style={s.drawerItem} onPress={() => { setMenuOpen(false); Alert.alert('Meu Perfil', 'Esta seção ainda não foi implementada no aplicativo mobile.'); }}><Ionicons name="settings-outline" color="#d8d0c6" size={19} /><SafeText style={s.drawerItemText}>Meu Perfil</SafeText></Pressable>
          </ScrollView>
          <Pressable style={s.drawerLogout} onPress={() => { setMenuOpen(false); void SecureStore.deleteItemAsync('access_token').then(() => router.replace('/')); }}><Ionicons name="log-out-outline" size={19} color="#eee7db" /><SafeText style={s.drawerItemText}>Sair</SafeText></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, scroll: { flex: 1 }, content: { padding: 16, paddingBottom: 35 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5, marginBottom: 15 },
  headerIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 11 },
  headerTitle: { flex: 1, color: C.ink, fontSize: 20, lineHeight: 31, fontWeight: '700' },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 9, marginBottom: 16 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 11, borderRadius: 11, minHeight: 44, gap: 6 },
  primary: { backgroundColor: C.gold }, secondary: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  buttonText: { fontSize: 13, lineHeight: 22, fontWeight: '700' }, disabled: { opacity: 0.45 },
  feedback: { padding: 28, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', gap: 13 },
  error: { color: C.error, fontSize: 13, lineHeight: 21, textAlign: 'center' }, muted: { color: C.muted, fontSize: 13, lineHeight: 22 },
  itemCard: { padding: 18, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, gap: 6, marginBottom: 15 },
  itemName: { fontSize: 24, lineHeight: 35, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: C.ink },
  lowBadge: { alignSelf: 'flex-start', backgroundColor: '#fef2f2', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, marginTop: 6 },
  lowText: { color: C.error, fontSize: 12, fontWeight: '700', lineHeight: 21 },
  section: { padding: 17, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, marginBottom: 15 },
  sectionTitle: { color: C.ink, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  sectionBody: { borderTopWidth: 1, borderTopColor: '#f0ece5', marginTop: 12, paddingTop: 15, gap: 16 },
  description: { color: C.ink, fontSize: 14, lineHeight: 23 },
  detail: { gap: 4, minWidth: 0 }, detailLabel: { color: C.muted, fontSize: 12, lineHeight: 20, fontWeight: '600' },
  detailValue: { color: C.ink, fontSize: 14, lineHeight: 24, fontWeight: '600' },
  expenseSection: { backgroundColor: '#f8f3ea', borderRadius: 16, borderWidth: 1, borderColor: '#e8d7bb', padding: 16, marginBottom: 15 },
  expenseHead: { alignItems: 'flex-start', gap: 12, marginBottom: 18 }, expenseTitle: { fontSize: 17, fontWeight: '700', color: C.ink, lineHeight: 27 },
  field: { marginBottom: 13, minWidth: 0 }, label: { color: C.ink, fontSize: 13, lineHeight: 22, marginBottom: 7, fontWeight: '600' },
  input: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#e8e0d4', borderRadius: 11, backgroundColor: C.card, fontSize: 14, color: C.ink },
  twoCol: { flexDirection: 'row', gap: 10 }, column: { flex: 1, minWidth: 0 },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }, expandText: { color: '#927448', fontSize: 13, lineHeight: 22, fontWeight: '700', flex: 1 },
  advanced: { backgroundColor: '#fffcf8', borderWidth: 1, borderColor: '#e8d7bb', padding: 13, borderRadius: 11, marginBottom: 14 },
  select: { backgroundColor: C.card, minHeight: 48, borderRadius: 11, borderWidth: 1, borderColor: '#e8e0d4', paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectValue: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 23 },
  purchaseList: { gap: 10, marginTop: 12 }, purchaseCard: { padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 12, gap: 10 },
  purchaseAlternate: { backgroundColor: '#f2eee7' }, purchaseName: { color: C.ink, fontSize: 16, lineHeight: 25, fontWeight: '700' },
  purchaseMeta: { flexDirection: 'row', gap: 15 }, purchaseActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9, marginTop: 4 },
  empty: { color: C.muted, fontSize: 13, lineHeight: 22, paddingVertical: 22, textAlign: 'center' },
  totalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f0e5d4', borderWidth: 1, borderColor: '#e8d7bb', padding: 14, borderRadius: 12, marginTop: 16 },
  totalLabel: { color: C.ink, fontSize: 13, lineHeight: 22, fontWeight: '600' }, totalAmount: { color: C.ink, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  footer: { color: C.muted, fontSize: 12, lineHeight: 20, textAlign: 'center', paddingTop: 13 },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 20 },
  pickerCard: { backgroundColor: C.card, padding: 18, borderRadius: 17, maxHeight: '80%' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border },
  drawerOverlay: { flex: 1, backgroundColor: '#0008', flexDirection: 'row' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: C.menu },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  drawerBrandCopy: { flex: 1 }, drawerLogo: { width: 55, height: 67 },
  drawerEyebrow: { fontSize: 10, letterSpacing: 2, color: '#d5bd91', fontWeight: '700', lineHeight: 18 },
  drawerTitle: { color: '#fff', fontFamily: 'serif', fontSize: 21, lineHeight: 30 },
  drawerScroll: { flex: 1 }, drawerContent: { padding: 14, paddingBottom: 28 },
  drawerSection: { color: '#b1a698', fontSize: 10, fontWeight: '700', letterSpacing: 1.6, lineHeight: 20, marginBottom: 14, marginTop: 14 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, minHeight: 48, gap: 12, borderRadius: 10 },
  drawerActive: { backgroundColor: '#665949' }, drawerItemText: { color: '#eee7db', fontSize: 14, lineHeight: 23, fontWeight: '600' },
  drawerLogout: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
