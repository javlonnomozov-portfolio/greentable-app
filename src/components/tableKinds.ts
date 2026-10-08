import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { TableKind } from '@/db/models';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export const TABLE_KINDS: { value: TableKind; label: string; icon: IconName }[] = [
  { value: 'billiard', label: 'Biliard', icon: 'billiards' },
  { value: 'ps', label: 'PlayStation', icon: 'sony-playstation' },
  { value: 'pc', label: 'Kompyuter', icon: 'desktop-classic' },
  { value: 'other', label: 'Boshqa', icon: 'dots-horizontal-circle-outline' },
];

export const kindIcon = (kind: TableKind): IconName => TABLE_KINDS.find((k) => k.value === kind)?.icon ?? 'billiards';
