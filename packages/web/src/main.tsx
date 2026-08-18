import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element the console mounts into.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
