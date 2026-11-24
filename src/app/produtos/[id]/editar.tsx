import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../lib/api';

type Pricing = 'FIXED' | 'TIERED' | 'QUOTE';
type Charge = 'PER_ORDER' | 'PER_UNIT' | 'FIRST_PURCHASE';
type Characteristic = 'colors' | 'sizes' | 'brands' | 'models' | 'materials';
type Attributes = Record<Characteristic, string[]>;
type Category = { id: string; name: string; type: 'PRODUCT' | 'INVENTORY' | 'EXPENSE' };
type ProductPrice = { id: string; minimumQuantity: number; unitPrice: number };
type ProductFee = { id: string; name: string; amount: number; chargeType: Charge; required: boolean; active: boolean };
type Product = {
  id: string; code: string; name: string; category: string; categoryId: string | null;
  description: string | null; minimumQuantity: number | null; pricingType: Pricing;
  shelfLifeDays: number | null; productionLeadTimeMinDays: number | null;
  productionLeadTimeMaxDays: number | null; active: boolean;
  colors?: string[]; sizes?: string[]; brands?: string[]; models?: string[]; materials?: string[];
  prices: ProductPrice[]; fees: ProductFee[];
};
type PriceRow = { key: number; id?: string; minimumQuantity: string; unitPrice: string };
type FeeRow = { key: number; id?: string; name: string; amount: string; chargeType: Charge; required: boolean; active: boolean };
type Form = {
  name: string; category: string; description: string; minimumQuantity: string; pricingType: Pricing;
  shelfLifeDays: string; productionLeadTimeMinDays: string; productionLeadTimeMaxDays: string; active: boolean;
};
type PickerState = { title: string; options: { label: string; value: string }[]; select: (value: string) => void } | null;

const C = { background: '#f8f6f2', paper: '#fff', dark: '#342d27', gold: '#a98a58', border: '#e8e1d7', muted: '#78716c', red: '#a66b55' };
const attributeFields: { key: Characteristic; label: string; placeholder: string }[] = [
  { key: 'colors', label: 'Cores', placeholder: 'Ex.: Azul' },
  { key: 'sizes', label: 'Tamanhos', placeholder: 'Ex.: M' },
  { key: 'brands', label: 'Marcas', placeholder: 'Ex.: Personalité' },
  { key: 'models', label: 'Modelos', placeholder: 'Ex.: Clássico' },
  { key: 'materials', label: 'Materiais', placeholder: 'Ex.: Algodão' },
];
const pricingOptions = [
  { label: 'Por quantidade', value: 'TIERED' }, { label: 'Preço fixo', value: 'FIXED' }, { label: 'Sob orçamento', value: 'QUOTE' },
];
const chargeOptions = [
  { label: 'Por pedido', value: 'PER_ORDER' }, { label: 'Por unidade', value: 'PER_UNIT' }, { label: 'Primeira compra', value: 'FIRST_PURCHASE' },
];
const cleanAttributes = (): Attributes => ({ colors: [], sizes: [], brands: [], models: [], materials: [] });
const blankInputs = (): Record<Characteristic, string> => ({ colors: '', sizes: '', brands: '', models: '', materials: '' });
const numberOrNull = (value: string) => value.trim() ? Number(value) : null;
const asNumber = (value: string) => Number(value.replace(',', '.'));
const validInteger = (value: string, minimum: number) => /^\d+$/.test(value) && Number(value) >= minimum;
const normalizeNumber = (value: number | null | undefined) => value == null ? '' : String(value);

