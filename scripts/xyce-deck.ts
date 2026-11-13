// Research translator: routed ngspice deck -> Xyce deck. See docs/research/xyce.md for every construct.
// Usage: bun scripts/xyce-deck.ts <in.cir> <out.cir> [--stop <s>] [--step <s>] [--native-mutual] [--print <file>]
import { readFile, writeFile } from 'node:fs/promises'

export interface XyceOptions {
  /** Keep K lines; Xyce then merges every inductor-sharing K set into one dense YMIL device. */
  nativeMutual: boolean
  /** Override `.tran` stop time (seconds). */
  stopSeconds?: number
  /** Override `.tran` step and step ceiling (seconds). */
  stepSeconds?: number
  /** `.print tran format=csv` target. */
  printFile: string
}

interface Inductor { line: number; name: string; from: string; to: string; henries: number }
interface Coupling { first: string; second: string; factor: number }
interface Scope { inductors: Map<string, Inductor>; couplings: Coupling[] }

/** Parse a SPICE number, including engineering suffixes. */
export function spiceValue(token: string): number {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpf])?/i.exec(token)
  if (!match) throw new Error(`Not a SPICE number: ${token}`)
  const scale: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
  return Number(match[1]) * (match[2] ? scale[match[2].toLowerCase()] : 1)
}

/** Join `+` continuation lines so every element is one logical line. */
function logicalLines(deck: string): string[] {
  const lines: string[] = []
  for (const line of deck.split(/\r?\n/)) {
    if (/^\+/.test(line) && lines.length) lines[lines.length - 1] += ' ' + line.slice(1)
    else lines.push(line)
  }
  return lines
}

/** ngspice `.options klu reltol abstol vntol method maxord` -> Xyce option packages. */
function xyceOptions(line: string): string[] {
  const values = new Map<string, string>()
  for (const token of line.trim().split(/\s+/).slice(1)) {
    const [key, value] = token.split('=')
    values.set(key.toLowerCase(), value ?? '')
  }
  const known = new Set(['klu', 'reltol', 'abstol', 'vntol', 'method', 'maxord'])
  const unknown = [...values.keys()].filter(key => !known.has(key))
  if (unknown.length) throw new Error(`Untranslated ngspice options: ${unknown.join(', ')}`)
  const timeint = ['.options timeint']
  if (values.has('method')) timeint.push(`method=${values.get('method')}`)
  if (values.has('maxord')) timeint.push(`maxord=${values.get('maxord')}`)
  if (values.has('reltol')) timeint.push(`reltol=${values.get('reltol')}`)
  // Xyce has one absolute LTE tolerance for every unknown; use the voltage tolerance.
  if (values.has('vntol')) timeint.push(`abstol=${values.get('vntol')}`)
  return [timeint.join(' '), values.has('klu') ? '.options linsol type=klu' : '* default linear solver']
}

/**
 * Exact sparse replacement for coupled inductors: V_i = L_i dI_i/dt + sum_j (M_ij / L_j) V(L_j),
 * where V(L_j) is the voltage across inductor j's self part. One linear VCVS per mutual term.
 */
function mutualChains(scope: Scope, lines: (string | undefined)[]): void {
  const terms = new Map<string, { other: string; henries: number }[]>()
  for (const coupling of scope.couplings) {
    const first = scope.inductors.get(coupling.first)
    const second = scope.inductors.get(coupling.second)
    if (!first || !second) throw new Error(`K references unknown inductor ${coupling.first}/${coupling.second}`)
    const mutual = coupling.factor * Math.sqrt(first.henries * second.henries)
    for (const [a, b] of [[first, second], [second, first]]) {
      const list = terms.get(a.name) ?? []
      list.push({ other: b.name, henries: mutual })
      terms.set(a.name, list)
    }
  }
  /** Node after the self part of inductor `name`. */
  const self = (name: string): string => `xm_${name}`
  for (const [name, list] of terms) {
    const inductor = scope.inductors.get(name)!
    const chain = [`${inductor.name} ${inductor.from} ${self(name)} ${inductor.henries}`]
    let node = self(name)
    for (const [index, term] of list.entries()) {
      const other = scope.inductors.get(term.other)!
      const next = index === list.length - 1 ? inductor.to : `xm_${name}_${index}`
      chain.push(`exm_${name}_${index} ${node} ${next} ${other.from} ${self(other.name)} ${Number((term.henries / other.henries).toPrecision(12))}`)
      node = next
    }
    lines[inductor.line] = chain.join('\n')
  }
}

