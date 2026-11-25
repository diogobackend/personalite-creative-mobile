import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal,
  Text as NativeText,
  Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type CategoryType = 'PRODUCT' | 'INVENTORY' | 'EXPENSE';
type Category = { id: string; name: string; type: CategoryType; createdAt?: string; updatedAt?: string };
type CategoryResponse = Category[] | { content: Category[] };
type IconName = ComponentProps<typeof Ionicons>['name'];

const PALETTE = {
  background: '#f8f6f2', dark: '#342d27', muted: '#766d63', gold: '#a98a58',
  border: '#e8e0d4', white: '#ffffff', danger: '#b4534d',
};
const GROUPS: { type: CategoryType; title: string; icon: IconName; tint: string; border: string; header: string }[] = [
  { type: 'PRODUCT', title: 'Produtos', icon: 'cube-outline', tint: '#eff6ff', border: '#bfdbfe', header: '#dbeafe' },
  { type: 'INVENTORY', title: 'Estoque', icon: 'layers-outline', tint: '#f0fdf4', border: '#bbf7d0', header: '#dcfce7' },
  { type: 'EXPENSE', title: 'Despesas', icon: 'receipt-outline', tint: '#fffbeb', border: '#fde68a', header: '#fef3c7' },
];
const LABELS: Record<CategoryType, string> = { PRODUCT: 'Produtos', INVENTORY: 'Estoque', EXPENSE: 'Despesas' };
const MENU_ITEMS: { label: string; icon: IconName; url?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' | '/estoque' | '/despesas' | '/relatorios' }[] = [
  { label: 'Visão geral', icon: 'grid-outline', url: '/home' },
  { label: 'Produtos', icon: 'cube-outline', url: '/produtos' },
  { label: 'Categorias', icon: 'pricetags-outline', url: '/categorias' },
  { label: 'Vendas', icon: 'bag-handle-outline', url: '/vendas' },
  { label: 'Histórico Financeiro', icon: 'card-outline', url: '/movimentacoes' },
  { label: 'Clientes', icon: 'people-outline', url: '/clientes' },
  { label: 'Estoque', icon: 'layers-outline', url: '/estoque' },
  { label: 'Despesas', icon: 'wallet-outline', url: '/despesas' },
  { label: 'Relatórios', icon: 'stats-chart-outline', url: '/relatorios' },
];

