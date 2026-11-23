import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
    Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type User = {
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
type EditableField = 'name' | 'email' | 'login' | 'phone' | 'cpf' | 'rg' | 'address' | 'birthDate';
type FormData = Record<EditableField, string>;
type InputKind = 'default' | 'email-address' | 'phone-pad';
type ProfileField = { key: EditableField; label: string; keyboardType?: InputKind; placeholder?: string };

const C = {
  bg: '#f8f6f2', card: '#fff', ink: '#342d27', muted: '#766d63',
  gold: '#a98a58', border: '#e8e0d4', menu: '#39342f', green: '#15803d',
};
const EMPTY: FormData = {
  name: '', email: '', login: '', phone: '', cpf: '', rg: '', address: '', birthDate: '',
};
const FIELDS: ProfileField[] = [
  { key: 'name', label: 'Nome' },
  { key: 'email', label: 'E-mail', keyboardType: 'email-address' },
  { key: 'login', label: 'Login' },
  { key: 'phone', label: 'Telefone', keyboardType: 'phone-pad' },
  { key: 'cpf', label: 'CPF' },
  { key: 'rg', label: 'RG' },
  { key: 'address', label: 'Endereço' },
  { key: 'birthDate', label: 'Data de nascimento', placeholder: 'AAAA-MM-DD' },
];
const MENU: { label: string; icon: IconName; route: string }[] = [
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

function getUserIdFromToken(token: string): string {
  const part = token.split('.')[1];
  if (!part) throw new Error('Token inválido.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0, buffer = 0, decoded = '';
  for (const character of part.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('Token inválido.');
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((buffer >>> bits) & 255);
    }
  }
  const { sub } = JSON.parse(decoded) as { sub?: string };
  if (!sub) throw new Error('Usuário não identificado.');
  return sub;
}

function toForm(user: User): FormData {
  return {
    name: user.name ?? '', email: user.email ?? '', login: user.login ?? '',
    phone: user.phone ?? '', cpf: user.cpf ?? '', rg: user.rg ?? '',
    address: user.address ?? '', birthDate: user.birthDate?.slice(0, 10) ?? '',
  };
}
function dateLabel(value: string | null): string {
  if (!value) return 'Não informado';
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}
function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map(part => part.charAt(0)).join('').toUpperCase();
}
function statusLabel(value: string): string {
  return ({ ACTIVE: 'Ativo', INACTIVE: 'Inativo', BLOCKED: 'Bloqueado' } as Record<string, string>)[value] ?? value;
}
function apiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message: unknown = error.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (error.response?.status === 401) return 'Sessão expirada ou credenciais inválidas.';
  }
  return fallback;
}

function Action({ label, icon, onPress, disabled = false, secondary = false }: {
  label: string; icon: IconName; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.action, secondary ? s.actionSecondary : s.actionPrimary, disabled && s.disabled]}>
    <Ionicons name={icon} size={17} color={secondary ? C.ink : '#fff'} />
    <Text style={[s.actionLabel, secondary && s.actionSecondaryLabel]}>{label}</Text>
  </Pressable>;
}

