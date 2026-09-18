import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Junta classes condicionais e resolve conflitos do Tailwind. O `cn` que todo
 *  componente do shadcn, MagicUI e SmoothUI importa. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
