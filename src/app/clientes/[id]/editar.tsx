import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type Client = {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  cpf: string | null;
  rg: string | null;
  birthDate: string | null;
};

type ClientForm = {
  name: string;
  email: string;
  phone: string;
  address: string;
  cpf: string;
  rg: string;
  birthDate: string;
};

type FieldKey = keyof ClientForm;
type IconName = keyof typeof Ionicons.glyphMap;

const COLORS = {
  background: '#f8f6f2', white: '#ffffff', ink: '#342d27', muted: '#766d63',
  gold: '#a98a58', border: '#e8e0d4', danger: '#b91c1c',
};
const GENERATED_EMAIL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@gmail\.com$/i;
const INITIAL_FORM: ClientForm = {
  name: '', email: '', phone: '', address: '', cpf: '', rg: '', birthDate: '',
};

function SafeText({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[styles.safeText, style]} />;
}

function messageForError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'Sessão expirada ou inválida. Faça login novamente.';
    if (error.response?.status === 403) return 'Você não possui permissão para editar este cliente.';
    if (error.response?.status === 404) return 'Cliente não encontrado.';
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : `Erro HTTP ${error.response.status}.`;
  }
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

function formatClientForm(client: Client): ClientForm {
  return {
    name: client.name ?? '',
    email: client.email && !GENERATED_EMAIL.test(client.email) ? client.email : '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    cpf: client.cpf ?? '',
    rg: client.rg ?? '',
    birthDate: client.birthDate?.slice(0, 10) ?? '',
  };
}

function FormField({
  label, value, onChange, placeholder, icon, keyboardType = 'default', maxLength,
  multiline = false, autoCapitalize = 'sentences', error,
}: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; icon?: IconName;
  keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
  maxLength?: number; multiline?: boolean;
  autoCapitalize?: ComponentProps<typeof TextInput>['autoCapitalize']; error?: string;
}) {
  return (
    <View style={styles.field}>
      <SafeText style={styles.label}>{label}</SafeText>
      <View style={[styles.inputShell, multiline && styles.multilineShell, !!error && styles.inputError]}>
        {icon && <Ionicons name={icon} size={19} color={COLORS.gold} style={styles.inputIcon} />}
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor="#a8a29e"
          style={[styles.input, multiline && styles.multilineInput]}
          maxLength={maxLength}
          keyboardType={keyboardType}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          autoCapitalize={autoCapitalize}
          autoCorrect={keyboardType === 'email-address' ? false : undefined}
        />
      </View>
      {!!error && <SafeText style={styles.errorText}>{error}</SafeText>}
    </View>
  );
}

