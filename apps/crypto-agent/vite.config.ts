import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.CRYPTO_AGENT_API_PORT || 5451);
export default defineConfig({ plugins: [react()], server: { port: Number(process.env.CRYPTO_AGENT_WEB_PORT || 5450), strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
