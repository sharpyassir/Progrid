'use client';

import { createContext, useContext } from 'react';
import type { Key, Locale } from '@/lib/i18n';
import type { Me } from '@/lib/types';

export type Vars = Record<string, string | number>;
export type ToastKind = 'info' | 'success' | 'error';

export interface ShellCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: Key, vars?: Vars) => string;
  me: Me | null;
  reloadMe: () => Promise<void>;
  /** The engineer's time zone (all times are shown in it). */
  tz: string | undefined;
  /** A contract's local time zone, for the hover time. */
  contractTz: (contractId: string | null | undefined) => string | undefined;
  contractName: (contractId: string | null | undefined) => string;
  toast: (message: string, kind?: ToastKind) => void;
  signOut: () => void;
}

export const Ctx = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useShell outside the shell');
  return c;
}
