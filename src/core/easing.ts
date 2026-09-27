/**
 * Easing / interpolation curves.
 *
 * Every segment between two keyframes is a cubic bezier in normalised time
 * (x: 0..1) and value (y: 0..1) space, exactly like After Effects or Alight
 * Motion. Named presets are just shorthands for a pair of control points, so
 * the graph editor can show — and the user can grab — the handles of any of
 * them. A handful of curves (bounce, elastic, steps) are not expressible as a
 * single bezier, so they carry a closed-form function instead and are drawn by
 * sampling.
 */

export type EasingKind =
  | 'linear' | 'hold' | 'custom'
  | 'smooth' | 'easeIn' | 'easeOut'
  | 'sineIn' | 'sineOut' | 'sineInOut'
  | 'quadIn' | 'quadOut' | 'quadInOut'
  | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'quartIn' | 'quartOut' | 'quartInOut'
  | 'quintIn' | 'quintOut' | 'quintInOut'
  | 'expoIn' | 'expoOut' | 'expoInOut'
  | 'circIn' | 'circOut' | 'circInOut'
  | 'backIn' | 'backOut' | 'backInOut'
  | 'elasticIn' | 'elasticOut' | 'elasticInOut'
  | 'bounceIn' | 'bounceOut' | 'bounceInOut'
  | 'anticipate' | 'overshoot' | 'snap'
  | 'stepStart' | 'stepEnd'

export type Handle = [number, number]

export interface EasingDef {
  id: EasingKind
  name: string
  group: '기본' | '부드럽게' | '빠르게' | '탄성' | '단계'
  /** bezier control points (x1, y1, x2, y2) — the graph editor's default handles */
  bez?: [number, number, number, number]
  /** closed-form curve for shapes a single bezier cannot express */
  fn?: (t: number) => number
}

/* ------------------------------------------------------------- solver */

const NEWTON_ITERS = 5
const SUBDIV_ITERS = 12

const A = (a: number, b: number) => 1 - 3 * b + 3 * a
const B = (a: number, b: number) => 3 * b - 6 * a
const C = (a: number) => 3 * a

const bezCalc = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t
const bezSlope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1)

/** Solve a CSS-style cubic bezier for y given x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  if (x1 === y1 && x2 === y2) return x       // linear shortcut

  let t = x
  for (let i = 0; i < NEWTON_ITERS; i++) {
    const slope = bezSlope(t, x1, x2)
    if (Math.abs(slope) < 1e-6) break
    const err = bezCalc(t, x1, x2) - x
    t -= err / slope
  }
  if (t < 0 || t > 1) {
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < SUBDIV_ITERS; i++) {
      const cx = bezCalc(t, x1, x2)
      if (cx > x) hi = t; else lo = t
      t = (lo + hi) / 2
    }
  }
  return bezCalc(t, y1, y2)
}

/* ------------------------------------------------------------ library */

const bounceOut = (x: number): number => {
  const n = 7.5625, d = 2.75
  if (x < 1 / d) return n * x * x
  if (x < 2 / d) { const v = x - 1.5 / d; return n * v * v + 0.75 }
  if (x < 2.5 / d) { const v = x - 2.25 / d; return n * v * v + 0.9375 }
  const v = x - 2.625 / d
  return n * v * v + 0.984375
}

const elasticOut = (x: number): number => {
  if (x === 0 || x === 1) return x
  const c = (2 * Math.PI) / 3
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c) + 1
}
const elasticIn = (x: number): number => {
  if (x === 0 || x === 1) return x
  const c = (2 * Math.PI) / 3
  return -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c)
}

