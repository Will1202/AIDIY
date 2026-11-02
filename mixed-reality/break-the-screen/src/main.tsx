import { createRoot } from 'react-dom/client'
import '@fontsource/michroma/400.css'
import '@fontsource-variable/martian-mono'
import './styles/global.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
