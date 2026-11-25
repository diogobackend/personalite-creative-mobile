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
  productName?: string | null; name?: string | null; product?: { name?: string | null } | null;
  unitPrice: number | string; additionalAmount?: number | string | null;
  color?: string | null; size?: string | null; material?: string | null;
  brand?: string | null; model?: string | null;
};
type SaleResponse = {
  id: string; customerId: string; deliveryDeadline?: string | null; deliveredAt?: string | null;
  totalAmount: number | string; downPaymentPercentage: number | string; paidPercentage: number | string;
  paymentMethod: PaymentMethod; observation?: string | null; additionalAmount?: number | string | null; items?: SaleItemResponse[]; createdAt: string;
};
type SaleItemForm = {
  key: number; productId: string; inventoryId: string | null; quantity: number; unitPrice: string;
  adjustmentType: 'discount' | 'addition' | ''; adjustmentAmount: string;
  color: string; size: string; material: string; brand: string; model: string;
};
type SaleForm = {
  customerId: string; hasDeliveryDeadline: boolean; deliveryDeadline: string; delivered: boolean;
  downPaymentPercentage: string; paidPercentage: string; paymentMethod: PaymentMethod;
  observation: string; additionalAmount: string; items: SaleItemForm[];
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
const toBR = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? date.split('-').reverse().join('/') : date;
const maskDate = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};
const toISO = (date: string): string | null => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return null;
  const [day, month, year] = date.split('/').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const dateToBrazilian = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
const emptyItem = (key: number): SaleItemForm => ({ key, productId: '', inventoryId: null, quantity: 1, unitPrice: '', adjustmentType: '', adjustmentAmount: '', color: '', size: '', material: '', brand: '', model: '' });
const additional = (item: SaleItemForm) => (item.adjustmentType === 'discount' ? -1 : 1) * numeric(item.adjustmentAmount);
const itemTotal = (item: SaleItemForm) => numeric(item.unitPrice) * item.quantity + additional(item);
const validEmail = (email?: string | null) => !!email && !/^[0-9a-f]{8}-[0-9a-f-]{27,}@/i.test(email) && !/^(sememail|noemail|temp|temporary|fake|placeholder|generated|gerado)[^@]*@/i.test(email);
const parseError = (cause: unknown, fallback: string) => axios.isAxiosError(cause) && typeof cause.response?.data?.message === 'string' ? cause.response.data.message : fallback;

function normalizeProduct(value: unknown): Product | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const id = data.id ?? data.productId;
  const name = data.name ?? data.productName;
  if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) return null;
  const priceValue = data.salePrice ?? data.sellingPrice ?? data.price;
  const priceTiers = Array.isArray(data.prices) ? data.prices : [];
  return {
    id, name: name.trim(),
    commercialCode: typeof (data.commercialCode ?? data.code) === 'string' ? String(data.commercialCode ?? data.code) : null,
    price: validNumber(priceValue) ? numeric(priceValue) : null,
    prices: priceTiers.map((tier: PriceTier) => ({ minimumQuantity: tier.minimumQuantity, unitPrice: numeric(tier.unitPrice) })),
  };
}

