import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
    ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet,
    Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type IconName = keyof typeof Ionicons.glyphMap;
type ExpenseStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
type Allocation = 'GENERAL' | 'SPECIFIC_PRODUCT' | 'CATEGORY_PRODUCTS';
type ExpenseProduct = { productId: string; allocatedValue: number };
type Expense = {
  id: string; name: string; description: string | null; value: number;
  paidAmount: number; remainingAmount: number; paidPercentage: number;
  category: string; allocationType: Allocation; status: ExpenseStatus;
  quantity: number | null; products: ExpenseProduct[];
  expenseDate: string; createdAt: string; updatedAt: string;
};
type Movement = {
  id: string; originId: string; originCode: string; origin: 'SALE' | 'EXPENSE';
  operation: string; direction: 'IN' | 'OUT' | null; amount: number;
  description: string | null; createdAt: string;
};
type MovementResponse = Movement[] | { content: Movement[]; totalPages?: number } | Movement;
type Product = { id: string; name: string };

const C = {
  bg: '#f8f6f2', card: '#fff', ink: '#342d27', muted: '#81766b',
  gold: '#a98a58', border: '#ece6dc', pale: '#f4ede2', red: '#b91c1c', green: '#047857',
};
const STATUS: Record<ExpenseStatus, string> = {
  PENDING: '0% pago', PARTIALLY_PAID: 'Parcialmente pago',
  PAID: '100% pago', CANCELLED: 'Cancelado',
};
const MOVEMENT: Record<string, string> = {
  UPDATED: 'Despesa atualizada', PAYMENT: 'Pagamento', REFUND: 'Estorno',
  VALUE_ADJUSTMENT_INCREASE: 'Aumento de valor',
  VALUE_ADJUSTMENT_DECREASE: 'Redução de valor', CANCELLED: 'Cancelamento',
};
const CATEGORY: Record<string, string> = {
  TRANSPORT: 'Transporte', PRODUCTION: 'Produção', INVESTMENT: 'Investimento',
  BILLS: 'Contas', MARKETING: 'Marketing', PACKAGING: 'Embalagens',
  EQUIPMENT: 'Equipamentos', STOCK: 'Estoque', OTHER: 'Outros',
};
const money = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));
function shortDate(value?: string | null) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}
function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) return 'Despesa não encontrada.';
    if (error.response?.status === 401) return 'Sessão expirada. Faça login novamente.';
    if (error.response?.status === 403) return 'Você não possui permissão para consultar a despesa.';
    const message: unknown = error.response?.data?.message;
    return typeof message === 'string' && message.trim() ? message : 'Não foi possível carregar a despesa.';
  }
  return error instanceof Error ? error.message : 'Não foi possível carregar a despesa.';
}
function Detail({ label, value }: { label: string; value: ReactNode }) {
  return <View style={styles.detail}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>;
}
function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <View style={styles.iconBox}><Ionicons name={icon} size={20} color={C.gold} /></View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>;
}
function NavigationButton({ label, icon, onPress, primary = false }: {
  label: string; icon: IconName; onPress: () => void; primary?: boolean;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={[styles.button, primary && styles.primaryButton]}>
    <Ionicons name={icon} size={18} color={primary ? '#fff' : C.gold} />
    <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

export default function DetalheDespesaScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0] ?? '';
  const [expense, setExpense] = useState<Expense | null>(null);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementsError, setMovementsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    setMovements([]);
    setMovementsError(false);
    setProducts({});
    try {
      if (!id) throw new Error('Identificador da despesa inválido.');
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') {
        if (!signal.aborted) router.replace('/');
        throw new Error('Sessão inválida. Faça login novamente.');
      }
      const headers = { Authorization: `Bearer ${token}` };
      const response = await api.get<Expense>(`/expenses/${encodeURIComponent(id)}`, { headers, signal });
      if (signal.aborted) return;
      setExpense(response.data);

      const [movementResult, productResult] = await Promise.allSettled([
        api.get<MovementResponse>('/moviments', { headers, params: { page: 0, size: 100 }, signal }),
        response.data.products?.length
          ? api.get<{ content: Product[] }>('/products', { headers, params: { page: 0, size: 100 }, signal })
          : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      if (movementResult.status === 'fulfilled') {
        const data = movementResult.value.data;
        const all = Array.isArray(data) ? data : 'content' in data ? data.content : [data];
        setMovements(all.filter(m => m.origin === 'EXPENSE' && m.originId === id && m.operation !== 'CREATED')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      } else {
        setMovementsError(true);
      }
      if (productResult.status === 'fulfilled' && productResult.value) {
        const items = productResult.value.data.content;
        setProducts(Object.fromEntries(items.map(p => [p.id, p])));
      }
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setExpense(null);
      setError(errorMessage(cause));
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const refresh = () => { setRefreshing(true); setReloadKey(n => n + 1); };
  const status = expense?.status;
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.gold} colors={[C.gold]} />}>
      <View style={styles.navigation}>
        <NavigationButton label="Voltar para despesas" icon="arrow-back-outline" onPress={() => router.push('/despesas')} />
        {expense && <NavigationButton label="Editar" icon="pencil-outline" primary
          onPress={() => router.push(`/despesas/${expense.id}/editar` as never)} />}
      </View>
      <Text style={styles.pageTitle}>Detalhes da despesa</Text>
      {loading ? <View style={styles.feedback}><ActivityIndicator size="large" color={C.gold} /><Text style={styles.muted}>Carregando despesa...</Text></View>
        : error || !expense ? <View style={styles.feedback}>
          <Ionicons name="receipt-outline" size={38} color={C.gold} />
          <Text style={styles.error}>{error ?? 'Despesa não encontrada.'}</Text>
          <NavigationButton label="Tentar novamente" icon="refresh-outline" onPress={() => setReloadKey(n => n + 1)} />
        </View> : <>
          <View style={styles.hero}>
            <Text style={styles.name}>{expense.name}</Text>
            <Text style={styles.muted}>{CATEGORY[expense.category] ?? expense.category}</Text>
            <View style={[styles.status, status === 'PAID' ? styles.statusPaid : status === 'CANCELLED' ? styles.statusCancelled : status === 'PARTIALLY_PAID' ? styles.statusPartial : styles.statusPending]}>
              <Text style={styles.statusText}>{STATUS[expense.status] ?? expense.status}</Text>
            </View>
            <View style={styles.heroDivider} />
            <Text style={styles.detailLabel}>VALOR TOTAL</Text>
            <Text style={styles.total}>{money(expense.value)}</Text>
            {status === 'PARTIALLY_PAID' && <View style={styles.moneyCards}>
              <View style={styles.moneyCard}><Text style={styles.detailLabel}>VALOR JÁ PAGO</Text>
                <Text style={styles.cardValue}>{money(expense.paidAmount)}</Text>
                <Text style={styles.paidPct}>{Number(expense.paidPercentage ?? 0).toFixed(2).replace('.', ',')}%</Text>
              </View>
              <View style={styles.moneyCard}><Text style={styles.detailLabel}>VALOR RESTANTE</Text>
                <Text style={styles.cardValue}>{money(expense.remainingAmount)}</Text>
                <Text style={styles.remainingPct}>{(100 - Number(expense.paidPercentage ?? 0)).toFixed(2).replace('.', ',')}%</Text>
              </View>
            </View>}
            {status === 'CANCELLED' && <Text style={styles.error}>Despesa cancelada. Os valores pagos permanecem registrados.</Text>}
          </View>

          <Section title="Informações gerais" icon="document-text-outline">
            <Detail label="Categoria" value={CATEGORY[expense.category] ?? expense.category} />
            {expense.category === 'item de estoque' && <Detail label="Quantidade" value={expense.quantity ?? '—'} />}
            <Detail label="Descrição" value={expense.description?.trim() || 'Sem descrição'} />
          </Section>
          <Section title="Datas e registros" icon="calendar-outline">
            <Detail label="Data da despesa" value={shortDate(expense.expenseDate)} />
            <Detail label="Data de cadastro" value={dateTime(expense.createdAt)} />
            <Detail label="Última atualização" value={dateTime(expense.updatedAt)} />
          </Section>
          <Section title="Alocação" icon="layers-outline">
            {expense.allocationType === 'GENERAL'
              ? <Text style={styles.muted}>Esta despesa é geral e não possui produtos vinculados.</Text>
              : <>
                <Text style={styles.subtitle}>Produtos vinculados ({expense.products?.length ?? 0})</Text>
                {(expense.products ?? []).map(product => <Pressable key={product.productId} style={styles.productRow}
                  onPress={() => router.push(`/produtos/${product.productId}` as never)}>
                  <View style={styles.productName}><Ionicons name="cube-outline" size={18} color={C.gold} />
                    <Text style={styles.linkText}>{products[product.productId]?.name ?? `Produto ${product.productId}`}</Text></View>
                  <Text style={styles.productValue}>{money(product.allocatedValue)}</Text>
                </Pressable>)}
              </>}
          </Section>
          <Section title="Histórico de movimentações" icon="receipt-outline">
            {movementsError ? <Text style={styles.muted}>Não foi possível carregar o histórico.</Text>
              : movements.length === 0 ? <Text style={styles.muted}>Nenhuma movimentação encontrada.</Text>
              : movements.map(movement => {
                const entry = movement.direction === 'IN';
                const exit = movement.direction === 'OUT';
                return <View key={movement.id} style={styles.movement}>
                  <Text style={styles.movementCode}>{movement.originCode?.toUpperCase() || movement.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={[styles.movementValue, entry && styles.inText, exit && styles.outText]}>
                    {entry ? '+ ' : exit ? '− ' : ''}{money(movement.amount)}
                  </Text>
                  <Detail label="Operação" value={MOVEMENT[movement.operation] ?? movement.operation} />
                  <Detail label="Data" value={dateTime(movement.createdAt)} />
                </View>;
              })}
          </Section>
        </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 19, paddingBottom: 45 },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 9, marginBottom: 20 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fff' },
  primaryButton: { backgroundColor: C.gold, borderColor: C.gold },
  buttonText: { color: C.gold, fontWeight: '700', fontSize: 12, lineHeight: 20 },
  primaryText: { color: '#fff' },
  pageTitle: { fontSize: 27, lineHeight: 38, color: C.ink, fontFamily: 'serif', marginBottom: 17 },
  feedback: { minHeight: 240, borderRadius: 15, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 23 },
  error: { color: C.red, fontSize: 13, lineHeight: 22, marginTop: 10 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 22, marginTop: 5 },
  hero: { backgroundColor: C.pale, borderRadius: 17, borderWidth: 1, borderColor: '#e8dfd2', padding: 20, marginBottom: 16 },
  name: { color: C.ink, fontWeight: '700', fontSize: 21, lineHeight: 31 },
  status: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', marginTop: 12 },
  statusPaid: { backgroundColor: '#dcfce7' }, statusPending: { backgroundColor: '#fef3c7' },
  statusPartial: { backgroundColor: '#dbeafe' }, statusCancelled: { backgroundColor: '#fee2e2' },
  statusText: { color: C.ink, fontWeight: '700', fontSize: 12, lineHeight: 20 },
  heroDivider: { height: 1, backgroundColor: '#e4d8c7', marginTop: 20, marginBottom: 17 },
  total: { color: C.ink, fontSize: 30, fontWeight: '700', lineHeight: 43, marginTop: 7 },
  moneyCards: { gap: 10, marginTop: 17 },
  moneyCard: { borderWidth: 1, borderColor: '#e4d8c7', borderRadius: 12, padding: 14, backgroundColor: '#ffffffb9' },
  cardValue: { color: C.ink, fontSize: 20, fontWeight: '700', lineHeight: 32, marginTop: 7 },
  paidPct: { color: C.green, fontWeight: '700', marginTop: 5 },
  remainingPct: { color: '#b45309', fontWeight: '700', marginTop: 5 },
  section: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 18, marginBottom: 15, gap: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: '#f0ebe5', paddingBottom: 14 },
  iconBox: { width: 37, height: 37, borderRadius: 11, backgroundColor: '#f5efe6', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 17, fontWeight: '700', lineHeight: 27, color: C.ink },
  detail: { gap: 5 },
  detailLabel: { color: '#94887b', fontSize: 11, letterSpacing: 0.4, lineHeight: 19, fontWeight: '600' },
  detailValue: { color: C.ink, fontSize: 14, lineHeight: 23, fontWeight: '600' },
  subtitle: { color: C.ink, fontWeight: '700', fontSize: 14, lineHeight: 24 },
  productRow: { borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fdfbf8', padding: 13, gap: 8 },
  productName: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  linkText: { color: C.gold, fontSize: 13, lineHeight: 22, fontWeight: '700', flex: 1 },
  productValue: { color: C.ink, fontSize: 14, fontWeight: '700', lineHeight: 24 },
  movement: { padding: 14, borderRadius: 12, backgroundColor: '#faf8f5', borderWidth: 1, borderColor: C.border, gap: 6 },
  movementCode: { color: C.muted, fontSize: 12, lineHeight: 20, fontWeight: '700' },
  movementValue: { color: C.ink, fontSize: 19, lineHeight: 30, fontWeight: '700' },
  inText: { color: C.green }, outText: { color: C.red },
});
