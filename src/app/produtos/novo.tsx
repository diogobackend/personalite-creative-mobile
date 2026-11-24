import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Text as NativeText,
  Platform,
  Pressable, ScrollView, StyleSheet, Switch,
  TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/api';

type Category = { id: string; name: string; type: string };
type PricingType = 'FIXED' | 'TIERED' | 'QUOTE';
type ChargeType = 'PER_ORDER' | 'PER_UNIT' | 'FIRST_PURCHASE';
type PriceRow = { id: number; minimumQuantity: string; unitPrice: string };
type FeeRow = { id: number; name: string; amount: string; chargeType: ChargeType; required: boolean; active: boolean };
type CharacteristicKey = 'colors' | 'sizes' | 'brands' | 'models' | 'materials';
type Characteristics = Record<CharacteristicKey, string[]>;
type ProductForm = {
  code: string; name: string; categoryId: string; description: string;
  minimumQuantity: string; pricingType: PricingType; shelfLifeDays: string;
  productionLeadTimeMinDays: string; productionLeadTimeMaxDays: string; active: boolean;
};
type PickerOption = { label: string; value: string };
type PickerState = { title: string; options: PickerOption[]; onSelect: (value: string) => void } | null;

// O Android pode recortar o último glifo de textos renderizados com largura exata.
// Um espaço não separável final reserva a largura do último caractere,
// sem alterar as palavras, e funciona também no iOS.
function Text({ children, style, ...props }: ComponentProps<typeof NativeText>) {
  return (
    <NativeText {...props} style={[{ includeFontPadding: true }, style]}>
      {children}{'\u00a0'}
    </NativeText>
  );
}

const GOLD = '#a98a58';
const DARK = '#302c29';
const BORDER = '#e6ded2';
const pricingTypes: { value: PricingType; label: string }[] = [
  { value: 'FIXED', label: 'Preço fixo' },
  { value: 'TIERED', label: 'Por quantidade' },
  { value: 'QUOTE', label: 'Sob consulta' },
];
const chargeTypes: { value: ChargeType; label: string }[] = [
  { value: 'PER_ORDER', label: 'Por pedido' },
  { value: 'PER_UNIT', label: 'Por unidade' },
  { value: 'FIRST_PURCHASE', label: 'Primeira compra' },
];
const characteristicFields: { key: CharacteristicKey; label: string; placeholder: string }[] = [
  { key: 'colors', label: 'Cores', placeholder: 'Ex.: Azul' },
  { key: 'sizes', label: 'Tamanhos', placeholder: 'Ex.: M' },
  { key: 'brands', label: 'Marcas', placeholder: 'Ex.: Personalité' },
  { key: 'models', label: 'Modelos', placeholder: 'Ex.: Clássico' },
  { key: 'materials', label: 'Materiais', placeholder: 'Ex.: Algodão' },
];
const blankCharacteristics = (): Characteristics => ({ colors: [], sizes: [], brands: [], models: [], materials: [] });
const blankInputs = (): Record<CharacteristicKey, string> => ({ colors: '', sizes: '', brands: '', models: '', materials: '' });
const positiveInteger = (value: string) => /^\d+$/.test(value) && Number(value) > 0;
const nonnegativeInteger = (value: string) => /^\d+$/.test(value) && Number(value) >= 0;
const optionalNumber = (value: string) => value.trim() === '' ? null : Number(value);
const decimal = (value: string) => Number(value.replace(',', '.'));

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    if (error.response.status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (error.response.status === 403) return 'Você não tem permissão para cadastrar produtos.';
    if (error.response.status === 409) return 'Já existe um produto com esse código.';
    const message: unknown = error.response.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    return `Não foi possível cadastrar o produto (HTTP ${error.response.status}).`;
  }
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

