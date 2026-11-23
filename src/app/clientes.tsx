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
type Client = {
  userId: string;
  name: string;
  email: string | null;
  login: string;
  role: string;
  status: string;
  phone: string | null;
  cpf: string | null;
  rg: string | null;
  address: string | null;
  birthDate: string | null;
  createdAt: string;
  updatedAt: string;
};
type PageResponse<T> = {
  content: T[];
  page: number;
  size: number;
  totalElementsThisPage: number;
  totalElements: number;
  totalPages: number;
};
type Filters = {
  name: string; email: string; login: string; phone: string; cpf: string;
  rg: string; address: string; status: string; birthDate: string;
  dateField: string; dateFrom: string; dateTo: string;
};
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onSelect: (value: string) => void } | null;

const C = {
  background: '#f8f6f2', white: '#ffffff', text: '#342d27', muted: '#766d63',
  gold: '#a98a58', border: '#e8e0d4', menu: '#39342f', placeholder: '#a8a29e',
};
const EMPTY: Filters = {
  name: '', email: '', login: '', phone: '', cpf: '', rg: '', address: '',
  status: '', birthDate: '', dateField: '', dateFrom: '', dateTo: '',
};
const SORT: Option[] = [
  { value: 'name', label: 'Nome' }, { value: 'email', label: 'E-mail' },
  { value: 'login', label: 'Login' }, { value: 'createdAt', label: 'Data de cadastro' },
  { value: 'updatedAt', label: 'Última atualização' },
];
const STATUS: Option[] = [
  { value: '', label: 'Todas' }, { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INACTIVE', label: 'Inativo' }, { value: 'BLOCKED', label: 'Bloqueado' },
];
const DATE_FIELDS: Option[] = [
  { value: '', label: 'Selecione' }, { value: 'createdAt', label: 'Data de cadastro' },
  { value: 'updatedAt', label: 'Última atualização' },
  { value: 'birthDate', label: 'Data de nascimento' },
];
const MENU: { label: string; icon: IconName; route?: string }[] = [
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

function visibleEmail(value: string | null): string {
  const email = value?.trim() ?? '';
  if (!email) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@gmail\.com$/i.test(email)) return '';
  return email;
}
function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'Sessão expirada ou inválida. Faça login novamente.';
    if (error.response?.status === 403) return 'Você não possui permissão para consultar clientes.';
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    return `Não foi possível consultar clientes (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Erro inesperado ao carregar clientes.';
}

// Sem numberOfLines, ellipsizeMode, adjustsFontSizeToFit ou flexShrink nos rótulos.
// Permite quebra natural de linhas com altura suficiente para caracteres no Android.
function Field({ label, value, onChange, placeholder, keyboardType = 'default' }: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'email-address' | 'number-pad';
}) {
  return <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput style={s.input} value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor={C.placeholder} keyboardType={keyboardType} autoCapitalize="none" />
  </View>;
}
function Button({ label, icon, onPress, secondary = false, disabled = false }: {
  label: string; icon?: IconName; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    style={[s.button, secondary ? s.secondaryButton : s.primaryButton, disabled && s.disabled]}>
    {icon ? <Ionicons name={icon} size={18} color={secondary ? C.gold : C.white} /> : null}
    <Text style={[s.buttonText, secondary ? s.secondaryButtonText : s.primaryButtonText]}>{label}</Text>
  </Pressable>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <View style={s.detail}>
    <Text style={s.detailLabel}>{label}</Text>
    <Text style={s.detailValue}>{value || '—'}</Text>
  </View>;
}

export default function ClientesScreen() {
  const [draft, setDraft] = useState<Filters>({ ...EMPTY });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY });
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [sortBy, setSortBy] = useState('name');
  const [direction, setDirection] = useState('ASC');
  const [result, setResult] = useState<PageResponse<Client> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [picker, setPicker] = useState<Picker>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeCount = useMemo(() => Object.values(applied).filter(value => value.trim()).length, [applied]);

  const update = (field: keyof Filters, value: string) => setDraft(current => ({ ...current, [field]: value }));
  const choose = (title: string, value: string, options: Option[], onSelect: (selected: string) => void) =>
    setPicker({ title, value, options, onSelect });

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'null' || token === 'undefined') {
        if (!signal.aborted) router.replace('/');
        return;
      }
      const params: Record<string, string | number> = { page, size, sortBy, direction, role: 'CANDIDATE' };
      (Object.keys(applied) as (keyof Filters)[]).forEach(key => {
        const value = applied[key].trim();
        if (value) params[key] = value;
      });
      const { data } = await api.get<PageResponse<Client>>('/users', {
        params, signal, headers: { Authorization: `Bearer ${token}` },
      });
      if (!signal.aborted) setResult(data);
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setResult(null);
      setError(errorText(cause));
      if (axios.isAxiosError(cause) && cause.response?.status === 401) {
        await SecureStore.deleteItemAsync('access_token');
        router.replace('/');
      }
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [applied, page, size, sortBy, direction]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  function apply() {
    if ((draft.dateFrom || draft.dateTo) && !draft.dateField) {
      Alert.alert('Verifique os filtros', 'Selecione qual data deseja filtrar no período.');
      return;
    }
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) {
      Alert.alert('Período inválido', 'A data inicial não pode ser posterior à data final.');
      return;
    }
    setError(null);
    setApplied({ ...draft });
    setPage(0);
  }
  function clear() {
    setDraft({ ...EMPTY }); setApplied({ ...EMPTY }); setPage(0); setError(null);
  }
  function openMenu(label: string, route?: string) {
    setMenuOpen(false);
    if (route) {
      if (route !== '/clientes') router.push(route as never);
      return;
    }
    Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  }
  async function logout() {
    setMenuOpen(false);
    await SecureStore.deleteItemAsync('access_token');
    router.replace('/');
  }
  const selectField = (label: string, value: string, options: Option[], onSelect: (selected: string) => void) =>
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Pressable onPress={() => choose(label, value, options, onSelect)} style={s.select}>
        <Text style={s.selectText}>{options.find(option => option.value === value)?.label ?? 'Selecione'}</Text>
        <Ionicons name="chevron-down-outline" size={18} color={C.gold} />
      </Pressable>
    </View>;
  const pageResult = result?.page ?? page;
  const total = result?.totalElements ?? 0;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.topbar}>
        <Pressable onPress={() => setMenuOpen(true)} style={s.topbarIcon} accessibilityLabel="Abrir menu">
          <Ionicons name="menu-outline" color={C.text} size={27} />
        </Pressable>
        <Text style={s.topbarTitle}>Clientes</Text>
        <Pressable onPress={() => setReloadKey(n => n + 1)} style={s.topbarIcon} accessibilityLabel="Atualizar clientes">
          <Ionicons name="refresh-outline" color={C.gold} size={21} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); setReloadKey(n => n + 1); }}
          colors={[C.gold]} tintColor={C.gold} />}>
        <View style={s.headingBlock}>
          <Text style={s.heading}>Clientes</Text>
          <Button label="Cadastrar cliente" icon="add" onPress={() => router.push('/clientes/novo' as never)} />
        </View>
        <View style={s.panel}>
          <Text style={s.sectionTitle}>Buscar clientes</Text>
          <Field label="Cliente" value={draft.name} onChange={v => update('name', v)} placeholder="Buscar pelo nome..." />
          <Field label="E-mail" value={draft.email} onChange={v => update('email', v)} placeholder="Buscar pelo e-mail..." keyboardType="email-address" />
          <View style={s.actions}>
            <Button label="Buscar" icon="search-outline" onPress={apply} />
            <Button label={advanced ? 'Ocultar filtros' : 'Filtros'} icon="options-outline"
              onPress={() => setAdvanced(current => !current)} secondary />
          </View>
          {advanced && <View style={s.advanced}>
            <Text style={s.sectionTitle}>Filtros avançados</Text>
            <Field label="Login" value={draft.login} onChange={v => update('login', v)} placeholder="Login" />
            <Field label="Telefone" value={draft.phone} onChange={v => update('phone', v)} placeholder="Telefone" keyboardType="number-pad" />
            <Field label="CPF" value={draft.cpf} onChange={v => update('cpf', v)} placeholder="CPF" keyboardType="number-pad" />
            <Field label="RG" value={draft.rg} onChange={v => update('rg', v)} placeholder="RG" />
            <Field label="Endereço" value={draft.address} onChange={v => update('address', v)} placeholder="Endereço" />
            {selectField('Situação', draft.status, STATUS, v => update('status', v))}
            <Field label="Data exata de nascimento (AAAA-MM-DD)" value={draft.birthDate}
              onChange={v => update('birthDate', v)} placeholder="2000-01-31" />
            <View style={s.period}>
              <Text style={s.periodTitle}>Filtrar por período</Text>
              <Text style={s.helper}>Escolha uma data e informe o início e/ou fim do período.</Text>
              {selectField('Qual data?', draft.dateField, DATE_FIELDS, v => update('dateField', v))}
              <Field label="De (AAAA-MM-DD)" value={draft.dateFrom} onChange={v => update('dateFrom', v)} placeholder="2026-01-01" />
              <Field label="Até (AAAA-MM-DD)" value={draft.dateTo} onChange={v => update('dateTo', v)} placeholder="2026-12-31" />
            </View>
            <View style={s.actions}>
              <Button label={`Limpar filtros${activeCount ? ` (${activeCount})` : ''}`} secondary icon="close-outline" onPress={clear} />
              <Button label="Aplicar filtros" icon="search-outline" onPress={apply} />
            </View>
          </View>}
        </View>
        <View style={s.panel}>
          <Text style={s.sectionTitle}>Clientes cadastrados</Text>
          <Text style={s.helper}>{loading ? 'Carregando...' : `${total} cliente(s) encontrado(s)`}{activeCount ? ` · ${activeCount} filtro(s) aplicado(s)` : ''}</Text>
          {selectField('Ordenar por', sortBy, SORT, v => { setSortBy(v); setPage(0); })}
          <View style={s.twoColumns}>
            <View style={s.column}>{selectField('Direção', direction, [
              { value: 'ASC', label: 'Crescente' }, { value: 'DESC', label: 'Decrescente' },
            ], v => { setDirection(v); setPage(0); })}</View>
            <View style={s.column}>{selectField('Por página', String(size), [10, 20, 50, 100].map(value => ({ value: String(value), label: String(value) })),
              v => { setSize(Number(v)); setPage(0); })}</View>
          </View>
          {loading ? <View style={s.feedback}><ActivityIndicator size="large" color={C.gold} /><Text style={s.helper}>Carregando clientes...</Text></View>
            : error ? <View style={s.feedback}><Text style={s.error}>{error}</Text><Button label="Tentar novamente" secondary onPress={() => setReloadKey(n => n + 1)} /></View>
            : !result?.content?.length ? <View style={s.feedback}>
              <Ionicons name="people-outline" size={38} color={C.gold} />
              <Text style={s.empty}>Nenhum cliente encontrado.</Text>
              <Text style={s.helper}>Ajuste os filtros para consultar outros clientes.</Text>
            </View>
            : result.content.map((client, index) => <View key={client.userId} style={[s.clientCard, index % 2 === 1 && s.alternateCard]}>
              <Text style={s.clientName} onPress={() => router.push(`/clientes/${client.userId}` as never)}>{client.name}</Text>
              {Boolean(visibleEmail(client.email)) && <Detail label="E-mail" value={visibleEmail(client.email)} />}
              {Boolean(client.cpf?.trim()) && <Detail label="CPF" value={client.cpf!.trim()} />}
              <View style={s.cardActions}>
                <Button label="Visualizar" icon="eye-outline" secondary onPress={() => router.push(`/clientes/${client.userId}` as never)} />
                <Button label="Editar" icon="pencil-outline" secondary onPress={() => router.push(`/clientes/${client.userId}/editar` as never)} />
              </View>
            </View>)}
          {!loading && !error && result && <View style={s.pagination}>
            <Text style={s.helper}>Exibindo {result.totalElementsThisPage} de {total} cliente(s) · Página {pageResult + 1} de {Math.max(result.totalPages, 1)}</Text>
            <View style={s.actions}>
              <Button label="Anterior" icon="chevron-back-outline" secondary disabled={pageResult <= 0} onPress={() => setPage(p => Math.max(0, p - 1))} />
              <Button label="Próxima" icon="chevron-forward-outline" secondary disabled={pageResult + 1 >= result.totalPages} onPress={() => setPage(p => p + 1)} />
            </View>
          </View>}
        </View>
        <Text style={s.footer}>Personalité Creative · Sistema de gestão</Text>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} accessibilityLabel="Fechar seleção" />
        <View style={s.modalCard}>
          <View style={s.modalHead}>
            <Text style={s.modalTitle}>{picker?.title}</Text>
            <Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={C.text} /></Pressable>
          </View>
          <ScrollView style={s.modalList} keyboardShouldPersistTaps="handled">
            {picker?.options.map(option => <Pressable key={option.value} style={s.option}
              onPress={() => { picker.onSelect(option.value); setPicker(null); }}>
              <Text style={s.optionText}>{option.label}</Text>
              {option.value === picker.value && <Ionicons name="checkmark" size={20} color={C.gold} />}
            </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>

    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={s.menuOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" />
        <SafeAreaView style={s.drawer} edges={['top', 'bottom']}>
          <View style={s.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} resizeMode="contain" style={s.logo} />
            <View style={s.brandText}><Text style={s.brandEyebrow}>PERSONALITÉ</Text><Text style={s.brandTitle}>Creative</Text></View>
            <Pressable onPress={() => setMenuOpen(false)}><Ionicons name="close" size={24} color={C.white} /></Pressable>
          </View>
          <ScrollView style={s.drawerScroll} contentContainerStyle={s.drawerContent}>
            <Text style={s.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} onPress={() => openMenu(item.label, item.route)}
              style={[s.drawerItem, item.route === '/clientes' && s.drawerActive]}>
              <Ionicons name={item.icon} size={20} color="#eee7db" />
              <Text style={s.drawerItemText}>{item.label}</Text>
            </Pressable>)}
            <Text style={s.drawerSection}>SISTEMA</Text>
            <Pressable style={s.drawerItem} onPress={() => openMenu('Meu Perfil')}>
              <Ionicons name="settings-outline" size={20} color="#eee7db" />
              <Text style={s.drawerItemText}>Meu Perfil</Text>
            </Pressable>
          </ScrollView>
          <Pressable style={s.drawerLogout} onPress={() => void logout()}>
            <Ionicons name="log-out-outline" size={20} color="#eee7db" />
            <Text style={s.drawerItemText}>Sair</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: C.background },
  topbar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  topbarIcon: { height: 44, width: 40, alignItems: 'center', justifyContent: 'center' },
  topbarTitle: { flex: 1, color: C.text, fontSize: 21, lineHeight: 32, fontWeight: '700', includeFontPadding: true },
  content: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 40 },
  headingBlock: { gap: 14, marginBottom: 20, alignItems: 'flex-start' },
  heading: { color: C.text, fontSize: 28, lineHeight: 40, fontWeight: '700', includeFontPadding: true },
  panel: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 17 },
  sectionTitle: { fontSize: 18, lineHeight: 29, color: C.text, fontWeight: '700', marginBottom: 13, includeFontPadding: true },
  helper: { color: C.muted, fontSize: 12, lineHeight: 22, includeFontPadding: true, marginBottom: 8 },
  field: { marginBottom: 14, minWidth: 0 },
  fieldLabel: { fontSize: 13, lineHeight: 23, fontWeight: '600', color: C.text, marginBottom: 7, includeFontPadding: true },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 9, fontSize: 14, color: C.text, includeFontPadding: true },
  select: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderColor: C.border, borderRadius: 11 },
  selectText: { flex: 1, fontSize: 13, lineHeight: 22, color: C.text, includeFontPadding: true },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 9 },
  button: { minHeight: 46, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButton: { backgroundColor: C.gold },
  secondaryButton: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border },
  buttonText: { fontSize: 13, lineHeight: 23, fontWeight: '700', includeFontPadding: true },
  primaryButtonText: { color: C.white },
  secondaryButtonText: { color: '#80623d' },
  disabled: { opacity: 0.4 },
  advanced: { borderTopWidth: 1, borderTopColor: C.border, marginTop: 18, paddingTop: 17 },
  period: { backgroundColor: '#fdfbf8', borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, marginBottom: 13 },
  periodTitle: { color: C.text, fontSize: 14, lineHeight: 24, fontWeight: '700', marginBottom: 5, includeFontPadding: true },
  twoColumns: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  feedback: { alignItems: 'center', paddingVertical: 28, gap: 12 },
  error: { color: '#b91c1c', fontSize: 13, lineHeight: 23, textAlign: 'center', includeFontPadding: true },
  empty: { color: C.muted, fontSize: 14, lineHeight: 24, textAlign: 'center', includeFontPadding: true },
  clientCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 15, marginTop: 12, gap: 9 },
  alternateCard: { backgroundColor: '#eee9e2' },
  clientName: { color: C.text, fontSize: 17, lineHeight: 29, fontWeight: '700', includeFontPadding: true },
  detail: { gap: 3 },
  detailLabel: { color: C.muted, fontSize: 11, lineHeight: 19, includeFontPadding: true },
  detailValue: { color: C.text, fontSize: 14, lineHeight: 24, includeFontPadding: true },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 10 },
  pagination: { marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderTopColor: C.border, gap: 10 },
  footer: { fontSize: 12, lineHeight: 21, color: C.muted, textAlign: 'center', paddingTop: 13, includeFontPadding: true },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 20 },
  modalCard: { backgroundColor: C.white, padding: 18, borderRadius: 17, maxHeight: '78%' },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { flex: 1, color: C.text, fontSize: 18, lineHeight: 29, fontWeight: '700', includeFontPadding: true },
  modalList: { flexGrow: 0 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  optionText: { flex: 1, fontSize: 14, lineHeight: 24, color: C.text, includeFontPadding: true },
  menuOverlay: { flex: 1, flexDirection: 'row', backgroundColor: '#0008' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: C.menu },
  drawerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 19, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  logo: { width: 56, height: 65 }, brandText: { flex: 1 },
  brandEyebrow: { color: '#d5bd91', fontSize: 10, lineHeight: 18, fontWeight: '700', letterSpacing: 2 },
  brandTitle: { color: C.white, fontSize: 21, lineHeight: 30, fontFamily: 'serif' },
  drawerScroll: { flex: 1 }, drawerContent: { paddingHorizontal: 13, paddingTop: 23, paddingBottom: 28 },
  drawerSection: { color: '#b1a698', fontSize: 10, lineHeight: 19, fontWeight: '700', letterSpacing: 1.7, marginBottom: 14, marginTop: 16 },
  drawerItem: { minHeight: 49, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, marginBottom: 4 },
  drawerActive: { backgroundColor: '#665949' },
  drawerItemText: { flex: 1, color: '#eee7db', fontSize: 14, lineHeight: 23, fontWeight: '600', includeFontPadding: true },
  drawerLogout: { paddingHorizontal: 27, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#ffffff22', flexDirection: 'row', alignItems: 'center', gap: 12 },
});
