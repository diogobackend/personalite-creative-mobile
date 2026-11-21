import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type FormKey =
  | 'name'
  | 'email'
  | 'login'
  | 'password'
  | 'cpf'
  | 'rg'
  | 'phone'
  | 'birthDate'
  | 'address';

type RegisterForm = Record<FormKey, string>;
type FieldErrors = Partial<Record<FormKey, string>>;
type InputOptions = {
  optional?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  multiline?: boolean;
  maxLength?: number;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'words' | 'sentences';
};

const INITIAL_FORM: RegisterForm = {
  name: '',
  email: '',
  login: '',
  password: '',
  cpf: '',
  rg: '',
  phone: '',
  birthDate: '',
  address: '',
};

function validate(form: RegisterForm): FieldErrors {
  const errors: FieldErrors = {};
  const name = form.name.trim();
  const email = form.email.trim();

  if (!name) errors.name = 'Informe o nome completo';
  else if (name.length > 150) errors.name = 'Máximo de 150 caracteres';

  if (!email) errors.email = 'Informe o e-mail';
  else if (email.length > 255) errors.email = 'Máximo de 255 caracteres';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Informe um e-mail válido';

  if (form.login.length < 3) errors.login = 'Mínimo de 3 caracteres';
  else if (form.login.length > 35) errors.login = 'Máximo de 35 caracteres';
  else if (!/^[a-z]/.test(form.login)) errors.login = 'O login deve começar com uma letra minúscula';
  else if (/[A-Z]/.test(form.login)) errors.login = 'Use apenas letras minúsculas';
  else if (/\s/.test(form.login)) errors.login = 'O login não pode conter espaços';

  if (form.password.length < 8) errors.password = 'A senha deve ter pelo menos 8 caracteres';
  else if (form.password.length > 100) errors.password = 'Máximo de 100 caracteres';

  const optionalLimits: Array<[FormKey, number, string]> = [
    ['phone', 30, 'Telefone'],
    ['address', 500, 'Endereço'],
    ['cpf', 14, 'CPF'],
    ['rg', 20, 'RG'],
  ];

  for (const [key, max, label] of optionalLimits) {
    if (form[key].length > max) {
      errors[key] = `${label} deve ter no máximo ${max} caracteres`;
    }
  }

  if (form.birthDate.trim()) {
    const date = form.birthDate.trim();
    const parsed = new Date(`${date}T12:00:00`);
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === date;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (!valid) errors.birthDate = 'Informe a data no formato AAAA-MM-DD';
    else if (date > today) errors.birthDate = 'A data de nascimento não pode ser futura';
  }

  return errors;
}

// Reserva espaço no fim dos textos para evitar recorte de glifos no Android.
// Não altera a leitura acessível: o texto anunciado permanece o mesmo.
function DisplayText({ children, ...props }: ComponentProps<typeof Text>) {
  const content = typeof children === 'string' ? children : null;
  return (
    <Text {...props} accessibilityLabel={content ?? props.accessibilityLabel}>
      {children}{'\u00A0\u00A0\u00A0'}
    </Text>
  );
}

