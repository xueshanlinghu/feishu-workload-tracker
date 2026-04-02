/**
 * Toast容器组件
 * 在右下角管理和显示多个Toast通知
 */

'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import Toast, { ToastType } from './Toast';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  autoClose: boolean;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType, autoClose?: boolean) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType, autoClose = true) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: ToastItem = {
      id,
      message,
      type,
      autoClose: type === 'success' ? true : autoClose, // 成功消息默认自动关闭
    };

    setToasts((prev) => [...prev, newToast]);
  }, []);

  const showSuccess = useCallback((message: string) => {
    showToast(message, 'success', true);
  }, [showToast]);

  const showError = useCallback((message: string) => {
    showToast(message, 'error', false); // 错误消息不自动关闭
  }, [showToast]);

  const showWarning = useCallback((message: string) => {
    showToast(message, 'warning', true);
  }, [showToast]);

  const showInfo = useCallback((message: string) => {
    showToast(message, 'info', true);
  }, [showToast]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const toastContextValue = useMemo(
    () => ({
      showToast,
      showSuccess,
      showError,
      showWarning,
      showInfo,
    }),
    [showToast, showSuccess, showError, showWarning, showInfo]
  );

  return (
    <ToastContext.Provider value={toastContextValue}>
      {children}

      {/* Toast容器 - 固定在右下角 */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast
              message={toast.message}
              type={toast.type}
              autoClose={toast.autoClose}
              onClose={() => removeToast(toast.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
