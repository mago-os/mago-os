import type * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("flex flex-col gap-4 rounded-cartao border border-linha bg-cartao p-5", className)}
      {...props}
    />
  );
}

export function CardTitulo({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescricao({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-texto-2", className)} {...props} />;
}
