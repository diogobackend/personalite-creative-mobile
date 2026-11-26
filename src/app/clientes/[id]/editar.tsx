import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
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
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const maskDate = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};
const isoToBr = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
const brToIso = (value: string) => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return null;
  const [day, month, year] = value.split('/').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const dateToBr = (value: Date) => `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
function formatClientForm(client: Client): ClientForm {
  return {
    name: client.name ?? '',
    email: client.email && !GENERATED_EMAIL.test(client.email) ? client.email : '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    cpf: client.cpf ?? '',
    rg: client.rg ?? '',
    birthDate: isoToBr(client.birthDate?.slice(0, 10) ?? ''),
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
function BirthDateField({ value, onChange, onCalendar, error }: { value: string; onChange: (value: string) => void; onCalendar: () => void; error?: string }) {
  return <View style={styles.field}>
    <SafeText style={styles.label}>Data de nascimento</SafeText>
    <View style={styles.dateRow}>
      <View style={[styles.inputShell, styles.dateInputShell, !!error && styles.inputError]}>
        <Ionicons name="calendar-outline" size={19} color={COLORS.gold} style={styles.inputIcon} />
        <TextInput value={value} onChangeText={text => onChange(maskDate(text))} placeholder="DD/MM/AAAA" placeholderTextColor="#a8a29e" style={styles.input} maxLength={10} keyboardType="number-pad" />
      </View>
      <Pressable onPress={onCalendar} style={styles.calendarButton} accessibilityLabel="Abrir calendário de nascimento">
        <Ionicons name="calendar-outline" size={23} color={COLORS.gold} />
      </Pressable>
    </View>
    {!!error && <SafeText style={styles.errorText}>{error}</SafeText>}
  </View>;
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const offset = new Date(year, month, 1).getDay();
    return [...Array.from({ length: offset }, () => null), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => index + 1)];
  }, [calendarMonth]);
  function openCalendar() {
    const iso = brToIso(form.birthDate);
    const selected = iso ? new Date(`${iso}T12:00:00`) : new Date();
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarOpen(true);
  }
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
      const iso = brToIso(form.birthDate);
      if (!iso || iso > localToday) {
        errors.birthDate = 'Informe uma data válida (DD/MM/AAAA), não futura.';
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
      if (client.birthDate == null && form.birthDate) payload.birthDate = brToIso(form.birthDate);
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
            <SafeText style={styles.backLabel}>Voltar </SafeText>
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
                <BirthDateField value={form.birthDate} onChange={v => update('birthDate', v)} onCalendar={openCalendar} error={fieldErrors.birthDate} />
              )}
              <View style={styles.actions}>
                <Pressable onPress={() => router.replace(detailRoute as never)} style={styles.cancelButton} disabled={saving}>
                  <SafeText allowFontScaling={false} numberOfLines={1} style={styles.cancelLabel}>Cancelar</SafeText>
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
        <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
          <View style={styles.calendarBackdrop}><View style={styles.calendarPanel}>
            <View style={styles.calendarHeader}>
              <Pressable onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={styles.calendarNav} accessibilityLabel="Mês anterior"><Ionicons name="chevron-back" size={23} color={COLORS.gold} /></Pressable>
              <SafeText allowFontScaling={false} style={styles.calendarHeading}>{MONTH_NAMES[calendarMonth.getMonth()]} de {calendarMonth.getFullYear()}</SafeText>
              <Pressable onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={styles.calendarNav} accessibilityLabel="Próximo mês"><Ionicons name="chevron-forward" size={23} color={COLORS.gold} /></Pressable>
            </View>
            <View style={styles.calendarGrid}>
              {WEEKDAYS.map((day, index) => <View key={`weekday-${index}`} style={styles.calendarCell}><SafeText style={styles.calendarWeekday}>{day}</SafeText></View>)}
              {calendarDays.map((day, index) => {
                const candidate = day ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day) : null;
                const selected = candidate && dateToBr(candidate) === form.birthDate;
                return <View key={`day-${index}`} style={styles.calendarCell}>{candidate && <Pressable onPress={() => { update('birthDate', dateToBr(candidate)); setCalendarOpen(false); }} style={[styles.calendarDay, selected && styles.calendarDaySelected]} accessibilityLabel={`Selecionar ${dateToBr(candidate)}`}><SafeText allowFontScaling={false} style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{day}</SafeText></Pressable>}</View>;
              })}
            </View>
            <Pressable style={styles.calendarClose} onPress={() => setCalendarOpen(false)}><SafeText allowFontScaling={false} style={styles.calendarCloseText}>Fechar</SafeText></Pressable>
          </View></View>
        </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dateInputShell: { flex: 1, minWidth: 0 },
  calendarButton: { width: 52, height: 50, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white },
  calendarBackdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 20 },
  calendarPanel: { width: '100%', maxWidth: 380, backgroundColor: COLORS.white, borderRadius: 17, padding: 15 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15, gap: 4 },
  calendarNav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  calendarHeading: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 14, lineHeight: 24, fontWeight: '700', color: COLORS.ink, textTransform: 'capitalize' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: '14.285714%', height: 43, justifyContent: 'center', alignItems: 'center' },
  calendarWeekday: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  calendarDay: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  calendarDaySelected: { backgroundColor: COLORS.gold },
  calendarDayText: { width: 33, fontSize: 13, lineHeight: 21, color: COLORS.ink, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  calendarDayTextSelected: { color: COLORS.white },
  calendarClose: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 12, marginTop: 12 },
  calendarCloseText: { minWidth: 75, textAlign: 'center', color: COLORS.gold, fontSize: 14, lineHeight: 22, fontWeight: '700' },

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
  cancelButton: { borderWidth: 1, borderColor: COLORS.border, minHeight: 48, minWidth: 112, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cancelLabel: { color: COLORS.muted, fontSize: 13, lineHeight: 23, fontWeight: '700', includeFontPadding: false, textAlign: 'center', minWidth: 78 },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 7, minHeight: 48, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11, backgroundColor: COLORS.gold },
  saveLabel: { color: '#fff', fontSize: 13, lineHeight: 23, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  loading: { minHeight: 210, justifyContent: 'center', alignItems: 'center', gap: 13 },
  retryButton: { paddingVertical: 13, marginTop: 12 },
  retryText: { color: COLORS.gold, fontWeight: '700', fontSize: 14, lineHeight: 24 },
});
