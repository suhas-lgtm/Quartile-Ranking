import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installAutoSort } from './utils/autoSort'

// Every table sorts by a click on a column heading (utils/autoSort).
installAutoSort()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