export default function EditarClienteScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [client, setClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>({ ...INITIAL_FORM });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const detailRoute = `/clientes/${encodeURIComponent(id ?? '')}`;

  const loadClient = useCallback(async (signal: AbortSignal) => {
    if (!id) {
      setError('Cliente não identificado.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') {
        throw new Error('Sessão não encontrada. Faça login novamente.');
      }
      const { data } = await api.get<Client>('/users/id', {
        params: { userId: id },
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (signal.aborted) return;
      setClient(data);
      setForm(formatClientForm(data));
      setFieldErrors({});
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setClient(null);
      setError(messageForError(cause));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClient(controller.signal);
    return () => controller.abort();
  }, [loadClient]);

  function update(field: FieldKey, value: string) {
    setForm(previous => ({ ...previous, [field]: value }));
    setFieldErrors(previous => ({ ...previous, [field]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<FieldKey, string>> = {};
    if (!form.name.trim()) errors.name = 'Informe o nome completo.';
    else if (form.name.trim().length > 150) errors.name = 'Máximo de 150 caracteres.';
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Informe um e-mail válido.';
    if (email.length > 255) errors.email = 'Máximo de 255 caracteres.';
    if (form.phone.trim().length > 30) errors.phone = 'Máximo de 30 caracteres.';
    if (form.address.trim().length > 500) errors.address = 'Máximo de 500 caracteres.';
    if (form.cpf.trim().length > 14) errors.cpf = 'Máximo de 14 caracteres.';
    if (form.rg.trim().length > 20) errors.rg = 'Máximo de 20 caracteres.';
    if (form.birthDate) {
      const today = new Date();
      const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const parsed = new Date(`${form.birthDate}T12:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate) || Number.isNaN(parsed.getTime()) || form.birthDate > localToday) {
        errors.birthDate = 'Informe uma data válida (AAAA-MM-DD), não futura.';
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      Alert.alert('Verifique os campos', Object.values(errors)[0]);
      return false;
    }
    return true;
  }

  async function save() {
    if (!client || !id || saving || !validate()) return;
    setSaving(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') {
        throw new Error('Sessão não encontrada. Faça login novamente.');
      }
      const payload: Record<string, string | null> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
      };
      const email = form.email.trim();
      if (email) payload.email = email;
      if (client.email && !GENERATED_EMAIL.test(client.email) && !email) payload.email = client.email;
      if (client.cpf == null && form.cpf.trim()) payload.cpf = form.cpf.trim();
      if (client.rg == null && form.rg.trim()) payload.rg = form.rg.trim();
      if (client.birthDate == null && form.birthDate) payload.birthDate = form.birthDate;

      await api.patch(`/users/${encodeURIComponent(id)}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      Alert.alert('Sucesso', 'Cliente atualizado com sucesso!', [
        { text: 'OK', onPress: () => router.replace(detailRoute as never) },
      ]);
    } catch (cause) {
      Alert.alert('Erro', messageForError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={styles.backLink} onPress={() => router.replace(detailRoute as never)}>
            <Ionicons name="arrow-back-outline" color={COLORS.gold} size={20} />
            <SafeText style={styles.backLabel}>Voltar aos dados do cliente</SafeText>
          </Pressable>
          <SafeText style={styles.heading}>Editar cliente</SafeText>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={COLORS.gold} />
              <SafeText style={styles.helper}>Carregando dados do cliente...</SafeText>
            </View>
          ) : !client ? (
            <View style={styles.card}>
              <SafeText style={styles.errorText}>{error ?? 'Cliente não encontrado.'}</SafeText>
              <Pressable onPress={() => { const controller = new AbortController(); void loadClient(controller.signal); }} style={styles.retryButton}>
                <SafeText style={styles.retryText}>Tentar novamente</SafeText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.userIcon}><Ionicons name="person-outline" color={COLORS.gold} size={25} /></View>
                <View style={styles.headerInfo}>
                  <SafeText style={styles.cardTitle}>Dados cadastrais</SafeText>
                  <SafeText style={styles.helper}>Atualize as informações do cliente.</SafeText>
                </View>
              </View>

              <FormField label="Nome completo" value={form.name} onChange={v => update('name', v)} maxLength={150}
                placeholder="Nome do cliente" icon="person-outline" error={fieldErrors.name} />
              <FormField label="E-mail" value={form.email} onChange={v => update('email', v)} maxLength={255}
                placeholder="E-mail do cliente" keyboardType="email-address" autoCapitalize="none"
                icon="mail-outline" error={fieldErrors.email} />
              <FormField label="Telefone" value={form.phone} onChange={v => update('phone', v)} maxLength={30}
                placeholder="Telefone do cliente" keyboardType="phone-pad" icon="call-outline" error={fieldErrors.phone} />
              <FormField label="Endereço" value={form.address} onChange={v => update('address', v)} maxLength={500}
                placeholder="Endereço completo" icon="location-outline" multiline error={fieldErrors.address} />
              {client.cpf == null && (
                <FormField label="CPF" value={form.cpf} onChange={v => update('cpf', v)} maxLength={14}
                  placeholder="CPF" keyboardType="number-pad" icon="card-outline" error={fieldErrors.cpf} />
              )}
              {client.rg == null && (
                <FormField label="RG" value={form.rg} onChange={v => update('rg', v)} maxLength={20}
                  placeholder="RG" icon="document-text-outline" error={fieldErrors.rg} />
              )}
              {client.birthDate == null && (
                <FormField label="Data de nascimento (AAAA-MM-DD)" value={form.birthDate}
                  onChange={v => update('birthDate', v)} maxLength={10}
                  placeholder="Ex.: 2000-01-31" keyboardType="numbers-and-punctuation"
                  icon="calendar-outline" error={fieldErrors.birthDate} />
              )}

              <View style={styles.actions}>
                <Pressable onPress={() => router.replace(detailRoute as never)} style={styles.cancelButton} disabled={saving}>
                  <SafeText style={styles.cancelLabel}>Cancelar</SafeText>
                </Pressable>
                <Pressable onPress={() => void save()} style={[styles.saveButton, saving && styles.disabled]} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" color="#fff" size={19} />}
                  <SafeText style={styles.saveLabel}>{saving ? 'Salvando...' : 'Salvar alterações'}</SafeText>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.background },
  safeText: { includeFontPadding: true, paddingRight: 4 },
  content: { padding: 17, paddingTop: 24, paddingBottom: 45 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 13 },
  backLabel: { color: COLORS.gold, fontSize: 13, lineHeight: 23, fontWeight: '600' },
  heading: { fontSize: 29, lineHeight: 41, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: COLORS.ink, marginBottom: 19 },
  card: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: 17, padding: 18 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#f0ece5', paddingBottom: 19, marginBottom: 23 },
  userIcon: { width: 47, height: 47, borderRadius: 12, backgroundColor: '#f7f0e6', alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1, minWidth: 0 },
  cardTitle: { color: COLORS.ink, fontSize: 18, lineHeight: 29, fontWeight: '700' },
  helper: { color: COLORS.muted, fontSize: 12, lineHeight: 21 },
  field: { marginBottom: 19 },
  label: { color: COLORS.ink, fontSize: 14, lineHeight: 24, fontWeight: '600', marginBottom: 8 },
  inputShell: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 12, backgroundColor: '#fff' },
  multilineShell: { alignItems: 'flex-start', paddingTop: 10 },
  inputError: { borderColor: COLORS.danger },
  inputIcon: { marginRight: 10, marginTop: 0 },
  input: { flex: 1, minWidth: 0, color: COLORS.ink, fontSize: 14, lineHeight: 22, paddingVertical: Platform.OS === 'ios' ? 12 : 8, includeFontPadding: true },
  multilineInput: { minHeight: 75, textAlignVertical: 'top' },
  errorText: { color: COLORS.danger, fontSize: 13, lineHeight: 22, marginTop: 5 },
  actions: { borderTopWidth: 1, borderTopColor: '#f0ece5', paddingTop: 20, marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
  cancelButton: { borderWidth: 1, borderColor: COLORS.border, minHeight: 48, paddingHorizontal: 17, paddingVertical: 11, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { color: COLORS.muted, fontSize: 13, lineHeight: 23, fontWeight: '700' },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 7, minHeight: 48, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11, backgroundColor: COLORS.gold },
  saveLabel: { color: '#fff', fontSize: 13, lineHeight: 23, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  loading: { minHeight: 210, justifyContent: 'center', alignItems: 'center', gap: 13 },
  retryButton: { paddingVertical: 13, marginTop: 12 },
  retryText: { color: COLORS.gold, fontWeight: '700', fontSize: 14, lineHeight: 24 },
});
