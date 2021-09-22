import typescript from 'rollup-plugin-typescript2';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import commonjs from '@rollup/plugin-commonjs';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import { terser } from 'rollup-plugin-terser';
//
import pkg from './package.json';

const input = 'src/index.tsx';
const commonOutputOptions = {
  exports: 'named',
  sourcemap: true,
  strict: false,
};
const commonPluginsHead = [
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
    input,
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
  // nodejs/server-side bundle
  {
    input,
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        ...commonOutputOptions,
      },
    ],
    plugins: [...commonPluginsHead, nodeResolve({ browser: false }), ...commonPluginsMiddle],
  },
  // react-native bundle
  {
    input,
    output: [
      {
        file: `${pkg.browser}.native.js`,
        format: 'umd',
        name: 'grc',
        ...commonOutputOptions,
      },
    ],
    plugins: [
      ...commonPluginsHead,
      nodeResolve({ browser: false }),
      ...commonPluginsMiddle,
      nodePolyfills(),
    ],
  },
];
