import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X } from 'lucide-react';

interface Toast {
  id: string;
  title: string;
  description?: string;
  type?: 'success' | 'info' | 'error';
}

interface ToastContextType {
  toast: (message: string) => void;
  showToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, ...toast }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const toast = useCallback((message: string) => {
    showToast({ title: message, type: 'info' });
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ toast, showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-brand-dark text-brand-cream px-4 py-3 rounded-xl shadow-md flex items-center gap-3 w-64 border border-white/10"
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${t.type === 'error' ? 'bg-red-500/20' : t.type === 'success' ? 'bg-green-500/20' : 'bg-brand-primary/20'}`}>
                {t.type === 'error' ? <X className="w-4 h-4 text-red-400" /> : <Check className={`w-4 h-4 ${t.type === 'success' ? 'text-green-400' : 'text-brand-primary'}`} />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold tracking-wide uppercase block">{t.title}</span>
                {t.description && <p className="text-[10px] text-brand-cream/70 mt-1 leading-relaxed">{t.description}</p>}
              </div>
              <button 
                onClick={() => setToasts(prev => prev.filter(toast => toast.id !== t.id))}
                className="text-white/50 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
