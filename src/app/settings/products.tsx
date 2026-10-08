import { useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, FAB, IconButton, List, Portal, Switch, Text, TextInput } from 'react-native-paper';
import { useFeedback } from '@/components/FeedbackProvider';
import { AmountInput, EmptyState, MethodPicker, PinGate, SectionTitle } from '@/components/ui';
import type { PaymentMethod, ProductRow } from '@/db/models';
import { useDb, useQuery } from '@/db/hooks';
import { useWriteGuard } from '@/hooks/useWriteGuard';
import { listProducts, restockProduct, saveProduct, setProductActive, setStock } from '@/services/catalog';
import { palette } from '@/theme';
import { formatSom, parseSom } from '@/utils/money';

export default function ProductsSettings() {
  return (
    <PinGate>
      <ProductsEditor />
    </PinGate>
  );
}

interface Draft {
  id?: number;
  name: string;
  category: string;
  price: number;
  track_stock: boolean;
}

interface StockDraft {
  product: ProductRow;
  mode: 'restock' | 'count';
  qty: string;
  totalCost: number;
  method: PaymentMethod;
}

function ProductsEditor() {
  const db = useDb();
  const guard = useWriteGuard();
  const { run } = useFeedback();
  const { data: products = [] } = useQuery((d) => listProducts(d, true), []);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [stock, setStockDraft] = useState<StockDraft | null>(null);

  const sections = Object.entries(
    products.reduce<Record<string, ProductRow[]>>((acc, p) => {
      const key = p.category || 'Boshqa';
      (acc[key] ??= []).push(p);
      return acc;
    }, {}),
  ).map(([title, data]) => ({ title, data }));
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  const save = async () => {
    if (!editing) return;
    const id = await run(() => saveProduct(db, editing), 'Saqlandi');
    if (id) setEditing(null);
  };

  const saveStock = async () => {
    if (!stock) return;
    const qty = parseSom(stock.qty);
    const ok = await run(
      async () => {
        if (stock.mode === 'restock') {
          await restockProduct(db, {
            productId: stock.product.id,
            qty,
            totalCost: stock.totalCost,
            method: stock.method,
            now: Date.now(),
          });
        } else {
          await setStock(db, stock.product.id, qty);
        }
        return true;
      },
      stock.mode === 'count' ? "Qoldiq to'g'rilandi" : stock.totalCost > 0 ? 'Kirim va xarajat yozildi' : 'Kirim yozildi',
    );
    if (ok) setStockDraft(null);
  };

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => String(p.id)}
        ItemSeparatorComponent={Divider}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState icon="cup-outline" title="Mahsulot qo'shing" />}
        renderSectionHeader={({ section }) => <List.Subheader>{section.title}</List.Subheader>}
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            titleStyle={!item.is_active && styles.inactive}
            description={
              formatSom(item.price) +
              (item.track_stock ? ` · qoldiq: ${item.stock_qty}` : '') +
              (item.is_active ? '' : ' · sotilmaydi')
            }
            descriptionStyle={item.track_stock && item.stock_qty <= 0 ? { color: palette.danger } : undefined}
            onPress={() =>
              setEditing({
                id: item.id,
                name: item.name,
                category: item.category,
                price: item.price,
                track_stock: item.track_stock === 1,
              })
            }
            right={() => (
              <View style={styles.right}>
                <IconButton
                  icon="package-variant-plus"
                  onPress={guard(() => setStockDraft({ product: item, mode: 'restock', qty: '', totalCost: 0, method: 'cash' }))}
                />
                <Switch value={item.is_active === 1} onValueChange={(v) => run(() => setProductActive(db, item.id, v))} />
              </View>
            )}
          />
        )}
      />
      <FAB
        icon="plus"
        label="Mahsulot"
        style={styles.fab}
        onPress={guard(() => setEditing({ name: '', category: categories[0] ?? '', price: 0, track_stock: false }))}
      />

      <Portal>
        <Dialog visible={editing != null} onDismiss={() => setEditing(null)}>
          <Dialog.Title>{editing?.id ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'}</Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            <TextInput
              mode="outlined"
              label="Nomi"
              value={editing?.name ?? ''}
              onChangeText={(name) => setEditing((e) => e && { ...e, name })}
            />
            <TextInput
              mode="outlined"
              label="Bo'lim (Ichimliklar, Taomlar…)"
              value={editing?.category ?? ''}
              onChangeText={(category) => setEditing((e) => e && { ...e, category })}
            />
            <AmountInput label="Sotish narxi" value={editing?.price ?? 0} onChange={(price) => setEditing((e) => e && { ...e, price })} />
            <View style={styles.switchRow}>
              <Text variant="bodyLarge">Ombor qoldig'ini hisoblash</Text>
              <Switch
                value={editing?.track_stock ?? false}
                onValueChange={(track_stock) => setEditing((e) => e && { ...e, track_stock })}
              />
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Bekor</Button>
            <Button mode="contained" onPress={save}>
              Saqlash
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={stock != null} onDismiss={() => setStockDraft(null)}>
          <Dialog.Title>{stock?.product.name}</Dialog.Title>
          <Dialog.Content style={styles.dialog}>
            <Text variant="bodyMedium">Hozirgi qoldiq: {stock?.product.stock_qty ?? 0}</Text>
            <View style={styles.modeRow}>
              <Button
                mode={stock?.mode === 'restock' ? 'contained' : 'outlined'}
                onPress={() => setStockDraft((s) => s && { ...s, mode: 'restock' })}
              >
                Kirim
              </Button>
              <Button
                mode={stock?.mode === 'count' ? 'contained' : 'outlined'}
                onPress={() => setStockDraft((s) => s && { ...s, mode: 'count' })}
              >
                Sanoq
              </Button>
            </View>
            <TextInput
              mode="outlined"
              label={stock?.mode === 'restock' ? 'Nechta keldi' : 'Aslida nechta bor'}
              value={stock?.qty ?? ''}
              onChangeText={(qty) => setStockDraft((s) => s && { ...s, qty: qty.replace(/\D/g, '') })}
              keyboardType="number-pad"
            />
            {stock?.mode === 'restock' && (
              <>
                <SectionTitle>Xarid summasi (xarajatga yoziladi)</SectionTitle>
                <AmountInput
                  label="Jami to'langan (ixtiyoriy)"
                  value={stock.totalCost}
                  onChange={(totalCost) => setStockDraft((s) => s && { ...s, totalCost })}
                />
                {stock.totalCost > 0 && (
                  <MethodPicker value={stock.method} onChange={(method) => setStockDraft((s) => s && { ...s, method })} />
                )}
              </>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStockDraft(null)}>Bekor</Button>
            <Button mode="contained" onPress={saveStock} disabled={!stock?.qty}>
              Saqlash
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingBottom: 96 },
  inactive: { color: palette.muted, textDecorationLine: 'line-through' },
  right: { flexDirection: 'row', alignItems: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  dialog: { gap: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeRow: { flexDirection: 'row', gap: 8 },
});
