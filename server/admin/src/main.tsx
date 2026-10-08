import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

// GreenTable brendi: zumrad #00C853, oltin #D4AF37, grafit #121417.
const emerald: MantineColorsTuple = [
  '#e5fff0', '#ccfde0', '#9bf9c0', '#66f59d', '#3cf280', '#22f06d', '#00c853', '#00b049', '#009c3e', '#008732',
];
const gold: MantineColorsTuple = [
  '#fdf8e7', '#f6eecf', '#ecdb9f', '#e2c76b', '#d9b640', '#d4af37', '#c79f22', '#b08b16', '#9d7b0d', '#876900',
];

// Mantine dark palitrasi grafitga moslangan: dark[7] — fon, dark[6] — kartalar.
const dark: MantineColorsTuple = [
  '#c9ced5', '#a9afb8', '#8c929d', '#5c626c', '#3a3f47', '#2a2f37', '#1c2026', '#121417', '#0e1013', '#0a0b0d',
];

const theme = createTheme({
  primaryColor: 'emerald',
  colors: { emerald, gold, dark },
  fontFamily: 'Segoe UI, system-ui, sans-serif',
  defaultRadius: 'md',
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
