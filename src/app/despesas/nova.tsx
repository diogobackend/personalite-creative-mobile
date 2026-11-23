import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/api';

type Allocation = 'GENERAL' | 'SPECIFIC_PRODUCT' | 'CATEGORY_PRODUCTS';
type ExpenseStatus = 'PAID' | 'PARTIALLY_PAID' | 'PENDING';
type Category = { id: string; name: string; type: string };
type Product = { id: string; name: string; category?: string };
type InventoryItem = { id: string; name: string; sku?: string | null };
type ProductAllocation = { productId: string; allocatedValue: string };
type Form = {
  name: string; description: string; value: string; paidAmount: string;
  category: string; categoryId: string; allocationType: Allocation; status: ExpenseStatus;
  quantity: string; inventoryId: string; expenseDate: string; isToday: boolean;
  products: ProductAllocation[];
};
type Option = { value: string; label: string; subtitle?: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void; searchable?: boolean } | null;

const C = { bg: '#f8f6f2', white: '#fff', dark: '#342d27', muted: '#81766b', gold: '#a98a58', border: '#e8e0d4', light: '#f4ede2', red: '#b91c1c' };
const STOCK_CATEGORY = 'item de estoque';
const INITIAL: Form = {
  name: '', description: '', value: '', paidAmount: '', category: '', categoryId: '',
  allocationType: 'GENERAL', status: 'PAID', quantity: '', inventoryId: '', expenseDate: '',
  isToday: true, products: [],
};
const STATUSES: Option[] = [
  { value: 'PAID', label: '100% paga' },
  { value: 'PARTIALLY_PAID', label: 'Parcialmente paga' },
  { value: 'PENDING', label: 'Pendente (0% paga)' },
];
const ALLOCATIONS: Option[] = [
  { value: 'GENERAL', label: 'Despesa geral', subtitle: 'Sem vinculação com produto. Ex.: transporte' },
  { value: 'SPECIFIC_PRODUCT', label: 'Produto específico', subtitle: 'Vinculada a um único produto' },
  { value: 'CATEGORY_PRODUCTS', label: 'Diversos produtos por categoria', subtitle: 'Distribuída entre produtos da mesma categoria' },
];
const PRODUCT_CATEGORIES: Option[] = [
  ['GOURMET', 'Gourmet'], ['AGUAS', 'Águas'], ['GARRAFAS', 'Garrafas'],
  ['GLOSS', 'Gloss'], ['BOLSAS', 'Bolsas'], ['NECESSAIRES', 'Necessaires'],
  ['LENCOS', 'Lenços'], ['PAPELARIA', 'Papelaria'], ['CAIXAS', 'Caixas'], ['KITS', 'Kits'],
].map(([value, label]) => ({ value, label }));

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function money(value: string) { return Number(value.replace(',', '.')); }
function currency(value: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
function requestError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não possui permissão para cadastrar despesas.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : `Erro ao cadastrar despesa (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Não foi possível cadastrar a despesa.';
}
async function getHeaders() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token || token === 'undefined' || token === 'null') throw new Error('Sessão inválida. Faça login novamente.');
  return { Authorization: `Bearer ${token}` };
}
function Field({ label, value, onChange, placeholder, numeric = false, multiline = false, required = false }: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; numeric?: boolean; multiline?: boolean; required?: boolean;
}) {
  return <View style={s.field}>
    <Text style={s.label}>{label}{required && <Text style={{ color: C.red }}> *</Text>}</Text>
    <TextInput
      style={[s.input, multiline && s.multiline]} value={value} onChangeText={onChange}
      placeholder={placeholder} placeholderTextColor="#a8a29e"
      keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'} autoCapitalize={numeric ? 'none' : 'sentences'}
    />
  </View>;
}
function Section({ title, icon, children }: { title?: string; icon?: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return <View style={s.section}>
    {title && <View style={s.sectionHeading}>{icon && <Ionicons name={icon} color={C.gold} size={21} />}<Text style={s.sectionTitle}>{title}</Text></View>}
    {children}
  </View>;
}
function Button({ text, onPress, icon, secondary = false, disabled = false }: {
  text: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, secondary ? s.buttonSecondary : s.buttonPrimary, disabled && { opacity: 0.5 }]}>
    {icon && <Ionicons name={icon} size={17} color={secondary ? C.gold : C.white} />}
    <Text style={[s.buttonText, secondary && { color: C.dark }]}>{text}</Text>
  </Pressable>;
}

export default function NovaDespesaScreen() {
  const [form, setForm] = useState<Form>({ ...INITIAL });
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [productCategory, setProductCategory] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [pickerSearch, setPickerSearch] = useState('');

  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const showPicker = (title: string, value: string, options: Option[], onPick: (v: string) => void, searchable = false) => {
    setPickerSearch(''); setPicker({ title, value, options, onPick, searchable });
  };
  const select = (label: string, value: string, options: Option[], onPick: (v: string) => void, searchable = false, required = false) =>
    <View style={s.field}>
      <Text style={s.label}>{label}{required && <Text style={{ color: C.red }}> *</Text>}</Text>
      <Pressable onPress={() => showPicker(label, value, options, onPick, searchable)} style={s.select}>
        <Text style={[s.selectText, !value && { color: '#a8a29e' }]}>
          {options.find(option => option.value === value)?.label ?? 'Selecione'}
        </Text>
        <Ionicons name="chevron-down-outline" size={18} color={C.gold} />
      </Pressable>
    </View>;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data } = await api.get<Category[] | { content: Category[] }>('/categories', { headers: await getHeaders() });
        const all = Array.isArray(data) ? data : data.content;
        if (active) setCategories(all.filter(category => category.type === 'EXPENSE'));
      } catch (error) {
        if (active) Alert.alert('Erro', requestError(error));
      } finally { if (active) setLoadingCategories(false); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (form.allocationType === 'GENERAL') return;
    const controller = new AbortController();
    setLoadingProducts(true);
    void (async () => {
      try {
        const { data } = await api.get<{ content: Product[] }>('/products', {
          params: { page: 0, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' },
          headers: await getHeaders(), signal: controller.signal,
        });
        if (!controller.signal.aborted) setProducts(data.content ?? []);
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) Alert.alert('Erro ao carregar produtos', requestError(error));
      } finally { if (!controller.signal.aborted) setLoadingProducts(false); }
    })();
    return () => controller.abort();
  }, [form.allocationType]);

  useEffect(() => {
    if (form.category !== STOCK_CATEGORY) { setInventory([]); return; }
    const controller = new AbortController();
    setLoadingInventory(true);
    void (async () => {
      try {
        const { data } = await api.get<{ content: InventoryItem[] } | InventoryItem[]>('/inventory', {
          params: { page: 0, pageSize: 100, sortBy: 'name', sortDirection: 'ASC' },
          headers: await getHeaders(), signal: controller.signal,
        });
        const items = Array.isArray(data) ? data : data.content;
        if (!controller.signal.aborted) setInventory(items ?? []);
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) Alert.alert('Erro ao carregar estoque', requestError(error));
      } finally { if (!controller.signal.aborted) setLoadingInventory(false); }
    })();
    return () => controller.abort();
  }, [form.category]);

  const allocationTotal = useMemo(() => form.products.reduce((sum, item) => sum + (money(item.allocatedValue) || 0), 0), [form.products]);
  const expenseTotal = form.allocationType === 'CATEGORY_PRODUCTS' ? Math.round(allocationTotal * 100) / 100 : money(form.value);
  const filteredPickerOptions = useMemo(() => (picker?.options ?? []).filter(option =>
    `${option.label} ${option.subtitle ?? ''}`.toLocaleLowerCase('pt-BR').includes(pickerSearch.trim().toLocaleLowerCase('pt-BR'))
  ), [picker, pickerSearch]);

  const changeAllocation = (type: Allocation) => {
    setProductCategory('');
    setForm(previous => ({ ...previous, allocationType: type, products: type === 'GENERAL' ? [] : type === 'SPECIFIC_PRODUCT'
      ? [{ productId: '', allocatedValue: previous.value }]
      : [{ productId: '', allocatedValue: '' }, { productId: '', allocatedValue: '' }] }));
  };
  const updateProduct = (index: number, field: keyof ProductAllocation, value: string) => {
    setForm(previous => ({ ...previous, products: previous.products.map((item, i) => i === index ? { ...item, [field]: value } : item) }));
  };
  const alertError = (message: string) => { Alert.alert('Verifique os dados', message); return false; };

  const validate = () => {
    if (!form.categoryId || !categories.some(category => category.id === form.categoryId)) return alertError('Selecione uma categoria de despesa válida.');
    if (!form.name.trim()) return alertError('Informe o nome da despesa.');
    if (!Number.isFinite(expenseTotal) || expenseTotal <= 0) return alertError('Informe um valor maior que zero.');
    const paidAmount = form.status === 'PAID' ? expenseTotal : form.status === 'PENDING' ? 0 : money(form.paidAmount);
    if (!Number.isFinite(paidAmount) || (form.status === 'PARTIALLY_PAID' && (paidAmount <= 0 || paidAmount >= expenseTotal)))
      return alertError('O valor pago inicialmente deve ser maior que zero e menor que o valor total da despesa.');
    const date = form.isToday ? today() : form.expenseDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime()))
      return alertError('Informe uma data válida no formato AAAA-MM-DD.');
    if (form.category === STOCK_CATEGORY) {
      if (!form.inventoryId) return alertError('Selecione um item do estoque.');
      const quantity = Number(form.quantity);
      if (!/^\d+$/.test(form.quantity.trim()) || !Number.isSafeInteger(quantity) || quantity <= 0)
        return alertError('Informe uma quantidade inteira maior que zero para o estoque.');
    }
    if (form.allocationType === 'SPECIFIC_PRODUCT' && form.products.length !== 1) return alertError('Selecione exatamente um produto.');
    if (form.allocationType === 'CATEGORY_PRODUCTS' && form.products.length < 2) return alertError('Selecione pelo menos dois produtos.');
    if (form.allocationType !== 'GENERAL') {
      if (form.products.some(product => !product.productId || !Number.isFinite(money(product.allocatedValue)) || money(product.allocatedValue) <= 0))
        return alertError('Preencha os produtos e seus valores de alocação.');
      const ids = form.products.map(product => product.productId);
      if (new Set(ids).size !== ids.length) return alertError('Não é permitido selecionar o mesmo produto duas vezes.');
      if (Math.abs(allocationTotal - expenseTotal) > 0.001) return alertError('A soma dos valores alocados deve ser igual ao valor da despesa.');
      if (form.allocationType === 'CATEGORY_PRODUCTS') {
        if (!productCategory) return alertError('Selecione a categoria dos produtos.');
        if (form.products.some(allocation => products.find(product => product.id === allocation.productId)?.category !== productCategory))
          return alertError('Selecione somente produtos da categoria escolhida.');
      }
    }
    return true;
  };

  const submit = async () => {
    if (saving || !validate()) return;
    const amount = form.allocationType === 'CATEGORY_PRODUCTS' ? Math.round(allocationTotal * 100) / 100 : money(form.value);
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null,
      value: amount, paidAmount: form.status === 'PAID' ? amount : form.status === 'PENDING' ? 0 : money(form.paidAmount),
      category: form.category, categoryId: form.categoryId,
      inventoryId: form.category === STOCK_CATEGORY ? form.inventoryId : null,
      allocationType: form.allocationType, status: form.status,
      quantity: form.category === STOCK_CATEGORY ? Number(form.quantity) : null,
      expenseDate: form.isToday ? today() : form.expenseDate.trim(),
      products: form.allocationType === 'GENERAL' ? [] : form.products.map(item => ({ productId: item.productId, allocatedValue: money(item.allocatedValue) })),
    };
    setSaving(true);
    try {
      await api.post('/expenses', payload, { headers: await getHeaders() });
      Alert.alert('Sucesso', 'Despesa cadastrada com sucesso!', [{ text: 'OK', onPress: () => router.replace('/despesas' as never) }]);
    } catch (error) {
      Alert.alert('Erro ao cadastrar', requestError(error));
    } finally { setSaving(false); }
  };

  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable style={s.back} onPress={() => router.push('/despesas' as never)}>
          <Ionicons name="arrow-back-outline" size={18} color={C.gold} /><Text style={s.backText}>Voltar para despesas</Text>
        </Pressable>
        <Text style={s.title}>Cadastrar despesa</Text>
        <Text style={s.subtitle}>Despesa ou entrada de estoque</Text>

        <Section>
          <Field label="Despesa" required value={form.name} onChange={v => update('name', v)} placeholder="Ex.: Compra de tecidos" />
          {loadingCategories ? <ActivityIndicator color={C.gold} /> : select('Categoria', form.categoryId,
            categories.map(item => ({ value: item.id, label: item.name })), value => {
              const category = categories.find(item => item.id === value)?.name ?? '';
              setForm(previous => ({ ...previous, categoryId: value, category, inventoryId: category === STOCK_CATEGORY ? previous.inventoryId : '', quantity: category === STOCK_CATEGORY ? previous.quantity : '' }));
            }, true, true)}
          {select('Status', form.status, STATUSES, v => update('status', v as ExpenseStatus), false, true)}
          {form.category === STOCK_CATEGORY && <>
            {loadingInventory && <ActivityIndicator color={C.gold} style={s.indicator} />}
            {select('Item do estoque', form.inventoryId, inventory.map(item => ({ value: item.id, label: item.name, subtitle: item.sku ? `SKU: ${item.sku}` : '' })),
              v => update('inventoryId', v), true, true)}
            <Field label="Quantidade em estoque" required value={form.quantity} onChange={v => update('quantity', v)} numeric placeholder="Ex.: 50" />
          </>}
          <Field label="Descrição" value={form.description} onChange={v => update('description', v)} placeholder="Informações adicionais sobre a despesa..." multiline />
        </Section>

        <Section title="Data" icon="calendar-outline">
          <Text style={s.label}>A despesa foi de hoje?</Text>
          <View style={s.row}>
            {([true, false] as const).map(isToday => <Pressable key={String(isToday)} style={[s.choice, form.isToday === isToday && s.choiceActive]} onPress={() => update('isToday', isToday)}>
              <Ionicons name={form.isToday === isToday ? 'radio-button-on' : 'radio-button-off'} size={20} color={C.gold} />
              <Text style={s.choiceText}>{isToday ? 'Sim' : 'Não'}</Text>
            </Pressable>)}
          </View>
          {!form.isToday && <Field label="Quando a despesa ocorreu? (AAAA-MM-DD)" required value={form.expenseDate} onChange={v => update('expenseDate', v)} placeholder="2026-11-23" />}
        </Section>

        <Section title="Alocação" icon="git-branch-outline">
          {select('Tipo', form.allocationType, ALLOCATIONS, v => changeAllocation(v as Allocation), false, true)}
          <Text style={s.hint}>{ALLOCATIONS.find(item => item.value === form.allocationType)?.subtitle}</Text>
          {form.allocationType === 'CATEGORY_PRODUCTS' && select('Categoria dos produtos', productCategory, PRODUCT_CATEGORIES, v => {
            setProductCategory(v);
            setForm(previous => ({ ...previous, products: previous.products.map(item => ({ ...item, productId: '' })) }));
          }, false, true)}
          {form.allocationType !== 'GENERAL' && <>
            {loadingProducts && <ActivityIndicator color={C.gold} style={s.indicator} />}
            {form.products.map((allocation, index) => {
              const filtered = form.allocationType === 'CATEGORY_PRODUCTS'
                ? products.filter(product => product.category === productCategory &&
                  (product.id === allocation.productId || !form.products.some(selected => selected.productId === product.id)))
                : products;
              return <View key={index} style={s.productBox}>
                <Text style={s.productTitle}>Produto {index + 1}</Text>
                {select('Produto', allocation.productId, filtered.map(product => ({ value: product.id, label: product.name })),
                  v => updateProduct(index, 'productId', v), true, true)}
                {form.allocationType === 'CATEGORY_PRODUCTS' && <>
                  <Field label="Valor alocado (R$)" required numeric value={allocation.allocatedValue} onChange={v => updateProduct(index, 'allocatedValue', v)} placeholder="0,00" />
                  <Button text="Remover produto" icon="trash-outline" secondary onPress={() => setForm(previous => ({ ...previous, products: previous.products.filter((_, i) => i !== index) }))} />
                </>}
              </View>;
            })}
            {form.allocationType === 'CATEGORY_PRODUCTS' && <Button text="Adicionar produto" icon="add-outline" secondary onPress={() => setForm(previous => ({ ...previous, products: [...previous.products, { productId: '', allocatedValue: '' }] }))} />}
          </>}
          {form.allocationType !== 'CATEGORY_PRODUCTS'
            ? <Field label="Valor total (R$)" required numeric value={form.value} onChange={v => {
                setForm(previous => ({ ...previous, value: v, products: previous.allocationType === 'SPECIFIC_PRODUCT' ? previous.products.map(product => ({ ...product, allocatedValue: v })) : previous.products }));
              }} placeholder="0,00" />
            : <View style={s.totalBox}><Text style={s.totalLabel}>Valor total da despesa</Text><Text style={s.totalValue}>{currency(expenseTotal)}</Text></View>}
          {form.status === 'PARTIALLY_PAID' && <Field label="Valor pago inicialmente (R$)" required numeric value={form.paidAmount} onChange={v => update('paidAmount', v)} placeholder="0,00" />}
        </Section>

        <View style={s.footer}>
          <Button text="Cancelar" secondary onPress={() => router.push('/despesas' as never)} />
          <Button text={saving ? 'Salvando...' : 'Registrar'} icon={saving ? undefined : 'save-outline'} disabled={saving || loadingCategories} onPress={() => void submit()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={s.modalCard}>
          <View style={s.modalHeading}><Text style={s.modalTitle}>{picker?.title}</Text><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={24} color={C.dark} /></Pressable></View>
          {picker?.searchable && <TextInput style={s.input} placeholder="Buscar por nome ou código..." placeholderTextColor="#a8a29e" value={pickerSearch} onChangeText={setPickerSearch} autoFocus />}
          <ScrollView style={s.modalList} keyboardShouldPersistTaps="handled">
            {filteredPickerOptions.length ? filteredPickerOptions.map(item => <Pressable key={item.value} style={s.modalOption} onPress={() => { picker?.onPick(item.value); setPicker(null); }}>
              <View style={s.optionInfo}><Text style={s.optionLabel}>{item.label}</Text>{item.subtitle && <Text style={s.optionSubtitle}>{item.subtitle}</Text>}</View>
              {picker?.value === item.value && <Ionicons name="checkmark-outline" size={20} color={C.gold} />}
            </Pressable>) : <Text style={s.empty}>Nenhuma opção encontrada.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, flex: { flex: 1 },
  content: { paddingHorizontal: 17, paddingTop: 24, paddingBottom: 44 },
  back: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 14, alignSelf: 'flex-start' },
  backText: { color: C.gold, fontSize: 13, lineHeight: 22, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 40, color: C.dark, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  subtitle: { fontSize: 13, lineHeight: 22, color: C.muted, marginBottom: 22 },
  section: { padding: 18, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, marginBottom: 17 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 19 },
  sectionTitle: { fontSize: 18, lineHeight: 29, fontWeight: '700', color: C.dark },
  field: { marginBottom: 17 }, label: { fontSize: 13, lineHeight: 23, fontWeight: '600', color: C.dark, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fff', minHeight: 49, paddingHorizontal: 13, paddingVertical: 10, color: C.dark, fontSize: 14, includeFontPadding: true },
  multiline: { minHeight: 99, paddingTop: 12 },
  select: { minHeight: 49, paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderColor: C.border, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectText: { flex: 1, fontSize: 14, lineHeight: 23, color: C.dark },
  hint: { fontSize: 12, lineHeight: 21, color: C.muted, marginTop: -7, marginBottom: 18 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  choice: { flex: 1, flexDirection: 'row', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 12, alignItems: 'center' },
  choiceActive: { borderColor: C.gold, backgroundColor: C.light },
  choiceText: { fontSize: 14, fontWeight: '600', color: C.dark },
  productBox: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: '#fdfcfb', marginBottom: 13 },
  productTitle: { color: C.dark, fontSize: 14, lineHeight: 24, fontWeight: '700', marginBottom: 12 },
  totalBox: { padding: 16, borderRadius: 12, backgroundColor: C.light, marginBottom: 15, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  totalLabel: { color: C.dark, fontSize: 13, lineHeight: 23 }, totalValue: { color: C.dark, fontSize: 17, lineHeight: 27, fontWeight: '700' },
  indicator: { marginBottom: 12 },
  button: { minHeight: 46, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonPrimary: { backgroundColor: C.gold }, buttonSecondary: { borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  buttonText: { color: C.white, fontSize: 13, lineHeight: 23, fontWeight: '700' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 11, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: C.white, borderRadius: 17, padding: 18, maxHeight: '80%' },
  modalHeading: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  modalTitle: { flex: 1, color: C.dark, fontWeight: '700', fontSize: 18, lineHeight: 29 },
  modalList: { flexGrow: 0, marginTop: 7 },
  modalOption: { paddingVertical: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  optionInfo: { flex: 1 }, optionLabel: { color: C.dark, fontSize: 14, lineHeight: 23 },
  optionSubtitle: { color: C.muted, fontSize: 12, lineHeight: 20 },
  empty: { textAlign: 'center', padding: 20, color: C.muted, fontSize: 13 },
});
