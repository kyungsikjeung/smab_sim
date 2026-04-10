import React, { useEffect } from 'react';
import { useRecoilState } from 'recoil';
import { toastMessageState } from 'state/atoms';

const Toast: React.FC = () => {
  const [toast, setToast] = useRecoilState(toastMessageState);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  if (!toast) return null;

  return (
    <div className={`toast toast--${toast.type}`}>
      {toast.message}
    </div>
  );
};

export default Toast;