function Section({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return <View style={styles.section}>
    {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
    {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
    {children}
  </View>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text>
    {children}
  </View>;
}

function OptionField({ label, value, placeholder, onPress, required }: {
  label: string; value: string; placeholder?: string; onPress: () => void; required?: boolean;
}) {
  return <Field label={label} required={required}>
    <Pressable onPress={onPress} style={styles.select} accessibilityRole="button">
      <Text style={[styles.selectText, !value && styles.placeholder]} numberOfLines={2}>
        {value || placeholder || 'Selecionar'}
      </Text>
      <Ionicons name="chevron-down" size={18} color={GOLD} />
    </Pressable>
  </Field>;
}

export default function NovoProdutoScreen() {
  const [form, setForm] = useState<ProductForm>({
    code: '', name: '', categoryId: '', description: '', minimumQuantity: '',
    pricingType: 'TIERED', shelfLifeDays: '', productionLeadTimeMinDays: '',
    productionLeadTimeMaxDays: '', active: true,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [prices, setPrices] = useState<PriceRow[]>([{ id: 0, minimumQuantity: '', unitPrice: '' }]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [nextId, setNextId] = useState(1);
  const [characteristics, setCharacteristics] = useState<Characteristics>(blankCharacteristics);
  const [characteristicInputs, setCharacteristicInputs] = useState<Record<CharacteristicKey, string>>(blankInputs);
  const [picker, setPicker] = useState<PickerState>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchCategories = async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        if (!token) { router.replace('/'); return; }
        const { data } = await api.get<Category[]>('/categories', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active) setCategories(data.filter(item => item.type === 'PRODUCT').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      } catch (error) {
        if (active) Alert.alert('Erro ao buscar categorias', errorMessage(error));
      } finally {
        if (active) setLoadingCategories(false);
      }
    };
    void fetchCategories();
    return () => { active = false; };
  }, []);

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }
  function updatePrice(id: number, key: 'minimumQuantity' | 'unitPrice', value: string) {
    setPrices(current => current.map(price => price.id === id ? { ...price, [key]: value } : price));
  }
  function updateFee<K extends keyof Omit<FeeRow, 'id'>>(id: number, key: K, value: FeeRow[K]) {
    setFees(current => current.map(fee => fee.id === id ? { ...fee, [key]: value } : fee));
  }
  function addCharacteristic(key: CharacteristicKey) {
    const value = characteristicInputs[key].trim();
    if (!value) return;
    setCharacteristics(current => ({
      ...current,
      [key]: current[key].some(item => item.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))
        ? current[key] : [...current[key], value],
    }));
    setCharacteristicInputs(current => ({ ...current, [key]: '' }));
  }
  function choose(title: string, options: PickerOption[], onSelect: (value: string) => void) {
    setPicker({ title, options, onSelect });
  }

  async function submit() {
    if (saving) return;
    const invalid = (message: string) => Alert.alert('Verifique os dados', message);
    if (!/^\d{4}$/.test(form.code)) return invalid('O código deve conter exatamente 4 números.');
    if (!form.name.trim()) return invalid('Informe o nome do produto.');
    const selectedCategory = categories.find(category => category.id === form.categoryId);
    if (!selectedCategory) return invalid('Selecione uma categoria válida.');
    if (form.minimumQuantity && !positiveInteger(form.minimumQuantity)) return invalid('A quantidade mínima deve ser um número inteiro maior que zero.');
    if (form.shelfLifeDays && !positiveInteger(form.shelfLifeDays)) return invalid('A validade deve ser um número inteiro maior que zero.');
    if (form.productionLeadTimeMinDays && !nonnegativeInteger(form.productionLeadTimeMinDays)) return invalid('O prazo mínimo de produção deve ser um número inteiro não negativo.');
    if (form.productionLeadTimeMaxDays && !nonnegativeInteger(form.productionLeadTimeMaxDays)) return invalid('O prazo máximo de produção deve ser um número inteiro não negativo.');
    if (form.productionLeadTimeMinDays && form.productionLeadTimeMaxDays && Number(form.productionLeadTimeMinDays) > Number(form.productionLeadTimeMaxDays))
      return invalid('O prazo mínimo de produção não pode exceder o máximo.');
    if (form.pricingType !== 'QUOTE') {
      if (prices.length === 0) return invalid('Adicione ao menos uma faixa de preço.');
      if (prices.some(price => !positiveInteger(price.minimumQuantity) || !price.unitPrice.trim() || !Number.isFinite(decimal(price.unitPrice)) || decimal(price.unitPrice) <= 0))
        return invalid('Preencha as faixas de preço com quantidade inteira positiva e valor maior que zero.');
      if (new Set(prices.map(price => Number(price.minimumQuantity))).size !== prices.length)
        return invalid('Não repita a mesma quantidade mínima nas faixas de preço.');
    }
    if (fees.some(fee => !fee.name.trim() || !fee.amount.trim() || !Number.isFinite(decimal(fee.amount)) || decimal(fee.amount) < 0))
      return invalid('Preencha o nome e um valor não negativo em todas as taxas.');

    setSaving(true);
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token || token === 'undefined' || token === 'null') {
        Alert.alert('Sessão inválida', 'Faça login novamente.');
        router.replace('/');
        return;
      }
      const payload = {
        code: form.code,
        name: form.name.trim(),
        category: selectedCategory.name,
        categoryId: selectedCategory.id,
        description: form.description.trim() || null,
        minimumQuantity: optionalNumber(form.minimumQuantity),
        pricingType: form.pricingType,
        shelfLifeDays: optionalNumber(form.shelfLifeDays),
        productionLeadTimeMinDays: optionalNumber(form.productionLeadTimeMinDays),
        productionLeadTimeMaxDays: optionalNumber(form.productionLeadTimeMaxDays),
        active: form.active,
        ...characteristics,
        prices: form.pricingType === 'QUOTE' ? [] : prices.map(price => ({
          minimumQuantity: Number(price.minimumQuantity), unitPrice: decimal(price.unitPrice),
        })),
        fees: fees.map(fee => ({
          name: fee.name.trim(), amount: decimal(fee.amount), chargeType: fee.chargeType,
          required: fee.required, active: fee.active,
        })),
      };
      await api.post('/products', payload, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Sucesso', 'Produto cadastrado com sucesso!', [
        { text: 'Ver produtos', onPress: () => router.replace('/produtos') },
      ]);
    } catch (error) {
      Alert.alert('Erro ao cadastrar produto', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const selectedCategory = categories.find(category => category.id === form.categoryId)?.name || '';
  const pricingLabel = pricingTypes.find(option => option.value === form.pricingType)?.label || '';
  const numberInput = (label: string, key: keyof Pick<ProductForm, 'minimumQuantity' | 'shelfLifeDays' | 'productionLeadTimeMinDays' | 'productionLeadTimeMaxDays'>, placeholder: string) => (
    <Field label={label}><TextInput style={styles.input} keyboardType="number-pad" value={form[key]} placeholder={placeholder}
      placeholderTextColor="#a8a29e" onChangeText={value => updateForm(key, value.replace(/\D/g, ''))} /></Field>
  );

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.heading}>Cadastrar produto</Text>
          
            <Pressable
              onPress={() => router.replace('/produtos')}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={17} color="#fff" />
              <NativeText style={styles.backButtonText}>
                Produtos
              </NativeText>
            </Pressable>

        </View>

        <Section>
          <Field label="Código" required><TextInput style={styles.input} placeholder="Ex.: 0703" placeholderTextColor="#a8a29e"
            value={form.code} maxLength={4} keyboardType="number-pad" onChangeText={value => updateForm('code', value.replace(/\D/g, ''))} /></Field>
          <Field label="Nome" required><TextInput style={styles.input} placeholder="Produto" placeholderTextColor="#a8a29e"
            value={form.name} maxLength={255} onChangeText={value => updateForm('name', value)} /></Field>
          <OptionField label="Categoria" required placeholder={loadingCategories ? 'Carregando categorias...' : 'Selecione uma categoria'}
            value={selectedCategory} onPress={() => choose('Categoria', categories.map(category => ({ label: category.name, value: category.id })), value => updateForm('categoryId', value))} />
          <OptionField label="Tipo de precificação" required value={pricingLabel}
            onPress={() => choose('Tipo de precificação', pricingTypes.map(item => ({ label: item.label, value: item.value })), value => updateForm('pricingType', value as PricingType))} />
          {numberInput('Quantidade mínima', 'minimumQuantity', 'Ex.: 50')}
          <Field label="Descrição"><TextInput style={[styles.input, styles.textarea]} multiline textAlignVertical="top"
            placeholder="Descreva o produto..." placeholderTextColor="#a8a29e" value={form.description}
            onChangeText={value => updateForm('description', value)} /></Field>
          <View style={styles.switchRow}><Text style={styles.switchText}>Produto ativo</Text>
            <Switch value={form.active} onValueChange={value => updateForm('active', value)} trackColor={{ false: '#ddd', true: '#cdb58c' }} thumbColor={form.active ? GOLD : '#f4f3f4'} /></View>
        </Section>

        <Section title="Características">
          {characteristicFields.map(({ key, label, placeholder }) => <View key={key} style={styles.characteristicBlock}>
            <Field label={label}>
              <View style={styles.addRow}>
                <TextInput style={[styles.input, styles.rowInput]} placeholder={placeholder} placeholderTextColor="#a8a29e"
                  value={characteristicInputs[key]} onChangeText={value => setCharacteristicInputs(current => ({ ...current, [key]: value }))}
                  onSubmitEditing={() => addCharacteristic(key)} returnKeyType="done" />
                <Pressable style={styles.addButton} onPress={() => addCharacteristic(key)}><Ionicons name="add" size={18} color="#946f3d" /><Text style={styles.addText}>Add</Text></Pressable>
              </View>
            </Field>
            {characteristics[key].length > 0 && <View style={styles.tags}>{characteristics[key].map(value => <View key={value} style={styles.tag}>
              <Text style={styles.tagText}>{value}</Text><Pressable onPress={() => setCharacteristics(current => ({ ...current, [key]: current[key].filter(item => item !== value) }))}>
                <Ionicons name="close-circle" color="#a66b55" size={18} />
              </Pressable></View>)}</View>}
          </View>)}
        </Section>

        <Section title="Produção e validade">
          {numberInput('Validade (dias)', 'shelfLifeDays', 'Ex.: 30')}
          {numberInput('Produção mínima (dias)', 'productionLeadTimeMinDays', 'Ex.: 3')}
          {numberInput('Produção máxima (dias)', 'productionLeadTimeMaxDays', 'Ex.: 7')}
        </Section>

        {form.pricingType !== 'QUOTE' && <Section title="Preços" description={form.pricingType === 'TIERED' ? 'Defina os preços por faixa de quantidade.' : 'Defina o preço unitário do produto.'}>
          <Pressable style={styles.outlineButton} onPress={() => { setPrices(current => [...current, { id: nextId, minimumQuantity: '', unitPrice: '' }]); setNextId(id => id + 1); }}>
            <Ionicons name="add" size={19} color="#946f3d" /><Text style={styles.outlineText}>Add preço</Text>
          </Pressable>
          {prices.map(price => <View key={price.id} style={styles.subCard}>
            <View style={styles.priceFieldsRow}>
              <View style={styles.priceField}>
                <Field label="Quantidade mínima"><TextInput style={styles.input} keyboardType="number-pad" placeholder="50"
                  placeholderTextColor="#a8a29e" value={price.minimumQuantity}
                  onChangeText={value => updatePrice(price.id, 'minimumQuantity', value.replace(/\D/g, ''))} /></Field>
              </View>
              <View style={styles.priceField}>
                <Field label="Preço unitário (R$)"><TextInput style={styles.input} keyboardType="decimal-pad" placeholder="3,50"
                  placeholderTextColor="#a8a29e" value={price.unitPrice}
                  onChangeText={value => updatePrice(price.id, 'unitPrice', value)} /></Field>
              </View>
            </View>
            <Pressable style={styles.removeButton} onPress={() => setPrices(current => current.filter(item => item.id !== price.id))}>
              <Ionicons name="trash-outline" size={18} color="#a66b55" /><Text style={styles.removeText}>Remover preço</Text>
            </Pressable>
          </View>)}
        </Section>}

        <Section title="Taxas adicionais">
          <Pressable style={styles.outlineButton} onPress={() => { setFees(current => [...current, { id: nextId, name: '', amount: '', chargeType: 'PER_ORDER', required: false, active: true }]); setNextId(id => id + 1); }}>
            <Ionicons name="add" size={19} color="#946f3d" /><Text style={styles.outlineText}>Add taxa</Text>
          </Pressable>
          {fees.length === 0 ? <Text style={styles.empty}>Nenhuma taxa adicional cadastrada.</Text> : fees.map(fee => <View key={fee.id} style={styles.subCard}>
            <Field label="Nome da taxa"><TextInput style={styles.input} value={fee.name} placeholder="Ex.: Carimbo personalizado"
              placeholderTextColor="#a8a29e" onChangeText={value => updateFee(fee.id, 'name', value)} /></Field>
            <Field label="Valor (R$)"><TextInput style={styles.input} keyboardType="decimal-pad" value={fee.amount}
              placeholder="0,00" placeholderTextColor="#a8a29e" onChangeText={value => updateFee(fee.id, 'amount', value)} /></Field>
            <OptionField label="Cobrança" value={chargeTypes.find(item => item.value === fee.chargeType)?.label || ''}
              onPress={() => choose('Tipo de cobrança', chargeTypes.map(item => ({ label: item.label, value: item.value })), value => updateFee(fee.id, 'chargeType', value as ChargeType))} />
            <View style={styles.switchRow}><Text style={styles.switchText}>Taxa obrigatória</Text>
              <Switch value={fee.required} onValueChange={value => updateFee(fee.id, 'required', value)} trackColor={{ false: '#ddd', true: '#cdb58c' }} thumbColor={fee.required ? GOLD : '#f4f3f4'} /></View>
            <View style={styles.switchRow}><Text style={styles.switchText}>Taxa ativa</Text>
              <Switch value={fee.active} onValueChange={value => updateFee(fee.id, 'active', value)} trackColor={{ false: '#ddd', true: '#cdb58c' }} thumbColor={fee.active ? GOLD : '#f4f3f4'} /></View>
            <Pressable style={styles.removeButton} onPress={() => setFees(current => current.filter(item => item.id !== fee.id))}>
              <Ionicons name="trash-outline" size={18} color="#a66b55" /><Text style={styles.removeText}>Remover taxa</Text>
            </Pressable>
          </View>)}
        </Section>

        <View style={styles.actions}>
          <Pressable disabled={saving} style={styles.cancelButton} onPress={() => router.replace('/produtos')}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
          <Pressable disabled={saving} style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={() => void submit()}>
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save-outline" color="#fff" size={18} />}
            <Text style={styles.saveText}>{saving ? 'Salvando...' : 'Cadastrar produto'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} accessibilityLabel="Fechar seleção" />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{picker?.title}</Text>
            <Pressable onPress={() => setPicker(null)}><Ionicons name="close" size={23} color={DARK} /></Pressable></View>
          <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
            {picker?.options.length ? picker.options.map(option => <Pressable key={option.value} style={styles.modalOption}
              onPress={() => { picker.onSelect(option.value); setPicker(null); }}><Text style={styles.modalOptionText}>{option.label}</Text></Pressable>)
              : <Text style={styles.empty}>Nenhuma opção disponível.</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8f6f2' },
  content: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 40 },
  header: { marginBottom: 20, gap: 14 },
  heading: { fontSize: 30, lineHeight: 42, color: DARK, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  
backButton: {
  width: 170,
  minHeight: 48,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  backgroundColor: '#16a34a',
  borderRadius: 12,
  paddingHorizontal: 16,
},

backButtonText: {
  width: 110,
  color: '#fff',
  fontSize: 13,
  fontWeight: '600',
  includeFontPadding: true,
},

  section: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8e1d7', borderRadius: 17, padding: 18, marginBottom: 18 },
  sectionTitle: { fontSize: 21, lineHeight: 30, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: DARK, marginBottom: 9 },
  sectionDescription: { color: '#8b8176', fontSize: 13, lineHeight: 20, marginBottom: 14 },
  field: { marginBottom: 16 },
  label: { color: '#51483f', fontSize: 13, lineHeight: 20, fontWeight: '500', marginBottom: 7, alignSelf: 'flex-start', flexWrap: 'wrap' },
  required: { color: '#ad7740' },
  input: { width: '100%', borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', borderRadius: 12, minHeight: 49, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: DARK, includeFontPadding: true },
  textarea: { height: 108, paddingTop: 13 },
  select: { borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', borderRadius: 12, minHeight: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 12 },
  selectText: { flex: 1, fontSize: 14, lineHeight: 22, color: DARK },
  placeholder: { color: '#a8a29e' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46, gap: 12 },
  switchText: { color: '#51483f', fontSize: 14, lineHeight: 22, flex: 1 },
  characteristicBlock: { marginBottom: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowInput: { flex: 1, width: undefined, minWidth: 0 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: '#e2d7c9', borderRadius: 12, paddingHorizontal: 13, minHeight: 49 },
  addText: { color: '#946f3d', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -4, marginBottom: 14 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#faf8f5', borderWidth: 1, borderColor: BORDER, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  tagText: { color: DARK, fontSize: 13, lineHeight: 20 },
  outlineButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#e2d7c9', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 14 },
  outlineText: { color: '#946f3d', fontWeight: '600', fontSize: 13, lineHeight: 21 },
  subCard: { borderRadius: 13, backgroundColor: '#faf8f5', padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#eee6dd' },
  priceFieldsRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  priceField: { flex: 1, minWidth: 0 },
  removeButton: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-end', borderRadius: 9, borderWidth: 1, borderColor: '#eaded6', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 9 },
  removeText: { color: '#a66b55', fontSize: 12, lineHeight: 19 },
  empty: { textAlign: 'center', color: '#93877b', fontSize: 13, lineHeight: 21, padding: 16 },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'stretch', marginTop: 3 },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#e2d7c9', backgroundColor: '#fff', borderRadius: 12, minHeight: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 7 },
  cancelText: { color: '#65584b', fontSize: 14, lineHeight: 22 },
  saveButton: { flex: 1.55, borderRadius: 12, backgroundColor: GOLD, minHeight: 52, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 10 },
  saveText: { color: '#fff', fontSize: 13, lineHeight: 21, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 22 },
  modalCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, maxHeight: '75%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 12 },
  modalTitle: { color: DARK, fontSize: 18, lineHeight: 26, fontWeight: '700', flex: 1 },
  modalList: { flexGrow: 0 },
  modalOption: { borderBottomWidth: 1, borderBottomColor: '#f0ece5', paddingVertical: 14, paddingHorizontal: 5 },
  modalOptionText: { color: DARK, fontSize: 14, lineHeight: 22 },
});
