import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type Allocation = 'GENERAL' | 'SPECIFIC_PRODUCT' | 'CATEGORY_PRODUCTS';
type Status = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
type Category = { id: string; name: string; type: string };
type Product = { id: string; name: string; category?: string };
type Stock = { id: string; name: string; sku?: string | null };
type AllocationItem = { productId: string; allocatedValue: number };
type Expense = {
  id: string; name: string; description: string | null; value: number; paidAmount: number;
  category: string; categoryId: string | null; allocationType: Allocation; status: Status;
  quantity: number | null; inventoryId: string | null; expenseDate: string; products: AllocationItem[];
};
type Form = {
  name: string; description: string; value: string; category: string; categoryId: string;
  allocationType: Allocation; status: Status; quantity: string; inventoryId: string;
  expenseDate: string; products: { productId: string; allocatedValue: string }[];
};
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;
const C = { bg: '#f8f6f2', white: '#fff', dark: '#342d27', muted: '#81766b', gold: '#a98a58', border: '#e8e0d4', light: '#f4ede2', red: '#b91c1c', green: '#047857' };
const STOCK_CATEGORY = 'item de estoque';
const STATUSES: Option[] = [{ value: 'PENDING', label: '0% pago' }, { value: 'PARTIALLY_PAID', label: 'Parcialmente pago' }, { value: 'PAID', label: '100% pago' }];
const ALLOCATIONS: Option[] = [{ value: 'GENERAL', label: 'Despesa geral' }, { value: 'SPECIFIC_PRODUCT', label: 'Produto específico' }, { value: 'CATEGORY_PRODUCTS', label: 'Diversos produtos por categoria' }];
const PRODUCT_CATEGORIES: Option[] = [
  ['GOURMET', 'Gourmet'], ['AGUAS', 'Águas'], ['GARRAFAS', 'Garrafas'], ['GLOSS', 'Gloss'],
  ['BOLSAS', 'Bolsas'], ['NECESSAIRES', 'Necessaires'], ['LENCOS', 'Lenços'], ['PAPELARIA', 'Papelaria'],
  ['CAIXAS', 'Caixas'], ['KITS', 'Kits'],
].map(([value, label]) => ({ value, label }));
const money = (value: string) => Number(value.replace(',', '.'));
const currency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const dateOnly = (date: string) => date.split('T')[0];
const errorMessage = (error: unknown) => axios.isAxiosError(error)
  ? (typeof error.response?.data?.message === 'string' ? error.response.data.message : 'Não foi possível atualizar a despesa.')
  : error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
async function headers() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');
  return { Authorization: `Bearer ${token}` };
}
function Field({ label, value, onChange, numeric, multiline, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; numeric?: boolean; multiline?: boolean; placeholder?: string;
}) {
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <TextInput style={[s.input, multiline && { minHeight: 100, textAlignVertical: 'top' }]}
      value={value} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'}
      placeholder={placeholder} placeholderTextColor="#a8a29e" multiline={multiline} />
  </View>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}
