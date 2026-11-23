import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type PricingType = 'FIXED' | 'TIERED' | 'QUOTE';
type ChargeType = 'PER_ORDER' | 'PER_UNIT' | 'FIRST_PURCHASE';
type Category = { id: string; name: string; type: 'PRODUCT' | 'INVENTORY' | 'EXPENSE' };
type ProductPrice = { id: string; minimumQuantity: number; unitPrice: number; createdAt: string; updatedAt: string };
type ProductFee = { id: string; name: string; amount: number; chargeType: ChargeType; required: boolean; active: boolean };
type Product = {
  id: string; code: string; name: string; category: string; description: string | null;
  minimumQuantity: number | null; pricingType: PricingType; shelfLifeDays: number | null;
  productionLeadTimeMinDays: number | null; productionLeadTimeMaxDays: number | null;
  active: boolean; prices: ProductPrice[]; fees: ProductFee[]; createdAt: string; updatedAt: string;
};
type ProductsPage = {
  content: Product[]; page: number; size: number; totalElementsThisPage: number;
  totalElements: number; totalPages: number;
};
type Filters = {
  code: string; name: string; description: string; category: string; active: string;
  pricingType: string; feeName: string; chargeType: string; minQuantity: string;
  maxQuantity: string; minShelfLifeDays: string; maxShelfLifeDays: string;
  minPrice: string; maxPrice: string; minFeeAmount: string; maxFeeAmount: string;
  hasFees: string; createdFrom: string; createdTo: string; colors: string;
  sizes: string; brands: string; models: string; materials: string;
};
const INITIAL: Filters = {
  code: '', name: '', description: '', category: '', active: '', pricingType: '',
  feeName: '', chargeType: '', minQuantity: '', maxQuantity: '', minShelfLifeDays: '',
  maxShelfLifeDays: '', minPrice: '', maxPrice: '', minFeeAmount: '', maxFeeAmount: '',
  hasFees: '', createdFrom: '', createdTo: '', colors: '', sizes: '', brands: '', models: '', materials: '',
};
const COLORS = { background: '#f8f6f2', text: '#342d27', gold: '#a98a58', dark: '#39342f', border: '#ece6dc', muted: '#78716c' };
const SORTS = [
  ['name', 'Nome'], ['code', 'Código'], ['createdAt', 'Data de cadastro'],
  ['updatedAt', 'Última atualização'], ['minimumQuantity', 'Quantidade mínima'],
  ['shelfLifeDays', 'Validade'], ['price', 'Menor preço'],
] as const;
const PRICING: Array<[string, string]> = [['', 'Todos'], ['FIXED', 'Preço fixo'], ['TIERED', 'Por quantidade'], ['QUOTE', 'Sob consulta']];
const CHARGES: Array<[string, string]> = [['', 'Todos'], ['PER_ORDER', 'Por pedido'], ['PER_UNIT', 'Por unidade'], ['FIRST_PURCHASE', 'Primeira compra']];
const YES_NO: Array<[string, string]> = [['', 'Todos'], ['true', 'Sim'], ['false', 'Não']];
const FILTER_FIELDS: Array<[keyof Filters, string, string, 'text' | 'number' | 'date']> = [
  ['description', 'Descrição', 'Buscar na descrição', 'text'],
  ['feeName', 'Nome da taxa', 'Buscar taxa', 'text'],
  ['colors', 'Cor', 'Azul, Verde', 'text'], ['sizes', 'Tamanho', 'P, M, G', 'text'],
  ['brands', 'Marca', 'Marca do produto', 'text'], ['models', 'Modelo', 'Modelo 01', 'text'],
  ['materials', 'Material', 'Algodão', 'text'],
  ['minQuantity', 'Quantidade mínima — de', 'Sem limite', 'number'],
  ['maxQuantity', 'Quantidade mínima — até', 'Sem limite', 'number'],
  ['minShelfLifeDays', 'Validade (dias) — de', 'Sem limite', 'number'],
  ['maxShelfLifeDays', 'Validade (dias) — até', 'Sem limite', 'number'],
  ['minPrice', 'Preço unitário — de', 'Sem limite', 'number'],
  ['maxPrice', 'Preço unitário — até', 'Sem limite', 'number'],
  ['minFeeAmount', 'Valor da taxa — de', 'Sem limite', 'number'],
  ['maxFeeAmount', 'Valor da taxa — até', 'Sem limite', 'number'],
  ['createdFrom', 'Cadastrado a partir de', 'AAAA-MM-DD', 'date'],
  ['createdTo', 'Cadastrado até', 'AAAA-MM-DD', 'date'],
];

