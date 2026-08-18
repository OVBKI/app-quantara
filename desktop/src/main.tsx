import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './state/store';
import { ToastProvider } from './ui/Toast';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine introuvable');

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </StrictMode>,
);
