"use client";

import { useAutoSave } from '@/hooks/useAutoSave';

interface AutoSaveStatusProps {
  ruc: string;
}

/**
 * Auto-save status indicator component
 *
 * Shows the current save status (auto-save is always enabled)
 */
export function AutoSaveStatus({ ruc }: AutoSaveStatusProps) {
  const {
    status,
    message,
    hasUnsavedChanges,
    saveNow,
  } = useAutoSave(ruc);

  const getStatusColor = () => {
    switch (status) {
      case 'idle':
        return 'text-foreground-muted';
      case 'pending':
        return 'text-warning';
      case 'saving':
        return 'text-primary';
      case 'saved':
        return 'text-success';
      case 'error':
        return 'text-error';
      default:
        return 'text-foreground-muted';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'idle':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'pending':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'saving':
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'saved':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getStatusText = () => {
    if (message) return message;
    switch (status) {
      case 'idle':
        return 'Auto-save on';
      case 'pending':
        return 'Unsaved changes';
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved';
      case 'error':
        return 'Save failed';
      default:
        return '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Status indicator */}
      <div className={`flex items-center gap-1.5 text-sm ${getStatusColor()}`}>
        {getStatusIcon()}
        <span>{getStatusText()}</span>
      </div>

      {/* Manual save button - only show if there are unsaved changes */}
      {hasUnsavedChanges && (
        <button
          onClick={() => saveNow()}
          disabled={status === 'saving'}
          className="text-xs px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 ml-2"
        >
          Save Now
        </button>
      )}
    </div>
  );
}

export default AutoSaveStatus;
