// Separate, minimal Babel config for __tests__/integration only.
// These are plain Node integration tests hitting Supabase directly — no RN/JSX,
// no NativeWind. Deliberately NOT using babel-preset-expo: that preset rewrites
// `process.env.EXPO_PUBLIC_*` into an import from `expo/virtual/env`, which only
// resolves inside Metro's bundler and breaks plain Jest/Node test runs.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-typescript'],
};