function getError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401) return 'Sua sessão expirou. Faça login novamente.';
    if (status === 403) return 'Você não tem permissão para editar produtos.';
    if (status === 404) return 'Produto não encontrado.';
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    const message: unknown = error.response.data?.message;
    return typeof message === 'string' && message.trim() ? message : `Erro HTTP ${status}.`;
  }
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>{children}</View>;
}
function Selection({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <Field label={label}><Pressable style={s.select} onPress={onPress} accessibilityRole="button">
    <Text style={[s.selectValue, !value && s.placeholder]}>{value || 'Selecionar'}</Text>
    <Ionicons name="chevron-down" size={18} color={C.gold} />
  </Pressable></Field>;
}

export default function EditarProdutoScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const idCounter = useRef(1);
  const createKey = () => idCounter.current++;
  const [original, setOriginal] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [form, setForm] = useState<Form>({ name: '', category: '', description: '', minimumQuantity: '', pricingType: 'TIERED', shelfLifeDays: '', productionLeadTimeMinDays: '', productionLeadTimeMaxDays: '', active: true });
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [attributes, setAttributes] = useState<Attributes>(cleanAttributes);
  const [inputs, setInputs] = useState<Record<Characteristic, string>>(blankInputs);
  const [picker, setPicker] = useState<PickerState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        if (!id) throw new Error('ID do produto não informado.');
        const token = await SecureStore.getItemAsync('access_token');
        if (!token) { if (!controller.signal.aborted) router.replace('/'); return; }
        const headers = { Authorization: `Bearer ${token}` };
        const [productResponse, categoriesResponse] = await Promise.all([
          api.get<Product>(`/products/${encodeURIComponent(id)}`, { headers, signal: controller.signal }),
          api.get<Category[]>('/categories', { headers, params: { type: 'PRODUCT' }, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        const product = productResponse.data;
        const productCategories = categoriesResponse.data.filter(item => item.type === 'PRODUCT');
        setOriginal(product);
        setCategories(productCategories);
        setCategoryId(product.categoryId ?? productCategories.find(item => item.name === product.category)?.id ?? '');
        setForm({
          name: product.name, category: product.category, description: product.description ?? '',
          minimumQuantity: normalizeNumber(product.minimumQuantity), pricingType: product.pricingType,
          shelfLifeDays: normalizeNumber(product.shelfLifeDays),
          productionLeadTimeMinDays: normalizeNumber(product.productionLeadTimeMinDays),
          productionLeadTimeMaxDays: normalizeNumber(product.productionLeadTimeMaxDays), active: product.active,
        });
        setPrices((product.prices ?? []).map(item => ({ key: createKey(), id: item.id, minimumQuantity: String(item.minimumQuantity), unitPrice: String(item.unitPrice) })));
        setFees((product.fees ?? []).map(item => ({ key: createKey(), id: item.id, name: item.name, amount: String(item.amount), chargeType: item.chargeType, required: item.required, active: item.active })));
        setAttributes({ colors: [...(product.colors ?? [])], sizes: [...(product.sizes ?? [])], brands: [...(product.brands ?? [])], models: [...(product.models ?? [])], materials: [...(product.materials ?? [])] });
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) {
          setLoadError(getError(error));
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            await SecureStore.deleteItemAsync('access_token');
            router.replace('/');
          }
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [id]);

  const updateForm = <K extends keyof Form,>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  const updatePrice = (key: number, patch: Partial<PriceRow>) => setPrices(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  const updateFee = (key: number, patch: Partial<FeeRow>) => setFees(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  const select = (title: string, options: { label: string; value: string }[], action: (value: string) => void) => setPicker({ title, options, select: action });
  const addAttribute = (key: Characteristic) => {
    const value = inputs[key].trim();
    if (!value) return;
    setAttributes(current => ({ ...current, [key]: current[key].some(existing => existing.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR')) ? current[key] : [...current[key], value] }));
    setInputs(current => ({ ...current, [key]: '' }));
  };
  const back = () => router.replace('/produtos');

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Informe o nome do produto.';
    if (form.name.trim().length > 150) return 'O nome deve ter no máximo 150 caracteres.';
    if (!categoryId || !categories.some(category => category.id === categoryId)) return 'Selecione uma categoria válida.';
    for (const [label, value, minimum] of [
      ['Quantidade mínima', form.minimumQuantity, 1], ['Validade', form.shelfLifeDays, 1],
      ['Prazo mínimo de produção', form.productionLeadTimeMinDays, 0], ['Prazo máximo de produção', form.productionLeadTimeMaxDays, 0],
    ] as const) {
      if (value && !validInteger(value, minimum)) return `${label}: informe um número inteiro maior ou igual a ${minimum}.`;
    }
    if (form.productionLeadTimeMinDays && form.productionLeadTimeMaxDays && Number(form.productionLeadTimeMinDays) > Number(form.productionLeadTimeMaxDays)) return 'O prazo máximo de produção não pode ser inferior ao mínimo.';
    if (form.pricingType === 'FIXED' && prices.length !== 1) return 'Preço fixo exige exatamente uma faixa.';
    if (form.pricingType === 'TIERED' && !prices.length) return 'Preço por quantidade exige pelo menos uma faixa.';
    if (form.pricingType === 'QUOTE' && prices.length) return 'Produtos sob orçamento não devem possuir faixas de preço.';
    if (form.pricingType !== 'QUOTE' && !form.minimumQuantity) return 'Informe a quantidade mínima do produto.';
    const minimums = new Set<number>();
    for (const row of prices) {
      if (!validInteger(row.minimumQuantity, 1)) return 'Informe uma quantidade mínima válida para cada faixa.';
      if (!row.unitPrice.trim() || !Number.isFinite(asNumber(row.unitPrice)) || asNumber(row.unitPrice) <= 0) return 'Preço unitário deve ser maior que zero.';
      if (minimums.has(Number(row.minimumQuantity))) return 'Existem faixas com quantidades mínimas duplicadas.';
      minimums.add(Number(row.minimumQuantity));
    }
    if (prices.length && Math.min(...minimums) !== numberOrNull(form.minimumQuantity)) return 'A menor faixa deve corresponder à quantidade mínima do produto.';
    for (const fee of fees) {
      if (!fee.name.trim()) return 'Informe o nome de todas as taxas.';
      if (!fee.amount.trim() || !Number.isFinite(asNumber(fee.amount)) || asNumber(fee.amount) < 0) return 'Informe um valor válido para cada taxa.';
    }
    return null;
  };

  const save = async () => {
    if (saving || !original) return;
    const error = validate();
    if (error) { Alert.alert('Verifique os dados', error); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      const scalar = ['name', 'category', 'description', 'pricingType', 'active'] as const;
      for (const key of scalar) {
        const value = key === 'description' ? form.description.trim() || null : key === 'name' ? form.name.trim() : form[key];
        if (value !== original[key]) body[key] = value;
      }
      if (categoryId !== original.categoryId) body.categoryId = categoryId;
      const numeric = ['minimumQuantity', 'shelfLifeDays', 'productionLeadTimeMinDays', 'productionLeadTimeMaxDays'] as const;
      for (const key of numeric) {
        const value = numberOrNull(form[key]);
        if (value !== original[key]) body[key] = value;
      }
      const oldPrices = new Map((original.prices ?? []).map(item => [item.id, item]));
      const oldFees = new Map((original.fees ?? []).map(item => [item.id, item]));
      const changedPrices = prices.filter(item => !!item.id).flatMap(item => {
        const before = oldPrices.get(item.id!);
        if (!before) return [];
        const patch: Record<string, unknown> = { id: item.id };
        if (Number(item.minimumQuantity) !== before.minimumQuantity) patch.minimumQuantity = Number(item.minimumQuantity);
        if (asNumber(item.unitPrice) !== Number(before.unitPrice)) patch.unitPrice = asNumber(item.unitPrice);
        return Object.keys(patch).length > 1 ? [patch] : [];
      });
      const addedPrices = prices.filter(item => !item.id).map(item => ({ minimumQuantity: Number(item.minimumQuantity), unitPrice: asNumber(item.unitPrice) }));
      const removedPrices = (original.prices ?? []).filter(item => !prices.some(row => row.id === item.id)).map(item => item.id);
      const changedFees = fees.filter(item => !!item.id).flatMap(item => {
        const before = oldFees.get(item.id!);
        if (!before) return [];
        const patch: Record<string, unknown> = { id: item.id };
        if (item.name !== before.name) patch.name = item.name;
        if (asNumber(item.amount) !== Number(before.amount)) patch.amount = asNumber(item.amount);
        if (item.chargeType !== before.chargeType) patch.chargeType = item.chargeType;
        if (item.required !== before.required) patch.required = item.required;
        if (item.active !== before.active) patch.active = item.active;
        return Object.keys(patch).length > 1 ? [patch] : [];
      });
      const addedFees = fees.filter(item => !item.id).map(item => ({ name: item.name.trim(), amount: asNumber(item.amount), chargeType: item.chargeType, required: item.required, active: item.active }));
      const removedFees = (original.fees ?? []).filter(item => !fees.some(row => row.id === item.id)).map(item => item.id);
      if (changedPrices.length) body.prices = changedPrices;
      if (addedPrices.length) body.addPrices = addedPrices;
      if (removedPrices.length) body.removePriceIds = removedPrices;
      if (changedFees.length) body.fees = changedFees;
      if (addedFees.length) body.addFees = addedFees;
      if (removedFees.length) body.removeFeeIds = removedFees;
      for (const { key } of attributeFields) {
        const values = attributes[key].map(value => value.trim()).filter(Boolean);
        if (JSON.stringify(values) !== JSON.stringify(original[key] ?? [])) body[key] = values;
      }
      if (!Object.keys(body).length) { Alert.alert('Sem alterações', 'Nenhuma informação foi modificada.'); return; }
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) { router.replace('/'); return; }
      await api.patch(`/products/${encodeURIComponent(id)}`, body, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Sucesso', 'Produto atualizado com sucesso!', [{ text: 'Voltar aos produtos', onPress: back }]);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) { await SecureStore.deleteItemAsync('access_token'); router.replace('/'); }
      else Alert.alert('Erro ao editar produto', getError(error));
    } finally { setSaving(false); }
  };

  const input = (label: string, key: keyof Pick<Form, 'minimumQuantity' | 'shelfLifeDays' | 'productionLeadTimeMinDays' | 'productionLeadTimeMaxDays'>) =>
    <Field label={label}><TextInput style={s.input} keyboardType="number-pad" value={form[key]} onChangeText={value => updateForm(key, value.replace(/\D/g, ''))} placeholder="Opcional" placeholderTextColor="#aaa19a" /></Field>;

  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View style={s.headingRow}>
          <Pressable onPress={back} style={s.backButton} accessibilityLabel="Voltar aos produtos"><Ionicons name="arrow-back" size={22} color={C.dark} /></Pressable>
          <View style={s.headingBlock}><Text style={s.heading}>Editar produto</Text><Text style={s.subtitle}>{original ? `Código ${original.code} · ${original.name}` : 'Alterar informações do produto'}</Text></View>
        </View>
        {loading ? <View style={s.loading}><ActivityIndicator size="large" color={C.gold} /><Text style={s.subtitle}>Carregando produto...</Text></View> : !original ?
          <View style={s.section}><Text style={s.error}>{loadError ?? 'Produto não encontrado.'}</Text><Pressable style={s.outlineButton} onPress={back}><Text style={s.outlineText}>Voltar</Text></Pressable></View> : <>
          <Section title="Informações gerais">
            <Field label="Nome"><TextInput style={s.input} value={form.name} maxLength={150} onChangeText={value => updateForm('name', value)} /></Field>
            <Selection label="Categoria" value={categories.find(item => item.id === categoryId)?.name ?? form.category} onPress={() => select('Categoria', categories.map(item => ({ label: item.name, value: item.id })), value => { setCategoryId(value); const chosen = categories.find(item => item.id === value); if (chosen) updateForm('category', chosen.name); })} />
            <Field label="Descrição"><TextInput style={[s.input, s.textarea]} multiline textAlignVertical="top" value={form.description} onChangeText={value => updateForm('description', value)} placeholder="Descrição do produto" placeholderTextColor="#aaa19a" /></Field>
            <Selection label="Tipo de precificação" value={pricingOptions.find(item => item.value === form.pricingType)?.label ?? ''} onPress={() => select('Tipo de precificação', pricingOptions, value => updateForm('pricingType', value as Pricing))} />
            {input('Quantidade mínima', 'minimumQuantity')}
            {input('Prazo mínimo de produção (dias)', 'productionLeadTimeMinDays')}
            {input('Prazo máximo de produção (dias)', 'productionLeadTimeMaxDays')}
            {input('Validade (dias)', 'shelfLifeDays')}
            <View style={s.switchRow}><Text style={s.switchLabel}>Produto ativo</Text><Switch value={form.active} onValueChange={value => updateForm('active', value)} trackColor={{ true: '#d4bc94', false: '#dedad6' }} thumbColor={form.active ? C.gold : '#f4f3f4'} /></View>
          </Section>
          <Section title="Faixas de preço">
            <Pressable style={s.outlineButton} onPress={() => setPrices(current => [...current, { key: createKey(), minimumQuantity: '', unitPrice: '' }])}><Ionicons name="add" color={C.gold} size={18}/><Text style={s.outlineText}>Adicionar faixa</Text></Pressable>
            {!prices.length && <Text style={s.empty}>Nenhuma faixa cadastrada.</Text>}
            {prices.map(price => <View style={s.subCard} key={price.key}>
              <View style={s.priceFieldsRow}>
                <View style={s.priceField}>
                  <Text style={s.priceFieldLabel}>Quantidade mínima</Text>
                  <TextInput style={s.input} value={price.minimumQuantity} keyboardType="number-pad" onChangeText={value => updatePrice(price.key, { minimumQuantity: value.replace(/\D/g, '') })} />
                </View>
                <View style={s.priceField}>
                  <Text style={s.priceFieldLabel}>Preço unitário (R$)</Text>
                  <TextInput style={s.input} value={price.unitPrice} keyboardType="decimal-pad" onChangeText={value => updatePrice(price.key, { unitPrice: value })} />
                </View>
              </View>
              <Pressable style={s.remove} onPress={() => setPrices(current => current.filter(row => row.key !== price.key))}><Ionicons name="trash-outline" color={C.red} size={17}/><Text style={s.removeText}>Remover faixa</Text></Pressable>
            </View>)}
          </Section>
          <Section title="Características">
            {attributeFields.map(({ key, label, placeholder }) => <View key={key} style={s.attributeGroup}>
              <Field label={label}><View style={s.addRow}><TextInput style={[s.input, s.attributeInput]} placeholder={placeholder} placeholderTextColor="#aaa19a" value={inputs[key]} onChangeText={value => setInputs(current => ({ ...current, [key]: value }))} onSubmitEditing={() => addAttribute(key)} /><Pressable style={s.addButton} onPress={() => addAttribute(key)}><Ionicons name="add" color={C.gold} size={19}/><Text style={s.attributeButtonText}>Adicionar{'\u00A0\u00A0'}</Text></Pressable></View></Field>
              {!!attributes[key].length && <View style={s.tags}>{attributes[key].map((value, index) => <View style={s.tag} key={`${key}-${index}`}><Text style={s.tagText}>{value}</Text><Pressable onPress={() => setAttributes(current => ({ ...current, [key]: current[key].filter((_, i) => i !== index) }))}><Ionicons name="close-circle-outline" color={C.red} size={20}/></Pressable></View>)}</View>}
            </View>)}
          </Section>
          <Section title="Taxas adicionais">
            <Pressable style={s.outlineButton} onPress={() => setFees(current => [...current, { key: createKey(), name: '', amount: '', chargeType: 'PER_ORDER', required: false, active: true }])}><Ionicons name="add" color={C.gold} size={18}/><Text style={s.outlineText}>Adicionar taxa</Text></Pressable>
            {!fees.length && <Text style={s.empty}>Nenhuma taxa cadastrada.</Text>}
            {fees.map(fee => <View style={s.subCard} key={fee.key}>
              <Field label="Nome"><TextInput style={s.input} value={fee.name} onChangeText={value => updateFee(fee.key, { name: value })} /></Field>
              <Field label="Valor (R$)"><TextInput style={s.input} keyboardType="decimal-pad" value={fee.amount} onChangeText={value => updateFee(fee.key, { amount: value })} /></Field>
              <Selection label="Tipo de cobrança" value={chargeOptions.find(item => item.value === fee.chargeType)?.label ?? ''} onPress={() => select('Tipo de cobrança', chargeOptions, value => updateFee(fee.key, { chargeType: value as Charge }))} />
              <View style={s.switchRow}><Text style={s.switchLabel}>Taxa obrigatória</Text><Switch value={fee.required} onValueChange={value => updateFee(fee.key, { required: value })} trackColor={{ true: '#d4bc94', false: '#dedad6' }} thumbColor={fee.required ? C.gold : '#f4f3f4'} /></View>
              <View style={s.switchRow}><Text style={s.switchLabel}>Taxa ativa</Text><Switch value={fee.active} onValueChange={value => updateFee(fee.key, { active: value })} trackColor={{ true: '#d4bc94', false: '#dedad6' }} thumbColor={fee.active ? C.gold : '#f4f3f4'} /></View>
              <Pressable style={s.remove} onPress={() => setFees(current => current.filter(row => row.key !== fee.key))}><Ionicons name="trash-outline" color={C.red} size={17}/><Text style={s.removeText}>Remover taxa</Text></Pressable>
            </View>)}
          </Section>
          <View style={s.actions}>
            <Pressable style={s.cancelButton} disabled={saving} onPress={back}><Text style={s.cancelText}>Cancelar{'\u00A0\u00A0'}</Text></Pressable>
            <Pressable style={[s.saveButton, saving && s.disabled]} disabled={saving} onPress={() => void save()}>{saving ? <ActivityIndicator color="#fff"/> : <Ionicons name="save-outline" color="#fff" size={19}/>}<Text style={s.saveText}>{saving ? 'Salvando...' : 'Salvar alterações'}{'\u00A0\u00A0'}</Text></Pressable>
          </View>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal transparent visible={picker !== null} animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={s.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} /><View style={s.pickerCard}>
        <View style={s.pickerHeader}><Text style={s.pickerTitle}>{picker?.title}</Text><Pressable onPress={() => setPicker(null)}><Ionicons name="close" color={C.dark} size={23}/></Pressable></View>
        <ScrollView style={{ maxHeight: 330 }}>{picker?.options.map(option => <Pressable key={option.value} style={s.pickerOption} onPress={() => { picker.select(option.value); setPicker(null); }}><Text style={s.pickerOptionText}>{option.label}</Text></Pressable>)}</ScrollView>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 17, paddingTop: 22, paddingBottom: 45 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20 },
  backButton: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.paper, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headingBlock: { flex: 1 }, heading: { fontSize: 28, lineHeight: 38, color: C.dark, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' },
  subtitle: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 6 },
  loading: { minHeight: 170, justifyContent: 'center', alignItems: 'center', gap: 12 },
  section: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.border, borderRadius: 17, padding: 18, marginBottom: 17 },
  sectionTitle: { color: C.dark, fontSize: 20, lineHeight: 29, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', marginBottom: 17 },
  field: { marginBottom: 15, width: '100%' },
  label: { color: C.dark, fontSize: 14, lineHeight: 23, marginBottom: 6, fontWeight: '500' },
  input: { width: '100%', minHeight: 48, borderRadius: 11, borderWidth: 1, borderColor: C.border, color: C.dark, backgroundColor: '#fff', fontSize: 14, paddingHorizontal: 13, paddingVertical: 10, includeFontPadding: true },
  textarea: { minHeight: 96, textAlignVertical: 'top' },
  select: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 11, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8 },
  selectValue: { color: C.dark, flex: 1, fontSize: 14, lineHeight: 23 },
  placeholder: { color: '#a8a29e' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, gap: 10 },
  switchLabel: { color: C.dark, fontSize: 14, lineHeight: 23, flex: 1 },
  outlineButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e2d7c9', borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 13 },
  outlineText: { color: '#946f3d', fontSize: 13, lineHeight: 21, fontWeight: '700' },
  empty: { color: C.muted, fontSize: 13, lineHeight: 21, paddingVertical: 10 },
  subCard: { backgroundColor: '#faf8f5', borderWidth: 1, borderColor: '#eee6dd', borderRadius: 13, padding: 15, marginTop: 11 },
  priceFieldsRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  priceField: { flex: 1, minWidth: 0 },
  priceFieldLabel: { color: C.dark, fontSize: 12, lineHeight: 18, minHeight: 40, marginBottom: 6, fontWeight: '600', includeFontPadding: true },
  remove: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#eaded6', borderRadius: 10, backgroundColor: C.paper },
  removeText: { color: C.red, fontSize: 13, lineHeight: 21 },
  attributeGroup: { marginBottom: 7 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attributeInput: { flex: 1, width: undefined, minWidth: 0 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 145,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2d7c9',
    gap: 4,
    paddingHorizontal: 10,
  },
  attributeButtonText: {
    color: '#946f3d',
    fontSize: 12,
    lineHeight: 24,
    fontWeight: '700',
    includeFontPadding: true,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tag: { backgroundColor: '#faf8f5', borderColor: C.border, borderWidth: 1, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, maxWidth: '100%' },
  tagText: { color: C.dark, fontSize: 13, lineHeight: 21 },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  cancelButton: {
    minWidth: 125,
    minHeight: 53,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.paper,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  cancelText: {
    color: C.dark,
    fontSize: 12,
    lineHeight: 24,
    fontWeight: '600',
    includeFontPadding: true,
  },
  saveButton: {
    flex: 1,
    minWidth: 0,
    backgroundColor: C.gold,
    minHeight: 53,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 8,
  },
  saveText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
    includeFontPadding: true,
  },
  disabled: { opacity: 0.6 }, error: { color: '#b91c1c', fontSize: 14, lineHeight: 22 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 22 },
  pickerCard: { backgroundColor: '#fff', borderRadius: 18, padding: 19, maxHeight: '75%' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  pickerTitle: { flex: 1, color: C.dark, fontSize: 18, lineHeight: 27, fontWeight: '700' },
  pickerOption: { paddingVertical: 14, paddingHorizontal: 5, borderBottomWidth: 1, borderBottomColor: '#f0ece5' },
  pickerOptionText: { color: C.dark, fontSize: 14, lineHeight: 23 },
});
