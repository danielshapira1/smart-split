import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'

// Rescue router: אם Supabase החזיר ל-root עם ה-hash של הטוקן, נעביר ל-base (ב-GitHub Pages זה /smart-split/)
if (
  import.meta.env.PROD &&
  window.location.pathname === '/' &&
  window.location.hash.includes('access_token=')
) {
  const target = `${window.location.origin}${import.meta.env.BASE_URL}${window.location.hash}`
  window.location.replace(target)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
