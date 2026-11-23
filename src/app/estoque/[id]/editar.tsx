import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type Inventory = {
  id: string; name: string; category: string; categoryId: string | null;
  description: string | null; productId: string | null; quantity: number;
  minimumQuantity: number | null; unit: string | null; color: string | null;
  size: string | null; material: string | null; brand: string | null;
  model: string | null; sku: string | null; createdAt: string; updatedAt: string;
};
type FormValues = {
  name: string; category: string; description: string; quantity: string;
  minimumQuantity: string; unit: string; color: string; size: string;
  material: string; brand: string; model: string; sku: string;
};
type EditableField = keyof FormValues;
type Product = { id: string; name: string; code: string; category: string; description?: string | null };
type Category = { id: string; name: string; type: 'PRODUCT' | 'INVENTORY' | 'EXPENSE' };
type ProductCharacteristics = {
  colors?: string[] | null; sizes?: string[] | null; materials?: string[] | null;
  brands?: string[] | null; models?: string[] | null;
};
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;
type IconName = keyof typeof Ionicons.glyphMap;
const C = { bg: '#f8f6f2', card: '#fff', ink: '#342d27', muted: '#81766b', gold: '#a98a58', border: '#ece6dc', error: '#b91c1c' };
const UNITS: Option[] = [
  { value: 'UN', label: 'Unidade' }, { value: 'PAR', label: 'Par' },
  { value: 'KIT', label: 'Kit' }, { value: 'CX', label: 'Caixa' },
  { value: 'PCT', label: 'Pacote' }, { value: 'DZ', label: 'Dúzia' },
  { value: 'M', label: 'Metro' }, { value: 'CM', label: 'Centímetro' },
  { value: 'M2', label: 'Metro quadrado' }, { value: 'KG', label: 'Quilograma' },
  { value: 'G', label: 'Grama' }, { value: 'L', label: 'Litro' },
  { value: 'ML', label: 'Mililitro' }, { value: 'ROLO', label: 'Rolo' },
  { value: 'FOLHA', label: 'Folha' },
];
const CHARACTERISTICS: {
  field: 'color' | 'size' | 'material' | 'brand' | 'model';
  list: keyof ProductCharacteristics; label: string; placeholder: string;
}[] = [
  { field: 'color', list: 'colors', label: 'Cor', placeholder: 'Ex.: Branco' },
  { field: 'size', list: 'sizes', label: 'Tamanho', placeholder: 'Ex.: 38, M, 22' },
  { field: 'material', list: 'materials', label: 'Material', placeholder: 'Ex.: Algodão' },
  { field: 'brand', list: 'brands', label: 'Marca', placeholder: 'Marca do item' },
  { field: 'model', list: 'models', label: 'Modelo', placeholder: 'Modelo do item' },
];
function toForm(item: Inventory): FormValues {
  return {
    name: item.name ?? '', category: item.category ?? '', description: item.description ?? '',
    quantity: String(item.quantity), minimumQuantity: item.minimumQuantity == null ? '' : String(item.minimumQuantity),
    unit: item.unit ?? '', color: item.color ?? '', size: item.size ?? '',
    material: item.material ?? '', brand: item.brand ?? '', model: item.model ?? '', sku: item.sku ?? '',
  };
}
function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não possui permissão para editar o estoque.';
    if (error.response.status === 404) return 'Item do estoque não encontrado.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : 'Não foi possível salvar as alterações.';
  }
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}
async function authHeaders() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token || token === 'null' || token === 'undefined') throw new Error('Sessão inválida. Faça login novamente.');
  return { Authorization: `Bearer ${token}` };
}
function SafeText({ children, style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} textBreakStrategy="simple" style={[{ includeFontPadding: true, paddingRight: 4 }, style]}>{children}</Text>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={s.field}><SafeText style={s.label}>{label}</SafeText>{children}</View>;
}
function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return <View style={s.card}><View style={s.sectionHeader}>
    <View style={s.iconBox}><Ionicons name={icon} size={21} color={C.gold} /></View>
    <SafeText style={s.sectionTitle}>{title}</SafeText>
  </View>{children}</View>;
}
function TextField({ label, value, onChange, placeholder, disabled = false, numeric = false, multiline = false, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  disabled?: boolean; numeric?: boolean; multiline?: boolean; maxLength?: number;
}) {
  return <Field label={label}><TextInput style={[s.input, multiline && s.multiline, disabled && s.readOnly]}
    value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#aaa197"
    editable={!disabled} keyboardType={numeric ? 'number-pad' : 'default'}
    multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} maxLength={maxLength} />
  </Field>;
}
function SelectField({ label, value, options, onPress, disabled = false }: {
  label: string; value: string; options: Option[]; onPress: () => void; disabled?: boolean;
}) {
  const selected = options.find(option => option.value === value);
  return <Field label={label}><Pressable onPress={onPress} disabled={disabled} style={[s.select, disabled && s.readOnly]}>
    <SafeText style={[s.selectText, !selected && s.placeholder]}>{selected?.label ?? (value || 'Selecione')}</SafeText>
    <Ionicons name="chevron-down-outline" size={18} color={C.gold} />
  </Pressable></Field>;
}
export default function EditarEstoqueScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [productChoice, setProductChoice] = useState<'YES' | 'NO'>('NO');
  const [productSearch, setProductSearch] = useState('');
  const [productListOpen, setProductListOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState<FormValues | null>(null);
  const [initialForm, setInitialForm] = useState<FormValues | null>(null);
  const [characteristics, setCharacteristics] = useState<ProductCharacteristics | null>(null);
  const [loadingCharacteristics, setLoadingCharacteristics] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(null);
      try {
        if (!id) throw new Error('Identificador do item inválido.');
        const headers = await authHeaders();
        const [itemResponse, categoriesResponse, productsResponse] = await Promise.all([
          api.get<Inventory>(`/inventory/${encodeURIComponent(id)}`, { headers, signal: controller.signal }),
          api.get<Category[] | { content: Category[] }>('/categories', { params: { type: 'INVENTORY' }, headers, signal: controller.signal }),
          api.get<{ content: Product[] }>('/products', { params: { page: 0, size: 100 }, headers, signal: controller.signal }),
        ]);
        const item = itemResponse.data;
        const categoryList = Array.isArray(categoriesResponse.data) ? categoriesResponse.data : categoriesResponse.data.content ?? [];
        let productCharacteristics: ProductCharacteristics | null = null;
        if (item.productId) {
          const response = await api.get<ProductCharacteristics>(`/products/${encodeURIComponent(item.productId)}`, { headers, signal: controller.signal });
          productCharacteristics = response.data;
        }
        if (controller.signal.aborted) return;
        const values = toForm(item);
        const productList = Array.isArray(productsResponse.data?.content) ? productsResponse.data.content : [];
        setInventory(item); setCategories(categoryList.filter(c => c.type === 'INVENTORY'));
        setProducts(productList); setProductId(item.productId); setProductChoice(item.productId ? 'YES' : 'NO');
        setProductSearch(productList.find(p => p.id === item.productId)?.name ?? '');
        setCategoryId(item.categoryId ?? categoryList.find(c => c.type === 'INVENTORY' && c.name === item.category)?.id ?? '');
        setCharacteristics(productCharacteristics);
        setForm(values); setInitialForm(values);
      } catch (cause) {
        if (controller.signal.aborted || axios.isCancel(cause)) return;
        setError(errorMessage(cause));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [id, refreshKey]);

  const change = (field: EditableField, value: string) => {
    setForm(previous => previous ? { ...previous, [field]: value } : previous);
    setError(null);
  };
  const changedFields = useMemo(() => form && initialForm
    ? (Object.keys(form) as EditableField[]).filter(field => form[field] !== initialForm[field]) : [], [form, initialForm]);
  const categoryChanged = categoryId !== (inventory?.categoryId ?? categories.find(c => c.name === inventory?.category)?.id ?? '');
  const productChanged = productId !== (inventory?.productId ?? null);
  const hasChanges = changedFields.length > 0 || categoryChanged || productChanged;
  const availableProducts = products.filter(product => product.name.toLocaleLowerCase('pt-BR').includes(productSearch.toLocaleLowerCase('pt-BR')));

  function chooseProductMode(choice: 'YES' | 'NO') {
    setProductChoice(choice);
    if (choice === 'NO') {
      setProductId(null); setProductSearch(''); setProductListOpen(false); setCharacteristics(null);
    } else {
      setProductListOpen(true);
    }
  }
  async function chooseProduct(product: Product) {
    setProductId(product.id); setProductChoice('YES'); setProductSearch(product.name); setProductListOpen(false);
    setCharacteristics(null); setLoadingCharacteristics(true);
    setForm(previous => previous ? {
      ...previous, name: product.name, category: product.category, sku: product.code,
      description: product.description ?? '', color: '', size: '', material: '', brand: '', model: '',
    } : previous);
    setCategoryId(categories.find(c => c.name === product.category)?.id ?? '');
    try {
      const headers = await authHeaders();
      const { data } = await api.get<ProductCharacteristics>(`/products/${encodeURIComponent(product.id)}`, { headers });
      setCharacteristics(data);
    } catch (cause) { Alert.alert('Erro', errorMessage(cause)); }
    finally { setLoadingCharacteristics(false); }
  }
  function showPicker(title: string, value: string, options: Option[], onPick: (value: string) => void) {
    setPicker({ title, value, options, onPick });
  }
  async function save() {
    if (!form || !initialForm || !inventory || !id || saving || !hasChanges) return;
    if (!form.name.trim()) return Alert.alert('Dados inválidos', 'O nome não pode ficar vazio.');
    if (!form.category.trim()) return Alert.alert('Dados inválidos', 'A categoria é obrigatória.');
    if (!/^\d+$/.test(form.quantity.trim()) || !Number.isSafeInteger(Number(form.quantity)))
      return Alert.alert('Dados inválidos', 'Informe uma quantidade inteira não negativa.');
    if (form.minimumQuantity.trim() && (!/^\d+$/.test(form.minimumQuantity.trim()) || !Number.isSafeInteger(Number(form.minimumQuantity))))
      return Alert.alert('Dados inválidos', 'A quantidade mínima deve ser um número inteiro não negativo.');
    if (productChoice === 'YES' && !productId) return Alert.alert('Dados inválidos', 'Selecione um produto cadastrado.');
    if (productChoice === 'YES' && loadingCharacteristics) return Alert.alert('Aguarde', 'As características do produto ainda estão sendo carregadas.');
    const payload: Record<string, string | number | null> = {};
    for (const field of changedFields) {
      const value = form[field].trim();
      if (!value) {
        if (CHARACTERISTICS.some(c => c.field === field)) payload[field] = '';
        else if (['description', 'sku', 'unit', 'minimumQuantity'].includes(field)) payload[field] = null;
      } else if (field === 'quantity' || field === 'minimumQuantity') payload[field] = Number(value);
      else payload[field] = value;
    }
    if (categoryChanged && categoryId) {
      payload.categoryId = categoryId;
      const category = categories.find(c => c.id === categoryId);
      if (category) payload.category = category.name;
    }
    if (productChanged) payload.productId = productId;
    if (!Object.keys(payload).length) return Alert.alert('Sem alterações', 'Nenhuma alteração válida para enviar.');
    setSaving(true); setError(null);
    try {
      const headers = await authHeaders();
      await api.patch(`/inventory/${encodeURIComponent(id)}`, payload, { headers });
      Alert.alert('Sucesso', 'Item do estoque atualizado com sucesso!', [
        { text: 'OK', onPress: () => router.replace(`/estoque/${id}` as never) },
      ]);
    } catch (cause) { Alert.alert('Erro', errorMessage(cause)); }
    finally { setSaving(false); }
  }

  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Pressable style={s.headerButton} onPress={() => router.back()} accessibilityLabel="Voltar">
          <Ionicons name="arrow-back" size={23} color={C.ink} />
        </Pressable>
        <SafeText style={s.headerTitle}>Editar item</SafeText>
        <Pressable style={s.headerButton} onPress={() => setRefreshKey(n => n + 1)} accessibilityLabel="Atualizar">
          <Ionicons name="refresh-outline" size={21} color={C.gold} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Pressable style={s.backLink} onPress={() => router.replace(`/estoque/${id}` as never)}>
          <Ionicons name="arrow-back-outline" size={17} color={C.gold} />
          <SafeText style={s.backText}>Voltar para o item</SafeText>
        </Pressable>
        <SafeText style={s.heading}>Editar item</SafeText>
        <SafeText style={s.subtitle}>SKU: {inventory?.sku || 'Não informado'}</SafeText>
        {loading ? <View style={s.center}><ActivityIndicator size="large" color={C.gold} /></View> : !inventory || !form ? (
          <View style={s.card}><SafeText style={s.error}>{error ?? 'Não foi possível carregar o item.'}</SafeText>
            <Pressable style={s.outlineButton} onPress={() => setRefreshKey(n => n + 1)}><SafeText style={s.outlineText}>Tentar novamente</SafeText></Pressable>
          </View>
        ) : <>
          <Section title="É um produto já cadastrado?" icon="cube-outline">
            <View style={s.choiceRow}>{(['YES', 'NO'] as const).map(choice =>
              <Pressable key={choice} onPress={() => chooseProductMode(choice)} style={[s.choice, productChoice === choice && s.choiceActive]}>
                <Ionicons name={productChoice === choice ? 'radio-button-on' : 'radio-button-off'} size={19} color={C.gold} />
                <SafeText style={s.choiceText}>{choice === 'YES' ? 'Sim' : 'Não'}</SafeText>
              </Pressable>)}</View>
            {productChoice === 'YES' && <>
              <TextField label="Selecione o produto" value={productSearch} onChange={value => { setProductSearch(value); setProductListOpen(true); }} placeholder="Buscar produto pelo nome" />
              <Pressable style={s.outlineButton} onPress={() => setProductListOpen(v => !v)}>
                <Ionicons name="search-outline" size={17} color={C.gold} />
                <SafeText style={s.outlineText}>{productListOpen ? 'Ocultar produtos' : 'Selecionar produto'}</SafeText>
              </Pressable>
              {productListOpen && <View style={s.productList}>{availableProducts.length ? availableProducts.map(product =>
                <Pressable key={product.id} style={s.productOption} onPress={() => void chooseProduct(product)}>
                  <SafeText style={s.productOptionName}>{product.name}</SafeText><SafeText style={s.productCode}>{product.code}</SafeText>
                </Pressable>) : <SafeText style={s.helper}>Nenhum produto encontrado.</SafeText>}</View>}
              {loadingCharacteristics && <ActivityIndicator color={C.gold} />}
            </>}
          </Section>
          <Section title="Informações do item" icon="cube-outline">
            <TextField label="Nome" value={form.name} onChange={v => change('name', v)} disabled={Boolean(productId)} maxLength={255} />
            <SelectField label="Categoria" value={categoryId} disabled={Boolean(productId)}
              options={[{ value: '', label: 'Selecione uma categoria' }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
              onPress={() => showPicker('Categoria', categoryId, [{ value: '', label: 'Selecione uma categoria' }, ...categories.map(c => ({ value: c.id, label: c.name }))], value => {
                setCategoryId(value); const c = categories.find(item => item.id === value); if (c) change('category', c.name);
              })} />
            <TextField label="SKU" value={form.sku} onChange={v => change('sku', v)} maxLength={255} placeholder="Ex.: CAM-BRA-M" />
            <TextField label="Descrição" value={form.description} onChange={v => change('description', v)} placeholder="Descrição do item" multiline />
          </Section>
          <Section title="Controle de estoque" icon="layers-outline">
            <TextField label="Quantidade" value={form.quantity} onChange={v => change('quantity', v)} numeric />
            <TextField label="Qtd mínima p/ alertar estar acabando" value={form.minimumQuantity} onChange={v => change('minimumQuantity', v)} numeric placeholder="Não informada" />
            <SelectField label="Unidade de medida" value={form.unit} options={[{ value: '', label: 'Não informada' }, ...UNITS]}
              onPress={() => showPicker('Unidade de medida', form.unit, [{ value: '', label: 'Não informada' }, ...UNITS], v => change('unit', v))} />
          </Section>
          {CHARACTERISTICS.some(({ field, list }) => !productId || (characteristics?.[list]?.some(value => value?.trim()) ?? false) || !!form[field]) &&
            <Section title="Características do item" icon="options-outline">
              {CHARACTERISTICS.map(({ field, list, label, placeholder }) => {
                const options = [...new Set((characteristics?.[list] ?? []).filter((value): value is string => !!value?.trim()))];
                if (productId && options.length === 0 && !form[field]) return null;
                if (!productId) return <TextField key={field} label={label} value={form[field]} onChange={v => change(field, v)} placeholder={placeholder} maxLength={255} />;
                const choices = [{ value: '', label: 'Inexistente' }, ...options.map(value => ({ value, label: value }))];
                if (form[field] && !options.includes(form[field])) choices.splice(1, 0, { value: form[field], label: `${form[field]} (atual)` });
                return <SelectField key={field} label={label} value={form[field]} options={choices}
                  onPress={() => showPicker(label, form[field], choices, v => change(field, v))} />;
              })}
            </Section>}
          {error ? <SafeText style={s.error}>{error}</SafeText> : null}
          <View style={s.actions}>
            <Pressable style={s.outlineButton} onPress={() => router.replace(`/estoque/${id}` as never)}><SafeText style={s.outlineText}>Cancelar</SafeText></Pressable>
            <Pressable onPress={() => void save()} disabled={saving || !hasChanges} style={[s.saveButton, (saving || !hasChanges) && s.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
              <SafeText style={s.saveText}>{saving ? 'Salvando...' : 'Salvar alterações'}</SafeText>
            </Pressable>
          </View>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={s.modalCard}>
          <View style={s.modalHeader}><SafeText style={s.modalTitle}>{picker?.title}</SafeText>
            <Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={C.ink} /></Pressable>
          </View>
          <ScrollView style={s.modalList} keyboardShouldPersistTaps="handled">{picker?.options.map(option =>
            <Pressable key={option.value} style={s.modalOption} onPress={() => { picker.onPick(option.value); setPicker(null); }}>
              <SafeText style={s.modalOptionText}>{option.label}</SafeText>
              {picker.value === option.value && <Ionicons name="checkmark" size={19} color={C.gold} />}
            </Pressable>)}</ScrollView>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 62, gap: 10, paddingHorizontal: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.border },
  headerButton: { width: 40, height: 43, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: C.ink, fontWeight: '700', fontSize: 19, lineHeight: 30 },
  content: { padding: 17, paddingBottom: 45 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
  backText: { color: C.gold, fontSize: 13, lineHeight: 23, fontWeight: '600' },
  heading: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 29, lineHeight: 42, color: C.ink },
  subtitle: { fontSize: 13, lineHeight: 22, color: C.muted, marginTop: 2, marginBottom: 21 },
  center: { paddingVertical: 60, alignItems: 'center' },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 17, marginBottom: 15 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 20 },
  iconBox: { width: 40, height: 40, backgroundColor: '#f4ede2', borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { color: C.ink, fontWeight: '700', fontSize: 17, lineHeight: 27, flex: 1 },
  label: { color: '#51473d', fontSize: 13, lineHeight: 23, fontWeight: '600', marginBottom: 8 },
  field: { marginBottom: 16 },
  input: { minHeight: 49, borderWidth: 1, borderColor: '#e8e0d4', borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, color: C.ink, includeFontPadding: true },
  multiline: { minHeight: 99 }, readOnly: { backgroundColor: '#f8f5f0', opacity: 0.72 },
  select: { borderWidth: 1, borderColor: '#e8e0d4', borderRadius: 12, minHeight: 49, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#fff' },
  selectText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 23 }, placeholder: { color: C.muted },
  choiceRow: { flexDirection: 'row', gap: 12, marginBottom: 17 },
  choice: { minWidth: 110, paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: C.border, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  choiceActive: { borderColor: C.gold, backgroundColor: '#f4ede2' }, choiceText: { color: C.ink, fontWeight: '700', fontSize: 14, lineHeight: 23 },
  productList: { marginTop: 11, maxHeight: 260, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  productOption: { flexDirection: 'row', gap: 8, paddingHorizontal: 13, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border },
  productOptionName: { flex: 1, fontSize: 13, lineHeight: 21, color: C.ink, fontWeight: '600' },
  productCode: { fontSize: 11, lineHeight: 20, color: C.muted }, helper: { color: C.muted, fontSize: 12, lineHeight: 21, padding: 13 },
  error: { color: C.error, fontSize: 13, lineHeight: 22, marginBottom: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  outlineButton: { minHeight: 45, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fff', paddingHorizontal: 15, paddingVertical: 11, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 7, marginBottom: 8 },
  outlineText: { color: '#80623d', fontSize: 13, lineHeight: 22, fontWeight: '700' },
  saveButton: { minHeight: 45, borderRadius: 11, backgroundColor: C.gold, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  saveText: { fontSize: 13, lineHeight: 22, color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.48 },
  modalBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  modalTitle: { flex: 1, fontSize: 17, lineHeight: 28, fontWeight: '700', color: C.ink }, modalList: { flexGrow: 0 },
  modalOption: { paddingVertical: 13, flexDirection: 'row', gap: 10, alignItems: 'center', borderBottomWidth: 1, borderColor: C.border },
  modalOptionText: { color: C.ink, fontSize: 14, lineHeight: 23, flex: 1 },
});
