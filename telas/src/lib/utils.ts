import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes do Tailwind sem conflito (padrão do shadcn). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
