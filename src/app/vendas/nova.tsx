import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/api';

type PaymentMethod = 'PIX' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BANK_TRANSFER' | 'BANK_SLIP';
type Customer = { id: string; name: string; email?: string | null; cpf?: string | null; rg?: string | null; phone?: string | null };
type PriceTier = { minimumQuantity: number; unitPrice: number };
type Product = {
  id: string; name: string; commercialCode?: string | null; price?: number | null;
  prices: PriceTier[]; colors: string[]; sizes: string[]; materials: string[];
  brands: string[]; models: string[];
};
type SaleItem = {
  key: number; productId: string; quantity: number;
  adjustmentType: '' | 'discount' | 'addition'; adjustmentAmount: string;
  color: string; size: string; material: string; brand: string; model: string;
};
type Form = {
  customerId: string; hasDeliveryDeadline: boolean; deliveryDeadline: string;
  downPaymentPercentage: '0' | '50' | '100'; paidPercentage: '0' | '50' | '100';
  paymentMethod: PaymentMethod; observation: string; additionalAmount: string;
  additionalDescription: string; items: SaleItem[];
};
type PickerItem = { id: string; label: string; detail?: string };
type PickerState = { title: string; value: string; options: PickerItem[]; onSelect: (id: string) => void };

const C = { bg: '#f8f6f2', white: '#fff', text: '#342d27', muted: '#81766b', gold: '#a98a58', border: '#e8e0d4', dark: '#39342f' };
const PAYMENT_OPTIONS: { id: PaymentMethod; label: string }[] = [
  { id: 'PIX', label: 'Pix' }, { id: 'CASH', label: 'Dinheiro' },
  { id: 'CREDIT_CARD', label: 'Cartão de crédito' }, { id: 'DEBIT_CARD', label: 'Cartão de débito' },
  { id: 'BANK_TRANSFER', label: 'Transferência bancária' }, { id: 'BANK_SLIP', label: 'Boleto' },
];
const emptyItem = (key: number): SaleItem => ({
  key, productId: '', quantity: 1, adjustmentType: '', adjustmentAmount: '',
  color: '', size: '', material: '', brand: '', model: '',
});
const currency = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const amount = (v: string) => num(v) ?? 0;
const validMoney = (v: string) => !v.trim() || /^\d+(?:[.,]\d{1,2})?$/.test(v.trim());
const getUnitPrice = (product: Product | undefined, qty: number): number | null => {
  if (!product) return null;
  const tiers = [...product.prices].sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  if (!tiers.length) return product.price ?? null;
  return (tiers.filter(t => qty >= t.minimumQuantity).at(-1) ?? tiers[0]).unitPrice;
};
const adjustment = (item: SaleItem) => item.adjustmentType === 'discount' ? -amount(item.adjustmentAmount) : amount(item.adjustmentAmount);
const validDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
};

// Reserva uma margem no fim de cada texto para evitar o corte do último caractere no Android.
function SafeText({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[{ includeFontPadding: true, paddingRight: 6 }, style]} />;
}
function Label({ children }: { children: string }) { return <SafeText style={styles.label}>{children}</SafeText>; }
function SelectButton({ label, value, placeholder, onPress }: { label: string; value?: string; placeholder: string; onPress: () => void }) {
  return <View style={styles.field}><Label>{label}</Label>
    <Pressable style={styles.selector} onPress={onPress} accessibilityRole="button">
      <SafeText style={[styles.selectorText, !value && styles.placeholder]}>{value || placeholder}</SafeText>
      <Ionicons name="chevron-down" size={19} color={C.gold} />
    </Pressable>
  </View>;
}
function Choice({ label, selected, onPress, danger = false }: { label: string; selected: boolean; onPress: () => void; danger?: boolean }) {
  return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected, danger && selected && styles.choiceDanger]}>
    <SafeText style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</SafeText>
  </Pressable>;
}