export const EASINGS: EasingDef[] = [
  { id: 'linear', name: '직선', group: '기본', bez: [0, 0, 1, 1] },
  { id: 'smooth', name: '부드럽게', group: '기본', bez: [0.4, 0, 0.2, 1] },
  { id: 'easeIn', name: '천천히 시작', group: '기본', bez: [0.42, 0, 1, 1] },
  { id: 'easeOut', name: '천천히 끝', group: '기본', bez: [0, 0, 0.58, 1] },
  { id: 'hold', name: '고정', group: '기본' },
  { id: 'custom', name: '직접 조절', group: '기본', bez: [0.33, 0, 0.67, 1] },

  { id: 'sineIn', name: '사인 In', group: '부드럽게', bez: [0.12, 0, 0.39, 0] },
  { id: 'sineOut', name: '사인 Out', group: '부드럽게', bez: [0.61, 1, 0.88, 1] },
  { id: 'sineInOut', name: '사인 InOut', group: '부드럽게', bez: [0.37, 0, 0.63, 1] },
  { id: 'quadIn', name: '제곱 In', group: '부드럽게', bez: [0.11, 0, 0.5, 0] },
  { id: 'quadOut', name: '제곱 Out', group: '부드럽게', bez: [0.5, 1, 0.89, 1] },
  { id: 'quadInOut', name: '제곱 InOut', group: '부드럽게', bez: [0.45, 0, 0.55, 1] },
  { id: 'cubicIn', name: '세제곱 In', group: '부드럽게', bez: [0.32, 0, 0.67, 0] },
  { id: 'cubicOut', name: '세제곱 Out', group: '부드럽게', bez: [0.33, 1, 0.68, 1] },
  { id: 'cubicInOut', name: '세제곱 InOut', group: '부드럽게', bez: [0.65, 0, 0.35, 1] },

  { id: 'quartIn', name: '4제곱 In', group: '빠르게', bez: [0.5, 0, 0.75, 0] },
  { id: 'quartOut', name: '4제곱 Out', group: '빠르게', bez: [0.25, 1, 0.5, 1] },
  { id: 'quartInOut', name: '4제곱 InOut', group: '빠르게', bez: [0.76, 0, 0.24, 1] },
  { id: 'quintIn', name: '5제곱 In', group: '빠르게', bez: [0.64, 0, 0.78, 0] },
  { id: 'quintOut', name: '5제곱 Out', group: '빠르게', bez: [0.22, 1, 0.36, 1] },
  { id: 'quintInOut', name: '5제곱 InOut', group: '빠르게', bez: [0.83, 0, 0.17, 1] },
  { id: 'expoIn', name: '지수 In', group: '빠르게', bez: [0.7, 0, 0.84, 0] },
  { id: 'expoOut', name: '지수 Out', group: '빠르게', bez: [0.16, 1, 0.3, 1] },
  { id: 'expoInOut', name: '지수 InOut', group: '빠르게', bez: [0.87, 0, 0.13, 1] },
  { id: 'circIn', name: '원 In', group: '빠르게', bez: [0.55, 0, 1, 0.45] },
  { id: 'circOut', name: '원 Out', group: '빠르게', bez: [0, 0.55, 0.45, 1] },
  { id: 'circInOut', name: '원 InOut', group: '빠르게', bez: [0.85, 0, 0.15, 1] },
  { id: 'snap', name: '스냅', group: '빠르게', bez: [0.9, 0, 0.1, 1] },

  { id: 'backIn', name: '뒤로 당겼다', group: '탄성', bez: [0.36, 0, 0.66, -0.56] },
  { id: 'backOut', name: '튀어나감', group: '탄성', bez: [0.34, 1.56, 0.64, 1] },
  { id: 'backInOut', name: '당겼다 튀어나감', group: '탄성', bez: [0.68, -0.6, 0.32, 1.6] },
  { id: 'anticipate', name: '예비 동작', group: '탄성', bez: [0.6, -0.45, 0.3, 1] },
  { id: 'overshoot', name: '오버슛', group: '탄성', bez: [0.25, 1.4, 0.4, 1] },
  { id: 'elasticIn', name: '탄성 In', group: '탄성', fn: elasticIn },
  { id: 'elasticOut', name: '탄성 Out', group: '탄성', fn: elasticOut },
  { id: 'elasticInOut', name: '탄성 InOut', group: '탄성', fn: (x) => x < 0.5 ? elasticIn(x * 2) / 2 : 0.5 + elasticOut(x * 2 - 1) / 2 },
  { id: 'bounceIn', name: '통통 In', group: '탄성', fn: (x) => 1 - bounceOut(1 - x) },
  { id: 'bounceOut', name: '통통 Out', group: '탄성', fn: bounceOut },
  { id: 'bounceInOut', name: '통통 InOut', group: '탄성', fn: (x) => x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2 },

  { id: 'stepStart', name: '즉시 변경', group: '단계', fn: () => 1 },
  { id: 'stepEnd', name: '끝에서 변경', group: '단계', fn: (x) => (x >= 1 ? 1 : 0) },
]

export const EASING_MAP: Record<string, EasingDef> =
  Object.fromEntries(EASINGS.map((e) => [e.id, e]))

export const EASING_GROUPS = ['기본', '부드럽게', '빠르게', '탄성', '단계'] as const

/** Default handles for a preset, used when the user starts dragging in the graph. */
export function handlesOf(kind: EasingKind): [number, number, number, number] {
  const d = EASING_MAP[kind]
  if (d?.bez) return d.bez
  return [0.33, 0, 0.67, 1]
}

/**
 * Evaluate an easing at normalised progress x.
 * `out` is the leaving handle of the first key, `inn` the arriving handle of
 * the second — both optional; presets fill them in.
 */
export function easeAt(
  kind: EasingKind, x: number,
  out?: Handle | null, inn?: Handle | null,
): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  if (kind === 'hold') return 0
  if (kind === 'linear' && !out && !inn) return t
  const def = EASING_MAP[kind]
  if (def?.fn && kind !== 'custom') return def.fn(t)
  const base = handlesOf(kind)
  const x1 = out ? out[0] : base[0]
  const y1 = out ? out[1] : base[1]
  const x2 = inn ? inn[0] : base[2]
  const y2 = inn ? inn[1] : base[3]
  return cubicBezier(x1, y1, x2, y2, t)
}

/** Sample the curve for drawing, including any overshoot beyond 0..1. */
export function sampleCurve(
  kind: EasingKind, steps = 48,
  out?: Handle | null, inn?: Handle | null,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const x = i / steps
    pts.push({ x, y: easeAt(kind, x, out, inn) })
  }
  return pts
}
