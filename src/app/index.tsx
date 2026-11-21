import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { authService } from '../services/auth-service';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

const COLORS = {
  background: '#f8f6f2',
  dark: '#302c29',
  gold: '#c9954c',
  goldLight: '#d9aa69',
  button: '#a98a58',
  text: '#494139',
  border: '#e7e1d8',
  muted: '#78716c',
};

function hasExpired(token: string) {
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0, buffer = 0, decoded = '';
    for (const ch of payload.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
      const digit = alphabet.indexOf(ch);
      if (digit === -1) return true;
      buffer = (buffer << 6) | digit;
      bits += 6;
      if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((buffer >>> bits) & 255); }
    }
    const match = decoded.match(/"exp"\s*:\s*(\d+)/);
    return match ? Number(match[1]) <= Math.floor(Date.now() / 1000) : false;
  } catch { return true; }
}

export default function LoginScreen() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ login?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (token && !hasExpired(token) && active) {
          router.replace('/home');
          return;
        }
        if (token && hasExpired(token)) await SecureStore.deleteItemAsync('access_token');
      } finally {
        if (active) setCheckingSession(false);
      }
    };
    void restoreSession();
    return () => { active = false; };
  }, []);

  async function handleSubmit() {
    const nextErrors = {
      login: login.trim() ? undefined : 'Informe seu e-mail ou login',
      password: password ? undefined : 'Informe sua senha',
    };
    setErrors(nextErrors);
    if (nextErrors.login || nextErrors.password || submitting) return;

    setSubmitting(true);
    try {
      const identifier = login.trim();
      await authService.login({
        ...(identifier.includes('@') ? { email: identifier } : { login: identifier }),
        password,
      });
      router.replace('/home');
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        Alert.alert('Erro', 'Ocorreu um erro inesperado.');
      } else if (!error.response) {
        Alert.alert('Erro de conexão', 'Não foi possível conectar ao servidor. Verifique se o backend está disponível.');
      } else {
        const message: Record<number, string> = {
          400: 'Credenciais inválidas.',
          401: 'Credenciais inválidas.',
          403: 'Acesso não autorizado.',
          429: 'Muitas tentativas. Aguarde e tente novamente.',
        };
        Alert.alert('Não foi possível entrar', message[error.response.status] ?? 'Não foi possível realizar o login. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) return <SafeAreaView style={[styles.safeArea, { justifyContent: 'center' }]}><ActivityIndicator color={COLORS.button}/></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.brandPanel}>
              <View style={styles.circleLarge} />
              <View style={styles.circleSmall} />
              <Image
                source={require('../../assets/images/personalite-logo.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="Logo Personalité Creative"
              />
              <Text style={styles.brandEyebrow}>PERSONALITÉ - Creative</Text>
            </View>

            <View style={styles.formPanel}>
              <Text style={styles.label}>E-mail ou login</Text>
              <View style={[styles.inputContainer, errors.login ? styles.inputError : null]}>
                <Ionicons name="person-outline" size={19} color="#a8a29e" />
                <TextInput
                  style={styles.input}
                  placeholder="Seu e-mail ou login"
                  placeholderTextColor="#a8a29e"
                  value={login}
                  onChangeText={setLogin}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  accessibilityLabel="E-mail ou login"
                />
              </View>
              {errors.login ? <Text style={styles.errorText}>{errors.login}</Text> : null}

              <Text style={[styles.label, styles.passwordLabel]}>Senha</Text>
              <View style={[styles.inputContainer, errors.password ? styles.inputError : null]}>
                <Ionicons name="lock-closed-outline" size={19} color="#a8a29e" />
                <TextInput
                  style={styles.input}
                  placeholder="Digite sua senha"
                  placeholderTextColor="#a8a29e"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  accessibilityLabel="Senha"
                />
                <Pressable onPress={() => setShowPassword((current) => !current)} accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'} hitSlop={10}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#a8a29e" />
                </Pressable>
              </View>
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

              <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.button, submitting && styles.buttonDisabled]}>
                {submitting ? <ActivityIndicator color="#fff" /> : <><Text style={styles.buttonText}>Entrar</Text><Ionicons name="arrow-forward" size={19} color="#fff" /></>}
              </Pressable>

              <Text style={styles.registerText}>
                Ainda não possui uma conta? <Text style={styles.registerLink} onPress={() => router.push('/cadastro')}>Criar conta</Text>
              </Text>
              <Text style={styles.footer}>Personalité Creative · Gestão com elegância e simplicidade</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  card: { width: '100%', backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e9e2d8', overflow: 'hidden' },
  brandPanel: { backgroundColor: COLORS.dark, paddingHorizontal: 28, paddingTop: 30, paddingBottom: 24, overflow: 'hidden' },
  circleLarge: { position: 'absolute', width: 310, height: 310, right: -145, top: -170, borderRadius: 155, borderWidth: 1, borderColor: '#c9954c33' },
  circleSmall: { position: 'absolute', width: 220, height: 220, right: -95, top: -125, borderRadius: 110, borderWidth: 1, borderColor: '#c9954c33' },
  logo: { width: 78, height: 88, marginBottom: 12 },
  brandEyebrow: { color: COLORS.goldLight, fontSize: 11, fontWeight: '700', letterSpacing: 4 },
  brandTitle: { color: '#fff', fontSize: 38, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), marginTop: 6 },
  goldLine: { width: 64, height: 1, backgroundColor: COLORS.gold, marginTop: 19 },
  brandDescription: { color: '#ded6cb', fontSize: 14, lineHeight: 22, marginTop: 18 },
  brandFooter: { color: '#bcb0a0', fontSize: 9, letterSpacing: 0.5, marginTop: 24 },
  formPanel: { paddingHorizontal: 24, paddingVertical: 30 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#f7f0e6', borderRadius: 50, paddingHorizontal: 13, paddingVertical: 8, marginBottom: 24 },
  badgeText: { color: '#a77838', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  label: { color: COLORS.text, fontSize: 14, fontWeight: '500', marginBottom: 9 },
  passwordLabel: { marginTop: 20 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 14, gap: 10 },
  inputError: { borderColor: '#f87171' },
  input: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#292524' },
  errorText: { color: '#dc2626', fontSize: 12, marginTop: 6 },
  button: { marginTop: 28, backgroundColor: COLORS.button, borderRadius: 12, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5, lineHeight: 24, paddingHorizontal: 6, minWidth: 70, textAlign: 'center' },
  registerText: { color: COLORS.muted, fontSize: 13, textAlign: 'center', marginTop: 24 },
  registerLink: { color: COLORS.button, fontWeight: '700' },
  footer: { color: '#a8a29e', fontSize: 11, textAlign: 'center', marginTop: 36 },
});
