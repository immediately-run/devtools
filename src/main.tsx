// Local `vite dev` entry ONLY. immediately.run never loads this file: the host
// boots a region app at the literal path `files/src/App.tsx` and renders its
// default export, so anything the rendered tree needs must be reachable from
// App.tsx — not from here.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
