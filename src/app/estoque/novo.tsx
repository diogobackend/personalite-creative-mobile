import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/api';

type ProductChoice = 'YES' | 'NO';
type Product = { id: string; code: string; name: string; category: string; description?: string | null };
type ProductCharacteristics = {
  colors?: string[] | null; sizes?: string[] | null; materials?: string[] | null;
  brands?: string[] | null; models?: string[] | null;
};
type InventoryCategory = { id: string; name: string; type: string };
type InventoryForm = {
  name: string; category: string; description: string; quantity: string;
  minimumQuantity: string; unit: string; color: string; size: string;
  material: string; brand: string; model: string; sku: string;
};
type FormKey = keyof InventoryForm;
type Option = { value: string; label: string };
type Picker = { title: string; value: string; options: Option[]; onPick: (value: string) => void } | null;
type IconName = keyof typeof Ionicons.glyphMap;

const C = { bg: '#f8f6f2', white: '#fff', ink: '#342d27', muted: '#766d63', gold: '#a98a58', border: '#e8e0d4', error: '#b91c1c' };
const INITIAL: InventoryForm = {
  name: '', category: '', description: '', quantity: '0', minimumQuantity: '',
  unit: '', color: '', size: '', material: '', brand: '', model: '', sku: '',
};
const UNIT_OPTIONS: Option[] = [
  { value: 'UN', label: 'Unidade (un)' }, { value: 'PAR', label: 'Par' },
  { value: 'KIT', label: 'Kit' }, { value: 'CX', label: 'Caixa' },
  { value: 'PCT', label: 'Pacote' }, { value: 'DZ', label: 'Dúzia' },
  { value: 'M', label: 'Metro (m)' }, { value: 'CM', label: 'Centímetro (cm)' },
  { value: 'M2', label: 'Metro quadrado (m²)' }, { value: 'KG', label: 'Quilograma (kg)' },
  { value: 'G', label: 'Grama (g)' }, { value: 'L', label: 'Litro (L)' },
  { value: 'ML', label: 'Mililitro (mL)' }, { value: 'ROLO', label: 'Rolo' },
  { value: 'FOLHA', label: 'Folha' },
];
const CHARACTERISTICS: { field: 'color' | 'size' | 'material' | 'brand' | 'model'; list: keyof ProductCharacteristics; label: string; example: string }[] = [
  { field: 'color', list: 'colors', label: 'Cor', example: 'Ex.: Branco' },
  { field: 'size', list: 'sizes', label: 'Tamanho', example: 'Ex.: M' },
  { field: 'material', list: 'materials', label: 'Material', example: 'Ex.: Algodão' },
  { field: 'brand', list: 'brands', label: 'Marca', example: 'Marca do fornecedor' },
  { field: 'model', list: 'models', label: 'Modelo', example: 'Ex.: Oversized' },
];
const optional = (value: string) => value.trim() || null;
const nonnegativeInteger = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value));

function getError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não tem permissão para cadastrar itens no estoque.';
    if (error.response.status === 409) return 'Já existe um item no estoque com este SKU.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : `Não foi possível cadastrar o item (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Erro inesperado ao cadastrar o item.';
}
async function headers() {
  const token = await SecureStore.getItemAsync('access_token');
  if (!token || token === 'null' || token === 'undefined') throw new Error('Sessão inválida. Faça login novamente.');
  return { Authorization: `Bearer ${token}` };
}
function SafeText({ children, style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} style={[{ includeFontPadding: true, paddingRight: 4 }, style]}>{children}</Text>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <View style={s.field}><SafeText style={s.label}>{label}{required ? ' *' : ''}</SafeText>{children}</View>;
}
function Section({ title, description, icon, children }: { title: string; description?: string; icon: IconName; children: ReactNode }) {
  return <View style={s.card}>
    <View style={s.sectionHead}><View style={s.iconBox}><Ionicons name={icon} size={22} color={C.gold} /></View>
      <View style={s.sectionCopy}><SafeText style={s.sectionTitle}>{title}</SafeText>{description ? <SafeText style={s.helper}>{description}</SafeText> : null}</View>
    </View>{children}
  </View>;
}
function Choice({ value, label, selected, onPress }: { value: string; label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[s.choice, selected && s.choiceActive]} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
    <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={21} color={C.gold} />
    <SafeText style={s.choiceText}>{label}</SafeText>
  </Pressable>;
}

