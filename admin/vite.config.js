import { defineConfig } from 'vite';
export default defineConfig({ base: '/admin/', server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' } } });