export default function NovaVendaScreen() {
  const [form, setForm] = useState<Form>({
    customerId: '', hasDeliveryDeadline: false, deliveryDeadline: '', downPaymentPercentage: '50',
    paidPercentage: '0', paymentMethod: 'PIX', observation: '', additionalAmount: '',
    additionalDescription: '', items: [emptyItem(0)],
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const update = <K extends keyof Form>(field: K, value: Form[K]) => setForm(old => ({ ...old, [field]: value }));
  const updateItem = (key: number, patch: Partial<SaleItem>) => setForm(old => ({
    ...old, items: old.items.map(item => item.key === key ? { ...item, ...patch } : item),
  }));
  const openPicker = (title: string, value: string, options: PickerItem[], onSelect: (id: string) => void) => {
    setPicker({ title, value, options, onSelect });
    setPickerSearch('');
  };
  const flip = (key: string) => setExpanded(old => ({ ...old, [key]: !old[key] }));

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (!token) { router.replace('/'); return; }
        const config = { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } };
        const [usersResult, productsResult] = await Promise.all([
          api.get('/users', { ...config, params: { page: 0, size: 100 } }),
          api.get('/products', { ...config, params: { page: 0, size: 100, sortBy: 'name', sortDirection: 'ASC' } }),
        ]);
        if (controller.signal.aborted) return;
        const users = usersResult.data?.content ?? usersResult.data;
        const availableProducts = productsResult.data?.content ?? productsResult.data;
        setCustomers((Array.isArray(users) ? users : []).filter((u: { role?: string; roles?: string[] }) =>
          u.role === 'CANDIDATE' || u.roles?.includes('CANDIDATE')
        ).map((u: { userId?: string; id?: string; name: string; email?: string; cpf?: string; rg?: string; phone?: string; telephone?: string }) => ({
          id: u.userId ?? u.id ?? '', name: u.name, email: u.email, cpf: u.cpf, rg: u.rg, phone: u.phone ?? u.telephone,
        })).filter((u: Customer) => !!u.id));
        setProducts((Array.isArray(availableProducts) ? availableProducts : []).map((p: {
          id: string; name: string; commercialCode?: string; code?: string;
          price?: string | number; salePrice?: string | number; sellingPrice?: string | number;
          prices?: { minimumQuantity: number; unitPrice: number | string }[];
          colors?: string[]; sizes?: string[]; materials?: string[]; brands?: string[]; models?: string[];
        }) => ({
          id: p.id, name: p.name, commercialCode: p.commercialCode ?? p.code,
          price: num(p.salePrice ?? p.sellingPrice ?? p.price),
          prices: (p.prices ?? []).map(t => ({ minimumQuantity: t.minimumQuantity, unitPrice: num(t.unitPrice) ?? 0 }))
            .filter(t => t.minimumQuantity > 0 && t.unitPrice > 0),
          colors: p.colors ?? [], sizes: p.sizes ?? [], materials: p.materials ?? [], brands: p.brands ?? [], models: p.models ?? [],
        })));
      } catch (e) {
        if (!controller.signal.aborted && !axios.isCancel(e)) Alert.alert('Erro', 'Não foi possível carregar clientes ou produtos.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, []);

  const itemsTotal = useMemo(() => form.items.reduce((sum, item) => {
    const price = getUnitPrice(products.find(p => p.id === item.productId), item.quantity) ?? 0;
    return sum + price * item.quantity + adjustment(item);
  }, 0), [form.items, products]);
  const total = itemsTotal + amount(form.additionalAmount);
  const received = total * Number(form.paidPercentage) / 100;
  const downPayment = total * Number(form.downPaymentPercentage) / 100;
  const remaining = total - received;
  const chosenCustomer = customers.find(c => c.id === form.customerId);

  const save = async () => {
    if (saving || loading) return;
    if (!form.customerId) return Alert.alert('Validação', 'Selecione um cliente.');
    if (!form.items.length || form.items.some(item => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1))
      return Alert.alert('Validação', 'Selecione pelo menos um produto e informe uma quantidade válida.');
    if (form.items.some(item => (getUnitPrice(products.find(p => p.id === item.productId), item.quantity) ?? 0) <= 0))
      return Alert.alert('Validação', 'Um ou mais produtos estão sem preço de venda válido.');
    if (form.hasDeliveryDeadline && !validDate(form.deliveryDeadline))
      return Alert.alert('Validação', 'Informe uma data de entrega válida no formato AAAA-MM-DD.');
    if (!validMoney(form.additionalAmount) || amount(form.additionalAmount) < 0)
      return Alert.alert('Validação', 'Informe um adicional válido, com até duas casas decimais.');
    for (const item of form.items) {
      if (!validMoney(item.adjustmentAmount) || amount(item.adjustmentAmount) < 0)
        return Alert.alert('Validação', 'Acréscimos e descontos devem ter até duas casas decimais.');
      if (amount(item.adjustmentAmount) > 0 && !item.adjustmentType)
        return Alert.alert('Validação', 'Selecione se o ajuste do produto é desconto ou acréscimo.');
      const unit = getUnitPrice(products.find(p => p.id === item.productId), item.quantity) ?? 0;
      if (unit * item.quantity + adjustment(item) <= 0)
        return Alert.alert('Validação', 'O produto precisa ser vendido com um valor positivo.');
    }
    if (!Number.isFinite(total) || total <= 0) return Alert.alert('Validação', 'O valor total deve ser maior que zero.');
    setSaving(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { router.replace('/'); return; }
      await api.post('/sales', {
        customerId: form.customerId,
        deliveryDeadline: form.hasDeliveryDeadline ? form.deliveryDeadline : null,
        totalAmount: Number(total.toFixed(2)),
        additionalAmount: Number(amount(form.additionalAmount).toFixed(2)),
        additionalDescription: form.additionalDescription.trim() || null,
        downPaymentPercentage: Number(form.downPaymentPercentage),
        paidPercentage: Number(form.paidPercentage), paymentMethod: form.paymentMethod,
        observation: form.observation.trim() || null,
        items: form.items.map(item => ({
          productId: item.productId, inventoryId: null, quantity: item.quantity,
          unitPrice: getUnitPrice(products.find(p => p.id === item.productId), item.quantity),
          additionalAmount: adjustment(item),
          color: item.color.trim() || null, size: item.size.trim() || null,
          material: item.material.trim() || null, brand: item.brand.trim() || null,
          model: item.model.trim() || null,
        })),
      }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Sucesso', 'Venda registrada com sucesso!', [{ text: 'OK', onPress: () => router.replace('/vendas') }]);
    } catch (e) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.message : null;
      Alert.alert('Erro', typeof msg === 'string' && msg.trim() ? msg : 'Não foi possível cadastrar a venda.');
    } finally { setSaving(false); }
  };

  const filteredPickerOptions = picker?.options.filter(o =>
    `${o.label} ${o.detail ?? ''}`.toLocaleLowerCase('pt-BR').includes(pickerSearch.trim().toLocaleLowerCase('pt-BR'))
  ) ?? [];

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        <View style={styles.topbar}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Voltar">
            <Ionicons name="arrow-back" size={23} color={C.gold} />
          </Pressable>
          <SafeText style={styles.pageTitle}>Nova venda</SafeText>
          <Pressable disabled={loading || saving} onPress={() => void save()} style={[styles.registerTop, (loading || saving) && styles.disabled]}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="save-outline" color="#fff" size={17} />}
            <SafeText style={styles.primaryText}>Registrar</SafeText>
          </Pressable>
        </View>
        {loading && <View style={styles.loading}><ActivityIndicator size="large" color={C.gold} /><SafeText style={styles.muted}>Carregando clientes e produtos...</SafeText></View>}
        <View style={styles.card}>
          <SelectButton label="Cliente *" value={chosenCustomer?.name} placeholder="Selecione ou busque um cliente" onPress={() => openPicker(
            'Selecionar cliente', form.customerId, customers.map(c => ({ id: c.id, label: c.name,
              detail: [c.email, c.cpf, c.rg, c.phone].filter(Boolean).slice(0, 2).join(' · ') })),
            id => update('customerId', id),
          )} />
        </View>

        <View style={styles.productsSection}>
          <SafeText style={styles.sectionHeading}>Produtos da venda</SafeText>
          {form.items.map((item, index) => {
            const product = products.find(p => p.id === item.productId);
            const unit = getUnitPrice(product, item.quantity) ?? 0;
            const itemTotal = unit * item.quantity + adjustment(item);
            const features = ([
              ['color', 'Cor', product?.colors ?? []], ['size', 'Tamanho', product?.sizes ?? []],
              ['material', 'Material', product?.materials ?? []], ['brand', 'Marca', product?.brands ?? []],
              ['model', 'Modelo', product?.models ?? []],
            ] as const).filter(([, , options]) => options.length > 0);
            const featureKey = `features-${item.key}`;
            const adjustmentKey = `adjustment-${item.key}`;
            return <View key={item.key} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <SafeText style={styles.itemHeading}>Produto {index + 1}</SafeText>
                <Pressable disabled={form.items.length === 1} onPress={() => update('items', form.items.filter(i => i.key !== item.key))} style={form.items.length === 1 && styles.disabled} accessibilityLabel="Remover produto">
                  <Ionicons name="trash-outline" size={20} color="#b4534d" />
                </Pressable>
              </View>
              <SelectButton label="Produto *" value={product?.name} placeholder="Nome ou código comercial" onPress={() => openPicker(
                'Selecionar produto', item.productId,
                products.map(p => ({ id: p.id, label: p.name, detail: p.commercialCode ?? '' })),
                productId => updateItem(item.key, { productId, color: '', size: '', material: '', brand: '', model: '' }),
              )} />
              <View style={styles.quantityRow}>
                <View style={styles.quantityColumn}>
                  <Label>Quantidade *</Label>
                  <View style={styles.quantityBox}>
                    <Pressable disabled={item.quantity <= 1} onPress={() => updateItem(item.key, { quantity: Math.max(1, item.quantity - 1) })} style={styles.quantityButton}>
                      <Ionicons name="remove" size={19} color={C.gold} />
                    </Pressable>
                    <TextInput style={styles.quantityInput} value={String(item.quantity)} keyboardType="number-pad" selectTextOnFocus
                      onChangeText={v => updateItem(item.key, { quantity: v === '' ? 0 : Math.max(0, Number(v.replace(/\D/g, '')) || 0) })} />
                    <Pressable onPress={() => updateItem(item.key, { quantity: item.quantity + 1 })} style={styles.quantityButton}>
                      <Ionicons name="add" size={19} color={C.gold} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.totalColumn}>
                  <Label>Valor do item</Label>
                  <SafeText style={styles.money}>{currency(itemTotal)}</SafeText>
                  {product && <SafeText style={styles.small}>{currency(unit)} / un.</SafeText>}
                </View>
              </View>
              {item.productId && <>
                <Pressable style={styles.accordionHeader} onPress={() => flip(adjustmentKey)}>
                  <SafeText style={styles.accordionTitle}>Adicionar acréscimo ou desconto</SafeText>
                  <Ionicons name={expanded[adjustmentKey] ? 'chevron-up' : 'chevron-down'} size={19} color={C.gold} />
                </Pressable>
                {expanded[adjustmentKey] && <View style={styles.accordionContent}>
                  <View style={styles.choiceRow}>
                    <Choice label="Desconto −" selected={item.adjustmentType === 'discount'} danger onPress={() => updateItem(item.key, { adjustmentType: 'discount' })} />
                    <Choice label="Acréscimo +" selected={item.adjustmentType === 'addition'} onPress={() => updateItem(item.key, { adjustmentType: 'addition' })} />
                  </View>
                  <Label>Valor do ajuste (R$)</Label>
                  <TextInput style={styles.input} value={item.adjustmentAmount} onChangeText={v => updateItem(item.key, { adjustmentAmount: v })}
                    keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor="#a8a29e" />
                </View>}
                <Pressable style={styles.accordionHeader} onPress={() => flip(featureKey)}>
                  <SafeText style={styles.accordionTitle}>Adicionar características</SafeText>
                  <Ionicons name={expanded[featureKey] ? 'chevron-up' : 'chevron-down'} size={19} color={C.gold} />
                </Pressable>
                {expanded[featureKey] && <View style={styles.accordionContent}>
                  {features.length ? features.map(([field, label, options]) => <SelectButton key={field} label={label}
                    value={item[field]} placeholder="Selecione (opcional)" onPress={() => openPicker(label, item[field],
                      [{ id: '', label: 'Nenhum' }, ...options.map(option => ({ id: option, label: option }))],
                      id => updateItem(item.key, { [field]: id }))} />)
                    : <SafeText style={styles.muted}>Nenhuma característica cadastrada nesse produto.</SafeText>}
                </View>}
              </>}
            </View>;
          })}
          <Pressable onPress={() => update('items', [...form.items, emptyItem(Math.max(-1, ...form.items.map(i => i.key)) + 1)])} style={styles.addProduct}>
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
            <SafeText style={styles.primaryText}>Adicionar mais produtos ao carrinho</SafeText>
          </Pressable>
          <View style={styles.divider} />
          <Label>Adicional da venda (R$)</Label>
          <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor="#a8a29e" value={form.additionalAmount} onChangeText={v => update('additionalAmount', v)} />
          <Label>Descrição do adicional</Label>
          <TextInput style={styles.input} placeholder="Ex.: frete, taxa de entrega..." placeholderTextColor="#a8a29e" value={form.additionalDescription} onChangeText={v => update('additionalDescription', v)} />
          <Label>Observação</Label>
          <TextInput style={[styles.input, styles.textArea]} multiline textAlignVertical="top" placeholder="Adicione observações sobre a venda..." placeholderTextColor="#a8a29e" value={form.observation} onChangeText={v => update('observation', v)} />
          <View style={styles.totalBanner}><SafeText style={styles.totalLabel}>Total da venda</SafeText><SafeText style={styles.totalValue}>{currency(total)}</SafeText></View>
        </View>

        <View style={styles.card}>
          <SafeText style={styles.sectionHeading}>Entrega</SafeText>
          <Label>Tem prazo de entrega?</Label>
          <View style={styles.choiceRow}>
            <Choice label="Não" selected={!form.hasDeliveryDeadline} onPress={() => setForm(old => ({ ...old, hasDeliveryDeadline: false, deliveryDeadline: '' }))} />
            <Choice label="Sim" selected={form.hasDeliveryDeadline} onPress={() => update('hasDeliveryDeadline', true)} />
          </View>
          {form.hasDeliveryDeadline && <><Label>Data de entrega * (AAAA-MM-DD)</Label>
            <TextInput style={styles.input} keyboardType="numbers-and-punctuation" placeholder="2026-12-31" placeholderTextColor="#a8a29e"
              maxLength={10} value={form.deliveryDeadline} onChangeText={v => update('deliveryDeadline', v)} />
          </>}
        </View>
        <View style={styles.card}>
          <SafeText style={styles.sectionHeading}>Pagamento</SafeText>
          <SelectButton label="Entrada (%) *" value={`${form.downPaymentPercentage}%`} placeholder="Selecione"
            onPress={() => openPicker('Entrada (%)', form.downPaymentPercentage, ['0', '50', '100'].map(v => ({ id: v, label: `${v}%` })),
              id => update('downPaymentPercentage', id as Form['downPaymentPercentage']))} />
          <SelectButton label="Já pago (%) *" value={`${form.paidPercentage}%`} placeholder="Selecione"
            onPress={() => openPicker('Já pago (%)', form.paidPercentage, ['0', '50', '100'].map(v => ({ id: v, label: `${v}%` })),
              id => update('paidPercentage', id as Form['paidPercentage']))} />
          <SelectButton label="Forma de pagamento *" value={PAYMENT_OPTIONS.find(p => p.id === form.paymentMethod)?.label} placeholder="Selecione"
            onPress={() => openPicker('Forma de pagamento', form.paymentMethod, PAYMENT_OPTIONS, id => update('paymentMethod', id as PaymentMethod))} />
          <View style={styles.summaryGrid}>
            {([['Total', total], ['Entrada', downPayment], ['Já pago', received], ['Faltam', remaining]] as const).map(([label, value]) =>
              <View key={label} style={styles.summaryCell}><SafeText style={styles.small}>{label}</SafeText><SafeText style={styles.summaryValue}>{currency(value)}</SafeText></View>)}
          </View>
        </View>
        <View style={styles.footerButtons}>
          <Pressable onPress={() => router.replace('/vendas')} style={styles.cancelButton}><SafeText style={styles.cancelText}>Cancelar</SafeText></Pressable>
          <Pressable disabled={saving || loading} onPress={() => void save()} style={[styles.primaryButton, (saving || loading) && styles.disabled]}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="save-outline" color="#fff" size={19} />}
            <SafeText style={styles.primaryText}>{saving ? 'Salvando...' : 'Registrar venda'}</SafeText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
      <View style={styles.modalBackdrop}><View style={styles.modalSheet}>
        <View style={styles.modalHeading}><SafeText style={styles.modalTitle}>{picker?.title}</SafeText>
          <Pressable onPress={() => setPicker(null)} accessibilityLabel="Fechar"><Ionicons name="close" size={24} color={C.text} /></Pressable>
        </View>
        <TextInput style={[styles.input, styles.modalSearch]} value={pickerSearch} onChangeText={setPickerSearch}
          placeholder="Buscar..." placeholderTextColor="#a8a29e" autoCapitalize="none" />
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.modalOptions}>
          {filteredPickerOptions.length === 0 && <SafeText style={styles.muted}>Nenhum resultado encontrado.</SafeText>}
          {filteredPickerOptions.map(option => <Pressable key={option.id || '__empty__'} style={[styles.option,
            option.id === picker?.value && styles.optionSelected]} onPress={() => { picker?.onSelect(option.id); setPicker(null); }}>
            <View style={styles.optionText}><SafeText style={styles.optionLabel}>{option.label}</SafeText>
              {!!option.detail && <SafeText style={styles.small}>{option.detail}</SafeText>}
            </View>
            {option.id === picker?.value && <Ionicons name="checkmark-circle" size={22} color={C.gold} />}
          </Pressable>)}
        </ScrollView>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  page: { padding: 16, paddingBottom: 45, gap: 15 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 },
  backButton: { width: 43, height: 43, borderRadius: 11, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { flex: 1, fontSize: 24, lineHeight: 35, color: C.text, fontWeight: '700' },
  registerTop: { backgroundColor: C.gold, borderRadius: 11, paddingHorizontal: 11, minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  loading: { padding: 18, gap: 9, alignItems: 'center' },
  muted: { fontSize: 13, lineHeight: 21, color: C.muted },
  card: { padding: 17, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 17, gap: 4 },
  productsSection: { padding: 16, backgroundColor: '#f8f2e8', borderWidth: 1, borderColor: '#d9c4a4', borderRadius: 17, gap: 12 },
  sectionHeading: { color: C.text, fontSize: 18, fontWeight: '700', lineHeight: 29, marginBottom: 11 },
  field: { marginBottom: 13 }, label: { color: C.text, fontSize: 13, fontWeight: '600', lineHeight: 23, marginBottom: 7 },
  selector: { borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 49, paddingVertical: 11, paddingHorizontal: 13, backgroundColor: C.white, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectorText: { flex: 1, color: C.text, fontSize: 14, lineHeight: 23 },
  placeholder: { color: '#a8a29e' },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.white, minHeight: 49, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: C.text, marginBottom: 13, includeFontPadding: true },
  textArea: { minHeight: 95 },
  itemCard: { backgroundColor: C.white, borderRadius: 13, borderWidth: 1, borderColor: '#e8ddcb', padding: 15, marginBottom: 4 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  itemHeading: { fontSize: 15, fontWeight: '700', lineHeight: 24, color: C.text },
  quantityRow: { flexDirection: 'row', gap: 15, marginTop: 2 },
  quantityColumn: { flex: 1, minWidth: 0 }, totalColumn: { flex: 1, minWidth: 0 },
  quantityBox: { flexDirection: 'row', borderRadius: 11, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'space-between', minHeight: 47 },
  quantityButton: { paddingHorizontal: 8, paddingVertical: 11 },
  quantityInput: { flex: 1, minWidth: 25, textAlign: 'center', fontSize: 15, fontWeight: '700', padding: 0, color: C.text },
  money: { fontSize: 15, fontWeight: '700', lineHeight: 25, color: C.text },
  small: { fontSize: 12, lineHeight: 20, color: C.muted },
  accordionHeader: { marginTop: 13, paddingTop: 13, borderTopWidth: 1, borderTopColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 9 },
  accordionTitle: { flex: 1, color: '#927448', fontSize: 13, lineHeight: 24, fontWeight: '700' },
  accordionContent: { paddingTop: 15 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 12 },
  choice: { borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: C.white, minHeight: 43, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  choiceSelected: { borderColor: C.gold, backgroundColor: '#f4ede2' },
  choiceDanger: { backgroundColor: '#fee2e2', borderColor: '#ef4444' },
  choiceText: { fontSize: 13, lineHeight: 21, color: C.muted, fontWeight: '600' },
  choiceTextSelected: { color: C.text, fontWeight: '700' },
  addProduct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.gold, borderRadius: 11, padding: 12, minHeight: 47 },
  primaryText: { color: C.white, fontWeight: '700', fontSize: 13, lineHeight: 22 },
  divider: { height: 1, backgroundColor: '#e2cfb3', marginVertical: 8 },
  totalBanner: { borderWidth: 1, borderColor: '#e2cfb3', backgroundColor: '#efe2cd', borderRadius: 11, padding: 16, gap: 5, marginTop: 9 },
  totalLabel: { fontSize: 14, fontWeight: '600', lineHeight: 23, color: C.text },
  totalValue: { fontSize: 23, fontWeight: '700', lineHeight: 34, color: C.text },
  summaryGrid: { backgroundColor: '#f4ede2', borderRadius: 11, padding: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 15 },
  summaryCell: { width: '50%', paddingHorizontal: 5, minWidth: 0 },
  summaryValue: { color: C.text, fontSize: 15, lineHeight: 25, fontWeight: '700' },
  footerButtons: { flexDirection: 'row', gap: 11 },
  cancelButton: { minHeight: 49, paddingHorizontal: 16, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: C.text, fontSize: 13, fontWeight: '700', lineHeight: 22 },
  primaryButton: { flex: 1, minHeight: 49, backgroundColor: C.gold, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  disabled: { opacity: 0.4 },
  modalBackdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  modalSheet: { height: '80%', backgroundColor: C.bg, borderTopLeftRadius: 23, borderTopRightRadius: 23, paddingTop: 15, overflow: 'hidden' },
  modalHeading: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '700', lineHeight: 28, color: C.text },
  modalSearch: { marginHorizontal: 16, marginTop: 10, marginBottom: 10 },
  modalOptions: { paddingHorizontal: 15, paddingBottom: 35 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8, backgroundColor: C.white },
  optionSelected: { backgroundColor: '#f4ede2' },
  optionText: { flex: 1 }, optionLabel: { fontSize: 14, lineHeight: 24, color: C.text, fontWeight: '600' },
});
