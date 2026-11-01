import './styles/global.css'
import { createRoot } from 'react-dom/client'
import App from './App'

if (import.meta.env.DEV && location.search.includes('harness')) void import('./dev/harness')

createRoot(document.getElementById('root')!).render(<App />)
