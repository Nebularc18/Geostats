"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function Modal({ className, label, onClose, children }: {
  className: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`ds-modal ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {children}
    </dialog>
  );
}