export default function PerfilScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changePassword, setChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadUser = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { router.replace('/'); return; }
      const userId = getUserIdFromToken(token);
      const { data } = await api.get<User>('/users/id', {
        params: { userId }, headers: { Authorization: `Bearer ${token}` },
      });
      setUser(data);
      setForm(toForm(data));
    } catch (error) {
      setLoadError(apiError(error, 'Não foi possível carregar os dados do perfil.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadUser(); }, [loadUser]);

  function cancelEditing() {
    if (user) setForm(toForm(user));
    setEditing(false);
  }

  async function saveProfile() {
    if (!user || saving) return;
    const payload: Partial<FormData> = {};
    for (const { key } of FIELDS) {
      if ((key === 'cpf' && user.cpf?.trim()) || (key === 'rg' && user.rg?.trim())) continue;
      const original = user[key] ?? '';
      const current = form[key].trim();
      if (current && current !== original) payload[key] = current;
    }
    if (!Object.keys(payload).length) { Alert.alert('Perfil', 'Nenhuma alteração foi realizada.'); return; }
    if (payload.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(payload.birthDate)) {
      Alert.alert('Data inválida', 'Informe a data no formato AAAA-MM-DD.'); return;
    }
    setSaving(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { router.replace('/'); return; }
      await api.patch(`/users/${user.userId}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      await loadUser();
      setEditing(false);
      Alert.alert('Sucesso', 'Perfil atualizado com sucesso.');
    } catch (error) {
      Alert.alert('Erro', apiError(error, 'Não foi possível salvar as alterações.'));
    } finally { setSaving(false); }
  }

  function resetPasswords() {
    setChangePassword(false);
    setOldPassword('');
    setNewPassword('');
    setRepeatPassword('');
  }

  async function savePassword() {
    if (!user || savingPassword) return;
    if (!oldPassword || !newPassword || !repeatPassword) {
      Alert.alert('Atenção', 'Preencha os três campos de senha.'); return;
    }
    if (newPassword !== repeatPassword) {
      Alert.alert('Atenção', 'As senhas novas não coincidem.'); return;
    }
    setSavingPassword(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { router.replace('/'); return; }
      try {
        await api.post('/login', { login: user.login, password: oldPassword }, {
          headers: { 'X-Password-Validation': 'true' },
        });
      } catch (error) {
        if (axios.isAxiosError(error) && (error.response?.status === 400 || error.response?.status === 401)) {
          Alert.alert('Senha incorreta', 'Se esqueceu, entre em contato com o Administrador.');
          return;
        }
        throw error;
      }
      await api.patch(`/users/${user.userId}`, { password: newPassword }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      resetPasswords();
      Alert.alert('Sucesso', 'Senha atualizada com sucesso.');
    } catch (error) {
      Alert.alert('Erro', apiError(error, 'Não foi possível atualizar a senha.'));
    } finally { setSavingPassword(false); }
  }

  async function logout() {
    setMenuOpen(false);
    await SecureStore.deleteItemAsync('access_token');
    router.replace('/');
  }

  const renderField = ({ key, label, keyboardType, placeholder }: ProfileField) => {
    if (!user) return null;
    const locked = (key === 'cpf' && Boolean(user.cpf?.trim())) || (key === 'rg' && Boolean(user.rg?.trim()));
    const text = editing ? form[key] : key === 'birthDate' ? (user.birthDate ? dateLabel(user.birthDate) : '') : (user[key] ?? '');
    return <View key={key} style={s.field}>
      <View style={s.fieldHeading}>
        <Text style={s.fieldLabel}>{label}</Text>
        {editing && locked && <Ionicons name="lock-closed-outline" size={15} color={C.gold} />}
      </View>
      {editing ? <TextInput
        style={[s.input, locked && s.inputLocked]}
        editable={!locked && !saving} value={form[key]}
        onChangeText={value => setForm(previous => ({ ...previous, [key]: value }))}
        placeholder={placeholder ?? 'Não informado'} placeholderTextColor="#aaa29a"
        keyboardType={keyboardType ?? 'default'} autoCapitalize={key === 'email' || key === 'login' ? 'none' : 'sentences'}
      /> : <View style={s.readonly}><Text style={[s.value, !text && s.placeholder]}>{text || 'Não informado'}</Text></View>}
    </View>;
  };

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.topbar}>
        <Pressable style={s.iconButton} onPress={() => setMenuOpen(true)} accessibilityLabel="Abrir menu">
          <Ionicons name="menu-outline" size={27} color={C.ink} />
        </Pressable>
        <Text style={s.topbarTitle}>Meu Perfil</Text>
        <Pressable style={s.iconButton} onPress={() => void loadUser()} accessibilityLabel="Atualizar perfil" disabled={loading || saving}>
          <Ionicons name="refresh-outline" size={22} color={C.gold} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadUser(); }} tintColor={C.gold} colors={[C.gold]} />}>
        {loading && !user ? <View style={s.feedback}><ActivityIndicator size="large" color={C.gold} /></View>
          : !user ? <View style={s.feedback}>
            <Text style={s.error}>{loadError ?? 'Não foi possível carregar o perfil.'}</Text>
            <Action label="Tentar novamente" icon="refresh-outline" onPress={() => void loadUser()} />
          </View> : <>
            <View style={s.actions}>
              {editing && <Action label="Cancelar" icon="close-outline" onPress={cancelEditing} disabled={saving} secondary />}
              <Action label={editing ? 'Visualizar' : 'Editar'} icon={editing ? 'eye-outline' : 'pencil-outline'}
                onPress={() => editing ? cancelEditing() : setEditing(true)} disabled={saving} />
              {editing && <Action label={saving ? 'Salvando...' : 'Salvar'} icon="save-outline" onPress={() => void saveProfile()} disabled={saving} />}
            </View>
            <View style={s.card}>
              <View style={s.identity}>
                <View style={s.avatar}><Text style={s.initials}>{initials(user.name) || 'P'}</Text></View>
                <View style={s.identityInfo}><Text style={s.name}>{user.name}</Text></View>
                <View style={s.status}><Text style={s.statusText}>{statusLabel(user.status)}</Text></View>
              </View>
              <View style={s.fields}>
                {FIELDS.map(renderField)}
                {editing && (user.cpf || user.rg) ? <View style={s.notice}>
                  <Ionicons name="lock-closed-outline" size={18} color={C.gold} />
                  <Text style={s.noticeText}>CPF e RG já cadastrados ficam bloqueados para edição.</Text>
                </View> : null}
                <View style={s.divider} />
                <View style={s.field}>
                  <Text style={s.fieldLabel}>Data de cadastro</Text>
                  <View style={s.readonly}><Text style={s.value}>{dateLabel(user.createdAt)}</Text></View>
                </View>
                <View style={s.field}>
                  <Text style={s.fieldLabel}>Última atualização</Text>
                  <View style={s.readonly}><Text style={s.value}>{dateLabel(user.updatedAt)}</Text></View>
                </View>
                <View style={s.divider} />
                <Text style={s.sectionTitle}>Deseja atualizar a senha?</Text>
                <View style={s.choiceRow}>
                  <Pressable style={[s.choice, changePassword && s.choiceSelected]} onPress={() => setChangePassword(true)}>
                    <Text style={[s.choiceText, changePassword && s.choiceSelectedText]}>SIM</Text>
                  </Pressable>
                  <Pressable style={[s.choice, !changePassword && s.choiceSelected]} onPress={resetPasswords}>
                    <Text style={[s.choiceText, !changePassword && s.choiceSelectedText]}>NÃO</Text>
                  </Pressable>
                </View>
                {changePassword && <View style={s.passwordPanel}>
                  {([
                    ['Senha antiga', oldPassword, setOldPassword],
                    ['Senha nova', newPassword, setNewPassword],
                    ['Repetir senha nova', repeatPassword, setRepeatPassword],
                  ] as [string, string, (value: string) => void][]).map(([label, value, onChange]) =>
                    <View key={label} style={s.field}>
                      <Text style={s.fieldLabel}>{label}</Text>
                      <TextInput style={s.input} secureTextEntry value={value} onChangeText={onChange}
                        editable={!savingPassword} autoCapitalize="none" autoCorrect={false} />
                    </View>)}
                  <Action label={savingPassword ? 'Atualizando...' : 'Atualizar senha'} icon="save-outline"
                    onPress={() => void savePassword()} disabled={savingPassword} />
                </View>}
              </View>
            </View>
          </>}
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={menuOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenuOpen(false)}>
      <View style={s.menuOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
        <SafeAreaView edges={['top', 'bottom']} style={s.drawer}>
          <View style={s.drawerBrand}>
            <Image source={require('../../assets/images/personalite-logo.png')} style={s.logo} resizeMode="contain" />
            <View style={s.brandText}><Text style={s.brandEyebrow}>PERSONALITÉ</Text><Text style={s.brandTitle}>Creative</Text></View>
            <Pressable onPress={() => setMenuOpen(false)}><Ionicons name="close" size={24} color="#fff" /></Pressable>
          </View>
          <ScrollView style={s.flex} contentContainerStyle={s.drawerContent}>
            <Text style={s.drawerSection}>MENU PRINCIPAL</Text>
            {MENU.map(item => <Pressable key={item.label} style={s.drawerItem} onPress={() => { setMenuOpen(false); router.push(item.route as never); }}>
              <Ionicons name={item.icon} size={19} color="#eee7db" /><Text style={s.drawerItemText}>{item.label}</Text>
            </Pressable>)}
            <Text style={s.drawerSection}>SISTEMA</Text>
            <Pressable style={[s.drawerItem, s.drawerActive]} onPress={() => setMenuOpen(false)}>
              <Ionicons name="settings-outline" size={19} color="#fff" /><Text style={s.drawerItemText}>Meu Perfil</Text>
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
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  topbar: { minHeight: 62, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  topbarTitle: { flex: 1, color: C.ink, fontWeight: '700', fontSize: 21 },
  iconButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 17, paddingBottom: 40 }, feedback: { alignItems: 'center', padding: 40, gap: 15 },
  error: { color: '#b91c1c', fontSize: 14, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginBottom: 15 },
  action: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  actionPrimary: { backgroundColor: C.green }, actionSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  actionLabel: { color: '#fff', fontSize: 13, fontWeight: '700' }, actionSecondaryLabel: { color: C.ink }, disabled: { opacity: 0.45 },
  card: { borderRadius: 17, overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  identity: { backgroundColor: '#fcfaf7', padding: 19, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: C.border, flexWrap: 'wrap' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f0e5d2', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 17, fontWeight: '700', color: C.gold }, identityInfo: { flex: 1, minWidth: 105 },
  name: { fontSize: 22, lineHeight: 30, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: C.ink },
  status: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8dfd0', borderRadius: 17, paddingHorizontal: 12, paddingVertical: 7 },
  statusText: { fontSize: 12, color: '#947646', fontWeight: '700' },
  fields: { padding: 18, gap: 15 }, field: { gap: 7 }, fieldHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#8b7b68' },
  readonly: { backgroundColor: '#faf9f7', borderWidth: 1, borderColor: '#eee8df', borderRadius: 11, minHeight: 46, paddingHorizontal: 13, paddingVertical: 12, justifyContent: 'center' },
  value: { color: C.ink, fontSize: 14, lineHeight: 21 }, placeholder: { color: '#a8a29e' },
  input: { borderRadius: 11, borderWidth: 1, borderColor: '#e7dfd4', minHeight: 46, backgroundColor: '#fff', paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, color: C.ink },
  inputLocked: { backgroundColor: '#f3f0eb', color: '#958b80' },
  notice: { borderRadius: 11, backgroundColor: '#faf7f1', padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeText: { flex: 1, color: '#8b7758', fontSize: 12, lineHeight: 19 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 5 },
  sectionTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: { borderRadius: 10, borderWidth: 1, borderColor: C.border, minWidth: 75, paddingHorizontal: 17, paddingVertical: 10, alignItems: 'center' },
  choiceSelected: { borderColor: C.green, backgroundColor: C.green }, choiceText: { color: C.ink, fontWeight: '600' }, choiceSelectedText: { color: '#fff' },
  passwordPanel: { gap: 15, padding: 15, borderWidth: 1, borderColor: C.border, borderRadius: 12 },
  menuOverlay: { flex: 1, backgroundColor: '#0008', flexDirection: 'row' },
  drawer: { width: '82%', maxWidth: 310, height: '100%', backgroundColor: C.menu },
  drawerBrand: { paddingHorizontal: 16, paddingVertical: 19, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  logo: { width: 56, height: 66 }, brandText: { flex: 1 }, brandEyebrow: { color: '#d5bd91', fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  brandTitle: { color: '#fff', fontSize: 21, fontFamily: 'serif' },
  drawerContent: { paddingHorizontal: 13, paddingTop: 24, paddingBottom: 27 },
  drawerSection: { color: '#b1a698', fontSize: 10, fontWeight: '700', letterSpacing: 1.7, marginBottom: 14, marginTop: 18 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, minHeight: 49, gap: 12, borderRadius: 10, marginBottom: 3 },
  drawerActive: { backgroundColor: '#665949' }, drawerItemText: { flex: 1, color: '#eee7db', fontSize: 14, fontWeight: '600' },
  drawerLogout: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 27, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#ffffff22' },
});