function BRText({ children, style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[{ includeFontPadding: true, paddingRight: 5 }, style]}>{children}</Text>;
}
function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
function toIso(date: string): string {
  if (!date.trim()) return '';
  const parsed = new Date(date.trim());
  return Number.isNaN(parsed.getTime()) ? date.trim() : parsed.toISOString();
}
function getError(error: unknown): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : 'Erro inesperado ao consultar produtos.';
  const status = error.response?.status;
  if (status === 401) return 'Sessão expirada ou inválida. Faça login novamente.';
  if (status === 403) return 'Você não possui permissão para consultar produtos.';
  if (!error.response) return 'Não foi possível conectar ao servidor.';
  const message = error.response.data?.message;
  return typeof message === 'string' && message.trim() ? message : `Não foi possível consultar os produtos (HTTP ${status}).`;
}
function SelectChips({ title, value, options, onChange }: {
  title: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void;
}) {
  return <View style={styles.filterBlock}>
    <BRText style={styles.label}>{title}</BRText>
    <View style={styles.chips}>{options.map(([optionValue, label]) =>
      <Pressable key={optionValue} onPress={() => onChange(optionValue)} style={[styles.chip, value === optionValue && styles.chipActive]}>
        <BRText style={[styles.chipText, value === optionValue && styles.chipTextActive]}>{label}</BRText>
      </Pressable>)}</View>
  </View>;
}

