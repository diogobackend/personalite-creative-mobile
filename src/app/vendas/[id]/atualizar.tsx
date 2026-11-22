import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type PaymentMethod = 'PIX' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BANK_TRANSFER' | 'BANK_SLIP';
type Customer = { id: string; name: string; email?: string | null; cpf?: string | null; rg?: string | null; phone?: string | null };
type PriceTier = { minimumQuantity: number; unitPrice: number };
type Product = { id: string; name: string; commercialCode?: string | null; price: number | null; prices: PriceTier[] };
type Characteristics = { colors: string[]; sizes: string[]; materials: string[]; brands: string[]; models: string[] };
type Characteristic = 'color' | 'size' | 'material' | 'brand' | 'model';
type SaleItemResponse = {
  id?: string; productId: string; inventoryId?: string | null; quantity: number;
  unitPrice: number | string; additionalAmount?: number | string | null;
  color?: string | null; size?: string | null; material?: string | null;
  brand?: string | null; model?: string | null;
};
type SaleResponse = {
  id: string; customerId: string; deliveryDeadline?: string | null; deliveredAt?: string | null;
  totalAmount: number | string; downPaymentPercentage: number | string; paidPercentage: number | string;
  paymentMethod: PaymentMethod; observation?: string | null; items?: SaleItemResponse[]; createdAt: string;
};
type SaleItemForm = {
  key: number; productId: string; inventoryId: string | null; quantity: number; unitPrice: string;
  adjustmentType: 'discount' | 'addition' | ''; adjustmentAmount: string;
  color: string; size: string; material: string; brand: string; model: string;
};
type SaleForm = {
  customerId: string; hasDeliveryDeadline: boolean; deliveryDeadline: string; delivered: boolean;
  downPaymentPercentage: string; paidPercentage: string; paymentMethod: PaymentMethod;
  observation: string; items: SaleItemForm[];
};
type PickerOption = { value: string; label: string };
type PickerState = { title: string; value: string; options: PickerOption[]; onSelect: (value: string) => void; searchable?: boolean } | null;

const P = { background: '#f8f6f2', ink: '#342d27', muted: '#81766b', gold: '#a98a58', border: '#e8e0d4', cream: '#f4ede2', white: '#fff' };
const PAYMENT_OPTIONS: PickerOption[] = [
  { value: 'PIX', label: 'Pix' }, { value: 'CASH', label: 'Dinheiro' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' }, { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'BANK_TRANSFER', label: 'Transferência bancária' }, { value: 'BANK_SLIP', label: 'Boleto' },
];
const PERCENT_OPTIONS: PickerOption[] = [0, 50, 100].map(n => ({ value: String(n), label: `${n}%` }));
const CHAR_FIELDS: { field: Characteristic; source: keyof Characteristics; label: string }[] = [
  { field: 'color', source: 'colors', label: 'Cor' }, { field: 'size', source: 'sizes', label: 'Tamanho' },
  { field: 'material', source: 'materials', label: 'Material' }, { field: 'brand', source: 'brands', label: 'Marca' },
  { field: 'model', source: 'models', label: 'Modelo' },
];
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const numeric = (value: unknown) => Number(String(value ?? '0').replace(',', '.'));
const validNumber = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(numeric(value));
const dateOnly = (value?: string | null) => value?.slice(0, 10) ?? '';
const emptyItem = (key: number): SaleItemForm => ({ key, productId: '', inventoryId: null, quantity: 1, unitPrice: '', adjustmentType: '', adjustmentAmount: '', color: '', size: '', material: '', brand: '', model: '' });
const additional = (item: SaleItemForm) => (item.adjustmentType === 'discount' ? -1 : 1) * numeric(item.adjustmentAmount);
const itemTotal = (item: SaleItemForm) => numeric(item.unitPrice) * item.quantity + additional(item);
const validEmail = (email?: string | null) => !!email && !/^[0-9a-f]{8}-[0-9a-f-]{27,}@/i.test(email) && !/^(sememail|noemail|temp|temporary|fake|placeholder|generated|gerado)[^@]*@/i.test(email);
const parseError = (cause: unknown, fallback: string) => axios.isAxiosError(cause) && typeof cause.response?.data?.message === 'string' ? cause.response.data.message : fallback;

function mapSaleItem(item: SaleItemResponse, key: number): SaleItemForm {
  const value = numeric(item.additionalAmount);
  return {
    key, productId: item.productId, inventoryId: item.inventoryId ?? null,
    quantity: item.quantity, unitPrice: String(item.unitPrice),
    adjustmentType: value < 0 ? 'discount' : value > 0 ? 'addition' : '',
    adjustmentAmount: value ? String(Math.abs(value)) : '',
    color: item.color ?? '', size: item.size ?? '', material: item.material ?? '',
    brand: item.brand ?? '', model: item.model ?? '',
  };
}
function DetailText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={muted ? styles.mutedText : styles.normalText}>{children}</Text>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <Field label={label}><View style={styles.wrapRow}>{[false, true].map(option =>
    <Pressable key={String(option)} onPress={() => onChange(option)} style={[styles.choice, value === option && styles.choiceSelected]}>
      <Text style={[styles.choiceText, value === option && styles.choiceTextSelected]}>{option ? 'Sim' : 'Não'}</Text>
    </Pressable>)}</View></Field>;
}
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return <View style={styles.section}>{title ? <Text style={styles.sectionTitle}>{title}</Text> : null}{children}</View>;
}