/** Translate one routed ngspice deck to an equivalent Xyce deck. */
export function xyceDeck(deck: string, options: XyceOptions): string {
  const source = logicalLines(deck)
  const lines: (string | undefined)[] = []
  const scopes: Scope[] = []
  const top: Scope = { inductors: new Map(), couplings: [] }
  let scope = top
  let saved: string[] = []
  scopes.push(top)
  for (const [index, line] of source.entries()) {
    const trimmed = line.trim()
    const head = trimmed.split(/\s+/, 1)[0].toLowerCase()
    if (index === 0) {
      lines.push(line)
      continue
    }
    if (head === '.subckt') {
      scope = { inductors: new Map(), couplings: [] }
      scopes.push(scope)
      lines.push(line)
    } else if (head === '.ends') {
      scope = top
      lines.push(line)
    } else if (head === '.options' || head === '.option') {
      lines.push(xyceOptions(trimmed).join('\n'))
    } else if (head === '.save') {
      // Xyce .SAVE writes operating points; probes become .print. Branch-current saves only fed ngspice B dependencies.
      saved = trimmed.split(/\s+/).slice(1).filter(vector => /^v\(/i.test(vector))
      lines.push(undefined)
    } else if (head === '.tran') {
      const tokens = trimmed.split(/\s+/)
      const step = options.stepSeconds ?? spiceValue(tokens[1])
      const stop = options.stopSeconds ?? spiceValue(tokens[2])
      const ceiling = options.stepSeconds ?? (tokens[4] ? spiceValue(tokens[4]) : step)
      lines.push(`.tran ${step} ${stop} 0 ${ceiling}`)
    } else if (head === '.end') {
      if (!saved.length) throw new Error('Deck has no saved voltage probes')
      lines.push(`.print tran format=csv file=${options.printFile} ${saved.join(' ')}`, '.end')
    } else if (/^b/i.test(head)) {
      // ngspice pwl(x, x0,y0, ...) extrapolates; the emitted argument is already clamped to the table, where Xyce table() holds the end values.
      lines.push(line.replace(/\bpwl\s*\(/gi, 'table('))
    } else if (/^l/i.test(head)) {
      const [name, from, to, value] = trimmed.split(/\s+/)
      scope.inductors.set(name.toLowerCase(), { line: lines.length, name: name.toLowerCase(), from, to, henries: spiceValue(value) })
      lines.push(line)
    } else if (/^k/i.test(head) && !options.nativeMutual) {
      const [, first, second, factor] = trimmed.split(/\s+/)
      scope.couplings.push({ first: first.toLowerCase(), second: second.toLowerCase(), factor: spiceValue(factor) })
      lines.push(undefined)
    } else if (head.startsWith('.') && !['.subckt', '.ends', '.tran', '.end', '.ic'].includes(head)) {
      throw new Error(`Untranslated control line: ${head}`)
    } else lines.push(line)
  }
  if (!options.nativeMutual) for (const entry of scopes) mutualChains(entry, lines)
  return lines.filter(line => line !== undefined).join('\n') + '\n'
}

/** CLI value for `--name <value>`. */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: bun scripts/xyce-deck.ts <in.cir> <out.cir> [--stop s] [--step s] [--native-mutual] [--print file]')
  const stop = argument('--stop')
  const step = argument('--step')
  const deck = xyceDeck(await readFile(input, 'utf8'), {
    nativeMutual: process.argv.includes('--native-mutual'),
    stopSeconds: stop === undefined ? undefined : Number(stop),
    stepSeconds: step === undefined ? undefined : Number(step),
    printFile: argument('--print') ?? 'waveform.csv',
  })
  await writeFile(output, deck)
}
