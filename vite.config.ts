import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createSolverMiddleware } from './src/adapters/solver-middleware'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-ngspice',
      // Cosmos 6 passes host=0.0.0.0 inline, so enforce loopback after that merge.
      config: () => ({
        server: {
          host: '127.0.0.1',
          open: 'http://127.0.0.1:5000',
          strictPort: true,
          cors: false,
          fs: { deny: ['**/models/**', '**/*.ibs', '**/*.circuit.json', '**/.env*', '**/.git/**'] },
        },
      }),
      configureServer: (server) => {
        server.middlewares.use(createSolverMiddleware())
      },
    },
  ],
})