function errorMessage(error: unknown, action: string): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não tem permissão para gerenciar categorias.';
    if (error.response.status === 409) return 'Já existe uma categoria com esse nome nesse tipo.';
    const message: unknown = error.response.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    return `Não foi possível ${action} (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : `Não foi possível ${action}.`;
}

async function authHeaders() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token || token === 'undefined' || token === 'null') throw new Error('Sessão inválida. Faça login novamente.');
  return { Authorization: `Bearer ${token}` };
}

// Reserva caracteres extras no fim para evitar o corte de glifos no Android.
// Mantém todas as palavras, rotas e interações da tela original.
function SafeText({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  return (
    <NativeText {...props} style={[styles.safeText, style]}>
      {children}{'\u00A0\u00A0\u00A0'}
    </NativeText>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <SafeText style={styles.label}>{children}</SafeText>;
}

export default function CategoriasScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('PRODUCT');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<CategoryType | 'ALL'>('ALL');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [viewTarget, setViewTarget] = useState<Category | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadCategories = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const headers = await authHeaders();
      if (signal.aborted) return;
      const { data } = await api.get<CategoryResponse>('/categories', { headers, signal });
      const items = Array.isArray(data) ? data : data?.content;
      if (!Array.isArray(items)) throw new Error('Formato inesperado da listagem de categorias.');
      if (!signal.aborted) setCategories(items);
    } catch (error) {
      if (signal.aborted || axios.isCancel(error)) return;
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        await SecureStore.deleteItemAsync('access_token');
        router.replace('/');
      }
      if (!signal.aborted) setLoadError(errorMessage(error, 'listar categorias'));
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCategories(controller.signal);
    return () => controller.abort();
  }, [loadCategories, reloadKey]);

  const codes = useMemo(() => {
    const ordered = categories.filter(category => category.type === 'PRODUCT')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return new Map(ordered.map((category, index) => [category.id, String(index + 1).padStart(2, '0')]));
  }, [categories]);

  const filtered = useMemo(() => categories.filter(category =>
    category.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')) &&
    (filterType === 'ALL' || category.type === filterType)
  ), [categories, search, filterType]);

  async function createCategory() {
    if (saving) return;
    const normalized = name.trim();
    if (!normalized) return Alert.alert('Verifique os dados', 'Informe o nome da categoria.');
    if (normalized.length > 150) return Alert.alert('Verifique os dados', 'O nome deve ter no máximo 150 caracteres.');
    setSaving(true);
    try {
      const headers = await authHeaders();
      const { data } = await api.post<Category>('/categories', { name: normalized, type }, { headers });
      setCategories(previous => [...previous.filter(item => item.id !== data.id), data]);
      setName('');
      Alert.alert('Sucesso', 'Categoria cadastrada com sucesso.');
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'cadastrar categoria'));
    } finally { setSaving(false); }
  }

  function startEditing(category: Category) {
    setEditingId(category.id);
    setEditName(category.name);
  }

  async function updateCategory(category: Category) {
    if (busyId) return;
    const normalized = editName.trim();
    if (!normalized || normalized.length > 150) return Alert.alert('Verifique os dados', 'Informe um nome com até 150 caracteres.');
    if (normalized === category.name) { setEditingId(null); return; }
    setBusyId(category.id);
    try {
      const headers = await authHeaders();
      const { data } = await api.patch<Category>(`/categories/${encodeURIComponent(category.id)}`, { name: normalized }, { headers });
      setCategories(previous => previous.map(item => item.id === category.id ? data : item));
      setEditingId(null);
      Alert.alert('Sucesso', 'Categoria atualizada com sucesso.');
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'atualizar categoria'));
    } finally { setBusyId(null); }
  }

  async function deleteCategory() {
    if (!deleteTarget || busyId) return;
    const target = deleteTarget;
    setBusyId(target.id);
    try {
      const headers = await authHeaders();
      await api.delete(`/categories/${encodeURIComponent(target.id)}`, { headers });
      setCategories(previous => previous.filter(item => item.id !== target.id));
      if (editingId === target.id) setEditingId(null);
      setDeleteTarget(null);
      Alert.alert('Sucesso', 'Categoria excluída com sucesso.');
    } catch (error) {
      setDeleteTarget(null);
      Alert.alert('Erro', errorMessage(error, 'excluir categoria'));
    } finally { setBusyId(null); }
  }

  async function logout() {
    setMenuOpen(false);
    await SecureStore.deleteItemAsync('access_token');
    router.replace('/');
  }

  function navigateMenu(label: string, url?: '/home' | '/produtos' | '/categorias' | '/vendas' | '/movimentacoes' | '/clientes' | '/estoque' | '/despesas' | '/relatorios' | '/perfil') {
    setMenuOpen(false);
    if (url) {
      if (url !== '/categorias') router.push(url);
      return;
    }
    Alert.alert(label, 'Esta seção ainda não foi implementada no aplicativo mobile.');
  }

  const renderTypeChoice = (value: CategoryType | 'ALL', label: string, selected: boolean, onPress: () => void) => (
    <Pressable key={value} onPress={onPress} style={[styles.typeChip, selected && styles.typeChipSelected]}>
      <SafeText style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>{label}</SafeText>
    </Pressable>
  );

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.topbar}>
        <Pressable accessibilityLabel="Abrir menu" onPress={() => setMenuOpen(true)} style={styles.menuButton}>
          <Ionicons name="menu-outline" size={27} color={PALETTE.dark} />
        </Pressable>
        <SafeText style={styles.topbarTitle}>Categorias</SafeText>
        <Pressable accessibilityLabel="Atualizar categorias" onPress={() => setReloadKey(n => n + 1)} style={styles.menuButton}>
          <Ionicons name="refresh-outline" size={21} color={PALETTE.gold} />
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey(n => n + 1); }} colors={[PALETTE.gold]} tintColor={PALETTE.gold} />}
      >
        <SafeText style={styles.heading}>Gerenciar categorias</SafeText>
        <SafeText style={styles.subtitle}>Cadastre, consulte, edite e exclua categorias nesta página.</SafeText>

        <View style={styles.formCard}>
          <View style={styles.sectionHeading}>
            <Ionicons name="add-circle-outline" color={PALETTE.gold} size={23} />
            <SafeText style={styles.sectionTitle}>Nova categoria</SafeText>
          </View>
          <Label>Nome</Label>
          <TextInput style={styles.input} placeholder="Ex.: Gourmet" placeholderTextColor="#a8a29e"
            value={name} onChangeText={setName} maxLength={150} returnKeyType="done" onSubmitEditing={() => void createCategory()} />
          <Label>Tipo</Label>
          <View style={styles.chipRow}>
            {GROUPS.map(group => renderTypeChoice(group.type, group.title, type === group.type, () => setType(group.type)))}
          </View>
          <Pressable disabled={saving} style={[styles.primaryButton, saving && styles.disabled]} onPress={() => void createCategory()}>
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="add" color="#fff" size={21} />}
            <SafeText style={styles.primaryButtonText}>{saving ? 'Cadastrando...' : 'Cadastrar categoria'}</SafeText>
          </Pressable>
        </View>

        <View style={styles.searchCard}>
          <View style={styles.searchInputRow}>
            <Ionicons name="search-outline" color={PALETTE.gold} size={20} />
            <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Buscar categoria pelo nome..." placeholderTextColor="#a8a29e" />
            {!!search && <Pressable onPress={() => setSearch('')} accessibilityLabel="Limpar busca"><Ionicons name="close-circle" size={19} color={PALETTE.muted} /></Pressable>}
          </View>
          <Label>Filtrar por tipo</Label>
          <View style={styles.chipRow}>
            {renderTypeChoice('ALL', 'Todos', filterType === 'ALL', () => { setFilterType('ALL'); setSearch(''); })}
            {GROUPS.map(group => renderTypeChoice(group.type, group.title, filterType === group.type, () => { setFilterType(group.type); setSearch(''); }))}
          </View>
        </View>

        {loadError && <View style={styles.errorCard}>
          <SafeText style={styles.errorText}>{loadError}</SafeText>
          <Pressable onPress={() => setReloadKey(n => n + 1)}><SafeText style={styles.linkText}>Tentar novamente</SafeText></Pressable>
        </View>}

        {GROUPS.filter(group => filterType === 'ALL' || filterType === group.type).map(group => {
          const items = filtered.filter(category => category.type === group.type)
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
          return <View key={group.type} style={[styles.groupCard, { borderColor: group.border, backgroundColor: group.tint }]}>
            <View style={[styles.groupHeader, { backgroundColor: group.header, borderBottomColor: group.border }]}>
              <View style={styles.groupHeadingLeft}>
                <Ionicons name={group.icon} size={22} color={PALETTE.dark} />
                <SafeText style={styles.groupTitle}>{group.title}</SafeText>
              </View>
              <View style={styles.countBadge}><SafeText style={styles.countText}>{loading || loadError ? '—' : String(items.length)}</SafeText></View>
            </View>
            {loading ? <View style={styles.emptyState}><ActivityIndicator color={PALETTE.gold} /></View> :
              loadError ? <SafeText style={styles.emptyText}>Listagem indisponível.</SafeText> :
              items.length === 0 ? <SafeText style={styles.emptyText}>{search || filterType !== 'ALL' ? 'Nenhuma categoria encontrada.' : 'Nenhuma categoria cadastrada neste grupo.'}</SafeText> :
              items.map(category => {
                const editing = editingId === category.id;
                const busy = busyId === category.id;
                return <View key={category.id} style={styles.categoryRow}>
                  {editing ? <View style={styles.editBlock}>
                    <TextInput autoFocus editable={!busy} style={styles.input} value={editName} onChangeText={setEditName} maxLength={150} onSubmitEditing={() => void updateCategory(category)} returnKeyType="done" />
                    <View style={styles.editActions}>
                      <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => setEditingId(null)}>
                        <SafeText style={styles.secondaryText}>Cancelar</SafeText>
                      </Pressable>
                      <Pressable disabled={busy} style={[styles.smallPrimary, busy && styles.disabled]} onPress={() => void updateCategory(category)}>
                        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark" size={18} color="#fff" />}
                        <SafeText style={styles.smallPrimaryText}>Salvar</SafeText>
                      </Pressable>
                    </View>
                  </View> : <View style={styles.categoryHeader}>
                    <View style={styles.categoryNameRow}>
                      <SafeText style={styles.categoryName}>{category.name}</SafeText>
                      {category.type === 'PRODUCT' && (
                        <View style={styles.codeBadge} accessibilityLabel={`Código ${codes.get(category.id) ?? '—'}`}>
                          {(codes.get(category.id) ?? '—').split('').map((digit, index) => (
                            <NativeText key={`${category.id}-${index}`} style={styles.codeDigit} allowFontScaling={false}>
                              {digit}
                            </NativeText>
                          ))}
                        </View>
                      )}
                    </View>
                    <View style={styles.actionRow}>
                      <Pressable accessibilityLabel={`Visualizar ${category.name}`} style={styles.iconAction} onPress={() => setViewTarget(category)}>
                        <Ionicons name="eye-outline" size={21} color={PALETTE.gold} />
                      </Pressable>
                      <Pressable accessibilityLabel={`Editar ${category.name}`} style={styles.iconAction} onPress={() => startEditing(category)}>
                        <Ionicons name="pencil-outline" size={19} color={PALETTE.gold} />
                      </Pressable>
                      <Pressable accessibilityLabel={`Excluir ${category.name}`} style={styles.iconAction} onPress={() => setDeleteTarget(category)}>
                        <Ionicons name="trash-outline" size={19} color={PALETTE.danger} />
                      </Pressable>
                    </View>
                  </View>}
                </View>;
              })}
          </View>;
        })}
        <SafeText style={styles.footer}>Personalité Creative · Sistema de gestão</SafeText>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal transparent animationType="fade" visible={deleteTarget !== null} onRequestClose={() => {
            if (!busyId) {
                setDeleteTarget(null);
            }
            }}>
      <View style={styles.modalBackdrop}><View style={styles.modalCard}>
        <View style={styles.modalTitleRow}><SafeText style={styles.modalTitle}>Excluir categoria?</SafeText>
          <Pressable disabled={!!busyId} onPress={() => setDeleteTarget(null)} accessibilityLabel="Fechar"><Ionicons name="close" size={24} color={PALETTE.dark} /></Pressable></View>
        <SafeText style={styles.modalDescription}>Deseja excluir {deleteTarget?.name}? Essa ação não poderá ser desfeita.</SafeText>
        <View style={styles.modalActions}>
          <Pressable disabled={!!busyId} style={styles.secondaryButton} onPress={() => setDeleteTarget(null)}><SafeText style={styles.secondaryText}>Cancelar</SafeText></Pressable>
          <Pressable disabled={!!busyId} style={[styles.deleteButton, !!busyId && styles.disabled]} onPress={() => void deleteCategory()}>
            {busyId ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash-outline" size={18} color="#fff" />}
            <SafeText style={styles.deleteButtonText}>Excluir</SafeText>
          </Pressable>
        </View>
      </View></View>
    </Modal>

    <Modal transparent animationType="fade" visible={viewTarget !== null} onRequestClose={() => setViewTarget(null)}>
      <View style={styles.modalBackdrop}><View style={styles.modalCard}>
        <View style={styles.modalTitleRow}><SafeText style={styles.modalTitle}>Detalhes da categoria</SafeText>
          <Pressable onPress={() => setViewTarget(null)} accessibilityLabel="Fechar"><Ionicons name="close" size={24} color={PALETTE.dark} /></Pressable></View>
        <SafeText style={styles.detailLabel}>Nome</SafeText><SafeText style={styles.detailValue}>{viewTarget?.name}</SafeText>
        <SafeText style={styles.detailLabel}>Tipo</SafeText><SafeText style={styles.detailValue}>{viewTarget ? LABELS[viewTarget.type] : ''}</SafeText>
        {viewTarget?.createdAt ? <><SafeText style={styles.detailLabel}>Cadastrada em</SafeText><SafeText style={styles.detailValue}>{new Date(viewTarget.createdAt).toLocaleString('pt-BR')}</SafeText></> : null}
        {viewTarget?.updatedAt ? <><SafeText style={styles.detailLabel}>Atualizada em</SafeText><SafeText style={styles.detailValue}>{new Date(viewTarget.updatedAt).toLocaleString('pt-BR')}</SafeText></> : null}
        <Pressable style={styles.primaryButton} onPress={() => setViewTarget(null)}><SafeText style={styles.primaryButtonText}>Fechar</SafeText></Pressable>
      </View></View>
    </Modal>

    <Modal transparent animationType="fade" visible={menuOpen} onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
      <View style={styles.drawerBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu" />
        <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
          <View style={styles.drawerHeading}>
            <Image source={require('../../assets/images/personalite-logo.png')} resizeMode="contain" style={styles.drawerLogo} />
            <View style={styles.drawerBrandText}>
              <SafeText style={styles.drawerEyebrow}>PERSONALITÉ</SafeText>
              <SafeText style={styles.drawerTitle}>Creative</SafeText>
            </View>
            <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Fechar menu">
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerScrollContent}>
            <SafeText style={styles.drawerSection}>MENU PRINCIPAL</SafeText>
            {MENU_ITEMS.map(item => (
              <Pressable
                key={item.label}
                style={[styles.drawerItem, item.url === '/categorias' && styles.drawerActive]}
                onPress={() => navigateMenu(item.label, item.url)}
                accessibilityRole="button"
              >
                <Ionicons name={item.icon} size={20} color={item.url === '/categorias' ? '#fff' : '#d8d0c6'} />
                <SafeText style={[styles.drawerItemText, item.url === '/categorias' && styles.drawerItemSelected]}>{item.label}</SafeText>
              </Pressable>
            ))}
            <SafeText style={[styles.drawerSection, { marginTop: 14 }]}>SISTEMA</SafeText>
            <Pressable style={styles.drawerItem} onPress={() => navigateMenu('Meu Perfil', '/perfil')}>
              <Ionicons name="settings-outline" size={20} color="#d8d0c6" />
              <SafeText style={styles.drawerItemText}>Meu Perfil</SafeText>
            </Pressable>
            <View style={styles.drawerFooter}>
              <SafeText style={styles.drawerFooterText}>Personalité Creative</SafeText>
              <Pressable onPress={() => void logout()} accessibilityLabel="Sair da conta" style={styles.logoutAction}>
                <Ionicons name="log-out-outline" color="#d8d0c6" size={23} />
                <SafeText style={styles.drawerLogoutText}>Sair</SafeText>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeText: { includeFontPadding: true },
  safe: { flex: 1, backgroundColor: PALETTE.background },
  topbar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: PALETTE.border, gap: 12 },
  menuButton: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  topbarTitle: { flex: 1, fontSize: 19, lineHeight: 29, fontWeight: '700', color: PALETTE.dark, includeFontPadding: true },
  content: { padding: 16, paddingBottom: 42 },
  heading: { fontSize: 27, lineHeight: 39, color: PALETTE.dark, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'sans-serif', includeFontPadding: true },
  subtitle: { fontSize: 13, lineHeight: 21, color: PALETTE.muted, marginTop: 4, marginBottom: 20, includeFontPadding: true },
  formCard: { backgroundColor: '#fff', borderRadius: 17, padding: 17, borderWidth: 1, borderColor: PALETTE.border, marginBottom: 16 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 18 },
  sectionTitle: { flex: 1, fontSize: 18, lineHeight: 28, fontWeight: '700', color: PALETTE.dark, includeFontPadding: true },
  label: { fontSize: 14, lineHeight: 23, fontWeight: '600', color: PALETTE.dark, marginBottom: 7, marginTop: 5, includeFontPadding: true },
  input: { width: '100%', minHeight: 50, borderWidth: 1, borderColor: PALETTE.border, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#fff', fontSize: 15, color: PALETTE.dark, includeFontPadding: true, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 9, marginBottom: 12, alignItems: 'flex-start' },
  typeChip: { width: '47%', borderRadius: 9, borderWidth: 1, borderColor: PALETTE.border, backgroundColor: '#fff', minHeight: 43, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 9 },
  typeChipSelected: { borderColor: PALETTE.gold, backgroundColor: '#f4ead8' },
  typeChipText: { fontSize: 13, lineHeight: 22, color: PALETTE.muted, includeFontPadding: true, textAlign: 'center', paddingHorizontal: 7 },
  typeChipTextSelected: { color: '#846335', fontWeight: '700' },
  primaryButton: { backgroundColor: PALETTE.gold, minHeight: 49, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 11, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 14, lineHeight: 24, fontWeight: '700', includeFontPadding: true, textAlign: 'center' },
  disabled: { opacity: 0.55 },
  searchCard: { backgroundColor: '#fff', borderRadius: 15, padding: 14, borderWidth: 1, borderColor: PALETTE.border, marginBottom: 17 },
  searchInputRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: PALETTE.border, borderRadius: 11, paddingHorizontal: 12, minHeight: 49, marginBottom: 12 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 14, color: PALETTE.dark, includeFontPadding: true },
  errorCard: { borderRadius: 12, padding: 17, backgroundColor: '#fff2f2', borderColor: '#fecaca', borderWidth: 1, marginBottom: 15 },
  errorText: { fontSize: 13, lineHeight: 21, color: '#991b1b', includeFontPadding: true },
  linkText: { color: PALETTE.gold, fontWeight: '700', marginTop: 9, fontSize: 13, lineHeight: 22 },
  groupCard: { borderWidth: 2, borderRadius: 17, overflow: 'hidden', marginBottom: 17 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, padding: 15, gap: 10 },
  groupHeadingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, paddingRight: 8 },
  groupTitle: { flexShrink: 1, fontSize: 18, lineHeight: 29, fontWeight: '700', color: PALETTE.dark, includeFontPadding: true, paddingRight: 12 },
  countBadge: { minWidth: 44, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f4ede2', alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, lineHeight: 20, fontWeight: '700', color: '#846335', paddingRight: 5 },
  categoryRow: { backgroundColor: '#fff', marginHorizontal: 9, marginVertical: 5, borderRadius: 11, borderWidth: 1, borderColor: '#eee8df', padding: 13 },
  categoryHeader: { gap: 11 },
  categoryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%' },
  categoryName: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 27, fontWeight: '600', color: PALETTE.dark, includeFontPadding: true, paddingRight: 12 },
  codeBadge: { borderRadius: 6, backgroundColor: '#f4ede2', width: 48, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  codeDigit: { width: 17, fontSize: 12, lineHeight: 20, fontWeight: '700', color: '#846335', textAlign: 'center', includeFontPadding: true, fontVariant: ['tabular-nums'] },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 11 },
  iconAction: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#faf8f5', borderWidth: 1, borderColor: PALETTE.border },
  editBlock: { gap: 8 },
  editActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  secondaryButton: { paddingHorizontal: 15, minHeight: 43, borderRadius: 10, borderWidth: 1, borderColor: PALETTE.border, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  secondaryText: { fontSize: 13, lineHeight: 22, fontWeight: '600', color: PALETTE.dark, includeFontPadding: true },
  smallPrimary: { backgroundColor: PALETTE.gold, paddingHorizontal: 15, minHeight: 43, borderRadius: 10, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' },
  smallPrimaryText: { fontSize: 13, lineHeight: 22, fontWeight: '700', color: '#fff', includeFontPadding: true },
  emptyState: { padding: 25, alignItems: 'center' },
  emptyText: { fontSize: 13, lineHeight: 21, color: PALETTE.muted, textAlign: 'center', padding: 20, includeFontPadding: true },
  footer: { fontSize: 12, lineHeight: 20, textAlign: 'center', color: PALETTE.muted, marginTop: 14 },
  modalBackdrop: { flex: 1, backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalCard: { backgroundColor: '#fff', borderRadius: 17, padding: 20, width: '100%', maxWidth: 440 },
  modalTitleRow: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 21, lineHeight: 30, color: PALETTE.dark, fontWeight: '700', flex: 1, includeFontPadding: true },
  modalDescription: { fontSize: 14, lineHeight: 24, color: PALETTE.muted, marginBottom: 17, includeFontPadding: true },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  deleteButton: { backgroundColor: '#b91c1c', minHeight: 43, paddingHorizontal: 15, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  deleteButtonText: { color: '#fff', fontWeight: '700', fontSize: 13, lineHeight: 22, includeFontPadding: true },
  detailLabel: { color: PALETTE.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
  detailValue: { color: PALETTE.dark, fontSize: 15, lineHeight: 24, fontWeight: '600', includeFontPadding: true },
  drawerBackdrop: { flex: 1, backgroundColor: '#0008', flexDirection: 'row' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: '#39342f' },
  drawerHeading: { flexDirection: 'row', gap: 11, alignItems: 'center', paddingHorizontal: 17, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ffffff1b' },
  drawerTitle: { color: '#fff', fontSize: 21, lineHeight: 29, fontFamily: 'serif' },
  drawerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, minHeight: 43, borderRadius: 11, marginBottom: 2 },
  drawerActive: { backgroundColor: '#b99b66' },
  drawerItemText: { flex: 1, minWidth: 0, color: '#d8d0c6', fontSize: 14, lineHeight: 24, includeFontPadding: true, paddingRight: 18 },
  drawerLogo: { width: 48, height: 55 },
  drawerBrandText: { flex: 1 },
  drawerEyebrow: { color: '#d5bd91', fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  drawerScroll: { flex: 1 },
  drawerScrollContent: { paddingHorizontal: 13, paddingTop: 13, paddingBottom: 20, flexGrow: 1 },
  drawerSection: { paddingHorizontal: 12, color: '#a99e90', letterSpacing: 2, fontSize: 10, fontWeight: '700', marginBottom: 14, lineHeight: 19 },
  drawerItemSelected: { color: '#fff', fontWeight: '700' },
  drawerFooter: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#ffffff1b', paddingHorizontal: 9, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  drawerFooterText: { color: '#d8d0c6', fontSize: 12, flex: 1, paddingRight: 10 },
  logoutAction: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drawerLogoutText: { color: '#d8d0c6', fontSize: 14, lineHeight: 24, includeFontPadding: true },
});
