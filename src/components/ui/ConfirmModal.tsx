"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Button from "./Button";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
}

// Variant styles defined outside component to prevent recreation on each render
const variantStyles = {
  danger: {
    icon: (
      <svg
        className="w-6 h-6 text-error"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
    iconBg: "bg-error/10",
    buttonVariant: "danger" as const,
  },
  warning: {
    icon: (
      <svg
        className="w-6 h-6 text-warning"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    iconBg: "bg-warning/10",
    buttonVariant: "primary" as const,
  },
  info: {
    icon: (
      <svg
        className="w-6 h-6 text-primary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    iconBg: "bg-primary/10",
    buttonVariant: "primary" as const,
  },
};

/**
 * Confirmation modal for destructive or important actions.
 * Includes keyboard navigation (Escape to close) and focus management.
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  isLoading = false,
}: ConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Handle escape key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        onClose();
      }
    },
    [onClose, isLoading]
  );

  // Focus management and keyboard handling
  useEffect(() => {
    if (isOpen) {
      // Focus cancel button when modal opens
      cancelButtonRef.current?.focus();

      // Add keyboard listener
      document.addEventListener("keydown", handleKeyDown);

      // Prevent body scroll
      document.body.style.overflow = "hidden";

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      };
    }
  }, [isOpen, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && !isLoading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const styles = variantStyles[variant];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
    >
      <div
        ref={modalRef}
        className="bg-surface rounded-xl shadow-2xl max-w-md w-full border border-border overflow-hidden"
        role="document"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div
              className={`flex-shrink-0 w-12 h-12 rounded-full ${styles.iconBg} flex items-center justify-center`}
            >
              {styles.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3
                id="modal-title"
                className="text-lg font-semibold text-foreground"
              >
                {title}
              </h3>
              <p
                id="modal-description"
                className="mt-2 text-sm text-foreground-muted"
              >
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 bg-surface-alt border-t border-border">
          <Button
            ref={cancelButtonRef}
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1"
          >
            {cancelText}
          </Button>
          <Button
            variant={styles.buttonVariant}
            onClick={onConfirm}
            isLoading={isLoading}
            className="flex-1"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for using confirmation modals with async actions.
 */
interface UseConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
}

export function useConfirm(options: UseConfirmOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  const confirm = (action: () => Promise<void>) => {
    setPendingAction(() => action);
    setIsOpen(true);
  };

  const handleConfirm = async () => {
    if (!pendingAction) return;

    setIsLoading(true);
    try {
      await pendingAction();
    } finally {
      setIsLoading(false);
      setIsOpen(false);
      setPendingAction(null);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setIsOpen(false);
    setPendingAction(null);
  };

  const ConfirmDialog = () => (
    <ConfirmModal
      isOpen={isOpen}
      onClose={handleClose}
      onConfirm={handleConfirm}
      isLoading={isLoading}
      {...options}
    />
  );

  return { confirm, ConfirmDialog };
}
