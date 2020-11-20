import typescript from 'rollup-plugin-typescript2';
import nodeResolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
//
import pkg from './package.json';

// continued
export default {
  input: 'src/index.tsx',
  output: [
    {
      file: pkg.main,
      format: 'cjs',
      exports: 'named',
      sourcemap: true,
      strict: false,
    },
  ],
  plugins: [
    // Preferably set as first plugin.
    peerDepsExternal(),
    //
    nodeResolve(),
    commonjs({
      // namedExports: {
      //   'node_modules/subscriptions-transport-ws/dist/index.js': ['SubscriptionClient'],
      // },
    }),
    typescript({ objectHashIgnoreUnknownHack: false }),
  ],
};