function Button({ label, icon, onPress, secondary, disabled }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable disabled={disabled} onPress={onPress} style={[s.button, secondary ? s.secondary : s.primary, disabled && { opacity: 0.45 }]}>
    {icon && <Ionicons name={icon} size={18} color={secondary ? C.dark : C.white} />}
    <Text style={[s.buttonText, secondary && { color: C.dark }]}>{label}</Text>
  </Pressable>;
}
export default function EditarDespesa() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [original, setOriginal] = useState<Expense | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Stock[]>([]);
  const [productCategory, setProductCategory] = useState('');
  const [editRegistration, setEditRegistration] = useState(false);
  const [status, setStatus] = useState<Status>('PENDING');
  const [paymentNow, setPaymentNow] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [search, setSearch] = useState('');
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm(prev => prev ? { ...prev, [key]: value } : prev);
  const choose = (title: string, value: string, options: Option[], onPick: (v: string) => void) => { setSearch(''); setPicker({ title, value, options, onPick }); };
  const Select = ({ label, value, options, onPick }: { label: string; value: string; options: Option[]; onPick: (v: string) => void }) => (
    <View style={s.field}><Text style={s.label}>{label}</Text>
      <Pressable style={s.select} onPress={() => choose(label, value, options, onPick)}>
        <Text style={s.selectText}>{options.find(option => option.value === value)?.label ?? 'Selecione'}</Text>
        <Ionicons name="chevron-down-outline" size={18} color={C.gold} />
      </Pressable>
    </View>
  );
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const auth = await headers();
        const [expenseResponse, categoryResponse] = await Promise.all([
          api.get<Expense>(`/expenses/${encodeURIComponent(id)}`, { headers: auth, signal: controller.signal }),
          api.get<Category[] | { content: Category[] }>('/categories', { params: { type: 'EXPENSE' }, headers: auth, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        const expense = expenseResponse.data;
        setOriginal(expense);
        setStatus(expense.status);
        const data = categoryResponse.data;
        setCategories((Array.isArray(data) ? data : data.content ?? []).filter(category => category.type === 'EXPENSE'));
        setForm({ name: expense.name, description: expense.description ?? '', value: String(expense.value),
          category: expense.category, categoryId: expense.categoryId ?? '', allocationType: expense.allocationType,
          status: expense.status, quantity: expense.quantity == null ? '' : String(expense.quantity),
          inventoryId: expense.inventoryId ?? '', expenseDate: dateOnly(expense.expenseDate),
          products: (expense.products ?? []).map(item => ({ productId: item.productId, allocatedValue: String(item.allocatedValue) })) });
      } catch (e) { if (!controller.signal.aborted && !axios.isCancel(e)) setError(errorMessage(e)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (!editRegistration || !form || form.allocationType === 'GENERAL') return;
    const controller = new AbortController();
    setLoadingOptions(true);
    void (async () => {
      try {
        const { data } = await api.get<{ content: Product[] }>('/products', {
          params: { page: 0, size: 100 }, headers: await headers(), signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setProducts(data.content ?? []);
          const firstId = form.products[0]?.productId;
          const first = (data.content ?? []).find(p => p.id === firstId);
          if (first?.category && !productCategory) setProductCategory(first.category);
        }
      } catch (e) { if (!controller.signal.aborted && !axios.isCancel(e)) Alert.alert('Erro', errorMessage(e)); }
      finally { if (!controller.signal.aborted) setLoadingOptions(false); }
    })();
    return () => controller.abort();
  }, [editRegistration, form?.allocationType]);
  useEffect(() => {
    if (!editRegistration || form?.category !== STOCK_CATEGORY) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await api.get<{ content: Stock[] } | Stock[]>('/inventory', {
          params: { page: 0, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' }, headers: await headers(), signal: controller.signal,
        });
        if (!controller.signal.aborted) setInventory(Array.isArray(data) ? data : data.content ?? []);
      } catch (e) { if (!controller.signal.aborted && !axios.isCancel(e)) Alert.alert('Erro', errorMessage(e)); }
    })();
    return () => controller.abort();
  }, [editRegistration, form?.category]);
  const allocatedTotal = useMemo(() => (form?.products ?? []).reduce((sum, item) => sum + (money(item.allocatedValue) || 0), 0), [form?.products]);
  const total = form?.allocationType === 'CATEGORY_PRODUCTS' ? Math.round(allocatedTotal * 100) / 100 : money(form?.value ?? '');
  const setProduct = (index: number, key: 'productId' | 'allocatedValue', value: string) =>
    setForm(prev => prev ? { ...prev, products: prev.products.map((item, i) => i === index ? { ...item, [key]: value } : item) } : prev);
  const changeAllocation = (type: Allocation) => {
    setProductCategory('');
    setForm(prev => prev ? { ...prev, allocationType: type, products: type === 'GENERAL' ? [] : type === 'SPECIFIC_PRODUCT'
      ? [{ productId: '', allocatedValue: prev.value }] : [{ productId: '', allocatedValue: '' }, { productId: '', allocatedValue: '' }] } : prev);
  };
  const warn = (message: string) => { Alert.alert('Verifique os dados', message); return false; };
  const save = async () => {
    if (!original || !form || saving || original.status === 'CANCELLED') return;
    const newTotal = editRegistration ? total : Number(original.value);
    const paid = Number(original.paidAmount);
    let nextPaid = paid;
    if (status === 'PARTIALLY_PAID') {
      if (original.status !== 'PARTIALLY_PAID' || paymentNow.trim()) {
        const entered = money(paymentNow);
        if (!Number.isFinite(entered) || entered <= 0) return warn('Informe um valor pago maior que zero.');
        nextPaid = Math.round((original.status === 'PAID' ? entered : paid + entered) * 100) / 100;
      }
      if (nextPaid <= 0 || nextPaid >= newTotal) return warn('O valor pago deve ser maior que zero e menor que o total.');
    } else if (status === 'PAID') nextPaid = newTotal;
    else if (status === 'PENDING') nextPaid = 0;
    if (!Number.isFinite(newTotal) || newTotal <= 0) return warn('Informe um valor total maior que zero.');
    if (nextPaid < 0 || nextPaid > newTotal) return warn('O valor pago deve estar entre zero e o valor total.');
    const payload: Record<string, unknown> = {};
    if (editRegistration) {
      if (!form.name.trim()) return warn('Informe o nome da despesa.');
      if (!form.categoryId || !categories.some(item => item.id === form.categoryId)) return warn('Selecione uma categoria válida.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expenseDate) || Number.isNaN(new Date(`${form.expenseDate}T12:00:00`).getTime()))
        return warn('Informe uma data válida no formato AAAA-MM-DD.');
      if (form.category === STOCK_CATEGORY) {
        if (!form.inventoryId) return warn('Selecione um item do estoque.');
        if (!/^\d+$/.test(form.quantity) || Number(form.quantity) <= 0) return warn('Informe uma quantidade válida para o estoque.');
      }
      if (form.allocationType === 'SPECIFIC_PRODUCT' && form.products.length !== 1) return warn('Selecione exatamente um produto.');
      if (form.allocationType === 'CATEGORY_PRODUCTS' && form.products.length < 2) return warn('Selecione pelo menos dois produtos.');
      if (form.allocationType !== 'GENERAL') {
        if (form.products.some(item => !item.productId || !Number.isFinite(money(item.allocatedValue)) || money(item.allocatedValue) <= 0))
          return warn('Selecione os produtos e informe seus valores.');
        if (new Set(form.products.map(item => item.productId)).size !== form.products.length) return warn('Não repita o mesmo produto.');
        if (Math.abs(allocatedTotal - newTotal) > 0.001) return warn('A soma dos valores alocados deve ser igual ao total.');
        if (form.allocationType === 'CATEGORY_PRODUCTS' && (!productCategory || form.products.some(item => products.find(p => p.id === item.productId)?.category !== productCategory)))
          return warn('Selecione produtos da mesma categoria.');
      }
      const registration = {
        name: form.name.trim(), description: form.description.trim() || null, value: newTotal,
        category: form.category, categoryId: form.categoryId, allocationType: form.allocationType,
        quantity: form.category === STOCK_CATEGORY ? Number(form.quantity) : null,
        inventoryId: form.category === STOCK_CATEGORY ? form.inventoryId : null, expenseDate: form.expenseDate,
        products: form.allocationType === 'GENERAL' ? [] : form.products.map(p => ({ productId: p.productId, allocatedValue: money(p.allocatedValue) })),
      };
      for (const [key, value] of Object.entries(registration)) {
        const previous = original[key as keyof Expense];
        if (JSON.stringify(value) !== JSON.stringify(key === 'expenseDate' ? dateOnly(String(previous)) : previous)) payload[key] = value;
      }
    }
    if (nextPaid !== paid) payload.paidAmount = nextPaid;
    // O status financeiro é derivado do valor pago pelo backend; sem cancelamento.
    if (Object.keys(payload).length === 0) return Alert.alert('Sem alterações', 'Nenhuma alteração realizada.');
    setSaving(true);
    try {
      await api.patch(`/expenses/${encodeURIComponent(id!)}`, payload, { headers: await headers() });
      Alert.alert('Sucesso', 'Despesa atualizada com sucesso!', [{ text: 'OK', onPress: () => router.replace('/despesas') }]);
    } catch (e) { Alert.alert('Erro', errorMessage(e)); }
    finally { setSaving(false); }
  };
  const filteredOptions = (picker?.options ?? []).filter(item => item.label.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  if (loading) return <SafeAreaView style={s.center}><ActivityIndicator color={C.gold} /><Text style={s.muted}>Carregando despesa...</Text></SafeAreaView>;
  if (error || !original || !form) return <SafeAreaView style={s.center}><Text style={s.muted}>{error ?? 'Despesa não encontrada.'}</Text><Button label="Voltar" onPress={() => router.replace('/despesas')} /></SafeAreaView>;
  const cancelled = original.status === 'CANCELLED';
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Pressable style={s.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={18} color={C.gold} /><Text style={s.backText}>Voltar</Text></Pressable>
        <Text style={s.title}>Editar despesa</Text>
        <Section title="Situação do pagamento">
          <Text style={s.muted}>Status atual: {cancelled ? 'Cancelada' : STATUSES.find(item => item.value === original.status)?.label}</Text>
          <View style={s.stat}><Text style={s.label}>Valor total</Text><Text style={s.statValue}>{currency(original.value)}</Text></View>
          {original.status !== 'PAID' && <View style={s.summaryRow}>
            <View style={s.summary}><Text style={s.label}>Já pago</Text><Text style={s.statSmall}>{currency(original.paidAmount)}</Text></View>
            <View style={s.summary}><Text style={s.label}>Pendente</Text><Text style={s.statSmall}>{currency(Math.max(0, original.value - original.paidAmount))}</Text></View>
          </View>}
          {cancelled ? <Text style={s.error}>Esta despesa está cancelada e não pode ser modificada.</Text> : <>
            {(original.status !== 'PAID' || editRegistration) && <Select label="Atualizar status do pagamento" value={status} options={STATUSES} onPick={v => { setStatus(v as Status); setPaymentNow(''); }} />}
            {status === 'PARTIALLY_PAID' &&
              <Field label={original.status === 'PAID' ? 'Valor parcial que ficará pago (R$)' : 'Valor pago agora (R$)'} value={paymentNow} onChange={setPaymentNow} numeric placeholder="0,00" />}
            {status === 'PAID' && original.status !== 'PAID' && <Text style={s.hint}>O valor pago será atualizado para o total da despesa.</Text>}
            {status === 'PENDING' && original.paidAmount > 0 && <Text style={s.hint}>Selecionar 0% pago redefine o valor pago acumulado para zero.</Text>}
          </>}
        </Section>
        <Section title="Deseja alterar dados cadastrais?">
          <View style={s.summaryRow}>
            <Button label="Não" secondary={editRegistration} disabled={cancelled} onPress={() => { setEditRegistration(false); setStatus(original.status); setPaymentNow(''); }} />
            <Button label="Sim" secondary={!editRegistration} disabled={cancelled} onPress={() => setEditRegistration(true)} />
          </View>
        </Section>
        {editRegistration && !cancelled && <>
          <Section title="Informações da despesa">
            <Field label="Despesa *" value={form.name} onChange={v => update('name', v)} placeholder="Nome da despesa" />
            <Select label="Categoria *" value={form.categoryId} options={categories.map(item => ({ value: item.id, label: item.name }))}
              onPick={v => { const category = categories.find(item => item.id === v); setForm(prev => prev ? { ...prev, categoryId: v, category: category?.name ?? '', inventoryId: category?.name === STOCK_CATEGORY ? prev.inventoryId : '', quantity: category?.name === STOCK_CATEGORY ? prev.quantity : '' } : prev); }} />
            {form.category === STOCK_CATEGORY && <>
              <Select label="Item do estoque *" value={form.inventoryId} options={inventory.map(item => ({ value: item.id, label: `${item.name}${item.sku ? ` — ${item.sku}` : ''}` }))} onPick={v => update('inventoryId', v)} />
              <Field label="Quantidade em estoque *" value={form.quantity} onChange={v => update('quantity', v)} numeric />
            </>}
            <Field label="Descrição" value={form.description} onChange={v => update('description', v)} multiline />
          </Section>
          <Section title="Data"><Field label="Data da despesa (AAAA-MM-DD)" value={form.expenseDate} onChange={v => update('expenseDate', v)} placeholder="2026-11-23" /></Section>
          <Section title="Alocação">
            <Select label="Tipo" value={form.allocationType} options={ALLOCATIONS} onPick={v => changeAllocation(v as Allocation)} />
            {form.allocationType === 'CATEGORY_PRODUCTS' && <Select label="Categoria dos produtos" value={productCategory} options={PRODUCT_CATEGORIES} onPick={v => { setProductCategory(v); update('products', form.products.map(p => ({ ...p, productId: '' }))); }} />}
            {form.allocationType !== 'GENERAL' && <>
              {loadingOptions && <ActivityIndicator color={C.gold} />}
              {form.products.map((item, index) => <View key={index} style={s.productCard}>
                <Select label={`Produto ${index + 1}`} value={item.productId} options={products.filter(p => form.allocationType !== 'CATEGORY_PRODUCTS' || (p.category === productCategory && (p.id === item.productId || !form.products.some(selected => selected.productId === p.id)))).map(p => ({ value: p.id, label: p.name }))}
                  onPick={v => setProduct(index, 'productId', v)} />
                {form.allocationType === 'CATEGORY_PRODUCTS' && <>
                  <Field label="Valor alocado (R$)" value={item.allocatedValue} onChange={v => setProduct(index, 'allocatedValue', v)} numeric />
                  <Button label="Remover produto" icon="trash-outline" secondary onPress={() => update('products', form.products.filter((_, i) => i !== index))} />
                </>}
              </View>)}
              {form.allocationType === 'CATEGORY_PRODUCTS' && <Button label="Adicionar produto" icon="add" secondary onPress={() => update('products', [...form.products, { productId: '', allocatedValue: '' }])} />}
            </>}
            {form.allocationType !== 'CATEGORY_PRODUCTS'
              ? <Field label="Valor total (R$)" value={form.value} numeric onChange={v => setForm(prev => prev ? { ...prev, value: v, products: prev.allocationType === 'SPECIFIC_PRODUCT' ? prev.products.map(p => ({ ...p, allocatedValue: v })) : prev.products } : prev)} />
              : <View style={s.stat}><Text style={s.label}>Valor total da despesa</Text><Text style={s.statValue}>{currency(Number.isFinite(total) ? total : 0)}</Text></View>}
          </Section>
        </>}
        <Button label={saving ? 'Salvando...' : 'Salvar alterações'} icon="save-outline" disabled={saving || cancelled} onPress={() => void save()} />
        <Button label="Cancelar" secondary onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={picker != null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={s.pickerCard}>
          <Text style={s.sectionTitle}>{picker?.title}</Text>
          <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder="Buscar..." placeholderTextColor="#a8a29e" />
          <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
            {filteredOptions.length === 0 && <Text style={s.muted}>Nenhuma opção encontrada.</Text>}
            {filteredOptions.map(option => <Pressable key={option.value} style={s.option} onPress={() => { picker?.onPick(option.value); setPicker(null); }}>
              <Text style={s.selectText}>{option.label}</Text>{picker?.value === option.value && <Ionicons name="checkmark" size={18} color={C.gold} />}
            </Pressable>)}
          </ScrollView>
          <Button label="Fechar" secondary onPress={() => setPicker(null)} />
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, content: { padding: 18, paddingBottom: 44, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 18, padding: 24 },
  back: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8 }, backText: { fontSize: 14, color: C.gold, fontWeight: '600' },
  title: { fontSize: 29, fontFamily: 'serif', color: C.dark, marginBottom: 4 },
  section: { backgroundColor: C.white, borderRadius: 17, padding: 18, borderWidth: 1, borderColor: C.border, gap: 13 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: C.dark, marginBottom: 5 },
  field: { gap: 7 }, label: { color: '#51473d', fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: C.white, color: C.dark, fontSize: 14 },
  select: { borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 13, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  selectText: { color: C.dark, fontSize: 14, flexShrink: 1 },
  button: { minHeight: 47, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', gap: 8, flex: 1 },
  primary: { backgroundColor: C.gold }, secondary: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border },
  buttonText: { color: C.white, fontSize: 14, fontWeight: '700' },
  stat: { borderRadius: 12, backgroundColor: C.light, padding: 15, gap: 8 }, statValue: { fontSize: 23, fontWeight: '700', color: C.dark },
  summaryRow: { flexDirection: 'row', gap: 10 }, summary: { flex: 1, padding: 12, backgroundColor: C.bg, borderRadius: 12, gap: 8 },
  statSmall: { fontSize: 17, color: C.dark, fontWeight: '700' }, muted: { fontSize: 13, color: C.muted }, hint: { fontSize: 12, color: C.muted, lineHeight: 19 }, error: { fontSize: 13, color: C.red },
  productCard: { backgroundColor: C.bg, borderRadius: 12, padding: 13, gap: 12 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 }, pickerCard: { borderRadius: 18, backgroundColor: C.white, padding: 19, gap: 13, maxHeight: '85%' },
  option: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
});
