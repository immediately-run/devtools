import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The devtools app — the Tools workbench activity (TOOLS_ACTIVITY_SPEC). One
// entry point serving two regions; see src/App.tsx. https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
});
