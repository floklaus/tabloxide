import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './assistant/assistantSession.css'
import { applyTheme } from './theme/theme'
import { useThemeStore } from './theme/themeStore'

applyTheme(useThemeStore.getState().theme)

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('The #root element is missing from index.html.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
