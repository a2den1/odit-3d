import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import './styles.css'
import './odit3d.css'

createRoot(document.getElementById('root')!).render(<App />)

const q = new URLSearchParams(location.search)
if (q.has('selftest') || q.has('shots')) {
  import('./harness').then((m) => m.run({ shots: q.has('shots') }))
}
