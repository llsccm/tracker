import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const browserRuntimeGlobals = {
  ...globals.browser,
  // 业务或三方框架特有的浏览器运行时全局变量
  Laya: 'readonly',
  JSZipUtils: 'readonly',
  CtrUtil: 'readonly',
  SystemContext: 'readonly',
  ChannelUtils: 'readonly',
  JSZip: 'readonly',
  Zlib: 'readonly',
  unsafeWindow: 'readonly',
  __VERSION__: 'readonly'
}

const nodeConfigGlobals = {
  ...globals.node
}

const unusedVarsRule = [
  'error',
  {
    vars: 'all',
    args: 'after-used',
    varsIgnorePattern: '^_[a-zA-Z0-9]*$',
    argsIgnorePattern: '^_[a-zA-Z0-9]*$',
    caughtErrorsIgnorePattern: '^_[a-zA-Z0-9]*$'
  }
]

const qualityRules = {
  'no-unused-vars': unusedVarsRule,
  'no-undef': 'error',
  'no-redeclare': 'warn',
  'block-scoped-var': 'warn',
  'prefer-const': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }]
}

const tsFiles = ['src/**/*.ts', 'tests/**/*.ts', '*.ts']
const nodeConfigFiles = ['eslint.config.js', '*.config.js']

export default defineConfig([
  {
    ignores: [
      'dist/**',
      'build/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      'plans/**',
      '.roo/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserRuntimeGlobals
    },
    rules: qualityRules
  },
  {
    files: nodeConfigFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeConfigGlobals
    },
    rules: qualityRules
  },
  eslintConfigPrettier,
  {
    files: tsFiles,
    plugins: { '@stylistic': stylistic },
    extends: [tseslint.configs.recommended],
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVarsRule,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@stylistic/object-curly-newline': [
        'error',
        {
          // configuration for object literals
          ObjectExpression: { multiline: true, consistent: true },
          // object patterns of destructuring assignments
          ObjectPattern: { multiline: true, consistent: true },
          ImportDeclaration: { multiline: true },
          ExportDeclaration: { multiline: true, consistent: true }
        }
      ],
      '@stylistic/array-element-newline': ['error', { consistent: true, multiline: true }]
    }
  }
])
