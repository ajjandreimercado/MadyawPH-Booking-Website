import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ToastProvider } from './components/ui/ToastProvider.tsx';
import { AuthProvider } from './contexts/AuthContext';
import { BookingsProvider } from './contexts/BookingsContext';
import ErrorBoundary from './components/ui/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <BookingsProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BookingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
