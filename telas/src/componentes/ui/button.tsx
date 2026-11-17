import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const variantesDoBotao = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        principal: "bg-tinta text-sobre-tinta hover:opacity-90",
        contorno: "border border-linha bg-cartao text-tinta hover:bg-suave",
        fantasma: "text-tinta hover:bg-suave",
        perigo: "bg-perigo text-white hover:opacity-90",
      },
      size: {
        padrao: "h-10 px-4",
        pequeno: "h-8 px-3 text-[13px]",
        icone: "size-10",
      },
    },
    defaultVariants: { variant: "principal", size: "padrao" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof variantesDoBotao> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp data-slot="button" className={cn(variantesDoBotao({ variant, size, className }))} {...props} />
  );
}
