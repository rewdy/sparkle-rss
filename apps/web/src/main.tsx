import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@mantine/core/styles.css';
import './styles.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
