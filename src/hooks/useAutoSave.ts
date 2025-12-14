"use client";

import { useState, useEffect, useCallback } from 'react';
import {
  autoSave,
  initAutoSave,
  AutoSaveStatus,
  SaveableDataType,
} from '@/lib/auto-save';

export interface UseAutoSaveReturn {
  status: AutoSaveStatus;
  message: string;
  isEnabled: boolean;
  hasUnsavedChanges: boolean;
  dirtyTypes: SaveableDataType[];
  enable: () => void;
  disable: () => void;
  saveNow: () => Promise<{ success: boolean; message: string }>;
  setDebounce: (ms: number) => void;
  getDebounce: () => number;
}

/**
 * React hook for auto-save functionality
 *
 * Usage:
 *   const { status, isEnabled, saveNow, enable, disable } = useAutoSave('02301');
 */
export function useAutoSave(ruc: string): UseAutoSaveReturn {
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [hasUnsaved, setHasUnsaved] = useState<boolean>(false);
  const [dirtyTypes, setDirtyTypes] = useState<SaveableDataType[]>([]);

  // Initialize auto-save on mount
  useEffect(() => {
    initAutoSave(ruc);
    setIsEnabled(autoSave.isEnabled());

    // Subscribe to status changes
    const unsubscribe = autoSave.onStatusChange((newStatus, newMessage) => {
      setStatus(newStatus);
      setMessage(newMessage || '');
      setHasUnsaved(autoSave.hasUnsavedChanges());
      setDirtyTypes(autoSave.getDirtyTypes());
    });

    return () => {
      unsubscribe();
    };
  }, [ruc]);

  // Update RUC if it changes
  useEffect(() => {
    autoSave.setRuc(ruc);
  }, [ruc]);

  const enable = useCallback(() => {
    autoSave.enable();
    setIsEnabled(true);
  }, []);

  const disable = useCallback(() => {
    autoSave.disable();
    setIsEnabled(false);
  }, []);

  const saveNow = useCallback(async () => {
    const result = await autoSave.saveNow();
    return result;
  }, []);

  const setDebounce = useCallback((ms: number) => {
    autoSave.setDebounce(ms);
  }, []);

  const getDebounce = useCallback(() => {
    return autoSave.getDebounce();
  }, []);

  return {
    status,
    message,
    isEnabled,
    hasUnsavedChanges: hasUnsaved,
    dirtyTypes,
    enable,
    disable,
    saveNow,
    setDebounce,
    getDebounce,
  };
}

export default useAutoSave;
