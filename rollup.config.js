import typescript from 'rollup-plugin-typescript2';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import { terser } from 'rollup-plugin-terser';
import replace from '@rollup/plugin-replace';
import nodePolyfills from 'rollup-plugin-node-polyfills';
//
import pkg from './package.json';

const input = 'src/index.tsx';
const commonOutputOptions = {
  exports: 'named',
  sourcemap: true,
  strict: false,
};
const commonPluginsHead = [
  replace({
    'process.env.NODE_ENV': JSON.stringify('production'),
    preventAssignment: true,
  }),
  // Preferably set as first plugin.
  peerDepsExternal(),
];
const commonPluginsMiddle = [
  commonjs({
    // namedExports: {
    //   'node_modules/subscriptions-transport-ws/dist/index.js': ['SubscriptionClient'],
    // },
  }),
  typescript({ objectHashIgnoreUnknownHack: false }),
];

// continued
export default [
  // browser/web bundle
  {
    input: 'src/entrypoints/browser.ts',
    output: [
      {
        file: `${pkg.browser}.mjs`,
        format: 'es',
        ...commonOutputOptions,
      },
    ],
    plugins: [
      ...commonPluginsHead,
      nodeResolve({ browser: true }),
      ...commonPluginsMiddle,
      terser({
        ecma: 2015,
      }),
    ],
  },
  // isomorphic bundle (client+ssr)
  {
    input: 'src/index.tsx',
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        ...commonOutputOptions,
      },
    ],
    plugins: [
      ...commonPluginsHead,
      nodePolyfills(),
      nodeResolve({ browser: false }),
      ...commonPluginsMiddle,
    ],
  },
  // nodejs/server-side bundle
  {
    input: 'src/entrypoints/server.ts',
    output: [
      {
        file: 'dist/server.js',
        format: 'cjs',
        ...commonOutputOptions,
      },
    ],
    plugins: [
      ...commonPluginsHead,
      nodePolyfills(),
      nodeResolve({ browser: false }),
      ...commonPluginsMiddle,
    ],
  },
  // react-native bundle
  {
    input,
    output: [
      {
        file: `${pkg.browser}.native.js`,
        format: 'cjs',
        ...commonOutputOptions,
      },
    ],
    plugins: [
      ...commonPluginsHead,
      nodePolyfills(),
      nodeResolve({ browser: false, exportConditions: ['node'] }),
      ...commonPluginsMiddle,
      // terser({
      //   ecma: 2015,
      // }),
    ],
  },
];
