/**
 * UI Component Exports
 *
 * This file provides a centralized export for all UI components,
 * making imports cleaner throughout the application.
 *
 * Usage:
 * import { Button, Input, Card } from "@/components/ui";
 */

// Form Components
export { default as Input } from "./Input";
export { default as Button } from "./Button";

// Layout Components
export { default as Card } from "./Card";
export { default as Modal } from "./Modal";
export { default as Logo } from "./Logo";

// Feedback Components
export { default as Spinner } from "./Spinner";
export { ToastProvider, useToast } from "./Toast";
export { default as FeedbackButton } from "./FeedbackButton";
export { default as SyncIndicator } from "./SyncIndicator";

// Loading States
export { default as Skeleton } from "./Skeleton";
export { TableSkeleton, CardSkeleton, ListSkeleton, FormSkeleton, PageSkeleton } from "./Skeleton";

// Error Handling
export { ErrorBoundary, AsyncBoundary } from "./ErrorBoundary";

// Modals
export { default as ConfirmModal, useConfirm } from "./ConfirmModal";
