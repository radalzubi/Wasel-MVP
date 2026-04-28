import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Minify + obfuscate in production
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2, drop_console: true },
      mangle: { toplevel: true },
      format: { comments: false },
    },
    // Chunk splitting so phone preview is a separate chunk
    rollupOptions: {
      output: {
        manualChunks: {
          'phone-demo': [
            './src/components/phone/AppPreview',
            './src/components/phone/PhoneFrame',
            './src/components/phone/screens/HomeScreen',
            './src/components/phone/screens/BookScreen',
            './src/components/phone/screens/MatchingScreen',
            './src/components/phone/screens/TripScreen',
            './src/components/phone/screens/RatingScreen',
          ],
        },
      },
    },
  },
})
