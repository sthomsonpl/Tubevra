import { defineConfig } from 'vite';
import { extensionBuildPlugin } from './build/extensions.mjs';

// https://vitejs.dev/config
export default defineConfig({ plugins: [extensionBuildPlugin()] });
