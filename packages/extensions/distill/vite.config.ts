import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createExtensionConfig, mergeExtensionConfig } from '@nimbalyst/extension-sdk/vite';

const base = createExtensionConfig({
  entry: './src/index.tsx',
});

export default defineConfig(
  mergeExtensionConfig(base, {
    plugins: [
      react({ jsxRuntime: 'automatic', jsxImportSource: 'react' }),
      ...(base.plugins ?? []),
    ],
  }),
);
