// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules (type-checked)
  ...tseslint.configs.recommendedTypeChecked,

  // Prettier integration — disables ESLint rules that conflict with Prettier
  prettierConfig,

  {
    // Apply to all TS/JS source files
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier violations reported as ESLint errors
      'prettier/prettier': 'error',

      // NestJS uses decorators heavily — these are fine to have unbound
      '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],

      // Allow empty constructors (common in NestJS modules/guards)
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['constructors'] },
      ],

      // Explicit return types are good but too noisy for small arrow callbacks
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Allow `any` in catch blocks and explicit casts — tighten later
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused vars: ignore args prefixed with _ (common pattern)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Floating promises should be handled
      '@typescript-eslint/no-floating-promises': 'error',

      // Supabase JS client returns `any`-typed data throughout; flag as warnings
      // so the codebase passes CI today — tighten to `error` in a future type-safety pass.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },

  {
    // Ignore built output and generated files
    ignores: ['dist/**', 'node_modules/**'],
  },
);