export default function NovoEstoqueScreen() {
  const [choice, setChoice] = useState<ProductChoice>('NO');
  const [form, setForm] = useState<InventoryForm>({ ...INITIAL });
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [characteristics, setCharacteristics] = useState<ProductCharacteristics | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState(false);
  const [loadingCharacteristics, setLoadingCharacteristics] = useState(false);
  const [characteristicsError, setCharacteristicsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [productModal, setProductModal] = useState(false);

  const update = (field: FormKey, value: string) => setForm(previous => ({ ...previous, [field]: value }));
  const pick = (title: string, value: string, options: Option[], onPick: (value: string) => void) => setPicker({ title, value, options, onPick });
  const selectedCategory = categories.find(category => category.name === form.category);
  const filteredProducts = useMemo(() => products.filter(product =>
    `${product.name} ${product.code}`.toLocaleLowerCase('pt-BR').includes(productSearch.trim().toLocaleLowerCase('pt-BR'))
  ), [products, productSearch]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data } = await api.get<InventoryCategory[] | { content: InventoryCategory[] }>('/categories', {
          headers: await headers(), signal: controller.signal,
        });
        const items = Array.isArray(data) ? data : data.content ?? [];
        if (!controller.signal.aborted) setCategories(items.filter(item => item.type === 'INVENTORY'));
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) setCategoryError(true);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (choice !== 'YES') return;
    const controller = new AbortController();
    void (async () => {
      setLoadingProducts(true); setProductsError(false);
      try {
        const { data } = await api.get<{ content: Product[] }>('/products', {
          params: { page: 0, size: 100 }, headers: await headers(), signal: controller.signal,
        });
        if (!controller.signal.aborted) setProducts(data.content ?? []);
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) setProductsError(true);
      } finally { if (!controller.signal.aborted) setLoadingProducts(false); }
    })();
    return () => controller.abort();
  }, [choice]);

  useEffect(() => {
    if (choice !== 'YES' || !selectedProduct) { setCharacteristics(null); return; }
    const controller = new AbortController();
    void (async () => {
      setLoadingCharacteristics(true); setCharacteristics(null); setCharacteristicsError(false);
      try {
        const { data } = await api.get<ProductCharacteristics>(`/products/${encodeURIComponent(selectedProduct.id)}`, {
          headers: await headers(), signal: controller.signal,
        });
        if (!controller.signal.aborted) setCharacteristics(data);
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) setCharacteristicsError(true);
      } finally { if (!controller.signal.aborted) setLoadingCharacteristics(false); }
    })();
    return () => controller.abort();
  }, [choice, selectedProduct]);

  function changeChoice(next: ProductChoice) {
    if (choice === next) return;
    setChoice(next); setSelectedProduct(null); setProductSearch('');
    setCharacteristics(null); setCharacteristicsError(false); setProductsError(false);
    setForm(previous => ({ ...previous, name: '', category: '', description: '', sku: '', color: '', size: '', material: '', brand: '', model: '' }));
  }
  function selectProduct(product: Product) {
    setSelectedProduct(product); setProductSearch(product.name); setProductModal(false);
    setForm(previous => ({ ...previous, name: product.name, category: product.category,
      sku: product.code, description: product.description ?? '', color: '', size: '', material: '', brand: '', model: '' }));
  }
  function selectField(label: string, value: string, options: Option[], onPick: (value: string) => void, disabled = false) {
    return <Field label={label}><Pressable disabled={disabled} style={[s.select, disabled && s.disabled]} onPress={() => pick(label, value, options, onPick)}>
      <SafeText style={[s.selectText, !value && s.placeholder]}>{options.find(option => option.value === value)?.label ?? 'Selecione'}</SafeText>
      <Ionicons name="chevron-down" color={C.gold} size={19} />
    </Pressable></Field>;
  }

  async function save() {
    if (saving) return;
    if (choice === 'YES' && !selectedProduct) return Alert.alert('Dados obrigatórios', 'Selecione um produto cadastrado.');
    if (choice === 'YES' && (loadingCharacteristics || !characteristics)) return Alert.alert('Características', characteristicsError ? 'Não foi possível carregar as características do produto.' : 'Aguarde o carregamento das características.');
    if (!form.name.trim()) return Alert.alert('Dados obrigatórios', 'Informe o nome do item.');
    if (choice === 'NO' && !selectedCategory) return Alert.alert('Dados obrigatórios', 'Selecione uma categoria válida do estoque.');
    if (!nonnegativeInteger(form.quantity)) return Alert.alert('Quantidade inválida', 'A quantidade inicial deve ser um número inteiro não negativo.');
    if (form.minimumQuantity.trim() && !nonnegativeInteger(form.minimumQuantity)) return Alert.alert('Quantidade inválida', 'A quantidade mínima deve ser um número inteiro não negativo.');
    setSaving(true);
    try {
      const authorization = await headers();
      let inventoryCategory = selectedCategory;
      if (choice === 'YES' && selectedProduct) {
        const categoryName = selectedProduct.category.trim();
        if (!categoryName) throw new Error('O produto selecionado não possui categoria.');
        if (!inventoryCategory) {
          const { data } = await api.get<InventoryCategory[] | { content: InventoryCategory[] }>('/categories', { headers: authorization });
          const existing = Array.isArray(data) ? data : data.content ?? [];
          inventoryCategory = existing.find(item => item.type === 'INVENTORY' && item.name === categoryName);
        }
        if (!inventoryCategory) {
          const { data } = await api.post<InventoryCategory>('/categories', { name: categoryName, type: 'INVENTORY' }, { headers: authorization });
          inventoryCategory = data;
          setCategories(previous => [...previous, data]);
        }
      }
      if (!inventoryCategory) throw new Error('Selecione uma categoria válida do estoque.');
      await api.post('/inventory', {
        name: form.name.trim(), category: inventoryCategory.name, categoryId: inventoryCategory.id,
        description: optional(form.description), productId: choice === 'YES' ? selectedProduct!.id : null,
        quantity: Number(form.quantity), minimumQuantity: optional(form.minimumQuantity) ? Number(form.minimumQuantity) : null,
        unit: optional(form.unit), color: optional(form.color), size: optional(form.size),
        material: optional(form.material), brand: optional(form.brand), model: optional(form.model),
        sku: choice === 'YES' ? selectedProduct!.code : optional(form.sku),
      }, { headers: authorization });
      Alert.alert('Sucesso', 'Item cadastrado no estoque com sucesso.', [{ text: 'OK', onPress: () => router.replace('/estoque') }]);
    } catch (error) { Alert.alert('Erro', getError(error)); }
    finally { setSaving(false); }
  }

  return <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Pressable onPress={() => router.back()} style={s.back}><Ionicons name="arrow-back" size={18} color={C.gold} /><SafeText style={s.backText}>Voltar para estoque</SafeText></Pressable>
        <SafeText style={s.heading}>Cadastrar item no estoque</SafeText>
        <SafeText style={s.subtitle}>Registre materiais, insumos e suas quantidades iniciais.</SafeText>

        <Section title="É um produto registrado?" icon="cube-outline">
          <View style={s.choices}>
            <Choice value="YES" label="Sim" selected={choice === 'YES'} onPress={() => changeChoice('YES')} />
            <Choice value="NO" label="Não" selected={choice === 'NO'} onPress={() => changeChoice('NO')} />
          </View>
          {choice === 'YES' ? <View style={s.topGap}>
            <Field label="Selecione o produto" required>
              <Pressable style={s.select} onPress={() => setProductModal(true)}>
                <SafeText style={[s.selectText, !selectedProduct && s.placeholder]}>{selectedProduct ? `${selectedProduct.name} · ${selectedProduct.code}` : 'Buscar produto cadastrado'}</SafeText>
                <Ionicons name="search-outline" color={C.gold} size={20} />
              </Pressable>
            </Field>
            {loadingProducts ? <ActivityIndicator color={C.gold} /> : null}
            {productsError ? <SafeText style={s.error}>Não foi possível carregar os produtos cadastrados.</SafeText> : null}
          </View> : null}
        </Section>

        <Section title="Informações do item" description="Dados principais para identificação no estoque." icon="cube-outline">
          {choice === 'NO' ? <Field label="Nome do item" required>
            <TextInput style={s.input} value={form.name} maxLength={255} onChangeText={value => update('name', value)} placeholder="Ex.: Camiseta branca" placeholderTextColor="#a8a29e" />
          </Field> : null}
          {choice === 'YES' ? <Field label="Categoria" required><View style={[s.select, s.readonly]}><SafeText style={s.selectText}>{form.category || 'Selecione um produto'}</SafeText></View></Field>
            : selectField('Categoria *', form.category, [{ value: '', label: 'Selecione uma categoria' }, ...categories.map(category => ({ value: category.name, label: category.name }))], value => update('category', value))}
          {categoryError ? <SafeText style={s.error}>Não foi possível carregar as categorias do estoque.</SafeText> : null}
          <Field label="SKU"><TextInput style={[s.input, choice === 'YES' && s.readonly]} value={form.sku} maxLength={255}
            editable={choice !== 'YES'} onChangeText={value => update('sku', value)} placeholder="Ex.: CAM-BRA-M" placeholderTextColor="#a8a29e" /></Field>
          <Field label="Descrição"><TextInput style={[s.input, s.textarea]} multiline textAlignVertical="top" value={form.description}
            onChangeText={value => update('description', value)} placeholder="Informações adicionais sobre o item..." placeholderTextColor="#a8a29e" /></Field>
        </Section>

        <Section title="Controle de estoque" description="Defina o saldo inicial e a quantidade mínima desejada." icon="layers-outline">
          <Field label="Quantidade" required><TextInput style={s.input} keyboardType="number-pad" value={form.quantity}
            onChangeText={value => update('quantity', value)} placeholder="Ex.: 50" placeholderTextColor="#a8a29e" /></Field>
          <Field label="Qtd. mínima para alertar estoque baixo"><TextInput style={s.input} keyboardType="number-pad" value={form.minimumQuantity}
            onChangeText={value => update('minimumQuantity', value)} placeholder="Ex.: 10" placeholderTextColor="#a8a29e" /></Field>
          {selectField('Unidade de medida', form.unit, [{ value: '', label: 'Selecione uma unidade' }, ...UNIT_OPTIONS], value => update('unit', value))}
          <View style={s.notice}><SafeText style={s.noticeText}>Quando a quantidade inicial for maior que zero, o sistema registrará automaticamente uma movimentação de entrada no estoque.</SafeText></View>
        </Section>

        <Section title="Características do item" description="Informações opcionais para diferenciar materiais e variações." icon="options-outline">
          {choice === 'YES' && selectedProduct && loadingCharacteristics ? <ActivityIndicator color={C.gold} /> : null}
          {choice === 'YES' && selectedProduct && characteristicsError ? <SafeText style={s.error}>Não foi possível carregar as características do produto.</SafeText> : null}
          {choice === 'YES' && selectedProduct && characteristics && CHARACTERISTICS.every(item => !characteristics[item.list]?.length)
            ? <SafeText style={s.helper}>Nenhuma característica cadastrada nesse produto.</SafeText> : null}
          {(choice === 'NO' || (choice === 'YES' && selectedProduct && characteristics)) ? CHARACTERISTICS.map(item => {
            const values = characteristics?.[item.list] ?? [];
            if (choice === 'YES' && !values.length) return null;
            return choice === 'YES'
              ? <View key={item.field}>{selectField(item.label, form[item.field], [{ value: '', label: `Selecione ${item.label.toLocaleLowerCase('pt-BR')}` }, ...values.map(value => ({ value, label: value }))], value => update(item.field, value))}</View>
              : <Field key={item.field} label={item.label}><TextInput style={s.input} maxLength={255} value={form[item.field]}
                onChangeText={value => update(item.field, value)} placeholder={item.example} placeholderTextColor="#a8a29e" /></Field>;
          }) : null}
        </Section>

        <View style={s.actions}>
          <Pressable style={s.cancel} onPress={() => router.replace('/estoque')} disabled={saving}><SafeText style={s.cancelText}>Cancelar</SafeText></Pressable>
          <Pressable style={[s.save, saving && s.disabled]} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="save-outline" size={18} color="#fff" />}
            <SafeText style={s.saveText}>{saving ? 'Salvando...' : 'Cadastrar item'}</SafeText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal visible={productModal} animationType="slide" transparent onRequestClose={() => setProductModal(false)}>
      <View style={s.overlay}><View style={s.sheet}>
        <View style={s.modalHead}><SafeText style={s.modalTitle}>Selecionar produto</SafeText><Pressable onPress={() => setProductModal(false)}><Ionicons name="close" size={24} color={C.ink} /></Pressable></View>
        <TextInput style={s.input} placeholder="Digite o nome ou código do produto" placeholderTextColor="#a8a29e" value={productSearch} onChangeText={setProductSearch} autoFocus />
        <ScrollView keyboardShouldPersistTaps="handled" style={s.modalList}>
          {loadingProducts ? <ActivityIndicator color={C.gold} /> : filteredProducts.length === 0
            ? <SafeText style={s.helper}>Nenhum produto encontrado.</SafeText>
            : filteredProducts.map(product => <Pressable key={product.id} style={s.modalItem} onPress={() => selectProduct(product)}>
                <SafeText style={s.optionText}>{product.name}</SafeText><SafeText style={s.helper}>{product.code}</SafeText>
              </Pressable>)}
        </ScrollView>
      </View></View>
    </Modal>

    <Modal visible={picker !== null} animationType="fade" transparent onRequestClose={() => setPicker(null)}>
      <View style={s.overlay}><View style={s.sheet}>
        <View style={s.modalHead}><SafeText style={s.modalTitle}>{picker?.title}</SafeText><Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={24} color={C.ink} /></Pressable></View>
        <ScrollView style={s.modalList} keyboardShouldPersistTaps="handled">
          {picker?.options.map(option => <Pressable key={option.value} style={s.modalItem} onPress={() => { picker.onPick(option.value); setPicker(null); }}>
            <SafeText style={s.optionText}>{option.label}</SafeText>
            {picker.value === option.value ? <Ionicons name="checkmark" size={20} color={C.gold} /> : null}
          </Pressable>)}
        </ScrollView>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 19, paddingBottom: 40 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, alignSelf: 'flex-start' },
  backText: { color: C.gold, fontWeight: '700', fontSize: 13, lineHeight: 22 },
  heading: { color: C.ink, fontSize: 27, lineHeight: 39, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 22, marginTop: 5, marginBottom: 20 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 17, padding: 17, marginBottom: 15 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 18 },
  sectionCopy: { flex: 1, minWidth: 0 },
  iconBox: { backgroundColor: '#f4ede2', width: 40, height: 40, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { color: C.ink, fontWeight: '700', fontSize: 17, lineHeight: 27 },
  helper: { color: C.muted, fontSize: 12, lineHeight: 21, marginTop: 3 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { minWidth: 105, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  choiceActive: { backgroundColor: '#f4ede2', borderColor: C.gold },
  choiceText: { color: C.ink, fontSize: 14, fontWeight: '700', lineHeight: 23 },
  topGap: { marginTop: 18 }, field: { marginBottom: 15 },
  label: { color: C.ink, fontSize: 13, lineHeight: 23, fontWeight: '600', marginBottom: 7 },
  input: { minHeight: 49, backgroundColor: '#fff', borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 10, color: C.ink, fontSize: 14, includeFontPadding: true },
  textarea: { minHeight: 94, paddingTop: 12 },
  select: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 11 },
  selectText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 23 },
  placeholder: { color: '#9f978d' }, readonly: { backgroundColor: '#f8f5f0' },
  error: { color: C.error, fontSize: 12, lineHeight: 21, marginBottom: 8 },
  notice: { borderColor: '#eee5d8', backgroundColor: '#fdfbf8', borderWidth: 1, padding: 13, borderRadius: 11, marginTop: 4 },
  noticeText: { color: C.muted, fontSize: 13, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9, marginTop: 4 },
  cancel: { borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  cancelText: { color: C.ink, fontWeight: '700', fontSize: 13, lineHeight: 22 },
  save: { borderRadius: 11, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 17, backgroundColor: C.gold },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 13, lineHeight: 22 }, disabled: { opacity: 0.5 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { maxHeight: '83%', minHeight: 250, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 },
  modalTitle: { color: C.ink, fontSize: 18, lineHeight: 28, fontWeight: '700', flex: 1 },
  modalList: { flexGrow: 0, marginTop: 9 },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  optionText: { color: C.ink, fontSize: 14, lineHeight: 23, flex: 1 },
});
