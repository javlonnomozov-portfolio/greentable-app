import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Chip, Modal, Portal, Searchbar, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { useQuery } from '@/db/hooks';
import type { ProductRow } from '@/db/models';
import { listProducts } from '@/services/catalog';
import { palette, theme } from '@/theme';
import { formatSom } from '@/utils/money';
import { EmptyState } from './ui';

interface Props {
  visible: boolean;
  onDismiss(): void;
  /** Har bosishda bitta dona qo'shiladi. */
  onPick(product: ProductRow): void;
}

const ALL = '__all__';

export function ProductPicker({ visible, onDismiss, onPick }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { data: products = [] } = useQuery((db) => listProducts(db), []);
  const [category, setCategory] = useState(ALL);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<number, number>>({});

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products],
  );
  const shown = products.filter(
    (p) =>
      (category === ALL || p.category === category) &&
      (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;

  const close = () => {
    setPicked({});
    setSearch('');
    onDismiss();
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={close} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}>
        <Searchbar placeholder="Mahsulot qidirish" value={search} onChangeText={setSearch} style={styles.search} />
        {categories.length > 1 && (
          <View style={styles.chips}>
            <Chip selected={category === ALL} onPress={() => setCategory(ALL)} compact>
              Hammasi
            </Chip>
            {categories.map((c) => (
              <Chip key={c} selected={category === c} onPress={() => setCategory(c)} compact>
                {c}
              </Chip>
            ))}
          </View>
        )}
        <FlatList
          key={columns}
          data={shown}
          numColumns={columns}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={styles.grid}
          ListEmptyComponent={<EmptyState icon="cup-outline" title="Mahsulot yo'q" hint="Sozlamalar → Mahsulotlar" />}
          renderItem={({ item }) => {
            const count = picked[item.id] ?? 0;
            const low = item.track_stock === 1 && item.stock_qty <= 0;
            return (
              <View style={[styles.cell, { width: `${100 / columns}%` }]}>
                <TouchableRipple
                  onPress={() => {
                    setPicked((p) => ({ ...p, [item.id]: count + 1 }));
                    onPick(item);
                  }}
                  style={[
                    styles.card,
                    { backgroundColor: count ? theme.colors.primaryContainer : theme.colors.surface },
                  ]}
                >
                  <View>
                    <Text variant="titleSmall" numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.primary }}>
                      {formatSom(item.price)}
                    </Text>
                    {item.track_stock === 1 && (
                      <Text variant="bodySmall" style={{ color: low ? palette.danger : palette.muted }}>
                        Qoldiq: {item.stock_qty}
                      </Text>
                    )}
                    {count > 0 && (
                      <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
                        <Text style={styles.badgeText}>+{count}</Text>
                      </View>
                    )}
                  </View>
                </TouchableRipple>
              </View>
            );
          }}
        />
        <Button mode="contained" onPress={close} style={styles.done}>
          Tayyor
        </Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: { margin: 12, padding: 12, borderRadius: 20, maxHeight: '92%', flex: 1 },
  search: { marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  grid: { paddingBottom: 8 },
  cell: { padding: 4 },
  card: { borderRadius: 14, padding: 12, minHeight: 84, elevation: 1 },
  badge: { position: 'absolute', top: -4, right: -4, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: theme.colors.onPrimary, fontWeight: '700', fontSize: 12 },
  done: { marginTop: 8 },
});
