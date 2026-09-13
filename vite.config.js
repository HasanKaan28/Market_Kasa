import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

const removeCrossOriginPlugin = () => ({
  name: 'remove-crossorigin',
  transformIndexHtml(html) {
    return html.replace(/ crossorigin/g, '');
  }
});

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    removeCrossOriginPlugin()
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5174'
    }
  }
})