export default function AtualizarVendaScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<SaleResponse | null>(null);
  const [form, setForm] = useState<SaleForm | null>(null);
  const [editRegistration, setEditRegistration] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [itemsChanged, setItemsChanged] = useState(false);
  const [characteristics, setCharacteristics] = useState<Record<string, Characteristics>>({});
  const [characteristicLoading, setCharacteristicLoading] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState<PickerState>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const choose = (title: string, value: string, options: PickerOption[], onSelect: (value: string) => void, searchable = false) => {
    setPickerSearch(''); setPicker({ title, value, options, onSelect, searchable });
  };
  const update = <K extends keyof SaleForm>(field: K, value: SaleForm[K]) => setForm(previous => previous ? { ...previous, [field]: value } : previous);
  const updateItem = (key: number, patch: Partial<SaleItemForm>) => {
    setItemsChanged(true);
    setForm(previous => previous ? { ...previous, items: previous.items.map(item => item.key === key ? { ...item, ...patch } : item) } : previous);
  };

  useEffect(() => {
    if (!id) { setLoading(false); setError('Venda não identificada.'); return; }
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (!token) { router.replace('/'); return; }
        const headers = { Authorization: `Bearer ${token}` };
        const [saleResult, usersResult, productsResult] = await Promise.all([
          api.get<SaleResponse>(`/sales/${encodeURIComponent(id)}`, { signal: controller.signal, headers }),
          api.get('/users', { signal: controller.signal, headers, params: { page: 0, size: 100 } }),
          api.get('/products', { signal: controller.signal, headers, params: { page: 0, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' } }),
        ]);
        if (controller.signal.aborted) return;
        const sale = saleResult.data;
        const users = usersResult.data?.content ?? usersResult.data;
        const productsData = productsResult.data?.content ?? productsResult.data;
        setOriginal(sale);
        setForm({
          customerId: sale.customerId, hasDeliveryDeadline: !!sale.deliveryDeadline,
          deliveryDeadline: dateOnly(sale.deliveryDeadline), delivered: !!sale.deliveredAt,
          downPaymentPercentage: String(sale.downPaymentPercentage), paidPercentage: String(sale.paidPercentage),
          paymentMethod: sale.paymentMethod, observation: sale.observation ?? '', items: (sale.items ?? []).map(mapSaleItem),
        });
        setItemsChanged(false);
        setCustomers((Array.isArray(users) ? users : [])
          .filter((user: { role?: string; roles?: string[] }) => user.role === 'CANDIDATE' || user.roles?.includes('CANDIDATE'))
          .map((user: { userId?: string; id?: string; name: string; email?: string; cpf?: string; rg?: string; phone?: string; telephone?: string }) => ({
            id: user.userId ?? user.id ?? '', name: user.name, email: user.email, cpf: user.cpf,
            rg: user.rg, phone: user.phone ?? user.telephone,
          })).filter((user: Customer) => !!user.id));
        setProducts((Array.isArray(productsData) ? productsData : []).map((product: {
          id: string; name: string; commercialCode?: string; code?: string; price?: number | string;
          salePrice?: number | string; sellingPrice?: number | string;
          prices?: { minimumQuantity: number; unitPrice: number | string }[];
        }) => ({
          id: product.id, name: product.name, commercialCode: product.commercialCode ?? product.code,
          price: product.salePrice != null || product.sellingPrice != null || product.price != null
            ? numeric(product.salePrice ?? product.sellingPrice ?? product.price) : null,
          prices: (product.prices ?? []).map(t => ({ minimumQuantity: t.minimumQuantity, unitPrice: numeric(t.unitPrice) })),
        })));
      } catch (cause) {
        if (!controller.signal.aborted && !axios.isCancel(cause)) setError(parseError(cause, 'Não foi possível carregar a venda.'));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [id, reloadKey]);

  const selectedProductIds = useMemo(() => [...new Set((form?.items ?? []).map(item => item.productId).filter(Boolean))].sort().join(','), [form?.items]);
  useEffect(() => {
    if (!selectedProductIds) return;
    const controller = new AbortController();
    const loadCharacteristics = async () => {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || controller.signal.aborted) return;
      await Promise.all(selectedProductIds.split(',').map(async productId => {
        setCharacteristicLoading(prev => ({ ...prev, [productId]: true }));
        try {
          const response = await api.get(`/products/${encodeURIComponent(productId)}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          const product = response.data?.product ?? response.data;
          setCharacteristics(prev => ({ ...prev, [productId]: {
            colors: product.colors ?? [], sizes: product.sizes ?? [], materials: product.materials ?? [],
            brands: product.brands ?? [], models: product.models ?? [],
          } }));
        } catch { /* A ausência de características não impede atualização dos demais campos. */ }
        finally { if (!controller.signal.aborted) setCharacteristicLoading(prev => ({ ...prev, [productId]: false })); }
      }));
    };
    void loadCharacteristics();
    return () => controller.abort();
  }, [selectedProductIds]);

  const cartPricesValid = Boolean(form?.items.length && form.items.every(item =>
    validNumber(item.unitPrice) && numeric(item.unitPrice) > 0 &&
    Number.isInteger(item.quantity) && item.quantity > 0,
  ));
  const total = itemsChanged && cartPricesValid
    ? form!.items.reduce((sum, item) => sum + itemTotal(item), 0)
    : numeric(original?.totalAmount);
  const totalKnown = itemsChanged ? cartPricesValid : validNumber(original?.totalAmount);
  const paid = numeric(form?.paidPercentage);
  const downPayment = numeric(form?.downPaymentPercentage);
  const customerName = customers.find(customer => customer.id === form?.customerId)?.name ?? 'Cliente não identificado';

  const selectProduct = async (key: number, productId: string, quantity: number) => {
    const product = products.find(entry => entry.id === productId);
    const tier = product?.prices.filter(entry => quantity >= entry.minimumQuantity).sort((a, b) => b.minimumQuantity - a.minimumQuantity)[0];
    const listedPrice = tier?.unitPrice ?? product?.price;
    updateItem(key, {
      productId, inventoryId: null, unitPrice: listedPrice != null && listedPrice > 0 ? String(listedPrice) : '',
      color: '', size: '', material: '', brand: '', model: '',
    });
    if (!productId || (listedPrice != null && listedPrice > 0)) return;
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) return;
      const { data } = await api.get(`/products/${encodeURIComponent(productId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const detail = data?.product ?? data;
      const detailTiers: PriceTier[] = Array.isArray(detail.prices) ? detail.prices : [];
      const matching = detailTiers.filter(t => quantity >= t.minimumQuantity).sort((a, b) => b.minimumQuantity - a.minimumQuantity)[0];
      const resolved = matching?.unitPrice ?? detail.salePrice ?? detail.sellingPrice ?? detail.price;
      if (validNumber(resolved) && numeric(resolved) > 0) {
        setForm(previous => previous ? { ...previous, items: previous.items.map(item => item.key === key && item.productId === productId ? { ...item, unitPrice: String(numeric(resolved)) } : item) } : previous);
      }
    } catch { Alert.alert('Atenção', 'Não foi possível consultar o preço do produto selecionado.'); }
  };

  const save = async () => {
    if (!form || !original || !id || saving) return;
    if (![paid, downPayment].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      Alert.alert('Verifique os dados', 'Os percentuais devem estar entre 0 e 100.'); return;
    }
    if (editRegistration && form.hasDeliveryDeadline && !form.deliveryDeadline) {
      Alert.alert('Verifique os dados', 'Informe o prazo de entrega.'); return;
    }
    const changes: Record<string, unknown> = {};
    if (paid !== numeric(original.paidPercentage)) changes.paidPercentage = paid;
    if (editRegistration && downPayment !== numeric(original.downPaymentPercentage)) changes.downPaymentPercentage = downPayment;
    if (editRegistration && form.paymentMethod !== original.paymentMethod) changes.paymentMethod = form.paymentMethod;
    if (form.delivered !== Boolean(original.deliveredAt)) changes.delivered = form.delivered;
    const deadline = form.hasDeliveryDeadline ? form.deliveryDeadline : null;
    if (editRegistration && deadline !== dateOnly(original.deliveryDeadline) && !(deadline === null && !original.deliveryDeadline)) changes.deliveryDeadline = deadline;
    if (editRegistration) {
      if (!form.customerId) { Alert.alert('Verifique os dados', 'Selecione um cliente.'); return; }
      if (form.customerId !== original.customerId) changes.customerId = form.customerId;
      if ((form.observation.trim() || null) !== (original.observation ?? null)) changes.observation = form.observation.trim() || null;
      if (itemsChanged) {
        if (!cartPricesValid || !form.items.length || form.items.some(item =>
          !item.productId || !validNumber(item.adjustmentAmount || '0') || numeric(item.adjustmentAmount) < 0 || itemTotal(item) <= 0,
        )) {
          Alert.alert('Verifique os dados', 'Informe produtos, quantidades e valores válidos. Cada item precisa ter total positivo.'); return;
        }
        const newItems = form.items.map(item => ({
          productId: item.productId, inventoryId: item.inventoryId, quantity: item.quantity,
          unitPrice: numeric(item.unitPrice), additionalAmount: additional(item),
          color: item.color.trim() || null, size: item.size.trim() || null,
          material: item.material.trim() || null, brand: item.brand.trim() || null, model: item.model.trim() || null,
        }));
        const oldItems = (original.items ?? []).map(item => ({
          productId: item.productId, inventoryId: item.inventoryId ?? null, quantity: item.quantity,
          unitPrice: numeric(item.unitPrice), additionalAmount: numeric(item.additionalAmount),
          color: item.color ?? null, size: item.size ?? null,
          material: item.material ?? null, brand: item.brand ?? null, model: item.model ?? null,
        }));
        if (JSON.stringify(newItems) !== JSON.stringify(oldItems)) changes.items = newItems;
      }
    }
    if (!Object.keys(changes).length) { Alert.alert('Informação', 'Nenhuma alteração realizada.'); return; }
    setSaving(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { router.replace('/'); return; }
      await api.patch(`/sales/${encodeURIComponent(id)}`, changes, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Sucesso', 'Venda atualizada com sucesso.', [{ text: 'OK', onPress: () => router.replace('/vendas') }]);
    } catch (cause) { Alert.alert('Erro', parseError(cause, 'Não foi possível atualizar a venda.')); }
    finally { setSaving(false); }
  };

  const pickerField = (title: string, value: string, options: PickerOption[], onSelect: (value: string) => void, searchable = false) =>
    <Field label={title}><Pressable style={styles.select} onPress={() => choose(title, value, options, onSelect, searchable)}>
      <Text style={styles.selectText}>{options.find(option => option.value === value)?.label ?? 'Selecione'}</Text>
      <Ionicons name="chevron-down-outline" size={18} color={P.gold} />
    </Pressable></Field>;

  const customerOptions = customers.map(customer => ({
    value: customer.id,
    label: [customer.name, validEmail(customer.email) ? customer.email : null, customer.cpf, customer.rg, customer.phone].filter(Boolean).join(' — '),
  }));
  if (form?.customerId && !customerOptions.some(option => option.value === form.customerId)) {
    customerOptions.unshift({ value: form.customerId, label: `Cliente atual: ${form.customerId}` });
  }

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.backIcon} accessibilityLabel="Voltar">
          <Ionicons name="arrow-back" size={23} color={P.ink} />
        </Pressable>
        <Text style={styles.topbarTitle}>Atualizar venda</Text>
        <Pressable onPress={() => router.replace('/vendas')} style={styles.backIcon} accessibilityLabel="Vendas">
          <Ionicons name="list-outline" size={23} color={P.gold} />
        </Pressable>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={P.gold} /><Text style={styles.mutedText}>Carregando venda...</Text></View>
        : !form || !original ? <View style={styles.center}><Text style={styles.errorText}>{error ?? 'Venda não encontrada.'}</Text><Pressable onPress={() => setReloadKey(n => n + 1)} style={styles.primary}><Text style={styles.primaryText}>Tentar novamente</Text></Pressable></View>
        : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.pageHeader}>
            <Text style={styles.heading}>Atualizar venda</Text>
            <Pressable disabled={saving} onPress={() => void save()} style={[styles.primary, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={19} color="#fff" />}
              <Text style={styles.primaryText}>{saving ? 'Salvando...' : 'Salvar alterações'}</Text>
            </Pressable>
          </View>

          <Section title="Pagamento e entrega">
            {pickerField('Valor já pago (%)', form.paidPercentage, PERCENT_OPTIONS, value => update('paidPercentage', value))}
            {form.hasDeliveryDeadline ? <Toggle label="Já foi entregue?" value={form.delivered} onChange={value => update('delivered', value)} /> : null}
            <View style={styles.summary}>
              {[['Total', total], ['Entrada', total * downPayment / 100], ['Já pago', total * paid / 100], ['Faltam', total * (100 - paid) / 100]].map(([label, amount]) =>
                <View key={String(label)} style={styles.summaryCell}>
                  <Text style={styles.smallLabel}>{label}</Text>
                  <Text style={styles.amount}>{totalKnown ? money(Number(amount)) : 'Valor indisponível'}</Text>
                </View>)}
              <View style={styles.summarySeparator} />
              <Text style={styles.label}>Produtos</Text>
              {(original.items ?? []).length ? original.items!.map((item, index) =>
                <DetailText key={item.id ?? String(index)}>{products.find(product => product.id === item.productId)?.name ?? `Produto ${item.productId.slice(0, 8)}`} ({item.quantity})</DetailText>)
                : <DetailText muted>Produtos não disponíveis na consulta.</DetailText>}
              <Text style={[styles.label, { marginTop: 12 }]}>Cliente</Text>
              <DetailText>{customerName}</DetailText>
              <Text style={[styles.label, { marginTop: 12 }]}>Vendido em</Text>
              <DetailText>{new Date(original.createdAt).toLocaleString('pt-BR')}</DetailText>
            </View>
            {form.delivered && original.deliveredAt ? <DetailText muted>Entregue em {new Date(original.deliveredAt).toLocaleString('pt-BR')}</DetailText> : null}
          </Section>

          <Section title="Dados da venda">
            <Toggle label="Alterar dados cadastrais da venda?" value={editRegistration} onChange={setEditRegistration} />
            {editRegistration ? <View style={styles.registration}>
              {pickerField('Entrada (%)', form.downPaymentPercentage, PERCENT_OPTIONS, value => update('downPaymentPercentage', value))}
              {pickerField('Forma de pagamento', form.paymentMethod, PAYMENT_OPTIONS, value => update('paymentMethod', value as PaymentMethod))}
              <Toggle label="Tem prazo de entrega?" value={form.hasDeliveryDeadline} onChange={value => setForm(previous => previous ? {
                ...previous, hasDeliveryDeadline: value, deliveryDeadline: value ? previous.deliveryDeadline : '',
                delivered: value ? previous.delivered : false,
              } : previous)} />
              {form.hasDeliveryDeadline ? <Field label="Prazo de entrega (AAAA-MM-DD)">
                <TextInput value={form.deliveryDeadline} onChangeText={value => update('deliveryDeadline', value)} style={styles.input} placeholder="2026-12-01" placeholderTextColor="#a8a29e" autoCapitalize="none" />
              </Field> : null}
              {pickerField('Cliente', form.customerId, customerOptions, value => update('customerId', value), true)}
              <View style={styles.cart}>
                <Text style={styles.cartHeading}>Produtos vendidos</Text>
                <Pressable onPress={() => { setItemsChanged(true); setForm(previous => previous ? {
                  ...previous, items: [...previous.items, emptyItem(Math.max(-1, ...previous.items.map(item => item.key)) + 1)],
                } : previous); }} style={styles.outline}>
                  <Ionicons name="add" color={P.gold} size={19} /><Text style={styles.outlineText}>Adicionar produto</Text>
                </Pressable>
                {form.items.map((item, index) => {
                  const product = products.find(entry => entry.id === item.productId);
                  const productOptions = products.map(entry => ({ value: entry.id, label: `${entry.name}${entry.commercialCode ? ` — ${entry.commercialCode}` : ''}` }));
                  if (item.productId && !productOptions.some(option => option.value === item.productId)) productOptions.unshift({ value: item.productId, label: `Produto ${item.productId.slice(0, 8)}` });
                  const availableChars = characteristics[item.productId];
                  return <View key={item.key} style={styles.itemCard}>
                    <Text style={styles.itemHeading}>Produto {index + 1}</Text>
                    {pickerField('Produto', item.productId, productOptions, value => void selectProduct(item.key, value, item.quantity), true)}
                    <View style={styles.quantityRow}>
                      <Field label="Quantidade">
                        <View style={styles.quantityControl}>
                          <Pressable disabled={item.quantity <= 1} onPress={() => updateItem(item.key, { quantity: Math.max(1, item.quantity - 1) })} style={styles.qtyButton}>
                            <Ionicons name="remove" size={19} color={P.gold} />
                          </Pressable>
                          <TextInput value={String(item.quantity)} keyboardType="number-pad" style={styles.qtyInput} onChangeText={value => updateItem(item.key, { quantity: Number(value) })} />
                          <Pressable onPress={() => updateItem(item.key, { quantity: item.quantity + 1 })} style={styles.qtyButton}>
                            <Ionicons name="add" size={19} color={P.gold} />
                          </Pressable>
                        </View>
                      </Field>
                      <View style={styles.itemValue}><Text style={styles.smallLabel}>Valor</Text>
                        <Text style={styles.amount}>{validNumber(item.unitPrice) && numeric(item.unitPrice) > 0 ? money(itemTotal(item)) : 'Preço indisponível'}</Text>
                      </View>
                    </View>
                    <Text style={styles.label}>Deseja aplicar desconto ou acréscimo?</Text>
                    <View style={styles.wrapRow}>{([
                      { value: '', label: 'Não' }, { value: 'discount', label: 'Desconto' }, { value: 'addition', label: 'Acréscimo' },
                    ] as const).map(option => <Pressable key={option.value} onPress={() => updateItem(item.key, {
                      adjustmentType: option.value, adjustmentAmount: option.value ? item.adjustmentAmount : '',
                    })} style={[styles.choice, item.adjustmentType === option.value && styles.choiceSelected]}>
                      <Text style={[styles.choiceText, item.adjustmentType === option.value && styles.choiceTextSelected]}>{option.label}</Text>
                    </Pressable>)}</View>
                    {item.adjustmentType !== '' ? <Field label="Valor do ajuste (R$)">
                      <TextInput style={styles.input} keyboardType="decimal-pad" value={item.adjustmentAmount} onChangeText={value => updateItem(item.key, { adjustmentAmount: value })} placeholder="0,00" />
                    </Field> : null}
                    {item.productId ? <View style={styles.characteristics}>
                      <Text style={styles.label}>Características do produto</Text>
                      {characteristicLoading[item.productId] ? <ActivityIndicator color={P.gold} /> : !availableChars
                        ? <DetailText muted>Características indisponíveis.</DetailText>
                        : CHAR_FIELDS.filter(entry => availableChars[entry.source].length > 0).length === 0
                          ? <DetailText muted>Nenhuma característica cadastrada nesse produto.</DetailText>
                          : CHAR_FIELDS.filter(entry => availableChars[entry.source].length > 0).map(entry =>
                            <View key={entry.field}>{pickerField(entry.label, item[entry.field], [
                              { value: '', label: 'Selecione (opcional)' }, ...availableChars[entry.source].map(v => ({ value: v, label: v })),
                            ], value => updateItem(item.key, { [entry.field]: value }))}</View>) }
                    </View> : null}
                    <Pressable disabled={form.items.length <= 1} style={[styles.removeButton, form.items.length <= 1 && styles.disabled]} onPress={() => {
                      setItemsChanged(true); update('items', form.items.filter(entry => entry.key !== item.key));
                    }}><Ionicons name="trash-outline" size={18} color="#b91c1c" /><Text style={styles.removeText}>Remover produto</Text></Pressable>
                  </View>;
                })}
                <View style={styles.cartTotal}><Text style={styles.label}>Total da venda</Text><Text style={styles.totalText}>{totalKnown ? money(total) : 'Indisponível'}</Text></View>
              </View>
              <Field label="Observação"><TextInput multiline textAlignVertical="top" value={form.observation} onChangeText={value => update('observation', value)} style={[styles.input, styles.multiline]} placeholder="Observações sobre a venda..." /></Field>
            </View> : null}
          </Section>
          <View style={styles.footerButtons}>
            <Pressable onPress={() => router.replace('/vendas')} style={styles.outline}><Ionicons name="arrow-back-outline" size={18} color={P.gold} /><Text style={styles.outlineText}>Cancelar</Text></Pressable>
            <Pressable disabled={saving} onPress={() => void save()} style={[styles.primary, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
              <Text style={styles.primaryText}>{saving ? 'Salvando...' : 'Salvar alterações'}</Text>
            </Pressable>
          </View>
        </ScrollView>}
    </KeyboardAvoidingView>
    <Modal transparent animationType="fade" visible={picker !== null} onRequestClose={() => setPicker(null)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={styles.pickerPanel}>
          <View style={styles.pickerHeader}><Text style={styles.pickerTitle}>{picker?.title}</Text><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={24} color={P.ink} /></Pressable></View>
          {picker?.searchable ? <TextInput style={styles.input} value={pickerSearch} onChangeText={setPickerSearch} placeholder="Pesquisar..." placeholderTextColor="#a8a29e" autoFocus /> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pickerContent}>
            {picker?.options.filter(option => !picker.searchable || option.label.toLocaleLowerCase('pt-BR').includes(pickerSearch.toLocaleLowerCase('pt-BR'))).map(option =>
              <Pressable key={option.value} onPress={() => { picker.onSelect(option.value); setPicker(null); }} style={styles.pickerOption}>
                <Text style={styles.pickerOptionText}>{option.label}</Text>
                {picker.value === option.value ? <Ionicons name="checkmark" size={21} color={P.gold} /> : null}
              </Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, safe: { flex: 1, backgroundColor: P.background },
  topbar: { backgroundColor: '#fff', borderBottomWidth: 1, borderColor: P.border, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 61 },
  topbarTitle: { flex: 1, color: P.ink, fontSize: 19, lineHeight: 30, fontWeight: '700', includeFontPadding: true },
  backIcon: { width: 39, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 45, gap: 16 },
  pageHeader: { gap: 14, alignItems: 'flex-start' },
  heading: { fontSize: 27, lineHeight: 40, fontWeight: '700', color: P.ink, includeFontPadding: true },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 25, gap: 17 },
  section: { borderWidth: 1, borderColor: P.border, backgroundColor: P.white, borderRadius: 17, padding: 17, gap: 13 },
  sectionTitle: { fontSize: 18, lineHeight: 29, fontWeight: '700', color: P.ink, includeFontPadding: true },
  field: { marginBottom: 7, gap: 8 }, label: { fontSize: 13, lineHeight: 22, fontWeight: '600', color: P.ink, includeFontPadding: true },
  input: { width: '100%', minHeight: 49, borderWidth: 1, borderColor: P.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: P.ink, fontSize: 15, includeFontPadding: true, backgroundColor: '#fff' },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  select: { width: '100%', minHeight: 49, borderWidth: 1, borderColor: P.border, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  selectText: { flex: 1, color: P.ink, fontSize: 14, lineHeight: 24, includeFontPadding: true },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: P.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', backgroundColor: '#fff' },
  choiceSelected: { backgroundColor: P.cream, borderColor: P.gold },
  choiceText: { color: P.muted, fontSize: 13, lineHeight: 23, includeFontPadding: true, fontWeight: '600' },
  choiceTextSelected: { color: P.ink, fontWeight: '700' },
  primary: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: P.gold, paddingHorizontal: 17, paddingVertical: 11, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 24, includeFontPadding: true },
  outline: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: P.border, borderRadius: 10, minHeight: 46, paddingHorizontal: 15, paddingVertical: 10, alignItems: 'center', gap: 7, backgroundColor: '#fff' },
  outlineText: { color: '#927448', fontSize: 13, lineHeight: 24, fontWeight: '700', includeFontPadding: true },
  disabled: { opacity: 0.4 },
  normalText: { color: P.ink, fontSize: 14, lineHeight: 24, includeFontPadding: true },
  mutedText: { color: P.muted, fontSize: 13, lineHeight: 22, includeFontPadding: true },
  errorText: { color: '#b91c1c', fontSize: 14, lineHeight: 24, textAlign: 'center' },
  summary: { padding: 15, backgroundColor: P.cream, borderRadius: 12, gap: 5 },
  summaryCell: { gap: 3, paddingVertical: 3 },
  smallLabel: { fontSize: 12, lineHeight: 21, color: P.muted, includeFontPadding: true },
  amount: { fontSize: 16, lineHeight: 27, color: P.ink, fontWeight: '700', includeFontPadding: true },
  summarySeparator: { height: 1, backgroundColor: '#e4d7c4', marginVertical: 12 },
  registration: { borderTopWidth: 1, borderTopColor: P.border, paddingTop: 18, gap: 11 },
  cart: { padding: 13, backgroundColor: '#f8f2e8', borderWidth: 1, borderColor: '#e8ddcb', borderRadius: 13, gap: 13 },
  cartHeading: { fontWeight: '700', fontSize: 16, lineHeight: 27, color: P.ink },
  itemCard: { borderRadius: 12, borderWidth: 1, borderColor: '#e8ddcb', backgroundColor: '#fff', padding: 13, gap: 12 },
  itemHeading: { fontSize: 15, lineHeight: 25, fontWeight: '700', color: P.ink },
  quantityRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' },
  quantityControl: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: P.border, borderRadius: 10 },
  qtyButton: { width: 39, height: 45, alignItems: 'center', justifyContent: 'center' },
  qtyInput: { width: 45, height: 45, textAlign: 'center', color: P.ink, fontSize: 16, fontWeight: '700', paddingHorizontal: 0 },
  itemValue: { gap: 5, paddingTop: 2, flexGrow: 1 },
  characteristics: { borderTopWidth: 1, borderTopColor: P.border, paddingTop: 15, gap: 10 },
  removeButton: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, paddingVertical: 8, alignSelf: 'flex-start' },
  removeText: { fontSize: 13, lineHeight: 22, color: '#b91c1c', fontWeight: '600' },
  cartTotal: { padding: 15, backgroundColor: '#efe2cd', borderRadius: 11, gap: 5 },
  totalText: { color: P.ink, fontSize: 19, lineHeight: 31, fontWeight: '700' },
  footerButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 },
  pickerPanel: { backgroundColor: '#fff', borderRadius: 17, padding: 17, maxHeight: '80%', gap: 10 },
  pickerHeader: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'center' },
  pickerTitle: { flex: 1, fontSize: 18, lineHeight: 28, fontWeight: '700', color: P.ink },
  pickerContent: { paddingBottom: 10 },
  pickerOption: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: P.border, flexDirection: 'row', alignItems: 'center', gap: 9 },
  pickerOptionText: { flex: 1, color: P.ink, fontSize: 14, lineHeight: 25, includeFontPadding: true },
});