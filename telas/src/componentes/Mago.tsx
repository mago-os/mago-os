import { useEffect, useRef } from "react";
import { DesenhoDoMago, type EstadoDoMago } from "./desenho-do-mago";

interface Props {
  tamanho: number;
  estado?: EstadoDoMago;
  /** "tinta" desenha na cor do texto; "sobre-tinta" é para usar em cima de um fundo cor de tinta. */
  cor?: "tinta" | "sobre-tinta";
  rotulo?: string;
  className?: string;
}

/** O mago em meio-tom, animado a 30 quadros por segundo e parado para quem pediu menos movimento. */
export function Mago({ tamanho, estado = "parado", cor = "tinta", rotulo, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const desenho = new DesenhoDoMago(canvas, tamanho, cor === "tinta" ? "--ink" : "--on-ink");
    const menosMovimento = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visivel = true;
    let ultimo = 0;
    let quadro = 0;
    const observador = new IntersectionObserver(([e]) => {
      visivel = e?.isIntersecting ?? true;
    });
    observador.observe(canvas);
    const laco = (t: number) => {
      if (t - ultimo >= 33 && visivel && !document.hidden) {
        ultimo = t;
        desenho.desenhar(t, estado, menosMovimento.matches);
      }
      quadro = requestAnimationFrame(laco);
    };
    desenho.desenhar(0, estado, menosMovimento.matches);
    if (!menosMovimento.matches) quadro = requestAnimationFrame(laco);
    // Redesenha quando o tema muda (as cores vêm do CSS).
    const tema = new MutationObserver(() =>
      desenho.desenhar(performance.now(), estado, menosMovimento.matches),
    );
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      tema.disconnect();
    };
  }, [tamanho, estado, cor]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: tamanho, height: tamanho }}
      role={rotulo ? "img" : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
    />
  );
}
