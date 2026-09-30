import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { BrandTitle } from '@/components/Brand';
import { palette, theme } from '@/theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function icon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialCommunityIcons name={name} color={color} size={size} />;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: palette.border },
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.onSurface,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Zal', headerTitle: () => <BrandTitle />, tabBarIcon: icon('billiards') }}
      />
      <Tabs.Screen name="sales" options={{ title: 'Savdo', tabBarIcon: icon('cart-outline') }} />
      <Tabs.Screen name="debts" options={{ title: 'Qarzlar', tabBarIcon: icon('notebook-outline') }} />
      <Tabs.Screen name="reports" options={{ title: 'Kassa', tabBarIcon: icon('chart-box-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Sozlamalar', tabBarIcon: icon('cog-outline') }} />
    </Tabs>
  );
}
