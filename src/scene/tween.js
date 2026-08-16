/**
 * Tween minimo (~50 linhas) no lugar de uma biblioteca de animacao.
 * O GSAP custaria ~23 KB gzip para as tres curvas que este projeto usa.
 *
 * Nao ha loop proprio aqui: quem roda os frames e o renderer, que so acorda
 * quando ha algo para desenhar. `setWaker` liga os dois sem import circular.
 */

const active = new Set();

let wake = () => {};

/** Chamado uma vez pelo renderer para poder acordar o loop ao criar um tween. */
export const setWaker = (fn) => {
  wake = fn;
};

// --------------------------------------------------------------- easings ---

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Passa um pouco do alvo e volta — da o "pop" da fase de apresentacao. */
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

// ----------------------------------------------------------------- tween ---

/**
 * @param {object} o
 * @param {number} o.dur        duracao em ms
 * @param {number} [o.delay]    atraso em ms
 * @param {(t:number)=>number} [o.ease]
 * @param {(u:number)=>void} o.onUpdate  recebe o progresso ja suavizado (0..1)
 * @param {()=>void} [o.onDone]
 * @returns {{ cancel: () => void }}
 */
export function tween({ dur, delay = 0, ease = easeOutCubic, onUpdate, onDone }) {
  const t = { start: performance.now() + delay, dur, ease, onUpdate, onDone };
  active.add(t);
  wake();
  return {
    cancel() {
      active.delete(t);
    },
  };
}

export const tweenCount = () => active.size;

/** Avanca todos os tweens ativos. Chamado pelo loop do renderer. */
export function stepTweens(now) {
  for (const t of active) {
    const elapsed = now - t.start;
    if (elapsed < 0) continue; // ainda no delay

    const raw = t.dur > 0 ? Math.min(1, elapsed / t.dur) : 1;
    t.onUpdate(t.ease(raw));

    if (raw >= 1) {
      // Remover antes do callback: um onDone que encadeia outro tween nao pode
      // ver este ainda na lista.
      active.delete(t);
      t.onDone?.();
    }
  }
}

export function cancelAllTweens() {
  active.clear();
}

/** O usuario pediu menos movimento: as animacoes viram saltos diretos. */
export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