export default function ProdutosScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Filters>({ ...INITIAL });
  const [applied, setApplied] = useState<Filters>({ ...INITIAL });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState<'ASC' | 'DESC'>('ASC');
  const [result, setResult] = useState<ProductsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const update = (key: keyof Filters, value: string) => setDraft(current => ({ ...current, [key]: value }));

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (!token || controller.signal.aborted) return;
        const { data } = await api.get<Category[]>('/categories', {
          params: { type: 'PRODUCT' }, headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!controller.signal.aborted) setCategories(data.filter(c => c.type === 'PRODUCT').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      } catch (cause) {
        if (!controller.signal.aborted && !axios.isCancel(cause)) setCategoryError(true);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (!token) return;
        const payloadPart = token.split('.')[1];
        if (!payloadPart) return;
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let buffer = 0, bits = 0, decoded = '';
        for (const char of payloadPart.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
          const digit = alphabet.indexOf(char);
          if (digit < 0) return;
          buffer = (buffer << 6) | digit;
          bits += 6;
          if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((buffer >>> bits) & 255); }
        }
        const { sub } = JSON.parse(decoded) as { sub?: string };
        if (!sub) return;
        const { data } = await api.get<{ name: string }>('/users/id', {
          params: { userId: sub }, headers: { Authorization: `Bearer ${token}` },
        });
        if (mounted) setUserName(data.name);
      } catch { /* Nome opcional; não impede consulta de produtos. */ }
    })();
    return () => { mounted = false; };
  }, []);

  const openMenuPage = (label: string, route?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes') => {
    setMenuOpen(false);
    if (route) { router.navigate(route); return; }
    Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  };

  const logout = async () => {
    setMenuOpen(false);
    await SecureStore.deleteItemAsync('access_token');
    router.replace('/');
  };

  const fetchProducts = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) {
        if (!signal.aborted) router.replace('/');
        return;
      }
      const params = new URLSearchParams();
      (Object.entries(applied) as Array<[keyof Filters, string]>).forEach(([key, raw]) => {
        const value = raw.trim();
        if (!value) return;
        if (['colors', 'sizes', 'brands', 'models', 'materials'].includes(key)) {
          value.split(',').map(v => v.trim()).filter(Boolean).forEach(v => params.append(key, v));
        } else {
          params.set(key, key === 'createdFrom' || key === 'createdTo' ? toIso(value) : value);
        }
      });
      params.set('page', String(page));
      params.set('size', String(size));
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);
      const { data } = await api.get<ProductsPage>(`/products?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }, signal,
      });
      if (!signal.aborted) setResult(data);
    } catch (cause) {
      if (!signal.aborted && !axios.isCancel(cause)) {
        setResult(null);
        setError(getError(cause));
        if (axios.isAxiosError(cause) && cause.response?.status === 401) {
          await SecureStore.deleteItemAsync('access_token');
          router.replace('/');
        }
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [applied, page, size, sortBy, sortDirection, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchProducts(controller.signal);
    return () => controller.abort();
  }, [fetchProducts]);

  const search = () => { setPage(0); setApplied({ ...draft }); setFiltersOpen(false); };
  const clear = () => { setDraft({ ...INITIAL }); setApplied({ ...INITIAL }); setPage(0); setFiltersOpen(false); };
  const activeCount = Object.values(applied).filter(v => v.trim()).length;
  const sortLabel = SORTS.find(([key]) => key === sortBy)?.[1] ?? 'Nome';

  const renderProduct = ({ item }: { item: Product }) => {
    const lowestPrice = item.prices?.length
      ? [...item.prices].sort((a, b) => a.minimumQuantity - b.minimumQuantity)[0].unitPrice
      : null;
    return <View style={styles.productCard}>
      <View style={styles.productTop}>
        <View style={styles.productInfo}>
          <BRText style={styles.productCode}>
            <Text style={{ color: '#2563eb' }}>{item.code?.slice(0, 2)}</Text>
            <Text style={{ color: COLORS.gold }}>{item.code?.slice(2)}</Text>
          </BRText>
          <BRText style={styles.productName}>{item.name}</BRText>
          <BRText style={styles.productCategory}>{item.category}</BRText>
        </View>
        <View style={[styles.status, !item.active && styles.statusInactive]}>
          <BRText style={[styles.statusText, !item.active && styles.statusInactiveText]}>{item.active ? 'Ativo' : 'Inativo'}</BRText>
        </View>
      </View>
      <View style={styles.productBottom}>
        <View style={styles.valueBox}><BRText style={styles.smallMuted}>Preço inicial</BRText><BRText style={styles.value}>{lowestPrice == null ? 'Sob consulta' : formatCurrency(lowestPrice)}</BRText></View>
        <View style={styles.valueBox}><BRText style={styles.smallMuted}>Qtd. mínima</BRText><BRText style={styles.value}>{item.minimumQuantity ?? '—'}</BRText></View>
      </View>
      <View style={styles.productActions}>
        <Pressable
        onPress={() => router.push(`/produtos/${item.id}`)}
        style={styles.actionButton}
      >
        <Ionicons name="eye-outline" size={18} color={COLORS.gold} />
        <BRText style={styles.actionText}>Visualizar</BRText>
      </Pressable>
        <Pressable
          onPress={() => router.push(`/produtos/${item.id}/editar`)}
          style={styles.actionButton}
        >
          <Ionicons name="pencil-outline" size={18} color={COLORS.gold} />
          <BRText style={styles.actionText}>Editar</BRText>
        </Pressable>
      </View>
    </View>;
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={result?.content ?? []} keyExtractor={item => item.id} renderItem={renderProduct}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setReloadKey(k => k + 1)} tintColor={COLORS.gold} colors={[COLORS.gold]} />}
        ListHeaderComponent={<>
          <View style={styles.header}>
            <Pressable style={styles.menuButton} onPress={() => setMenuOpen(true)} accessibilityLabel="Abrir menu" accessibilityRole="button">
              <Ionicons name="menu" size={27} color={COLORS.dark} />
            </Pressable>
            <View style={styles.headerTitle}><BRText style={styles.heading}>Produtos</BRText><BRText style={styles.subtitle}>Catálogo de produtos cadastrados</BRText></View>
            <Pressable
              style={styles.addButton}
              onPress={() => router.push('/produtos/novo')}
            >
              <Ionicons name="add" color="white" size={20} />
              <BRText style={styles.addText}>Novo</BRText>
</Pressable>
          </View>
          <View style={styles.panel}>
            <View style={styles.inputShell}><Ionicons name="search-outline" size={19} color="#a8a29e" />
              <TextInput style={styles.textInput} placeholder="Buscar pelo nome do produto..." placeholderTextColor="#a8a29e" value={draft.name} onChangeText={value => update('name', value)} returnKeyType="search" onSubmitEditing={search} />
            </View>
            <View style={styles.searchRow}>
              <TextInput style={[styles.textInput, styles.codeInput]} placeholder="Código (ex.: 0703)" placeholderTextColor="#a8a29e" value={draft.code} onChangeText={value => update('code', value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} />
              <Pressable style={styles.searchButton} onPress={search}><Ionicons name="search" size={17} color="white" /><BRText style={styles.searchButtonText}>Buscar</BRText></Pressable>
            </View>
            <View style={styles.toolbar}>
              <Pressable style={styles.outlineButton} onPress={() => setFiltersOpen(true)}><Ionicons name="options-outline" size={17} color={COLORS.dark} /><BRText style={styles.outlineText}>Filtros{activeCount ? ` (${activeCount})` : ''}</BRText></Pressable>
              <Pressable style={styles.outlineButton} onPress={() => setSortOpen(true)}><Ionicons name="swap-vertical-outline" size={17} color={COLORS.dark} /><BRText style={styles.outlineText}>Ordenar</BRText></Pressable>
              <Pressable style={styles.iconButton} onPress={() => setReloadKey(k => k + 1)} accessibilityLabel="Atualizar produtos"><Ionicons name="refresh-outline" size={20} color={COLORS.gold} /></Pressable>
            </View>
          </View>
          <View style={styles.resultsHeader}>
            <BRText style={styles.sectionTitle}>Produtos cadastrados</BRText>
            <BRText style={styles.subtitle}>{loading ? 'Carregando...' : result ? `${result.totalElements} produto(s) encontrado(s)` : 'Consulta de produtos'}</BRText>
            <BRText style={styles.smallMuted}>Ordenação: {sortLabel} · {sortDirection === 'ASC' ? 'Crescente' : 'Decrescente'} · {size} por página</BRText>
          </View>
          {error && <View style={styles.message}><BRText style={styles.error}>{error}</BRText><Pressable onPress={() => setReloadKey(k => k + 1)}><BRText style={styles.actionText}>Tentar novamente</BRText></Pressable></View>}
          {loading && <View style={styles.message}><ActivityIndicator size="large" color={COLORS.gold} /></View>}
          {!loading && !error && (!result || !result.content.length) && <View style={styles.message}><Ionicons name="cube-outline" size={38} color="#cbb58e"/><BRText style={styles.sectionTitle}>Nenhum produto encontrado</BRText><BRText style={styles.subtitle}>Ajuste os filtros ou cadastre um novo produto.</BRText></View>}
        </>}
        ListFooterComponent={result && !loading && !error ? ( <View style={styles.pagination}>
          <BRText style={styles.subtitle}>Exibindo {result.totalElementsThisPage} de {result.totalElements} · Página {result.page + 1} de {Math.max(result.totalPages, 1)}</BRText>
          <View style={styles.paginationButtons}>
            <Pressable disabled={page <= 0} onPress={() => setPage(p => Math.max(0, p - 1))} style={[styles.pageButton, page <= 0 && styles.disabled]}><Ionicons name="chevron-back" size={17} color={COLORS.gold}/><BRText style={styles.actionText}>Anterior</BRText></Pressable>
            <Pressable disabled={page + 1 >= result.totalPages} onPress={() => setPage(p => p + 1)} style={[styles.pageButton, page + 1 >= result.totalPages && styles.disabled]}><BRText style={styles.actionText}>Próxima</BRText><Ionicons name="chevron-forward" size={17} color={COLORS.gold}/></Pressable>
          </View>
          </View>
        ) : undefined}
      />
    </KeyboardAvoidingView>

    <Modal animationType="slide" transparent visible={filtersOpen} onRequestClose={() => setFiltersOpen(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modalSheet}>
        <View style={styles.modalHeader}><BRText style={styles.sectionTitle}>Filtros avançados</BRText><Pressable onPress={() => setFiltersOpen(false)} hitSlop={12}><Ionicons name="close" size={24} color={COLORS.text}/></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
          <SelectChips title="Categoria" value={draft.category} options={[[ '', 'Todas' ], ...categories.map(c => [c.name, c.name] as [string, string])]} onChange={value => update('category', value)} />
          {categoryError && <BRText style={styles.error}>Não foi possível carregar as categorias.</BRText>}
          <SelectChips title="Situação" value={draft.active} options={[[ '', 'Todas' ], ['true', 'Ativo'], ['false', 'Inativo']]} onChange={value => update('active', value)} />
          <SelectChips title="Tipo de precificação" value={draft.pricingType} options={PRICING} onChange={value => update('pricingType', value)} />
          <SelectChips title="Tipo de cobrança" value={draft.chargeType} options={CHARGES} onChange={value => update('chargeType', value)} />
          <SelectChips title="Possui taxas" value={draft.hasFees} options={YES_NO} onChange={value => update('hasFees', value)} />
          {FILTER_FIELDS.map(([key, label, placeholder, type]) => <View style={styles.filterBlock} key={key}><BRText style={styles.label}>{label}</BRText><TextInput style={styles.filterInput} value={draft[key]} onChangeText={value => update(key, value)} placeholder={placeholder} placeholderTextColor="#a8a29e" keyboardType={type === 'number' ? 'decimal-pad' : 'default'} autoCapitalize="none" /></View>)}
        </ScrollView>
        <View style={styles.modalFooter}><Pressable style={styles.clearButton} onPress={clear}><BRText style={styles.outlineText}>Limpar filtros</BRText></Pressable><Pressable style={styles.applyButton} onPress={search}><BRText style={styles.searchButtonText}>Aplicar filtros</BRText></Pressable></View>
      </View></View>
    </Modal>

    <Modal animationType="fade" transparent visible={sortOpen} onRequestClose={() => setSortOpen(false)}>
      <Pressable style={styles.centerBackdrop} onPress={() => setSortOpen(false)}><View style={styles.sortPanel}>
        <BRText style={styles.sectionTitle}>Ordenar produtos</BRText>
        {SORTS.map(([key, label]) => <Pressable key={key} style={styles.sortItem} onPress={() => { setSortBy(key); setPage(0); setSortOpen(false); }}><BRText style={styles.label}>{label}</BRText>{sortBy === key && <Ionicons name="checkmark" color={COLORS.gold} size={20} />}</Pressable>)}
        <View style={styles.divider}/>
        <SelectChips title="Direção" value={sortDirection} options={[[ 'ASC', 'Crescente' ], ['DESC', 'Decrescente' ]]} onChange={value => { setSortDirection(value as 'ASC' | 'DESC'); setPage(0); }} />
        <SelectChips title="Produtos por página" value={String(size)} options={['10', '20', '50', '100'].map(n => [n, n])} onChange={value => { setSize(Number(value)); setPage(0); }} />
        <Pressable style={styles.applyButton} onPress={() => setSortOpen(false)}><BRText style={styles.searchButtonText}>Concluir</BRText></Pressable>
      </View></Pressable>
    </Modal>

    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={styles.drawerOverlay}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" />
        <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
          <View style={styles.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} resizeMode="contain" style={styles.drawerLogo} />
            <View style={styles.drawerBrandText}>
              <BRText style={styles.drawerEyebrow}>PERSONALITÉ</BRText>
              <BRText style={styles.drawerTitle}>Creative</BRText>
            </View>
            <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" hitSlop={12}>
              <Ionicons name="close" size={23} color="#fff" />
            </Pressable>
          </View>
          <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerScrollContent}>
            <BRText style={styles.drawerSection}>MENU PRINCIPAL</BRText>
            {([
              { label: 'Visão geral', icon: 'grid-outline', route: '/home' },
              { label: 'Produtos', icon: 'cube-outline', route: '/produtos' },
              { label: 'Categorias', icon: 'pricetags-outline', route: '/categorias' },
              { label: 'Vendas', icon: 'bag-handle-outline', route: '/vendas' },
              { label: 'Histórico Financeiro', icon: 'card-outline', route: '/movimentacoes' },
              { label: 'Clientes', icon: 'people-outline', route: '/clientes' },
              { label: 'Estoque', icon: 'layers-outline' },
              { label: 'Despesas', icon: 'wallet-outline' },
              { label: 'Relatórios', icon: 'stats-chart-outline' },
            ] as { label: string; icon: keyof typeof Ionicons.glyphMap; route?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' }[]).map(item => (
              <Pressable key={item.label} onPress={() => openMenuPage(item.label, item.route)}
                style={[styles.drawerItem, item.route === '/produtos' && styles.drawerItemActive]} accessibilityRole="button">
                <Ionicons name={item.icon} size={19} color={item.route === '/produtos' ? '#fff' : '#d8d0c6'} />
                <BRText style={[styles.drawerItemText, item.route === '/produtos' && styles.drawerItemTextActive]}>{item.label}</BRText>
              </Pressable>
            ))}
            <BRText style={[styles.drawerSection, styles.drawerSystem]}>SISTEMA</BRText>
            <Pressable style={styles.drawerItem} onPress={() => openMenuPage('Meu Perfil')}>
              <Ionicons name="settings-outline" size={19} color="#d8d0c6" />
              <BRText style={styles.drawerItemText}>Meu Perfil</BRText>
            </Pressable>
          </ScrollView>
          <View style={styles.drawerFooter}>
            <View style={styles.drawerAvatar}>
              {userName ? <BRText style={styles.drawerAvatarText}>{userName.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase()}</BRText>
                : <Ionicons name="person-outline" size={19} color="#e3c99a" />}
            </View>
            <View style={styles.drawerAccount}>
              <BRText style={styles.drawerAccountTitle}>{userName || 'Personalité Creative'}</BRText>
              <BRText style={styles.drawerAccountSubtitle}>Sistema de gestão</BRText>
            </View>
            <Pressable onPress={() => void logout()} accessibilityLabel="Sair da conta" hitSlop={10}>
              <Ionicons name="log-out-outline" size={23} color="#d8d0c6" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  priceFieldsRow: {
  flexDirection: 'row',
  gap: 12,
},
priceField: {
  flex: 1,
  minWidth: 0,
},
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 36, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 18 },
  menuButton: { width: 43, height: 43, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: '#fff' },
  headerTitle: { flex: 1, minWidth: 0 }, heading: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 27, lineHeight: 37, color: COLORS.text },
  subtitle: { fontSize: 12, color: '#8f8881', lineHeight: 19, marginTop: 4 },
  addButton: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: COLORS.gold, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 11 },
  addText: { color: '#fff', fontSize: 13, lineHeight: 20, fontWeight: '700' }, panel: { padding: 16, borderWidth: 1, borderColor: COLORS.border, borderRadius: 17, backgroundColor: '#fff', marginBottom: 25 },
  inputShell: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#e8e0d4', paddingHorizontal: 12, gap: 8 },
  textInput: { flex: 1, fontSize: 14, color: COLORS.text, paddingVertical: 10, minWidth: 0 },
  searchRow: { flexDirection: 'row', gap: 9, marginTop: 10 }, codeInput: { flex: 1, minHeight: 45, borderWidth: 1, borderColor: '#e8e0d4', borderRadius: 11, paddingHorizontal: 12 },
  searchButton: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: COLORS.dark, paddingHorizontal: 16, borderRadius: 11, minHeight: 45 },
  searchButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 }, toolbar: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
  outlineButton: { paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderColor: '#e8e0d4', borderRadius: 11, flexDirection: 'row', gap: 7, alignItems: 'center' },
  outlineText: { color: COLORS.dark, fontWeight: '600', fontSize: 12 }, iconButton: { marginLeft: 'auto', padding: 11, borderWidth: 1, borderColor: '#e8e0d4', borderRadius: 11 },
  resultsHeader: { gap: 3, marginBottom: 15 }, sectionTitle: { fontWeight: '700', fontSize: 16, color: COLORS.text },
  smallMuted: { color: '#8f8881', fontSize: 11, lineHeight: 16 },
  productCard: { borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'white', padding: 17, marginBottom: 12 },
  productTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, productInfo: { flex: 1, gap: 5 },
  productCode: { fontWeight: '700', fontSize: 13, letterSpacing: 0.6 }, productName: { fontSize: 16, fontWeight: '700', color: COLORS.text, lineHeight: 23 },
  productCategory: { color: COLORS.muted, fontSize: 12 }, status: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#edf7f0', alignSelf: 'flex-start' },
  statusText: { fontSize: 11, lineHeight: 17, color: '#287349', fontWeight: '700' }, statusInactive: { backgroundColor: '#f1efed' }, statusInactiveText: { color: '#827a72' },
  productBottom: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f0ece5', marginTop: 13, paddingTop: 14, gap: 12 },
  valueBox: { flex: 1, gap: 5 }, value: { fontWeight: '700', color: COLORS.text, fontSize: 15 },
  productActions: { flexDirection: 'row', gap: 16, justifyContent: 'flex-end', marginTop: 13 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 3 }, actionText: { fontSize: 12, lineHeight: 19, color: COLORS.gold, fontWeight: '700' },
  message: { alignItems: 'center', gap: 10, padding: 25, backgroundColor: '#fff', borderRadius: 14, marginBottom: 12 }, error: { color: '#b91c1c', fontSize: 13, textAlign: 'center' },
  pagination: { paddingTop: 14, alignItems: 'center', gap: 13 }, paginationButtons: { flexDirection: 'row', gap: 12 },
  pageButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, gap: 4 },
  disabled: { opacity: 0.35 }, modalBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  modalSheet: { height: '88%', backgroundColor: COLORS.background, borderTopLeftRadius: 23, borderTopRightRadius: 23, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  modalContent: { padding: 20, paddingBottom: 40 }, modalFooter: { paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', gap: 11, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.border },
  clearButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, minHeight: 46 },
  applyButton: { flex: 1, backgroundColor: COLORS.gold, borderRadius: 11, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  filterBlock: { marginBottom: 19 }, label: { fontSize: 13, color: COLORS.text, fontWeight: '600', marginBottom: 9 },
  filterInput: { borderWidth: 1, borderColor: '#e8e0d4', backgroundColor: '#fff', borderRadius: 11, minHeight: 47, paddingHorizontal: 13, fontSize: 14, color: COLORS.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: '#f4ead8', borderColor: COLORS.gold }, chipText: { fontSize: 12, color: COLORS.muted }, chipTextActive: { color: '#8c693b', fontWeight: '700' },
  centerBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 23 }, sortPanel: { backgroundColor: '#fff', borderRadius: 18, padding: 20, gap: 8, maxHeight: '90%' },
  sortItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 }, divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  drawerOverlay: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.52)' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: COLORS.dark },
  drawerBrand: { paddingHorizontal: 16, paddingVertical: 20, minHeight: 110, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#ffffff1b' },
  drawerLogo: { width: 60, height: 70 },
  drawerBrandText: { flex: 1 },
  drawerEyebrow: { fontSize: 10, letterSpacing: 2, color: '#d5bd91', fontWeight: '700', lineHeight: 17 },
  drawerTitle: { fontSize: 21, lineHeight: 29, color: '#fff', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  drawerScroll: { flex: 1 },
  drawerScrollContent: { paddingHorizontal: 13, paddingTop: 25, paddingBottom: 35 },
  drawerSection: { paddingHorizontal: 12, color: '#a99e90', letterSpacing: 2, fontSize: 10, lineHeight: 18, fontWeight: '700', marginBottom: 14 },
  drawerSystem: { marginTop: 32 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 47, paddingHorizontal: 15, marginBottom: 3, borderRadius: 11 },
  drawerItemActive: { backgroundColor: '#b99b66' },
  drawerItemText: { fontSize: 14, lineHeight: 22, color: '#d8d0c6', flex: 1 },
  drawerItemTextActive: { color: '#fff', fontWeight: '700' },
  drawerFooter: { borderTopWidth: 1, borderTopColor: '#ffffff1b', paddingHorizontal: 16, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawerAvatar: { width: 39, height: 39, backgroundColor: '#b99b6629', borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  drawerAvatarText: { color: '#e3c99a', fontWeight: '700', fontSize: 13 },
  drawerAccount: { flex: 1 },
  drawerAccountTitle: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 20 },
  drawerAccountSubtitle: { color: '#bcb0a0', fontSize: 11, lineHeight: 17 },

});
