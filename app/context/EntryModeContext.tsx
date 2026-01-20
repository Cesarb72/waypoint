'use client';

import { createContext, useContext, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { DEFAULT_ENTRY_MODE, isEntryMode, type EntryMode } from '../lib/entryMode';

type EntryModeState = {
  mode: EntryMode;
  isReadOnly: boolean;
};

const EntryModeContext = createContext<EntryModeState | null>(null);

export function EntryModeProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const modeParam = searchParams.get('mode');
  const mode = useMemo(
    () => (isEntryMode(modeParam) ? modeParam : DEFAULT_ENTRY_MODE),
    [modeParam]
  );
  const isReadOnly = mode !== 'plan';
  const value = useMemo(() => ({ mode, isReadOnly }), [mode, isReadOnly]);
  return <EntryModeContext.Provider value={value}>{children}</EntryModeContext.Provider>;
}

export function useEntryMode(): EntryModeState {
  const context = useContext(EntryModeContext);
  if (!context) {
    return { mode: DEFAULT_ENTRY_MODE, isReadOnly: false };
  }
  return context;
}
