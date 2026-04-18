import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: false
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      },
      output: {
        comments: false
      }
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['@supabase/supabase-js']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['@supabase/supabase-js']
  },
  define: {
    __VERSION__: JSON.stringify('1.0.0'),
    __DEV__: JSON.stringify(false)
  }
});
