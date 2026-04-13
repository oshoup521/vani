import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config — standard React setup with HMR support
export default defineConfig({
  plugins: [react()],
})
