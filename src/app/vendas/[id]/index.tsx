import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type IconName = ComponentProps<typeof Ionicons>['name'];
type SaleItem = {
  id: string; productId: string; inventoryId: string | null; quantity: number;
  unitPrice: number | null; additionalAmount: number; totalPrice: number | null;
  color: string | null; brand: string | null; model: string | null;
  size: string | null; material: string | null;
};
type Sale = {
  id: string; customerId: string; deliveryDeadline: string | null;
  totalAmount: number; additionalAmount?: number | null;
  additionalDescription?: string | null;
  downPaymentPercentage: number; downPaymentAmount: number;
  paidPercentage: number; paidAmount: number; remainingPercentage: number;
  remainingAmount: number; paymentMethod: string; paymentStatus: string;
  deadlineStatus: string; observation: string | null; items: SaleItem[];
  deliveredAt: string | null; createdAt: string; updatedAt: string;
};
type Customer = {
  id: string; name: string; rg?: string | null; email?: string | null;
  cpf?: string | null; phone?: string | null;
};
type Product = { id: string; name: string; code?: string | null };
type Movement = {
  id: string; originId: string; originCode: string; origin: 'SALE' | 'EXPENSE';
  operation: string; direction: 'IN' | 'OUT' | null; amount: number;
  description: string | null; createdAt: string;
};
type MovementsResponse = Movement[] | { content: Movement[] };

const C = {
  bg: '#faf8f5', white: '#fff', dark: '#342d27', text: '#51473d',
  muted: '#81766b', gold: '#a98a58', border: '#eee8df', cream: '#f4ede2',
};
const PAYMENT_METHODS: Record<string, string> = {
  PIX: 'Pix', CASH: 'Dinheiro', CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito', BANK_TRANSFER: 'Transferência bancária',
  BANK_SLIP: 'Boleto',
};
const PAYMENT_STATUSES: Record<string, string> = {
  UNPAID: 'Não pago', PARTIALLY_PAID: 'Parcialmente pago', PAID: 'Pago',
};
const DEADLINE_STATUSES: Record<string, string> = {
  NO_DEADLINE: 'Sem prazo', OVERDUE: 'Atrasado',
  DUE_TODAY: 'Vence hoje', ON_TIME: 'No prazo',
};
const MOVEMENT_LABELS: Record<string, string> = {
  UPDATED: 'Venda atualizada', PAYMENT: 'Pagamento', REFUND: 'Estorno',
  VALUE_ADJUSTMENT_INCREASE: 'Aumento de valor',
  VALUE_ADJUSTMENT_DECREASE: 'Redução de valor',
};
const currency = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));
function date(value?: string | null) {
  if (!value) return '—';
  const [year, month, day] = value.split('T')[0].split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}
function dateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function serverError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) return 'Venda não encontrada.';
    if (error.response?.status === 401 || error.response?.status === 403) return 'Sessão inválida ou sem permissão.';
    if (typeof error.response?.data?.message === 'string') return error.response.data.message;
    return error.response ? 'Não foi possível carregar os detalhes da venda.' : 'Não foi possível conectar ao servidor.';
  }
  return error instanceof Error ? error.message : 'Ocorreu um erro ao consultar a venda.';
}

// Textos sem limitação de linhas nem encolhimento de fonte, para não cortar
// o último caractere em dispositivos Android com diferentes escalas.
function SafeText({ style, children, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[styles.safeText, style]}>{children}</Text>;
}
function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}><Ionicons name={icon} size={19} color="#927448" /></View>
      <SafeText style={styles.sectionTitle}>{title}</SafeText>
    </View>
    {children}
  </View>;
}
function Field({ label, value }: { label: string; value: ReactNode }) {
  return <View style={styles.field}>
    <SafeText style={styles.fieldLabel}>{label}</SafeText>
    {typeof value === 'string' || typeof value === 'number'
      ? <SafeText style={styles.fieldValue}>{value}</SafeText> : value}
  </View>;
}
function getColor(value: string): string | undefined {
  const name = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const colors: Record<string, string> = {
    branco: '#ffffff', branca: '#ffffff', preto: '#000000', preta: '#000000',
    vermelho: '#dc2626', vermelha: '#dc2626', azul: '#2563eb', verde: '#16a34a',
    amarelo: '#eab308', amarela: '#eab308', rosa: '#ec4899', roso: '#ec4899',
    roxo: '#9333ea', roxa: '#9333ea', laranja: '#f97316', marrom: '#92400e',
    cinza: '#6b7280', bege: '#d6c2a1', dourado: '#ca8a04', dourada: '#ca8a04',
    prata: '#9ca3af', prateado: '#9ca3af', prateada: '#9ca3af',
  };
  return colors[name];
}
function contrastingColor(value: string, background: string | undefined) {
  if (!background) return C.dark;
  const clean = background.replace('#', '');
  if (clean.length !== 6) return C.dark;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 165 ? '#000' : '#fff';
}
function asList(data: unknown): Record<string, unknown>[] {
  const collection = Array.isArray(data) ? data :
    data && typeof data === 'object' && 'content' in data ? (data as { content: unknown }).content : [];
  return Array.isArray(collection) ? collection.filter(x => x != null && typeof x === 'object') : [];
}

