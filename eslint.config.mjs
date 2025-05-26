import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
// import airbnb from 'eslint-config-airbnb';

export default [
  {
    languageOptions: { globals: globals.node },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
  },
  {
    ignores: [
      'global.d.ts',
      'node_modules/**',
      'lib/**/*',
      'lib/',
      'types'
    ],
  },
  // {
  //   plugins: {
  //     airbnb
  //   }
  // },
  {
    rules: {
      'quotes': ['error', 'single']
    }
  }
];