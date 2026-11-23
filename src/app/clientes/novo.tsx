import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
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
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) &&
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value;
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
  if (form.birthDate && (!validDate(form.birthDate) || form.birthDate > todayLocal())) {
    errors.birthDate = 'Informe uma data válida que não seja futura (AAAA-MM-DD).';
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
    <SafeText style={[s.buttonLabel, secondary ? s.secondaryLabel : s.primaryLabel]}>{label}</SafeText>
  </Pressable>;
}

export default function NovoClienteScreen() {
  const [form, setForm] = useState<ClientForm>({ ...INITIAL });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

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
        birthDate: form.birthDate.trim() || null,
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
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SafeText style={s.heading}>Cadastrar cliente</SafeText>
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
            {input('birthDate', 'AAAA-MM-DD', { maxLength: 10, autoCapitalize: 'none' })}
            <SafeText style={s.hint}>Formato: ano-mês-dia. Exemplo: 1998-05-21.</SafeText>
          </FormField>
          <FormField label="Endereço" error={errors.address}>
            {input('address', 'Rua, número, bairro, cidade e CEP', { maxLength: 500, multiline: true })}
          </FormField>
        </View>
        <View style={s.actions}>
          <Button label="Cancelar" icon="close-outline" secondary disabled={submitting} onPress={() => router.push('/clientes')} />
          <Pressable onPress={() => void submit()} disabled={submitting} style={[s.button, s.primaryButton, submitting && s.disabled]}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
            <SafeText style={[s.buttonLabel, s.primaryLabel]}>{submitting ? 'Cadastrando...' : 'Cadastrar cliente'}</SafeText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 62, paddingHorizontal: 16, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  backIcon: { width: 39, height: 43, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: C.ink, fontSize: 19, lineHeight: 30, fontWeight: '700' },
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 21, justifyContent: 'flex-end' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, minHeight: 49, borderRadius: 11 },
  secondaryButton: { borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  primaryButton: { backgroundColor: C.gold },
  buttonLabel: { fontSize: 13, lineHeight: 23, fontWeight: '700' },
  secondaryLabel: { color: C.ink }, primaryLabel: { color: C.white }, disabled: { opacity: 0.5 },
});