export default function CadastroScreen() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterForm>(INITIAL_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isRegistering] = useState(false);

  function update(key: FormKey, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function submit() {
    const nextErrors = validate(form);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      Alert.alert('Verifique os dados', 'Corrija os campos indicados antes de continuar.');
      return;
    }

    // Integração com userService.register ficará para a etapa de conexão com o backend.
    Alert.alert('Cadastro validado', 'Os dados estão válidos. Falta integrar o serviço de cadastro do backend.');
  }

  function field(key: FormKey, label: string, placeholder: string, options: InputOptions = {}) {
    return (
      <View style={styles.field} key={key}>
        <View style={styles.fieldLabelRow}>
          <DisplayText style={styles.label}>{label}</DisplayText>
          {options.optional ? <DisplayText style={styles.optional}>Opcional</DisplayText> : null}
        </View>

        <View style={[styles.inputShell, errors[key] ? styles.inputError : undefined]}>
          {options.icon ? (
            <Ionicons name={options.icon} color="#a8a29e" size={19} style={styles.inputIcon} />
          ) : null}
          <TextInput
            style={[styles.input, options.multiline ? styles.multiline : undefined]}
            value={form[key]}
            onChangeText={(value) => update(key, value)}
            placeholder={placeholder}
            placeholderTextColor="#a8a29e"
            keyboardType={options.keyboardType ?? 'default'}
            multiline={options.multiline}
            maxLength={options.maxLength}
            secureTextEntry={Boolean(options.secureTextEntry && !showPassword)}
            autoCapitalize={options.autoCapitalize ?? 'sentences'}
            autoCorrect={false}
            textAlignVertical={options.multiline ? 'top' : 'center'}
            accessibilityLabel={label}
          />
          {options.secureTextEntry ? (
            <Pressable
              onPress={() => setShowPassword((current) => !current)}
              hitSlop={12}
              accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              style={styles.visibilityButton}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} color="#a8a29e" size={21} />
            </Pressable>
          ) : null}
        </View>
        {errors[key] ? <DisplayText style={styles.errorText}>{errors[key]}</DisplayText> : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.brandPanel}>
              <View style={styles.decorativeCircleLarge} />
              <View style={styles.decorativeCircleSmall} />
              <Image
                source={require('../../assets/images/personalite-logo.png')}
                resizeMode="contain"
                style={styles.logo}
                accessibilityLabel="Logo Personalité Creative"
              />
              <DisplayText style={styles.brandEyebrow}>PERSONALITÉ</DisplayText>
            </View>

            <View style={styles.formPanel}>
              <View style={styles.sectionHeading}>
                <Ionicons name="person-outline" size={18} color="#b99b66" />
                <DisplayText style={styles.sectionTitle}>Informações de acesso</DisplayText>
              </View>

              {field('name', 'Nome completo', 'Seu nome completo', {
                maxLength: 150,
                autoCapitalize: 'words',
              })}
              {field('email', 'E-mail', 'seu@email.com', {
                icon: 'mail-outline',
                keyboardType: 'email-address',
                maxLength: 255,
                autoCapitalize: 'none',
              })}
              {field('login', 'Login', 'seu.login', {
                maxLength: 35,
                autoCapitalize: 'none',
              })}
              {field('password', 'Senha', 'Mínimo de 8 caracteres', {
                icon: 'lock-closed-outline',
                maxLength: 100,
                secureTextEntry: true,
                autoCapitalize: 'none',
              })}

              <View style={[styles.sectionHeading, styles.personalSection]}>
                <Ionicons name="person-outline" size={18} color="#b99b66" />
                <DisplayText style={styles.sectionTitle}>Informações pessoais</DisplayText>
                <DisplayText style={styles.sectionOptional}>Opcionais</DisplayText>
              </View>

              {field('cpf', 'CPF', '000.000.000-00', {
                optional: true,
                keyboardType: 'numeric',
                maxLength: 14,
              })}
              {field('rg', 'RG', 'Número do RG', {
                optional: true,
                maxLength: 20,
              })}
              {field('phone', 'Telefone', '(98) 99999-9999', {
                optional: true,
                icon: 'call-outline',
                keyboardType: 'phone-pad',
                maxLength: 30,
              })}
              {field('birthDate', 'Data de nascimento', 'AAAA-MM-DD', {
                optional: true,
                icon: 'calendar-outline',
                maxLength: 10,
                keyboardType: 'numeric',
              })}
              {field('address', 'Endereço', 'Rua, número, bairro, cidade...', {
                optional: true,
                icon: 'location-outline',
                multiline: true,
                maxLength: 500,
              })}

              <Pressable
                onPress={submit}
                disabled={isRegistering}
                style={({ pressed }) => [styles.submitButton, pressed && styles.buttonPressed]}
              >
                {isRegistering ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <View style={styles.submitContent}>
                    <DisplayText style={styles.submitText}>Criar conta</DisplayText>
                    <Ionicons name="arrow-forward" size={19} color="#fff" />
                  </View>
                )}
              </Pressable>

              <View style={styles.loginRow}>
                <DisplayText style={styles.loginText}>Já possui uma conta?</DisplayText>
                <Pressable onPress={() => router.replace('/')} hitSlop={8}>
                  <DisplayText style={styles.loginLink}>Entrar</DisplayText>
                </Pressable>
              </View>

              <DisplayText style={styles.formFooter}>
                Personalité Creative · Gestão com elegância e simplicidade
              </DisplayText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#f8f6f2' },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e9e2d8',
    overflow: 'hidden',
  },
  brandPanel: {
    overflow: 'hidden',
    backgroundColor: '#39342f',
    paddingHorizontal: 25,
    paddingTop: 26,
    paddingBottom: 24,
  },
  decorativeCircleLarge: {
    position: 'absolute',
    width: 245,
    height: 245,
    top: -130,
    right: -90,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: 'rgba(214,184,121,0.22)',
  },
  decorativeCircleSmall: {
    position: 'absolute',
    width: 190,
    height: 190,
    top: -100,
    right: -45,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(214,184,121,0.22)',
  },
  logo: { width: 76, height: 82, marginBottom: 14 },
  brandEyebrow: {
    color: '#d5bd91',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    paddingRight: 14,
    alignSelf: 'flex-start',
  },
  formPanel: {
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 26,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#f6f0e5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 24,
  },
  chipText: {
    color: '#977c4e',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingRight: 12,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#eee8df',
    paddingBottom: 14,
    marginBottom: 21,
  },
  sectionTitle: {
    fontSize: 14,
    color: '#51483e',
    fontWeight: '700',
    paddingRight: 10,
    flexGrow: 1,
    flexShrink: 0,
  },
  sectionOptional: {
    fontSize: 11,
    color: '#a8a29e',
    marginLeft: 'auto',
    paddingRight: 10,
    flexShrink: 0,
  },
  personalSection: { marginTop: 23 },
  field: { marginBottom: 18, width: '100%' },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    minHeight: 22,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#494139',
    paddingRight: 12,
    flexGrow: 1,
    flexShrink: 0,
  },
  optional: {
    fontSize: 11,
    color: '#a8a29e',
    paddingRight: 12,
    flexShrink: 0,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e7e1d8',
    borderRadius: 12,
    paddingHorizontal: 13,
    backgroundColor: '#fff',
    minHeight: 52,
    width: '100%',
  },
  inputError: { borderColor: '#f87171' },
  inputIcon: { marginRight: 9 },
  input: {
    flex: 1,
    minWidth: 0,
    color: '#292524',
    fontSize: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    paddingHorizontal: 2,
  },
  multiline: { minHeight: 90, paddingTop: 14 },
  visibilityButton: { padding: 5, justifyContent: 'center', alignItems: 'center' },
  errorText: {
    color: '#dc2626',
    fontSize: 11,
    marginTop: 6,
    paddingRight: 12,
  },
  submitButton: {
    backgroundColor: '#a98a58',
    borderRadius: 12,
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 6,
  },
  submitContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  buttonPressed: { opacity: 0.82 },
  submitText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    textAlign: 'center',
    minWidth: 114,
  },
  loginRow: {
    marginTop: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  loginText: {
    color: '#78716c',
    fontSize: 13,
    paddingRight: 10,
  },
  loginLink: {
    color: '#a98a58',
    fontSize: 13,
    fontWeight: '700',
    paddingRight: 12,
  },
  formFooter: {
    marginTop: 33,
    textAlign: 'center',
    color: '#a8a29e',
    fontSize: 11,
    lineHeight: 19,
    paddingHorizontal: 10,
  },
});
