// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'server/*'],
  },
  {
    rules: {
      // O'zbek lotinida apostrof harfning bir qismi (o', g', ma'lumot) — JSX matnida escape qilish shart emas.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
