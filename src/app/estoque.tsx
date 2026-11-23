import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal,
  Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type Inventory = {
  id: string; name: string; category: string; description: string | null;
  productId: string | null; quantity: number; minimumQuantity: number | null;
  unit: string | null; color: string | null; size: string | null;
  material: string | null; brand: string | null; model: string | null;
  sku: string | null; createdAt: string; updatedAt: string;
};
type InventoryPage = {
  content: Inventory[]; page: number; size: number;
  totalElements: number; totalElementsThisPage: number; totalPages: number;
};
type InventoryCategory = { id: string; name: string; type: string };
type Filters = {
  sku: string; name: string; category: string; description: string;
  quantity: string; minQuantity: string; maxQuantity: string; unit: string;
  color: string; size: string; material: string; brand: string; model: string;
  createdAt: string; createdFrom: string; createdTo: string;
};
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;

const C = {
  background: '#f8f6f2', white: '#ffffff', ink: '#342d27',
  gold: '#a98a58', muted: '#766d63', border: '#e8e0d4', dark: '#39342f',
};
const EMPTY: Filters = {
  sku: '', name: '', category: '', description: '', quantity: '', minQuantity: '',
  maxQuantity: '', unit: '', color: '', size: '', material: '', brand: '', model: '',
  createdAt: '', createdFrom: '', createdTo: '',
};
const UNITS: Option[] = [
  { value: 'UN', label: 'Unidade (un)' }, { value: 'PAR', label: 'Par' },
  { value: 'KIT', label: 'Kit' }, { value: 'CX', label: 'Caixa' },
  { value: 'PCT', label: 'Pacote' }, { value: 'DZ', label: 'Dúzia' },
  { value: 'M', label: 'Metro (m)' }, { value: 'CM', label: 'Centímetro (cm)' },
  { value: 'M2', label: 'Metro quadrado (m²)' }, { value: 'KG', label: 'Quilograma (kg)' },
  { value: 'G', label: 'Grama (g)' }, { value: 'L', label: 'Litro (L)' },
  { value: 'ML', label: 'Mililitro (mL)' }, { value: 'ROLO', label: 'Rolo' },
  { value: 'FOLHA', label: 'Folha' },
];
const SORT: Option[] = [
  { value: 'name', label: 'Nome' }, { value: 'category', label: 'Categoria' },
  { value: 'quantity', label: 'Quantidade' }, { value: 'unit', label: 'Unidade' },
  { value: 'color', label: 'Cor' }, { value: 'size', label: 'Tamanho' },
  { value: 'material', label: 'Material' }, { value: 'brand', label: 'Marca' },
  { value: 'model', label: 'Modelo' }, { value: 'sku', label: 'SKU' },
  { value: 'createdAt', label: 'Data de cadastro' },
  { value: 'updatedAt', label: 'Última atualização' },
];
const ADVANCED_FIELDS: { key: keyof Filters; label: string; placeholder: string; numeric?: boolean }[] = [
  { key: 'description', label: 'Descrição', placeholder: 'Buscar na descrição' },
  { key: 'minQuantity', label: 'Quantidade mínima', placeholder: 'De', numeric: true },
  { key: 'maxQuantity', label: 'Quantidade máxima', placeholder: 'Até', numeric: true },
  { key: 'quantity', label: 'Quantidade exata', placeholder: 'Ex.: 50', numeric: true },
  { key: 'color', label: 'Cor', placeholder: 'Ex.: Branco' },
  { key: 'size', label: 'Tamanho', placeholder: 'Ex.: M' },
  { key: 'material', label: 'Material', placeholder: 'Ex.: Algodão' },
  { key: 'brand', label: 'Marca', placeholder: 'Buscar marca' },
  { key: 'model', label: 'Modelo', placeholder: 'Buscar modelo' },
  { key: 'createdAt', label: 'Data exata de cadastro', placeholder: 'AAAA-MM-DD' },
  { key: 'createdFrom', label: 'Cadastro a partir de', placeholder: 'AAAA-MM-DD' },
  { key: 'createdTo', label: 'Cadastro até', placeholder: 'AAAA-MM-DD' },
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

async function headers() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token || token === 'undefined' || token === 'null') {
    throw new Error('Sessão inválida. Faça login novamente.');
  }
  return { Authorization: `Bearer ${token}` };
}
function errorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : 'Erro ao consultar o estoque.';
  if (!error.response) return 'Não foi possível conectar ao servidor.';
  if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
  if (error.response.status === 403) return 'Você não possui permissão para consultar o estoque.';
  const message: unknown = error.response.data?.message;
  return typeof message === 'string' && message.trim() ? message : `Não foi possível consultar o estoque (HTTP ${error.response.status}).`;
}
function formatDate(value?: string | null) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
function buildParams(filters: Filters, page: number, size: number, sortBy: string, sortDirection: string) {
  const params = new URLSearchParams();
  const sku = filters.sku.trim();
  if (sku) {
    params.set('sku', sku); // Busca por SKU ignora filtros, paginação e ordenação.
    return params.toString();
  }
  (Object.entries(filters) as [keyof Filters, string][]).forEach(([key, value]) => {
    if (key !== 'sku' && value.trim()) params.set(key, value.trim());
  });
  params.set('page', String(page));
  params.set('pageSize', String(size));
  params.set('sortBy', sortBy);
  params.set('sortDirection', sortDirection);
  return params.toString();
}
function Field({ label, value, onChange, placeholder, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; numeric?: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput style={styles.input} value={value} onChangeText={onChange}
      placeholder={placeholder} placeholderTextColor="#a8a29e"
      keyboardType={numeric ? 'number-pad' : 'default'} />
  </View>;
}
function Button({ label, icon, onPress, secondary = false, disabled = false }: {
  label: string; icon?: IconName; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={[styles.button, secondary ? styles.secondaryButton : styles.primaryButton, disabled && styles.disabled]}>
    {icon && <Ionicons name={icon} size={18} color={secondary ? C.gold : '#fff'} />}
    <Text style={[styles.buttonText, secondary ? styles.secondaryButtonText : styles.primaryButtonText]}>{label}</Text>
  </Pressable>;
}

export default function EstoqueScreen() {
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [draft, setDraft] = useState<Filters>({ ...EMPTY });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('ASC');
  const [result, setResult] = useState<InventoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [picker, setPicker] = useState<Picker>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const update = (key: keyof Filters, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  const skuActive = applied.sku.trim().length > 0;
  const appliedCount = useMemo(() => skuActive ? 1 : Object.values(applied).filter(value => value.trim()).length, [applied, skuActive]);
  const total = result?.totalElements ?? 0;
  const currentPage = result?.page ?? page;
  const first = total ? currentPage * (result?.size ?? size) + 1 : 0;
  const last = total ? Math.min(first + (result?.totalElementsThisPage ?? result?.content?.length ?? 0) - 1, total) : 0;
  const totalPages = result?.totalPages ?? 0;

  const fetchInventory = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const auth = await headers();
      if (signal.aborted) return;
      const query = buildParams(applied, page, size, sortBy, sortDirection);
      const { data } = await api.get<InventoryPage>(`/inventory?${query}`, { headers: auth, signal });
      if (!signal.aborted) setResult(data);
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setResult(null);
      setError(errorMessage(cause));
      if (axios.isAxiosError(cause) && cause.response?.status === 401) {
        await SecureStore.deleteItemAsync('access_token');
        router.replace('/');
      }
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [applied, page, size, sortBy, sortDirection]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchInventory(controller.signal);
    return () => controller.abort();
  }, [fetchInventory, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const auth = await headers();
        if (controller.signal.aborted) return;
        const { data } = await api.get<InventoryCategory[] | { content: InventoryCategory[] }>('/categories', {
          params: { type: 'INVENTORY' }, headers: auth, signal: controller.signal,
        });
        const items = Array.isArray(data) ? data : data?.content ?? [];
        if (!controller.signal.aborted) setCategories(items.filter(item => item.type === 'INVENTORY'));
      } catch { /* Categorias opcionais: mantém a consulta principal disponível. */ }
    })();
    return () => controller.abort();
  }, []);

  const apply = () => { setPage(0); setApplied({ ...draft }); setFiltersOpen(false); };
  const clear = () => { setDraft({ ...EMPTY }); setApplied({ ...EMPTY }); setPage(0); setFiltersOpen(false); };
  const refresh = () => { setRefreshing(true); setReloadKey(previous => previous + 1); };
  const pick = (title: string, value: string, options: Option[], onPick: (value: string) => void) =>
    setPicker({ title, value, options, onPick });
  function selection(label: string, value: string, options: Option[], onPick: (value: string) => void, disabled = false) {
    const current = options.find(option => option.value === value)?.label ?? 'Selecionar';
    return <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable disabled={disabled} onPress={() => pick(label, value, options, onPick)}
        style={[styles.select, disabled && styles.disabled]}>
        <Text style={styles.selectText}>{current}</Text>
        <Ionicons name="chevron-down-outline" size={18} color={C.gold} />
      </Pressable>
    </View>;
  }
  function openMenu(label: string, route?: string) {
    setMenuOpen(false);
    if (route) { if (route !== '/estoque') router.push(route as never); return; }
    Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  }
  async function logout() {
    setMenuOpen(false);
    await SecureStore.deleteItemAsync('access_token');
    router.replace('/');
  }
  const renderItem = ({ item, index }: { item: Inventory; index: number }) => {
    const lowStock = item.minimumQuantity !== null && item.quantity <= item.minimumQuantity;
    const unit = UNITS.find(option => option.value === item.unit)?.label ?? item.unit ?? '—';
    return <View style={[styles.itemCard, index % 2 === 1 && styles.alternateCard]}>
      <View style={styles.itemHeader}>
        <View style={styles.itemHeading}>
          <Text style={styles.itemName}>{item.name}</Text>
          {!!item.sku && <Text style={styles.sku}>SKU: {item.sku}</Text>}
        </View>
        {lowStock && <View style={styles.warning}><Text style={styles.warningText}>Estoque baixo</Text></View>}
      </View>
      {!!item.description && <Text style={styles.description}>{item.description}</Text>}
      <View style={styles.itemDetails}>
        <View style={styles.detail}><Text style={styles.detailLabel}>Categoria</Text><Text style={styles.detailValue}>{item.category || '—'}</Text></View>
        <View style={styles.detail}><Text style={styles.detailLabel}>Quantidade</Text><Text style={[styles.detailValue, lowStock && styles.lowQuantity]}>{item.quantity}</Text></View>
        <View style={styles.detail}><Text style={styles.detailLabel}>Unidade</Text><Text style={styles.detailValue}>{unit}</Text></View>
        <View style={styles.detail}><Text style={styles.detailLabel}>Cadastro</Text><Text style={styles.detailValue}>{formatDate(item.createdAt)}</Text></View>
      </View>
      <View style={styles.itemActions}>
        <Button secondary label="Visualizar" icon="eye-outline" onPress={() => router.push(`/estoque/${item.id}` as never)} />
        <Button secondary label="Editar" icon="pencil-outline" onPress={() => router.push(`/estoque/${item.id}/editar` as never)} />
      </View>
    </View>;
  };

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={result?.content ?? []} renderItem={renderItem} keyExtractor={item => item.id}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[C.gold]} tintColor={C.gold} />}
        ListHeaderComponent={<>
          <View style={styles.topbar}>
            <Pressable style={styles.headerButton} onPress={() => setMenuOpen(true)} accessibilityLabel="Abrir menu">
              <Ionicons name="menu-outline" size={27} color={C.ink} />
            </Pressable>
            <View style={styles.headerTitle}><Text style={styles.heading}>Estoque</Text></View>
            <Pressable style={styles.headerButton} onPress={refresh} accessibilityLabel="Atualizar estoque">
              <Ionicons name="refresh-outline" size={21} color={C.gold} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Consulte materiais, insumos e quantidades disponíveis.</Text>
          <View style={styles.newRow}>
            <Button label="Cadastrar item" icon="add-outline" onPress={() => router.push('/estoque/novo' as never)} />
          </View>
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Buscar itens</Text>
            <Field label="Nome" value={draft.name} onChange={value => update('name', value)} placeholder="Buscar item pelo nome" />
            <Field label="SKU" value={draft.sku} onChange={value => update('sku', value)} placeholder="Ex.: GAR-AZUL-001" />
            <View style={styles.actions}>
              <Button label="Buscar" icon="search-outline" onPress={apply} />
              <Button secondary label={`Filtros${appliedCount ? ` (${appliedCount})` : ''}`} icon="options-outline" onPress={() => setFiltersOpen(true)} />
            </View>
          </View>
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Itens cadastrados</Text>
            <Text style={styles.helper}>{loading ? 'Carregando estoque...' : `${total} ${total === 1 ? 'item encontrado' : 'itens encontrados'}`}{appliedCount ? ` · ${appliedCount} filtros aplicados` : ''}</Text>
            {selection('Ordenar por', sortBy, SORT, value => { setSortBy(value); setPage(0); }, skuActive)}
            <View style={styles.twoCol}>
              <View style={styles.column}>{selection('Direção', sortDirection, [{ value: 'ASC', label: 'Crescente' }, { value: 'DESC', label: 'Decrescente' }], value => { setSortDirection(value); setPage(0); }, skuActive)}</View>
              <View style={styles.column}>{selection('Por página', String(size), [10, 20, 50, 100].map(value => ({ value: String(value), label: String(value) })), value => { setSize(Number(value)); setPage(0); }, skuActive)}</View>
            </View>
          </View>
          {error && <View style={styles.feedback}><Text style={styles.error}>{error}</Text><Button secondary label="Tentar novamente" icon="refresh-outline" onPress={refresh} /></View>}
          {loading && !error && <View style={styles.feedback}><ActivityIndicator size="large" color={C.gold} /><Text style={styles.helper}>Carregando...</Text></View>}
          {!loading && !error && !result?.content?.length && <View style={styles.feedback}>
            <Ionicons name="layers-outline" size={35} color={C.gold} />
            <Text style={styles.sectionTitle}>Nenhum item encontrado</Text>
            <Text style={styles.helper}>Ajuste os filtros ou cadastre um novo item.</Text>
          </View>}
        </>}
        ListFooterComponent={!loading && !error && result ? (
            <View style={styles.pagination}>
              <Text style={styles.helper}>
                Exibindo {first} a {last} de {total} resultados
              </Text>
              <Text style={styles.pageCount}>
                Página {totalPages ? currentPage + 1 : 0} de {totalPages}
              </Text>
              <View style={styles.actions}>
                <Button
                  secondary
                  label="Anterior"
                  icon="chevron-back-outline"
                  disabled={skuActive || page <= 0}
                  onPress={() => setPage(value => Math.max(0, value - 1))}
                />
                <Button
                  secondary
                  label="Próxima"
                  icon="chevron-forward-outline"
                  disabled={skuActive || totalPages === 0 || page >= totalPages - 1}
                  onPress={() => setPage(value => value + 1)}
                />
              </View>
            </View>
          ) : undefined}
      />
    </KeyboardAvoidingView>

    <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
      <View style={styles.bottomOverlay}><View style={styles.filterSheet}>
        <View style={styles.modalTitleRow}><Text style={styles.modalTitle}>Filtros avançados</Text>
          <Pressable onPress={() => setFiltersOpen(false)} accessibilityLabel="Fechar filtros"><Ionicons name="close" size={23} color={C.ink} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
          {selection('Categoria', draft.category, [{ value: '', label: 'Todas as categorias' }, ...categories.map(item => ({ value: item.name, label: item.name }))], value => update('category', value))}
          {selection('Unidade de medida', draft.unit, [{ value: '', label: 'Todas as unidades' }, ...UNITS], value => update('unit', value))}
          {ADVANCED_FIELDS.map(field => <Field key={field.key} label={field.label} value={draft[field.key]}
            onChange={value => update(field.key, value)} placeholder={field.placeholder} numeric={field.numeric} />)}
        </ScrollView>
        <View style={styles.modalActions}>
          <Button secondary label="Limpar" icon="close-outline" onPress={clear} />
          <Button label="Aplicar filtros" icon="search-outline" onPress={apply} />
        </View>
      </View></View>
    </Modal>

    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={styles.pickerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} accessibilityLabel="Fechar seleção" />
        <View style={styles.pickerCard}>
          <View style={styles.modalTitleRow}><Text style={styles.modalTitle}>{picker?.title}</Text>
            <Pressable onPress={() => setPicker(null)} accessibilityLabel="Fechar"><Ionicons name="close" size={23} color={C.ink} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.pickerScroll}>
            {picker?.options.map(option => <Pressable key={option.value} style={styles.pickerItem}
              onPress={() => { picker.onPick(option.value); setPicker(null); }}>
              <Text style={styles.pickerItemText}>{option.label}</Text>
              {option.value === picker.value && <Ionicons name="checkmark" size={20} color={C.gold} />}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>

    <Modal visible={menuOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenuOpen(false)}>
      <View style={styles.drawerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" />
        <SafeAreaView edges={['top', 'bottom']} style={styles.drawer}>
          <View style={styles.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} resizeMode="contain" style={styles.drawerLogo} />
            <View style={styles.drawerBrandName}><Text style={styles.drawerEyebrow}>PERSONALITÉ</Text><Text style={styles.drawerTitle}>Creative</Text></View>
            <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu"><Ionicons name="close" size={23} color="#fff" /></Pressable>
          </View>
          <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerScrollContent}>
            <Text style={styles.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} onPress={() => openMenu(item.label, item.route)}
              style={[styles.drawerItem, item.route === '/estoque' && styles.drawerActive]}>
              <Ionicons name={item.icon} size={19} color="#eee7db" />
              <Text style={styles.drawerItemText}>{item.label}</Text>
            </Pressable>)}
            <Text style={[styles.drawerSection, styles.drawerSystem]}>SISTEMA</Text>
            <Pressable style={styles.drawerItem} onPress={() => openMenu('Meu Perfil')}>
              <Ionicons name="settings-outline" size={19} color="#eee7db" /><Text style={styles.drawerItemText}>Meu Perfil</Text>
            </Pressable>
          </ScrollView>
          <Pressable style={styles.drawerLogout} onPress={() => void logout()}>
            <Ionicons name="log-out-outline" size={20} color="#eee7db" /><Text style={styles.drawerItemText}>Sair</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background }, fill: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 38, flexGrow: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 },
  headerButton: { width: 42, height: 43, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 }, heading: { fontSize: 28, lineHeight: 40, color: C.ink, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', includeFontPadding: true },
  subtitle: { fontSize: 13, lineHeight: 21, color: C.muted, marginBottom: 12, includeFontPadding: true },
  newRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 17 },
  panel: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 15 },
  sectionTitle: { fontSize: 17, lineHeight: 27, fontWeight: '700', color: C.ink, marginBottom: 10, includeFontPadding: true },
  helper: { fontSize: 12, lineHeight: 21, color: C.muted, includeFontPadding: true, marginBottom: 7 },
  field: { marginBottom: 13, minWidth: 0 }, fieldLabel: { fontSize: 13, lineHeight: 23, fontWeight: '600', color: C.ink, includeFontPadding: true, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 48, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, includeFontPadding: true },
  select: { borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' },
  selectText: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 23, includeFontPadding: true },
  twoCol: { flexDirection: 'row', gap: 10 }, column: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 7 },
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11 },
  primaryButton: { backgroundColor: C.gold }, secondaryButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  buttonText: { fontWeight: '700', fontSize: 13, lineHeight: 22, includeFontPadding: true }, primaryButtonText: { color: '#fff' }, secondaryButtonText: { color: '#80623d' },
  disabled: { opacity: 0.4 },
  itemCard: { borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 15, padding: 16, marginBottom: 12, gap: 9 },
  alternateCard: { backgroundColor: '#f0ece6' }, itemHeader: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 9 },
  itemHeading: { flex: 1, minWidth: 0 }, itemName: { color: C.ink, fontWeight: '700', fontSize: 17, lineHeight: 27, includeFontPadding: true },
  sku: { color: '#927448', fontSize: 12, lineHeight: 21, marginTop: 3, fontWeight: '600', includeFontPadding: true },
  warning: { alignSelf: 'flex-start', backgroundColor: '#fee2e2', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 }, warningText: { color: '#b91c1c', fontSize: 11, lineHeight: 19, fontWeight: '700' },
  description: { fontSize: 12, lineHeight: 20, color: C.muted, includeFontPadding: true },
  itemDetails: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  detail: { width: '50%', paddingRight: 8 }, detailLabel: { fontSize: 11, lineHeight: 19, color: C.muted, includeFontPadding: true },
  detailValue: { fontSize: 14, lineHeight: 23, color: C.ink, fontWeight: '700', includeFontPadding: true }, lowQuantity: { color: '#b91c1c' },
  itemActions: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, flexDirection: 'row', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' },
  feedback: { backgroundColor: '#fff', borderRadius: 14, padding: 23, marginBottom: 14, alignItems: 'center', gap: 8 }, error: { color: '#b91c1c', fontSize: 13, lineHeight: 22, textAlign: 'center' },
  pagination: { paddingTop: 15, alignItems: 'center', gap: 9 }, pageCount: { color: C.ink, fontSize: 13, lineHeight: 22, fontWeight: '700' },
  bottomOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }, filterSheet: { backgroundColor: C.background, height: '88%', borderTopLeftRadius: 21, borderTopRightRadius: 21, overflow: 'hidden' },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: 18, paddingVertical: 16 },
  modalTitle: { color: C.ink, fontSize: 18, lineHeight: 28, fontWeight: '700', flex: 1 },
  modalContent: { padding: 19, paddingBottom: 38 }, modalActions: { backgroundColor: '#fff', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9, padding: 13, borderTopWidth: 1, borderTopColor: C.border },
  pickerOverlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0008' },
  pickerCard: { backgroundColor: '#fff', borderRadius: 18, maxHeight: '80%', overflow: 'hidden' }, pickerScroll: { flexGrow: 0 },
  pickerItem: { minHeight: 47, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerItemText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 23, includeFontPadding: true },
  drawerOverlay: { flex: 1, backgroundColor: '#0008', flexDirection: 'row' }, drawer: { width: '82%', maxWidth: 310, backgroundColor: C.dark, height: '100%' },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  drawerLogo: { width: 56, height: 67 }, drawerBrandName: { flex: 1 }, drawerEyebrow: { color: '#d5bd91', fontSize: 10, lineHeight: 18, letterSpacing: 2, fontWeight: '700' },
  drawerTitle: { color: '#fff', fontSize: 21, lineHeight: 30, fontFamily: 'serif' }, drawerScroll: { flex: 1 },
  drawerScrollContent: { paddingHorizontal: 13, paddingTop: 24, paddingBottom: 30 }, drawerSection: { color: '#b1a698', fontSize: 10, lineHeight: 18, fontWeight: '700', letterSpacing: 1.7, marginBottom: 13 },
  drawerSystem: { marginTop: 25 }, drawerItem: { minHeight: 49, borderRadius: 10, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 3 },
  drawerActive: { backgroundColor: '#665949' }, drawerItemText: { flex: 1, color: '#eee7db', fontSize: 14, lineHeight: 23, fontWeight: '600', includeFontPadding: true },
  drawerLogout: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 26, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
