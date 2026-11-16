/**
 * Desenho do mago em meio-tom: chapéu, sobrancelhas, barba longa e olhos que brilham na cor secundária.
 * Portado do design aprovado (mago-os-design.html). Roda no aparelho do usuário, sem IA nem servidor.
 */

export type EstadoDoMago = "parado" | "ouvindo" | "pensando" | "falando";

interface Parametros {
  piscar: number;
  boca: number;
}

const limitar = (v: number) => Math.min(1, Math.max(0, v));
function suave(e0: number, e1: number, v: number): number {
  const t = limitar((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function elipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const u = (x - cx) / rx;
  const v = (y - cy) / ry;
  return u * u + v * v;
}

/** Marca de cada ponto: 0 nada, 1 órbita, 2 olho, 3 barba, 4 bigode, 5 boca. */
export function sombra(x: number, y: number, p: Parametros): [brilho: number, marca: number] {
  let b = 0;
  let marca = 0;
  // chapéu: cone com ponta curvada para a direita
  if (y >= -1.0 && y <= -0.3) {
    const t = (y + 1.0) / 0.7;
    const hw = 0.5 * t ** 0.85 + 0.02;
    const hc = 0.24 * (1 - t) ** 2.2;
    const u = (x - hc) / hw;
    if (Math.abs(u) <= 1) {
      b = 0.28 + 0.5 * (1 - (u + 1) / 2) * (0.6 + 0.4 * t);
      if (y > -0.45 && y < -0.37) b = 0.92;
      b *= suave(1, 0.86, Math.abs(u));
    }
  }
  // aba
  if (elipse(x, y, 0, -0.29, 0.86, 0.085) <= 1)
    b = Math.max(b, 0.55 + 0.4 * (1 - limitar((y + 0.29) / 0.085 + 0.5)));
  // rosto iluminado de cima à esquerda
  const fu = x / 0.4;
  const fv = (y - 0.02) / 0.36;
  const fr = fu * fu + fv * fv;
  if (y > -0.21 && fr <= 1) {
    const nz = Math.sqrt(1 - fr);
    const luz = -0.42 * fu - 0.5 * fv + 0.76 * nz;
    b = Math.max(b, 0.12 + 0.62 * limitar(luz));
    if (y < -0.13) b *= 0.55;
    for (let s = -1; s <= 1; s += 2) {
      const ex = s * 0.155;
      if (elipse(x, y, ex, -0.06, 0.1, 0.055) <= 1) {
        b = Math.min(b, 0.14);
        marca = 1;
      }
      if (elipse(x, y, ex, -0.06, 0.06, 0.032 * p.piscar + 0.004) <= 1) {
        b = 1;
        marca = 2;
      }
      const by = -0.15 - 0.03 * (1 - Math.abs((x - ex) / 0.13));
      if (Math.abs(x - ex) < 0.14 && Math.abs(y - by) < 0.022)
        b = Math.max(b, 0.88 - 0.25 * ((x - ex) * s + 0.14));
    }
    if (y > -0.04 && y < 0.15) {
      if (Math.abs(x + 0.012) < 0.016) b = Math.max(b, 0.9);
      else if (x > 0.004 && x < 0.05) b *= 0.55;
    }
  }
  // barba longa
  if (y > 0.12 && y <= 0.98) {
    const bt = (y - 0.12) / 0.86;
    const bw = 0.43 * (1 - bt ** 1.6) + 0.03;
    const bc = 0.05 * bt * bt;
    const bu = (x - bc) / bw;
    if (Math.abs(bu) <= 1) {
      const fio = 0.5 + 0.5 * Math.sin(((x - bc) * 34) / (0.5 + bt) + y * 4);
      let bb = (0.32 + 0.4 * fio) * (0.75 + 0.25 * (1 - bt)) * (1 - 0.35 * Math.max(0, bu));
      bb *= suave(1, 0.8, Math.abs(bu));
      b = Math.max(b, bb);
      if (marca === 0) marca = 3;
    }
  }
  // bigode
  for (let m = -1; m <= 1; m += 2) {
    const mo = elipse(x, y, m * 0.1, 0.2 + 0.03 * Math.abs(x) * 6, 0.13, 0.04);
    if (mo <= 1) {
      b = Math.max(b, 0.8 - 0.3 * mo);
      marca = 4;
    }
  }
  // boca
  if (elipse(x, y, 0, 0.27, 0.085, 0.012 + p.boca) <= 1) {
    b = 0.04;
    marca = 5;
  }
  return [b, marca];
}

interface Ponto {
  px: number;
  py: number;
  x: number;
  y: number;
  b: number;
  marca: number;
  muda: boolean;
}

export class DesenhoDoMago {
  private readonly canvas: HTMLCanvasElement;
  private readonly tamanho: number;
  private readonly corVar: "--ink" | "--on-ink";
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lado: number;
  private readonly passo: number;
  private readonly pontos: Ponto[] = [];

  constructor(canvas: HTMLCanvasElement, tamanho: number, corVar: "--ink" | "--on-ink") {
    this.canvas = canvas;
    this.tamanho = tamanho;
    this.corVar = corVar;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = tamanho * dpr;
    canvas.height = tamanho * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas sem contexto 2D");
    this.ctx = ctx;
    // passo dos pontos: ~72 colunas no tamanho grande, mínimo de 1,7 px nos ícones
    this.passo = Math.max(1.7, tamanho / 72) * dpr;
    this.lado = tamanho * dpr;
    const escala = this.lado * 0.47;
    let linha = 0;
    for (let py = this.passo / 2; py < this.lado; py += this.passo * 0.866, linha++) {
      for (let px = linha % 2 ? this.passo : this.passo / 2; px < this.lado; px += this.passo) {
        const x = (px - this.lado / 2) / escala;
        const y = (py - this.lado / 2 - this.lado * 0.02) / escala;
        const [b, marca] = sombra(x, y, { piscar: 1, boca: 0 });
        const muda =
          (Math.abs(y - 0.27) < 0.12 && Math.abs(x) < 0.16) ||
          (Math.abs(y + 0.06) < 0.07 && Math.abs(x) < 0.25);
        if (b < 0.04 && !muda) continue;
        this.pontos.push({ px, py, x, y, b, marca, muda });
      }
    }
  }

  get quantidadeDePontos(): number {
    return this.pontos.length;
  }

  desenhar(tempoMs: number, estado: EstadoDoMago, semMovimento: boolean): void {
    const { ctx, lado } = this;
    const css = getComputedStyle(this.canvas);
    const cor = css.getPropertyValue(this.corVar).trim();
    const brilho = css.getPropertyValue("--sec").trim();
    ctx.clearRect(0, 0, lado, lado);
    const st = semMovimento ? "parado" : estado;
    const T = semMovimento ? 0 : tempoMs / 1000;
    const piscar = !semMovimento && T % 4.6 < 0.14 ? 0.1 : 1;
    const boca = st === "falando" ? 0.02 + 0.05 * Math.abs(Math.sin(T * 9) * Math.sin(T * 3.3)) : 0;
    const raioMax = this.passo * 0.52;
    const grande = this.tamanho >= 90;
    // ponto escuro sobre fundo claro: o tamanho segue a sombra, como numa impressão em meio-tom
    const temaClaro = css.getPropertyValue("--on-ink").trim().toUpperCase() === "#FFFFFF";
    const pontosDeTinta = (this.corVar === "--ink") === temaClaro;
    const faixa = ((T * 0.35) % 1.6) - 0.3;
    const normais: number[] = [];
    const olhos: number[] = [];
    for (const d of this.pontos) {
      let { b, marca } = d;
      if (d.muda && (piscar < 1 || boca > 0)) [b, marca] = sombra(d.x, d.y, { piscar, boca });
      const yy = (d.y + 1) / 2;
      if (st === "parado") b += 0.18 * Math.max(0, 1 - Math.abs(yy - faixa) * 9) + 0.04 * Math.sin(T * 1.6);
      if (st === "ouvindo") {
        const dist = Math.hypot(d.x, d.y - 0.27);
        b += 0.3 * Math.max(0, Math.sin(T * 7 - dist * 14)) * (0.55 + 0.45 * Math.sin(T * 2.3));
      }
      if (st === "pensando") b += 0.28 * Math.max(0, Math.sin((d.x * 0.8 + d.y) * 7 - T * 4));
      if (st === "falando" && marca === 3) b += 0.12 * Math.abs(Math.sin(T * 9 + d.y * 6));
      if (b < 0.05) continue;
      let v = Math.min(1, b);
      if (pontosDeTinta && marca !== 2) v = 0.12 + 0.88 * (1 - v) * (1 - v * 0.15);
      (marca === 2 && grande ? olhos : normais).push(d.px, d.py, raioMax * Math.sqrt(v));
    }
    ctx.fillStyle = cor;
    ctx.beginPath();
    for (let k = 0; k < normais.length; k += 3) {
      const [x, y, r] = [normais[k] ?? 0, normais[k + 1] ?? 0, normais[k + 2] ?? 0];
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    if (olhos.length) {
      ctx.fillStyle = brilho;
      ctx.beginPath();
      for (let k = 0; k < olhos.length; k += 3) {
        const [x, y, r] = [olhos[k] ?? 0, olhos[k + 1] ?? 0, (olhos[k + 2] ?? 0) * 1.15];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
}
