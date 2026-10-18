import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// `npm run lint` checks src/. It is tuned to catch real mistakes (undefined
// variables, unused imports/variables, hook misuse) without flagging this
// codebase's long-standing, working patterns — see the notes on each override.
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Unused imports/variables are errors; unused function parameters and
      // caught errors are not (a handler that ignores its event, or a
      // `catch (e)` that just falls back, is normal). Prefix with _ to opt out.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Initial values that every branch overwrites in the 2D sketch engine —
      // harmless, so a warning rather than a build-blocking error.
      'no-useless-assignment': 'warn',

      // react-hooks v7 also ships "React Compiler readiness" rules. This app
      // doesn't use the compiler, and these rules flag patterns that are
      // deliberate and work correctly here (the mirrored useRef/useState sketch
      // state described in CLAUDE.md, resetting state when a panel opens,
      // reading a ref during render). Turned off rather than rewriting working
      // code; revisit if the compiler is ever adopted.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/static-components': 'off',

      // A file that exports a hook AND a component only loses fast-refresh
      // for that file in dev; not a correctness problem.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