export default function SaleDetailsScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementsError, setMovementsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!id) { setError('Identificador da venda não informado.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    setCustomer(null);
    setProducts({});
    setMovements([]);
    setMovementsError(false);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') {
        if (!signal.aborted) router.replace('/');
        return;
      }
      if (signal.aborted) return;
      const config = { signal, headers: { Authorization: `Bearer ${token}` } };
      const { data: saleData } = await api.get<Sale>(`/sales/${encodeURIComponent(id)}`, config);
      if (signal.aborted) return;
      setSale(saleData);

      const [customersResult, productsResult, movementsResult] = await Promise.allSettled([
        api.get('/users', { ...config, params: { page: 0, size: 100 } }),
        api.get('/products', { ...config, params: { page: 0, size: 100 } }),
        api.get<MovementsResponse>('/moviments', { ...config, params: { saleId: id, page: 0, size: 100 } }),
      ]);
      if (signal.aborted) return;

      if (customersResult.status === 'fulfilled') {
        const entries = asList(customersResult.value.data);
        const matched = entries.find(entry => (entry.userId ?? entry.id) === saleData.customerId);
        if (matched) {
          setCustomer({
            id: String(matched.userId ?? matched.id ?? ''),
            name: String(matched.name ?? ''),
            cpf: typeof matched.cpf === 'string' ? matched.cpf : null,
            rg: typeof matched.rg === 'string' ? matched.rg : null,
            email: typeof matched.email === 'string' ? matched.email : null,
            phone: typeof (matched.phone ?? matched.telephone) === 'string' ? String(matched.phone ?? matched.telephone) : null,
          });
        }
      }
      // Consulta por ID como fallback para clientes fora da primeira página.
      if (customersResult.status !== 'fulfilled' ||
          !asList(customersResult.value.data).some(entry => (entry.userId ?? entry.id) === saleData.customerId)) {
        try {
          const { data } = await api.get<{ userId?: string; id?: string; name: string; cpf?: string; rg?: string; email?: string; phone?: string; telephone?: string }>(
            '/users/id', { ...config, params: { userId: saleData.customerId } },
          );
          if (!signal.aborted) setCustomer({ id: data.userId ?? data.id ?? saleData.customerId, name: data.name,
            cpf: data.cpf, rg: data.rg, email: data.email, phone: data.phone ?? data.telephone });
        } catch { /* Dados auxiliares opcionais. */ }
      }

      if (productsResult.status === 'fulfilled') {
        const entries = asList(productsResult.value.data);
        setProducts(Object.fromEntries(entries.filter(x => typeof x.id === 'string').map(entry => [String(entry.id), {
          id: String(entry.id), name: String(entry.name ?? ''),
          code: typeof (entry.code ?? entry.commercialCode) === 'string' ? String(entry.code ?? entry.commercialCode) : null,
        }])));
      }
      if (movementsResult.status === 'fulfilled') {
        const raw = movementsResult.value.data;
        const entries = (Array.isArray(raw) ? raw : raw.content) ?? [];
        setMovements(entries.filter(m => m.origin === 'SALE' && m.originId === id && m.operation !== 'CREATED')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      } else {
        setMovementsError(true);
      }
    } catch (cause) {
      if (signal.aborted || axios.isCancel(cause)) return;
      setSale(null);
      setError(serverError(cause));
      if (axios.isAxiosError(cause) && cause.response?.status === 401) {
        await SecureStore.deleteItemAsync('access_token');
        router.replace('/');
      }
    } finally {
      if (!signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const navigateBack = () => router.navigate('/vendas');
  const navigateEdit = () => { if (sale) router.push(`/vendas/${sale.id}/atualizar` as never); };

  const info = customer ? [
    { label: 'CPF', value: customer.cpf?.trim() },
    { label: 'RG', value: customer.rg?.trim() },
    { label: 'Telefone', value: customer.phone?.trim() },
    { label: 'E-mail', value: customer.email?.trim() && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@/i.test(customer.email.trim()) ? customer.email.trim() : null },
  ].filter(row => row.value) : [];

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.topBar}>
      <Pressable style={styles.backIcon} onPress={navigateBack} accessibilityLabel="Voltar">
        <Ionicons name="arrow-back" size={23} color={C.dark} />
      </Pressable>
      <SafeText style={styles.topTitle}>Detalhes da venda</SafeText>
      <Pressable style={styles.backIcon} onPress={() => setReloadKey(n => n + 1)} accessibilityLabel="Atualizar venda">
        <Ionicons name="refresh-outline" size={22} color={C.gold} />
      </Pressable>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey(n => n + 1); }} colors={[C.gold]} tintColor={C.gold} />}>
      {loading ? <View style={styles.feedback}>
        <ActivityIndicator size="large" color={C.gold} />
        <SafeText style={styles.muted}>Carregando venda...</SafeText>
      </View> : error || !sale ? <View style={styles.feedback}>
        <Ionicons name="receipt-outline" size={42} color={C.gold} />
        <SafeText style={styles.error}>{error ?? 'Venda não encontrada.'}</SafeText>
        <Pressable style={styles.primaryButton} onPress={navigateBack}><SafeText style={styles.primaryText}>Voltar</SafeText></Pressable>
      </View> : <>
        <View style={styles.toolbar}>
          <Pressable onPress={navigateBack} style={styles.backLink}><Ionicons name="arrow-back" size={16} color="#927448" /><Text style={styles.linkText}>Voltar{'\u00A0\u00A0'}</Text></Pressable>
          <Pressable onPress={navigateEdit} style={styles.primaryButton}><Ionicons name="pencil-outline" size={17} color="#fff" /><Text style={styles.primaryText}>Atualizar{'\u00A0\u00A0'}</Text></Pressable>
        </View>

        <View style={styles.hero}>
          <SafeText style={styles.fieldLabel}>CLIENTE</SafeText>
          <SafeText style={styles.heroName}>{customer?.name ?? 'Cliente não identificado'}</SafeText>
          <SafeText style={styles.muted}>Registrada em {dateTime(sale.createdAt)}</SafeText>
          <View style={[styles.badge,
            sale.paymentStatus === 'PAID' ? styles.badgePaid :
            sale.paymentStatus === 'UNPAID' ? styles.badgeUnpaid : styles.badgePartial]}>
            <Text style={styles.badgeText}>{PAYMENT_STATUSES[sale.paymentStatus] ?? sale.paymentStatus}{'\u00A0\u00A0\u00A0'}</Text>
          </View>
          <View style={styles.heroDivider} />
          <SafeText style={styles.fieldLabel}>VALOR TOTAL</SafeText>
          <SafeText style={styles.heroAmount}>{currency(sale.totalAmount)}</SafeText>
        </View>

        {info.length ? <Section title="Dados do comprador" icon="person-outline">
          {info.map(entry => <Field key={entry.label} label={entry.label} value={entry.value ?? '—'} />)}
        </Section> : null}

        <Section title="Entrega e registros" icon="calendar-outline">
          {sale.deliveryDeadline ? <Field label="Prazo de entrega" value={date(sale.deliveryDeadline)} /> : null}
          <Field label="Situação da entrega" value={sale.deliveredAt ? 'Entregue' : DEADLINE_STATUSES[sale.deadlineStatus] ?? sale.deadlineStatus} />
          <Field label="Última atualização" value={dateTime(sale.updatedAt)} />
        </Section>

        <Section title="Informações financeiras" icon="card-outline">
          <View style={styles.metrics}>
            <View style={styles.metricCell}><Field label={`Entrada (${sale.downPaymentPercentage}%)`} value={currency(sale.downPaymentAmount)} /></View>
            <View style={styles.metricCell}><Field label={`Já pago (${sale.paidPercentage}%)`} value={currency(sale.paidAmount)} /></View>
            <View style={styles.metricCell}><Field label={`Restante (${sale.remainingPercentage}%)`} value={currency(sale.remainingAmount)} /></View>
          </View>
          <Field label="Forma de pagamento" value={PAYMENT_METHODS[sale.paymentMethod] ?? sale.paymentMethod} />
          <Field label="Status do pagamento" value={PAYMENT_STATUSES[sale.paymentStatus] ?? sale.paymentStatus} />
          <Field label="Valor adicional" value={currency(sale.additionalAmount)} />
          <Field label="Descrição do adicional" value={sale.additionalDescription?.trim() || '—'} />
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, Number(sale.paidPercentage) || 0))}%` as `${number}%` }]} /></View>
          <SafeText style={styles.progressText}>{sale.paidPercentage}% do valor pago</SafeText>
        </Section>

        <Section title={`Produtos comprados (${sale.items?.length ?? 0})`} icon="cube-outline">
          {!sale.items?.length ? <SafeText style={styles.muted}>Nenhum produto vinculado.</SafeText> : sale.items.map((item, index) => {
            const product = products[item.productId];
            const characteristics = [
              { label: 'Cor', value: item.color }, { label: 'Tamanho', value: item.size },
              { label: 'Material', value: item.material }, { label: 'Marca', value: item.brand },
              { label: 'Modelo', value: item.model },
            ].filter(entry => Boolean(entry.value));
            return <View key={item.id ?? `${item.productId}-${index}`} style={[styles.productCard, index % 2 !== 0 && styles.productAlternate]}>
              <Pressable onPress={() => router.push(`/produtos/${item.productId}` as never)} style={styles.productLink}>
                <Text style={styles.productName}>{product?.name ?? `Produto ${index + 1}`}{'\u00A0'}</Text>
                {product?.code ? <Text style={styles.productCode}>{product.code}{'\u00A0\u00A0'}</Text> : null}
                <Ionicons name="open-outline" size={16} color={C.gold} />
              </Pressable>
              <View style={styles.productSummary}>
                <View style={styles.smallPill}><Text style={styles.pillText}>{item.quantity} un.{'\u00A0\u00A0'}</Text></View>
                {item.totalPrice != null ? <View style={styles.smallPill}><Text style={styles.pillText}>{currency(item.totalPrice)}{'\u00A0\u00A0'}</Text></View> : null}
              </View>
              {characteristics.length ? <View style={styles.characteristics}>
                {characteristics.map(entry => {
                  const background = entry.label === 'Cor' && entry.value ? getColor(entry.value) : undefined;
                  return <View key={entry.label} style={styles.characteristic}>
                    <Text style={styles.fieldLabel}>{entry.label}</Text>
                    {entry.label === 'Cor' ? <View style={[styles.colorPill, { backgroundColor: background ?? '#f5f2e9' }]}>
                      <Text style={[styles.colorText, { color: contrastingColor(entry.value ?? '', background) }]}>{entry.value}{'\u00A0\u00A0\u00A0'}</Text>
                    </View> : <SafeText style={styles.fieldValue}>{entry.value}</SafeText>}
                  </View>;
                })}
              </View> : null}
            </View>;
          })}
        </Section>

        
<Section title="Histórico de movimentações" icon="receipt-outline">
  {movementsError ? (
    <SafeText style={styles.muted}>
      Não foi possível carregar o histórico.
    </SafeText>
  ) : movements.length === 0 ? (
    <SafeText style={styles.muted}>
      Nenhuma movimentação encontrada.
    </SafeText>
  ) : (
    movements.map(movement => (
      <View key={movement.id} style={styles.movementCard}>
        <View style={styles.movementHead}>
          <Text style={styles.movementId}>
            {movement.originCode?.toUpperCase() ?? '—'}{'\u00A0'}
          </Text>

          <Text style={styles.movementType}>
            {MOVEMENT_LABELS[movement.operation] ?? movement.operation}
            {'\u00A0\u00A0\u00A0\u00A0'}
          </Text>
        </View>

        <Text style={styles.movementAmountLabel}>
          Valor
        </Text>

        <View style={styles.movementValueRow}>
          <Text
            style={[
              styles.movementAmount,
              {
                color:
                  movement.direction === 'OUT'
                    ? '#b91c1c'
                    : movement.direction === 'IN'
                      ? '#047857'
                      : C.dark,
              },
            ]}
          >
            {movement.direction === 'OUT' ? '− ' : movement.direction === 'IN' ? '+ ' : ''}
            {currency(movement.amount)}{'\u00A0\u00A0'}
          </Text>
        </View>

        <SafeText style={styles.muted}>
          {dateTime(movement.createdAt)}
        </SafeText>
      </View>
    ))
  )}
</Section>


        {sale.observation?.trim() ? <Section title="Observações" icon="document-text-outline">
          <SafeText style={styles.observation}>{sale.observation.trim()}</SafeText>
        </Section> : null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, scroll: { flex: 1 },
  safeText: { includeFontPadding: true, paddingRight: 3 },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 60, borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: 13, backgroundColor: '#fff', gap: 9 },
  backIcon: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontWeight: '700', fontSize: 19, lineHeight: 29, color: C.dark },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 45, gap: 16 },
  feedback: { minHeight: 310, justifyContent: 'center', alignItems: 'center', gap: 15, padding: 20 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 12 },
  linkText: { color: '#927448', fontSize: 13, lineHeight: 24, fontWeight: '600', includeFontPadding: true, minWidth: 80 },
  primaryButton: { minHeight: 48, minWidth: 145, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11, backgroundColor: C.gold },
  primaryText: { fontSize: 13, lineHeight: 24, color: '#fff', fontWeight: '700', includeFontPadding: true },
  hero: { borderRadius: 17, borderWidth: 1, borderColor: '#e8dfd2', backgroundColor: C.cream, padding: 19, gap: 8 },
  heroName: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 25, lineHeight: 36, color: C.dark, fontWeight: '600' },
  heroAmount: { color: C.dark, fontSize: 28, lineHeight: 42, fontWeight: '700' },
  heroDivider: { marginTop: 10, marginBottom: 5, height: 1, backgroundColor: '#e4d8c7' },
  badge: { alignSelf: 'flex-start', borderRadius: 15, paddingHorizontal: 18, paddingVertical: 9, marginTop: 7, minWidth: 110 },
  badgePaid: { backgroundColor: '#dcfce7' }, badgeUnpaid: { backgroundColor: '#fee2e2' }, badgePartial: { backgroundColor: '#fef3c7' },
  badgeText: { color: C.dark, fontSize: 12, lineHeight: 23, fontWeight: '700', includeFontPadding: true },
  section: { borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 17, padding: 17, gap: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: '#f0ebe5', paddingBottom: 14, marginBottom: 2 },
  sectionIcon: { width: 39, height: 39, borderRadius: 11, backgroundColor: '#f5efe6', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 17, lineHeight: 28, fontWeight: '700', color: C.dark },
  field: { gap: 5 }, fieldLabel: { fontSize: 11, lineHeight: 19, fontWeight: '600', letterSpacing: 0.25, textTransform: 'uppercase', color: '#94887b' },
  fieldValue: {
  fontSize: 14,
  lineHeight: 23,
  fontWeight: '600',
  color: C.dark,
  paddingRight: 16,
},
  muted: { fontSize: 12, lineHeight: 21, color: C.muted },
  error: { fontSize: 14, lineHeight: 23, color: '#b91c1c', textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCell: { width: '47%', minWidth: 0 },
  progressTrack: { height: 11, backgroundColor: '#eee8df', borderRadius: 20, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: '100%', backgroundColor: C.gold, borderRadius: 20 },
  progressText: { textAlign: 'right', fontSize: 12, lineHeight: 21, color: C.muted },
  productCard: { padding: 14, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: '#fff', gap: 13 },
  productAlternate: { backgroundColor: '#e9e4dc' },
  productLink: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingRight: 8 },
  productName: { color: C.dark, fontSize: 14, lineHeight: 26, fontWeight: '700', includeFontPadding: true, maxWidth: '100%' },
  productCode: { color: C.gold, fontSize: 12, lineHeight: 24, fontWeight: '700', includeFontPadding: true, minWidth: 52 },
  productSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  smallPill: { backgroundColor: C.cream, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 13, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, lineHeight: 23, fontWeight: '700', color: C.dark, includeFontPadding: true },
  characteristics: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 13, gap: 12 },
  characteristic: { gap: 7, alignItems: 'flex-start', width: '100%', minWidth: 0 },
  colorPill: { minWidth: 105, maxWidth: '100%', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#e8e0d4', alignSelf: 'flex-start', alignItems: 'flex-start' },
  colorText: { fontSize: 13, lineHeight: 24, fontWeight: '600', includeFontPadding: true },
  movementCard: { padding: 14, borderWidth: 1, borderColor: C.border, borderRadius: 10, gap: 8 },
  movementHead: { gap: 5, alignItems: 'flex-start' },
  movementType: { fontSize: 14, lineHeight: 24, color: C.dark, fontWeight: '600', includeFontPadding: true },
  movementAmountLabel: { fontSize: 11, lineHeight: 19, color: C.muted, fontWeight: '600' },
  movementValueRow: { width: '100%', minHeight: 30, alignItems: 'flex-start' },
  movementId: { fontSize: 13, lineHeight: 23, fontWeight: '700', color: C.dark },
  movementAmount: { fontSize: 16, lineHeight: 29, fontWeight: '700', includeFontPadding: true, minWidth: 155 },
  observation: { color: C.text, fontSize: 14, lineHeight: 25 },
});
