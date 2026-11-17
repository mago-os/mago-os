import type * as React from "react";
import { cn } from "@/lib/utils";

/** Campo de texto com rótulo, no estilo do Mago OS. */
export function Campo({
  rotulo,
  id,
  className,
  ...props
}: React.ComponentProps<"input"> & { rotulo: string; id: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      <input
        id={id}
        className={cn(
          "h-11 rounded-md border border-linha bg-cartao px-3 text-base outline-none focus-visible:border-tinta focus-visible:ring-2 focus-visible:ring-tinta/15",
          className,
        )}
        {...props}
      />
    </div>
  );
}
