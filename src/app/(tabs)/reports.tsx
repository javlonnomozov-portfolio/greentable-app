import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, IconButton, Text } from 'react-native-paper';
import { BarChart } from '@/components/BarChart';
import { PeriodSwitcher } from '@/components/PeriodSwitcher';
import { usePin } from '@/components/PinProvider';
import { MoneyRow, PinGate } from '@/components/ui';
import { useQuery } from '@/db/hooks';
import { useSettings } from '@/hooks/useSettings';
import { getReport, periodFor, type PeriodKind } from '@/services/reports';
import { palette } from '@/theme';
import { formatSom } from '@/utils/money';
import { formatMinutes } from '@/utils/time';

export default function ReportsTab() {
  const navigation = useNavigation();
  const { hasPin, unlocked, lock } = usePin();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasPin && unlocked ? () => <IconButton icon="lock-outline" onPress={lock} /> : undefined,
    });
  }, [navigation, hasPin, unlocked, lock]);

  return (
    <PinGate>
      <ReportsScreen />
    </PinGate>
  );
}

function ReportsScreen() {
  const { dayStartHour } = useSettings();
  const [kind, setKind] = useState<PeriodKind>('day');
  const [offset, setOffset] = useState(0);
  // "Bugun" chegarasi tab ochilganda yoki davr almashtirilganda yangilanadi —
  // hisobot har soniyada qayta chizilmasligi uchun jonli taymer ishlatilmaydi.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  const period = periodFor(kind, offset, now, dayStartHour);
  const { data: report } = useQuery((db) => getReport(db, period, dayStartHour), [period.from, period.to, dayStartHour]);

  const listParams = { from: period.from, to: period.to, label: period.label };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <PeriodSwitcher
        kind={kind}
        offset={offset}
        period={period}
        onChange={(k, o) => {
          setKind(k);
          setOffset(o);
          setNow(Date.now());
        }}
      />
      {report && (
        <>
          <View style={styles.kpis}>
            <Kpi label="Tushum" amount={report.revenue.total} color={palette.income} />
            <Kpi label="Xarajat" amount={report.cash.expenses.total} color={palette.expense} />
            <Kpi label="Foyda" amount={report.profit} color={report.profit >= 0 ? palette.income : palette.expense} />
          </View>

          <Card mode="outlined">
            <Card.Title title="Tushum" subtitle={`${report.revenue.billCount} ta chek · stollar ${formatMinutes(report.revenue.tableMinutes)}`} />
            <Card.Content>
              <MoneyRow label="Stol vaqti" amount={report.revenue.tableTime} />
              <MoneyRow label="Stoldagi bar" amount={report.revenue.tableBar} />
              <MoneyRow label="Stolsiz savdo" amount={report.revenue.sales} />
              {report.revenue.discount > 0 && (
                <MoneyRow label="Chegirmalar" hint="Hisoblangandan kam olingan" amount={-report.revenue.discount} />
              )}
              {report.revenue.extra > 0 && (
                <MoneyRow label="Ustamalar" hint="Hisoblangandan ko'p olingan" amount={report.revenue.extra} />
              )}
              <Divider style={styles.divider} />
              <MoneyRow label="Jami tushum" amount={report.revenue.total} strong />
            </Card.Content>
            <Card.Actions>
              <Button onPress={() => router.push({ pathname: '/bills', params: listParams })}>Cheklar</Button>
            </Card.Actions>
          </Card>

          <Card mode="outlined">
            <Card.Title title="Kassa (pul oqimi)" subtitle="Haqiqatda kelgan va chiqqan pul" />
            <Card.Content>
              <FlowRow label="" cells={['Kirim', 'Chiqim', 'Qoldi']} muted />
              <FlowRow label="Naqd" income={report.cash.income.cash} expense={report.cash.expenses.cash} />
              <FlowRow label="Karta" income={report.cash.income.card} expense={report.cash.expenses.card} />
              <FlowRow label="O'tkazma" income={report.cash.income.transfer} expense={report.cash.expenses.transfer} />
              <Divider style={styles.divider} />
              <FlowRow label="Jami" income={report.cash.income.total} expense={report.cash.expenses.total} strong />
              <Text variant="bodySmall" style={styles.note}>
                Kirim: cheklardan {formatSom(report.cash.fromBills)}, qaytarilgan qarzlardan{' '}
                {formatSom(report.cash.fromDebtRepayments)}
              </Text>
            </Card.Content>
          </Card>

          <Card mode="outlined">
            <Card.Title title="Qarzlar" />
            <Card.Content>
              <MoneyRow label="Shu davrda berildi" amount={report.debts.given} color={palette.debt} />
              <MoneyRow label="Shu davrda qaytarildi" amount={report.debts.repaid} color={palette.income} />
              <MoneyRow label="Hozirgi umumiy qarz" amount={report.debts.outstanding} strong />
            </Card.Content>
          </Card>

          <Card mode="outlined">
            <Card.Title title="Xarajatlar" />
            <Card.Content>
              {report.expensesByCategory.length === 0 ? (
                <Text style={styles.note}>Xarajat yo'q</Text>
              ) : (
                report.expensesByCategory.map((e) => <MoneyRow key={e.name} label={e.name} amount={e.amount} />)
              )}
            </Card.Content>
            <Card.Actions>
              <Button onPress={() => router.push({ pathname: '/expenses', params: listParams })}>Ro'yxat</Button>
              <Button mode="contained-tonal" icon="plus" onPress={() => router.push('/expense/new')}>
                Xarajat
              </Button>
            </Card.Actions>
          </Card>

          {report.daily.length > 1 && (
            <Card mode="outlined">
              <Card.Title title="Kunlik tushum" />
              <Card.Content>
                <BarChart points={report.daily} />
              </Card.Content>
            </Card>
          )}

          {report.tables.length > 0 && (
            <Card mode="outlined">
              <Card.Title title="Stollar" />
              <Card.Content>
                {report.tables.map((t) => (
                  <MoneyRow
                    key={t.name}
                    label={t.name}
                    hint={`${t.sessions} marta · ${formatMinutes(t.minutes)}`}
                    amount={t.amount}
                  />
                ))}
              </Card.Content>
            </Card>
          )}

          {report.products.length > 0 && (
            <Card mode="outlined">
              <Card.Title title="Eng ko'p sotilgan mahsulotlar" />
              <Card.Content>
                {report.products.map((p) => (
                  <MoneyRow key={p.name} label={p.name} hint={`${p.qty} dona`} amount={p.amount} />
                ))}
              </Card.Content>
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <Card mode="contained" style={styles.kpi}>
      <Card.Content>
        <Text variant="labelMedium" style={styles.muted}>
          {label}
        </Text>
        <Text variant="titleMedium" style={[styles.bold, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatSom(amount, false)}
        </Text>
      </Card.Content>
    </Card>
  );
}

/** Kassa jadvalining qatori: to'lov turi | kirim | chiqim | qoldi. */
function FlowRow({
  label,
  income = 0,
  expense = 0,
  cells,
  strong,
  muted,
}: {
  label: string;
  income?: number;
  expense?: number;
  cells?: string[];
  strong?: boolean;
  muted?: boolean;
}) {
  const values = cells ?? [formatSom(income, false), formatSom(expense, false), formatSom(income - expense, false)];
  const colors = cells ? [palette.muted, palette.muted, palette.muted] : [palette.income, palette.expense, undefined];
  const variant = strong ? 'titleSmall' : muted ? 'labelMedium' : 'bodyMedium';
  return (
    <View style={styles.flowRow}>
      <Text variant={variant} style={[styles.flowLabel, strong && styles.bold]}>
        {label}
      </Text>
      {values.map((v, i) => (
        <Text
          key={i}
          variant={variant}
          style={[styles.flowCell, strong && styles.bold, colors[i] ? { color: colors[i] } : null]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {v}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1 },
  divider: { marginVertical: 6 },
  note: { color: palette.muted, marginTop: 4 },
  flowRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 4 },
  flowLabel: { width: 72 },
  flowCell: { flex: 1, textAlign: 'right' },
  muted: { color: palette.muted },
  bold: { fontWeight: '700' },
});
