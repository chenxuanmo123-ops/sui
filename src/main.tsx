import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import './styles.css'
import './workspace.css'
import './investigation.css'
import './notebook.css'
import './desk.css'
import './app.css'
import './instrument.css'
import './observation.css'
import './redesign.css'
import './studio.css'
import './motion.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

