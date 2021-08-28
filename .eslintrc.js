module.exports = {
  plugins: [
    '@typescript-eslint',
    'prettier',
    'import',
    'react',
    'react-hooks',
    'compat',
    'security',
  ],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'prettier',
  ],
  settings: {
    react: {
      version: '17',
    },
  },
  env: {
    es6: true,
    browser: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    jsx: true,
    project: 'tsconfig.json',
  },
  rules: {
    indent: 0,
    'no-debugger': 'off',
    'no-console': 1,
    'no-unused-vars': 0,
    'max-len': [1, 150],
    'arrow-parens': 'off', // Несовместимо с prettier
    'no-mixed-operators': 'off', // Несовместимо с prettier
    'object-curly-newline': 'off', // Несовместимо с prettier
    'space-before-function-paren': 0, // Несовместимо с prettier
    'function-paren-newline': 0,
    'import/no-named-as-default-member': 0,
    'import/no-named-as-default': 0,
    'import/named': 0,
    // note you must disable the base rule as it can report incorrect errors
    'lines-between-class-members': 'off',
    '@typescript-eslint/lines-between-class-members': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',

    'react/forbid-prop-types': [
      1,
      { forbid: ['any', 'object'], ignore: ['style', 'data', 'variables'] },
    ],
    'react/static-property-placement': 1,
    'react/jsx-wrap-multilines': 1,
    'react/jsx-fragments': 0,
    'react/jsx-props-no-spreading': 1,
    'react/destructuring-assignment': 1,
    'react/jsx-curly-newline': 0, // Несовместимо с prettier
    'react/prop-types': [
      1,
      {
        ignore: [
          // `dispatch` is typically used by Redux `@connect`
          'dispatch',
          // `data` is injected by Apollo
          'data',
          // default "style" prop could be unshaped objected
          'style',
          // `variables` is used for GraphQL queries
          'variables',
        ],
      },
    ],
    'react/jsx-no-bind': [
      1,
      {
        ignoreDOMComponents: false,
        ignoreRefs: false,
        allowArrowFunctions: false,
        allowFunctions: false,
        allowBind: false,
      },
    ],
    'react/jsx-closing-bracket-location': [
      1,
      {
        selfClosing: 'tag-aligned',
        nonEmpty: 'after-props',
      },
    ],
    'react/jsx-one-expression-per-line': [1, { allow: 'single-child' }],
    'prettier/prettier': ['error'],

    //
    'max-classes-per-file': 0,
    'prefer-object-spread': 1,
    'operator-linebreak': 0, // Несовместимо с prettier
    // 'implicit-arrow-linebreak': 1,
    'react-hooks/rules-of-hooks': 2,
    'react-hooks/exhaustive-deps': 1,
  },
};