function productList(payload: unknown): Product[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as Record<string, unknown>;
  const list = Array.isArray(payload) ? payload : data.content ?? data.products ?? data.items;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProduct).filter((item): item is Product => item !== null);
}

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
      <Text style={[styles.choiceText, styles.booleanChoiceText, value === option && styles.choiceTextSelected]} allowFontScaling={false}>{option ? 'Sim' : 'Não'}</Text>
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const openCalendar = () => {
    const iso = toISO(form?.deliveryDeadline ?? '');
    const selected = iso ? new Date(`${iso}T12:00:00`) : new Date();
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarOpen(true);
  };
  const shiftMonth = (offset: number) => setCalendarMonth(previous =>
    new Date(previous.getFullYear(), previous.getMonth() + offset, 1));
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const offset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return [...Array.from({ length: offset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  }, [calendarMonth]);
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
          api.get('/products', { signal: controller.signal, headers, params: { page: 0, size: 100, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' } }),
        ]);
        if (controller.signal.aborted) return;
        const sale = saleResult.data;
        const users = usersResult.data?.content ?? usersResult.data;
        const productsPayload = productsResult.data;
        const productsData = productsPayload?.content ?? productsPayload?.products ?? productsPayload;
        setOriginal(sale);
        setForm({
          customerId: sale.customerId, hasDeliveryDeadline: !!sale.deliveryDeadline,
          deliveryDeadline: toBR(dateOnly(sale.deliveryDeadline)), delivered: !!sale.deliveredAt,
          downPaymentPercentage: String(sale.downPaymentPercentage), paidPercentage: String(sale.paidPercentage),
          paymentMethod: sale.paymentMethod, observation: sale.observation ?? '',
          additionalAmount: numeric(sale.additionalAmount).toFixed(2).replace('.', ','),
          items: (sale.items ?? []).map(mapSaleItem),
        });
        setItemsChanged(false);
        setCustomers((Array.isArray(users) ? users : [])
          .filter((user: { role?: string; roles?: string[] }) => user.role === 'CANDIDATE' || user.roles?.includes('CANDIDATE'))
          .map((user: { userId?: string; id?: string; name: string; email?: string; cpf?: string; rg?: string; phone?: string; telephone?: string }) => ({
            id: user.userId ?? user.id ?? '', name: user.name, email: user.email, cpf: user.cpf,
            rg: user.rg, phone: user.phone ?? user.telephone,
          })).filter((user: Customer) => !!user.id));
        const listedProducts = productList(productsData);
        const soldProductNames = (sale.items ?? []).flatMap(item => {
          const name = item.productName ?? item.product?.name ?? item.name;
          return typeof name === 'string' && name.trim()
            ? [{ id: item.productId, name: name.trim(), commercialCode: null, price: null, prices: [] }]
            : [];
        });
        setProducts(previous => {
          const byId = new Map<string, Product>();
          for (const product of [...previous, ...soldProductNames, ...listedProducts]) byId.set(product.id, product);
          return [...byId.values()];
        });
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
      const missingNames = new Set<string>();
      await Promise.all(selectedProductIds.split(',').map(async productId => {
        setCharacteristicLoading(prev => ({ ...prev, [productId]: true }));
        try {
          const response = await api.get(`/products/${encodeURIComponent(productId)}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          const product = response.data?.product ?? response.data;
          if (typeof product?.name !== 'string' || !product.name.trim()) missingNames.add(productId);
          if (typeof product?.name === 'string' && product.name.trim()) {
            setProducts(previous => {
              const existing = previous.find(entry => entry.id === productId);
              if (existing) {
                return previous.map(entry => entry.id === productId
                  ? { ...entry, name: product.name.trim() } : entry);
              }
              return [...previous, {
                id: productId,
                name: product.name.trim(),
                commercialCode: product.commercialCode ?? product.code ?? null,
                price: validNumber(product.salePrice ?? product.sellingPrice ?? product.price)
                  ? numeric(product.salePrice ?? product.sellingPrice ?? product.price) : null,
                prices: Array.isArray(product.prices)
                  ? product.prices.map((tier: PriceTier) => ({
                      minimumQuantity: tier.minimumQuantity, unitPrice: numeric(tier.unitPrice),
                    })) : [],
              }];
            });
          }
          setCharacteristics(prev => ({ ...prev, [productId]: {
            colors: product.colors ?? [], sizes: product.sizes ?? [], materials: product.materials ?? [],
            brands: product.brands ?? [], models: product.models ?? [],
          } }));
        } catch {
          // Um produto já vendido pode não aparecer na consulta individual.
          missingNames.add(productId);
        } finally {
          if (!controller.signal.aborted) setCharacteristicLoading(prev => ({ ...prev, [productId]: false }));
        }
      }));

      // Recupera nomes que ficaram fora da primeira página da listagem.
      // A busca é limitada e só ocorre para produtos sem nome resolvido.
      if (!controller.signal.aborted && missingNames.size) {
        const auth = { Authorization: `Bearer ${token}` };
        for (let page = 0; page < 20 && missingNames.size && !controller.signal.aborted; page++) {
          try {
            const { data } = await api.get('/products', {
              headers: auth,
              signal: controller.signal,
              params: { page, size: 100, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' },
            });
            const batch = productList(data);
            if (!batch.length) break;
            const matched = batch.filter(product => missingNames.has(product.id));
            if (matched.length) {
              setProducts(previous => {
                const byId = new Map(previous.map(product => [product.id, product]));
                for (const product of matched) byId.set(product.id, product);
                return [...byId.values()];
              });
              for (const product of matched) missingNames.delete(product.id);
            }
            const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
            const pagination = response.pagination && typeof response.pagination === 'object'
              ? response.pagination as Record<string, unknown> : response;
            if (pagination.hasNext === false ||
              (typeof pagination.totalPages === 'number' && page + 1 >= pagination.totalPages) ||
              (pagination.hasNext === undefined && pagination.totalPages === undefined && batch.length < 100)) break;
          } catch {
            break;
          }
        }
      }
    };
    void loadCharacteristics();
    return () => controller.abort();
  }, [selectedProductIds]);

  const cartPricesValid = Boolean(form?.items.length && form.items.every(item =>
    validNumber(item.unitPrice) && numeric(item.unitPrice) > 0 &&
    Number.isInteger(item.quantity) && item.quantity > 0,
  ));
  const currentAdditionalAmount = numeric(form?.additionalAmount);
  const originalAdditionalAmount = numeric(original?.additionalAmount);
  const total = itemsChanged && cartPricesValid
    ? form!.items.reduce((sum, item) => sum + itemTotal(item), 0) + currentAdditionalAmount
    : numeric(original?.totalAmount) + currentAdditionalAmount - originalAdditionalAmount;
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
    if (editRegistration && form.hasDeliveryDeadline && !toISO(form.deliveryDeadline)) {
      Alert.alert('Verifique os dados', 'Informe uma data válida no formato DD/MM/AAAA.'); return;
    }
    if (editRegistration && (!/^\d+(?:[.,]\d{1,2})?$/.test(form.additionalAmount.trim()) || !Number.isFinite(currentAdditionalAmount) || currentAdditionalAmount < 0)) {
      Alert.alert('Verifique os dados', 'Informe uma taxa adicional válida, com até duas casas decimais.'); return;
    }
    const changes: Record<string, unknown> = {};
    if (paid !== numeric(original.paidPercentage)) changes.paidPercentage = paid;
    if (editRegistration && downPayment !== numeric(original.downPaymentPercentage)) changes.downPaymentPercentage = downPayment;
    if (editRegistration && form.paymentMethod !== original.paymentMethod) changes.paymentMethod = form.paymentMethod;
    if (form.delivered !== Boolean(original.deliveredAt)) changes.delivered = form.delivered;
    const deadline = form.hasDeliveryDeadline ? toISO(form.deliveryDeadline) : null;
    if (editRegistration && deadline !== dateOnly(original.deliveryDeadline) && !(deadline === null && !original.deliveryDeadline)) changes.deliveryDeadline = deadline;
    if (editRegistration) {
      if (!form.customerId) { Alert.alert('Verifique os dados', 'Selecione um cliente.'); return; }
      if (form.customerId !== original.customerId) changes.customerId = form.customerId;
      if (currentAdditionalAmount !== originalAdditionalAmount) {
        changes.additionalAmount = Number(currentAdditionalAmount.toFixed(2));
        if (totalKnown) changes.totalAmount = Number(total.toFixed(2));
      }
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
            <Pressable disabled={saving} onPress={() => void save()} style={[styles.primary, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={19} color="#fff" />}
              <Text style={styles.primaryText}>{saving ? 'Salvando...' : 'Salvar alterações'}</Text>
            </Pressable>
          </View>

          <Section>
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
                <DetailText key={item.id ?? String(index)}>{products.find(product => product.id === item.productId)?.name || 'Produto indisponível'} ({item.quantity})</DetailText>)
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
              {form.hasDeliveryDeadline ? <Field label="Prazo de entrega (DD/MM/AAAA)">
                <View style={styles.dateRow}>
                  <TextInput value={form.deliveryDeadline} onChangeText={value => update('deliveryDeadline', maskDate(value))} style={[styles.input, styles.dateInput]} placeholder="DD/MM/AAAA" placeholderTextColor="#a8a29e" keyboardType="number-pad" maxLength={10} />
                  <Pressable style={styles.calendarButton} onPress={openCalendar} accessibilityLabel="Selecionar data no calendário">
                    <Ionicons name="calendar-outline" size={23} color={P.gold} />
                  </Pressable>
                </View>
              </Field> : null}
              {pickerField('Cliente', form.customerId, customerOptions, value => update('customerId', value), true)}
              <Field label="Taxa adicional da venda (R$)">
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={form.additionalAmount}
                  onChangeText={value => update('additionalAmount', value)}
                  placeholder="0,00"
                  placeholderTextColor="#a8a29e"
                />
              </Field>
              <View style={styles.cart}>
                <Text style={styles.cartHeading}>Produtos vendidos</Text>
                <Pressable onPress={() => { setItemsChanged(true); setForm(previous => previous ? {
                  ...previous, items: [...previous.items, emptyItem(Math.max(-1, ...previous.items.map(item => item.key)) + 1)],
                } : previous); }} style={styles.outline}>
                  <Ionicons name="add" color={P.gold} size={19} /><Text style={styles.outlineText}>Adicionar produto</Text>
                </Pressable>
                {form.items.map((item, index) => {
                  const product = products.find(entry => entry.id === item.productId);
                  const productOptions = products.map(entry => ({ value: entry.id, label: entry.name }));
                  if (item.productId && !productOptions.some(option => option.value === item.productId)) {
                    productOptions.unshift({
                      value: item.productId,
                      label: characteristicLoading[item.productId]
                        ? 'Carregando nome do produto...'
                        : 'Produto indisponível',
                    });
                  }
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
                    })} style={[styles.choice, styles.adjustmentChoice, item.adjustmentType === option.value && styles.choiceSelected]}>
                      <Text
                        style={[styles.choiceText, styles.adjustmentChoiceText, item.adjustmentType === option.value && styles.choiceTextSelected]}
                        allowFontScaling={false}
                      >{option.label}{'  '}</Text>
                    </Pressable>)}</View>
                    {item.adjustmentType !== '' ? <Field label="Valor do ajuste (R$)">
                      <TextInput style={styles.input} keyboardType="decimal-pad" value={item.adjustmentAmount} onChangeText={value => updateItem(item.key, { adjustmentAmount: value })} placeholder="0,00" />
                    </Field> : null}
                    {item.productId && availableChars && CHAR_FIELDS.some(entry => availableChars[entry.source]?.length > 0) ? (
                      <View style={styles.characteristics}>
                        <Text style={styles.label}>Características do produto</Text>
                        {CHAR_FIELDS.filter(entry => availableChars[entry.source]?.length > 0).map(entry => (
                          <View key={entry.field}>
                            {pickerField(entry.label, item[entry.field], [
                              { value: '', label: 'Selecione (opcional)' },
                              ...availableChars[entry.source].map(value => ({ value, label: value })),
                            ], value => updateItem(item.key, { [entry.field]: value }))}
                          </View>
                        ))}
                      </View>
                    ) : null}
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
            <Pressable onPress={() => router.replace('/vendas')} style={[styles.outline, styles.cancelButton]}><Ionicons name="arrow-back-outline" size={18} color={P.gold} /><Text style={[styles.outlineText, styles.cancelText]} allowFontScaling={false}>Cancelar</Text></Pressable>
            <Pressable disabled={saving} onPress={() => void save()} style={[styles.primary, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
              <Text style={styles.primaryText}>{saving ? 'Salvando...' : 'Salvar alterações'}</Text>
            </Pressable>
          </View>
        </ScrollView>}
    </KeyboardAvoidingView>
    <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
      <View style={styles.calendarBackdrop}>
        <View style={styles.calendarPanel}>
          <View style={styles.calendarHeader}>
            <Pressable onPress={() => shiftMonth(-1)} accessibilityLabel="Mês anterior" style={styles.calendarNav}>
              <Ionicons name="chevron-back" size={23} color={P.gold} />
            </Pressable>
            <Text style={styles.calendarHeading}>{MONTH_NAMES[calendarMonth.getMonth()]} de {calendarMonth.getFullYear()}</Text>
            <Pressable onPress={() => shiftMonth(1)} accessibilityLabel="Próximo mês" style={styles.calendarNav}>
              <Ionicons name="chevron-forward" size={23} color={P.gold} />
            </Pressable>
          </View>
          <View style={styles.calendarGrid}>
            {WEEKDAYS.map((weekday, index) => (
              <View key={`weekday-${index}`} style={styles.calendarCell}>
                <Text style={styles.calendarWeekday}>{weekday}</Text>
              </View>
            ))}
            {calendarDays.map((day, index) => {
              const candidate = day ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day) : null;
              const selected = candidate ? dateToBrazilian(candidate) === form?.deliveryDeadline : false;
              return <View key={`day-${index}`} style={styles.calendarCell}>
                {candidate && <Pressable
                  style={[styles.calendarDay, selected && styles.calendarDaySelected]}
                  onPress={() => { update('deliveryDeadline', dateToBrazilian(candidate)); setCalendarOpen(false); }}
                  accessibilityLabel={`Selecionar ${dateToBrazilian(candidate)}`}>
                  <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{day}</Text>
                </Pressable>}
              </View>;
            })}
          </View>
          <Pressable style={styles.calendarClose} onPress={() => setCalendarOpen(false)}>
            <Text style={styles.calendarCloseText}>Fechar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  choice: { borderWidth: 1, borderColor: P.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, minHeight: 46, minWidth: 89, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  choiceSelected: { backgroundColor: P.cream, borderColor: P.gold },
  choiceText: { color: P.muted, fontSize: 13, lineHeight: 23, includeFontPadding: true, fontWeight: '600' },
  adjustmentChoice: { width: '47%', minWidth: 0, paddingHorizontal: 8, minHeight: 48 },
  adjustmentChoiceText: { width: '100%', textAlign: 'center', fontSize: 12, lineHeight: 24, paddingHorizontal: 3 },
  booleanChoiceText: { width: 55, textAlign: 'center', fontSize: 13 },
  choiceTextSelected: { color: P.ink, fontWeight: '700' },
  primary: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: P.gold, paddingHorizontal: 17, paddingVertical: 11, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 24, includeFontPadding: true },
  outline: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: P.border, borderRadius: 10, minHeight: 46, paddingHorizontal: 15, paddingVertical: 10, alignItems: 'center', gap: 7, backgroundColor: '#fff' },
  outlineText: { color: '#927448', fontSize: 13, lineHeight: 24, fontWeight: '700', includeFontPadding: true },
  cancelButton: { minWidth: 154, justifyContent: 'center', flexWrap: 'nowrap' },
  cancelText: { width: 80, textAlign: 'center' },
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
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dateInput: { flex: 1, minWidth: 0 },
  calendarButton: { width: 52, height: 49, borderRadius: 11, borderWidth: 1, borderColor: P.border, backgroundColor: P.white, alignItems: 'center', justifyContent: 'center' },
  calendarBackdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 20 },
  calendarPanel: { width: '100%', maxWidth: 380, backgroundColor: P.white, borderRadius: 17, padding: 15 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  calendarHeading: { fontSize: 16, lineHeight: 25, fontWeight: '700', color: P.ink, textTransform: 'capitalize' },
  calendarNav: { padding: 9 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: '14.285714%', height: 43, justifyContent: 'center', alignItems: 'center' },
  calendarWeekday: { color: P.muted, fontWeight: '700', fontSize: 12 },
  calendarDay: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  calendarDaySelected: { backgroundColor: P.gold },
  calendarDayText: { color: P.ink, fontSize: 14, fontWeight: '600' },
  calendarDayTextSelected: { color: P.white },
  calendarClose: { alignSelf: 'flex-end', padding: 12, marginTop: 12 },
  calendarCloseText: { color: P.gold, fontWeight: '700', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 },
  pickerPanel: { backgroundColor: '#fff', borderRadius: 17, padding: 17, maxHeight: '80%', gap: 10 },
  pickerHeader: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'center' },
  pickerTitle: { flex: 1, fontSize: 18, lineHeight: 28, fontWeight: '700', color: P.ink },
  pickerContent: { paddingBottom: 10 },
  pickerOption: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: P.border, flexDirection: 'row', alignItems: 'center', gap: 9 },
  pickerOptionText: { flex: 1, color: P.ink, fontSize: 14, lineHeight: 25, includeFontPadding: true },
});