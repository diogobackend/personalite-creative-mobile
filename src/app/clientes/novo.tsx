import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/api';
type ClientForm = {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  rg: string;
  address: string;
  birthDate: string;
};
type FormErrors = Partial<Record<keyof ClientForm, string>>;
type FieldName = keyof ClientForm;
type IconName = keyof typeof Ionicons.glyphMap;
const INITIAL: ClientForm = {
  name: '', email: '', phone: '', cpf: '', rg: '', address: '', birthDate: '',
};
const DEFAULT_CREDENTIAL = 'valorpadraocredencial';
const C = {
  bg: '#f8f6f2', white: '#fff', ink: '#342d27', muted: '#766d63',
  gold: '#a98a58', border: '#e8e0d4', error: '#b91c1c',
};
// Identificadores aleatórios para cadastro; não são usados como credenciais secretas.
function randomId(): string {
  const pattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return pattern.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
const optional = (value: string) => value.trim() || null;
const todayLocal = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const maskDate = (value: string) => { const digits = value.replace(/\D/g, '').slice(0, 8); return digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`; };
function toIsoDate(value: string): string {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return '';
  const [day, month, year] = value.split('/').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const toBrazilian = (value: Date) => `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
function validDate(value: string): boolean {
  return Boolean(toIsoDate(value));
}
function validate(form: ClientForm): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  const email = form.email.trim();
  if (!name) errors.name = 'Informe o nome do cliente.';
  else if (name.length > 150) errors.name = 'O nome deve ter no máximo 150 caracteres.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Informe um e-mail válido ou deixe em branco.';
  else if (email.length > 255) errors.email = 'O e-mail deve ter no máximo 255 caracteres.';
  if (form.phone.trim().length > 30) errors.phone = 'Máximo de 30 caracteres.';
  if (form.cpf.trim().length > 14) errors.cpf = 'Máximo de 14 caracteres.';
  if (form.rg.trim().length > 20) errors.rg = 'Máximo de 20 caracteres.';
  if (form.address.trim().length > 500) errors.address = 'Máximo de 500 caracteres.';
  if (form.birthDate && (!validDate(form.birthDate) || toIsoDate(form.birthDate) > todayLocal())) {
    errors.birthDate = 'Informe uma data válida que não seja futura (DD/MM/AAAA).';
  }
  return errors;
}
function requestError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message: unknown = error.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não possui permissão para cadastrar clientes.';
    return `Não foi possível cadastrar o cliente (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Erro inesperado ao cadastrar o cliente.';
}
function SafeText({ children, style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} style={[{ includeFontPadding: true, paddingRight: 4 }, style]}>{children}</Text>;
}
function FormField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <View style={s.field}>
    <SafeText style={s.label}>{label}</SafeText>
    {children}
    {error ? <SafeText style={s.error}>{error}</SafeText> : null}
  </View>;
}
function Button({ label, icon, onPress, secondary, disabled }: {
  label: string; icon: IconName; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={[s.button, secondary ? s.secondaryButton : s.primaryButton, disabled && s.disabled]}>
    <Ionicons name={icon} color={secondary ? C.ink : '#fff'} size={18} />
    <Text allowFontScaling={false} numberOfLines={1} style={[s.buttonLabel, s.cancelButtonLabel, secondary ? s.secondaryLabel : s.primaryLabel]}>{label}</Text>
  </Pressable>;
}
export default function NovoClienteScreen() {
  const [form, setForm] = useState<ClientForm>({ ...INITIAL });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const offset = new Date(year, month, 1).getDay();
    return [...Array.from({ length: offset }, () => null), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => index + 1)];
  }, [calendarMonth]);
  const openCalendar = () => {
    const iso = toIsoDate(form.birthDate);
    const selected = iso ? new Date(`${iso}T12:00:00`) : new Date();
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarOpen(true);
  };
  const update = (field: FieldName, value: string) => {
    setForm(previous => ({ ...previous, [field]: value }));
    setErrors(previous => ({ ...previous, [field]: undefined }));
  };
  async function submit() {
    if (submitting) return;
    const validation = validate(form);
    setErrors(validation);
    if (Object.keys(validation).length) {
      Alert.alert('Verifique os dados', Object.values(validation).filter(Boolean).join('\n'));
      return;
    }
    setSubmitting(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') {
        Alert.alert('Sessão inválida', 'Faça login novamente.');
        router.replace('/');
        return;
      }
      const id = randomId();
      await api.post('/users', {
        name: form.name.trim(),
        email: form.email.trim() || `${id}@gmail.com`,
        login: `cli${randomId().replace(/-/g, '').toLowerCase()}`,
        password: DEFAULT_CREDENTIAL,
        phone: optional(form.phone),
        cpf: optional(form.cpf),
        rg: optional(form.rg),
        address: optional(form.address),
        birthDate: form.birthDate ? toIsoDate(form.birthDate) : null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Sucesso', 'Cliente cadastrado com sucesso!', [
        { text: 'OK', onPress: () => router.replace('/clientes') },
      ]);
    } catch (error) {
      Alert.alert('Erro ao cadastrar', requestError(error));
    } finally {
      setSubmitting(false);
    }
  }
  function input(field: FieldName, placeholder: string, options?: {
    keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
    maxLength?: number; multiline?: boolean; autoCapitalize?: ComponentProps<typeof TextInput>['autoCapitalize'];
  }) {
    return <TextInput
      style={[s.input, options?.multiline && s.multiline, errors[field] && s.inputError]}
      placeholder={placeholder} placeholderTextColor="#a8a29e"
      value={form[field]} onChangeText={value => update(field, value)}
      keyboardType={options?.keyboardType ?? 'default'} maxLength={options?.maxLength}
      multiline={options?.multiline} textAlignVertical={options?.multiline ? 'top' : 'center'}
      autoCapitalize={options?.autoCapitalize ?? 'sentences'}
      autoCorrect={field !== 'email' && field !== 'cpf' && field !== 'birthDate'}
    />;
  }
  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backIcon} accessibilityLabel="Voltar">
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <SafeText style={s.headerTitle}>Novo cliente</SafeText>
        <Pressable onPress={() => void submit()} disabled={submitting} accessibilityRole="button" accessibilityLabel="Salvar novo cliente" style={[s.headerSave, submitting && s.disabled]}>
          {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
          <Text allowFontScaling={false} numberOfLines={1} style={s.headerSaveText}>{submitting ? 'Salvando' : 'Salvar'}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.card}>
          <View style={s.cardHead}>
            <View style={s.iconBox}><Ionicons name="person-outline" size={23} color={C.gold} /></View>
            <View style={s.cardHeadingCopy}>
              <SafeText style={s.helper}>Apenas o nome é obrigatório. Os outros campos são opcionais.</SafeText>
            </View>
          </View>
          <FormField label="Nome *" error={errors.name}>
            {input('name', 'Nome do cliente', { maxLength: 150 })}
          </FormField>
          <FormField label="E-mail" error={errors.email}>
            {input('email', 'E-mail (opcional)', { keyboardType: 'email-address', maxLength: 255, autoCapitalize: 'none' })}
          </FormField>
          <FormField label="Telefone" error={errors.phone}>
            {input('phone', '(00) 00000-0000', { keyboardType: 'phone-pad', maxLength: 30 })}
          </FormField>
          <FormField label="CPF" error={errors.cpf}>
            {input('cpf', '000.000.000-00', { keyboardType: 'numeric', maxLength: 14 })}
          </FormField>
          <FormField label="RG" error={errors.rg}>
            {input('rg', 'Documento de identidade', { maxLength: 20 })}
          </FormField>
          <FormField label="Data de nascimento" error={errors.birthDate}>
              <View style={s.dateRow}>
                <TextInput style={[s.input, s.dateInput, errors.birthDate && s.inputError]} value={form.birthDate} onChangeText={value => update('birthDate', maskDate(value))} placeholder="DD/MM/AAAA" placeholderTextColor="#a8a29e" keyboardType="number-pad" maxLength={10} />
                <Pressable onPress={openCalendar} style={s.calendarButton} accessibilityLabel="Selecionar data de nascimento no calendário"><Ionicons name="calendar-outline" size={23} color={C.gold} /></Pressable>
              </View>
          </FormField>
          <FormField label="Endereço" error={errors.address}>
            {input('address', 'Rua, número, bairro, cidade e CEP', { maxLength: 500, multiline: true })}
          </FormField>
        </View>
        <View style={s.actions}>
          <Button label="Cancelar" icon="close-outline" secondary disabled={submitting} onPress={() => router.push('/clientes')} />
          <Pressable onPress={() => void submit()} disabled={submitting} style={[s.button, s.primaryButton, submitting && s.disabled]}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
            <Text allowFontScaling={false} numberOfLines={1} style={[s.buttonLabel, s.footerSaveText, s.primaryLabel]}>{submitting ? 'Salvando' : 'Salvar'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
      <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
        <View style={s.calendarBackdrop}>
          <View style={s.calendarPanel}>
            <View style={s.calendarHeader}>
              <Pressable onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} style={s.calendarNav} accessibilityLabel="Mês anterior"><Ionicons name="chevron-back" size={23} color={C.gold} /></Pressable>
              <Text allowFontScaling={false} style={s.calendarHeading}>{MONTH_NAMES[calendarMonth.getMonth()]} de {calendarMonth.getFullYear()}</Text>
              <Pressable onPress={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} style={s.calendarNav} accessibilityLabel="Próximo mês"><Ionicons name="chevron-forward" size={23} color={C.gold} /></Pressable>
            </View>
            <View style={s.calendarGrid}>
              {WEEKDAYS.map((weekday, index) => <View key={`weekday-${index}`} style={s.calendarCell}><Text style={s.calendarWeekday}>{weekday}</Text></View>)}
              {calendarDays.map((day, index) => {
                const candidate = day ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day) : null;
                const selected = candidate ? toBrazilian(candidate) === form.birthDate : false;
                return <View key={`day-${index}`} style={s.calendarCell}>{candidate && <Pressable onPress={() => { update('birthDate', toBrazilian(candidate)); setCalendarOpen(false); }} accessibilityLabel={`Selecionar ${toBrazilian(candidate)}`} style={[s.calendarDay, selected && s.calendarDaySelected]}><Text allowFontScaling={false} style={[s.calendarDayText, selected && s.calendarDayTextSelected]}>{day}</Text></Pressable>}</View>;
              })}
            </View>
            <Pressable onPress={() => setCalendarOpen(false)} style={s.calendarClose}><Text allowFontScaling={false} style={s.calendarCloseText}>Fechar</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>;
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 62, paddingHorizontal: 16, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  backIcon: { width: 39, height: 43, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, minWidth: 0, color: C.ink, fontSize: 19, lineHeight: 30, fontWeight: '700' },
  headerSave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 132, gap: 6, paddingHorizontal: 12, height: 42, borderRadius: 10, backgroundColor: C.gold },
  headerSaveText: { width: 73, color: C.white, fontSize: 13, lineHeight: 22, fontWeight: '700', textAlign: 'center', includeFontPadding: false },
  content: { paddingHorizontal: 16, paddingVertical: 23, paddingBottom: 45 },
  heading: { color: C.ink, fontSize: 27, lineHeight: 39, fontWeight: '700' },
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 22, marginTop: 4, marginBottom: 20 },
  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 17, padding: 17 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 16, marginBottom: 17 },
  cardHeadingCopy: { flex: 1, minWidth: 0 },
  iconBox: { backgroundColor: '#f7f0e6', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: C.ink, fontSize: 17, lineHeight: 27, fontWeight: '700' },
  helper: { color: C.muted, fontSize: 12, lineHeight: 20 },
  field: { marginBottom: 17 },
  label: { color: C.ink, fontSize: 14, lineHeight: 23, marginBottom: 8, fontWeight: '600' },
  input: { width: '100%', minHeight: 50, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, lineHeight: 23, color: C.ink, includeFontPadding: true },
  inputError: { borderColor: '#fca5a5' },
  multiline: { minHeight: 103, paddingTop: 13 },
  error: { fontSize: 12, lineHeight: 21, color: C.error, marginTop: 6 },
  hint: { fontSize: 11, lineHeight: 19, color: C.muted, marginTop: 5 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: '#faf8f4', borderWidth: 1, borderColor: C.border, padding: 15, borderRadius: 12, marginTop: 17 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 21, color: C.muted },
  actions: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, marginTop: 21, justifyContent: 'space-between' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 12, minHeight: 49, borderRadius: 11, minWidth: 0 },
  secondaryButton: { width: 145, borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  primaryButton: { flex: 1, backgroundColor: C.gold },
  buttonLabel: { fontSize: 13, lineHeight: 23, fontWeight: '700', includeFontPadding: false, textAlign: 'center' },
  cancelButtonLabel: { width: 88 },
  footerSaveText: { width: 74 },
  secondaryLabel: { color: C.ink }, primaryLabel: { color: C.white }, disabled: { opacity: 0.5 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dateInput: { flex: 1, minWidth: 0, width: undefined },
  calendarButton: { width: 52, height: 50, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  calendarBackdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 20 },
  calendarPanel: { width: '100%', maxWidth: 380, backgroundColor: C.white, borderRadius: 17, padding: 15 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15, gap: 4 },
  calendarNav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  calendarHeading: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 14, lineHeight: 24, fontWeight: '700', color: C.ink, textTransform: 'capitalize' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: '14.285714%', height: 43, justifyContent: 'center', alignItems: 'center' },
  calendarWeekday: { color: C.muted, fontSize: 12, fontWeight: '700' },
  calendarDay: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  calendarDaySelected: { backgroundColor: C.gold },
  calendarDayText: { width: 33, fontSize: 13, lineHeight: 21, color: C.ink, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  calendarDayTextSelected: { color: C.white },
  calendarClose: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 12, marginTop: 12 },
  calendarCloseText: { minWidth: 74, textAlign: 'center', color: C.gold, fontSize: 14, lineHeight: 22, fontWeight: '700' },
});
