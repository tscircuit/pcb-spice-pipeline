// Coupled RLGC pi-section subcircuit text.
import { fail } from './diagnostics'
import { validateMatrix, validateCapacitance } from './checks'
import { scale, sum, type Matrix } from './linalg'

/** One stage's loop matrices (spice.ts called this `ChannelMatrices`). */
export interface StageMatrices { R: Matrix; L: Matrix; C: Matrix }

/** Formats a value with 12 significant digits so the netlist text is stable across runs. */
const num = (value: number): string => Number(value.toPrecision(12)).toString()

/** Writes the RLGC channel as a SPICE subcircuit: each stage is split into equal pi sections with coupled R, L and C between signals. */
export function channelSpice(extracted: readonly StageMatrices[], sections: number, taps: { conductor: number; fraction: number; name: string }[] = [], reciprocityTolerance: number = 0.025): string {
  if (!Number.isInteger(sections) || sections < 1 || sections > 128) fail('sections', 'sections must be an integer 1..128')
  if (!extracted.length || !extracted[0].R.length) fail('matrix_dimension', 'At least one extracted channel stage is required')
  const n = extracted[0].R.length
  if (taps.some(tap => !Number.isInteger(tap.conductor) || tap.conductor < 0 || tap.conductor >= n || !(tap.fraction > 0 && tap.fraction < 1) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(tap.name)) || (taps.length && extracted.length !== 1)) fail('sections', 'Internal taps require one stage, a valid conductor, a fraction strictly between 0 and 1, and a safe node name')
  for (const [stage, matrices] of extracted.entries()) {
    for (const kind of ['R', 'L', 'C'] as const) {
      if (matrices[kind].length !== n) fail('matrix_dimension', `Stage ${stage} ${kind}: channel dimensions disagree`)
      if (kind === 'C') validateCapacitance(matrices.C, reciprocityTolerance)
      else validateMatrix(matrices[kind], `Stage ${stage} ${kind}`, 1e-10)
    }
    if (matrices.C.some((row, i) => row.some((entry, j) => i !== j && entry > 0) || sum(row) <= 0)) {
      fail('capacitance_sign', `Stage ${stage}: referenced Maxwell C requires nonpositive mutual and positive shunt capacitance`)
    }
  }
  const inputs = Array.from({ length: n }, (_, i) => `IN${i}`)
  const outputs = Array.from({ length: n }, (_, i) => `OUT${i}`)
  const lines = ['* Constant-frequency matrix pi channel; explicit reference terminal', `.subckt CHANNEL ${[...inputs, ...outputs, ...taps.map(tap => tap.name), 'REF'].join(' ')}`]
  const cuts = [...new Set([...Array.from({ length: sections + 1 }, (_, i) => i / sections), ...taps.map(tap => tap.fraction)])].sort((a, b) => a - b)
  let global = 0
  for (const [stage, e] of extracted.entries()) for (let section = 0; section < cuts.length - 1; section++) {
    const g = global++
    const R: Matrix = scale(e.R, cuts[section + 1] - cuts[section])
    const L: Matrix = scale(e.L, cuts[section + 1] - cuts[section])
    const C: Matrix = scale(e.C, cuts[section + 1] - cuts[section])
    const first = g === 0
    const last = stage === extracted.length - 1 && section === cuts.length - 2
    const before = inputs.map((input, i) => first ? input : taps.find(tap => tap.conductor === i && tap.fraction === cuts[section])?.name ?? `N${g}_${i}`)
    const after = outputs.map((output, i) => last ? output : taps.find(tap => tap.conductor === i && tap.fraction === cuts[section + 1])?.name ?? `N${g + 1}_${i}`)
    for (let i = 0; i < n; i++) {
      lines.push(`VS${g}_${i} ${before[i]} S${g}_${i} 0`, `R${g}_${i} S${g}_${i} R${g}_${i} ${num(R[i][i])}`)
      // The shared return contributes cross resistance R_ij * I_j as well as mutual inductance.
      if (n > 1) lines.push(`E${g}_${i} R${g}_${i} L${g}_${i} value={${R[i].flatMap((r, j) => j === i ? [] : [`${num(r)}*i(VS${g}_${j})`]).join('+')}}`)
      lines.push(`L${g}_${i} ${n > 1 ? `L${g}_${i}` : `R${g}_${i}`} ${after[i]} ${num(L[i][i])}`)
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) lines.push(`K${g}_${i}_${j} L${g}_${i} L${g}_${j} ${num(L[i][j] / Math.sqrt(L[i][i] * L[j][j]))}`)
    for (const [label, nodes] of [['a', before], ['b', after]] as const) {
      if (C.some((row, i) => row.some((value, j) => value !== C[j][i]))) {
        // Sense each diagonal capacitor current and copy C_ij/C_jj into row i.
        // This realizes I=C*dV/dt exactly, retaining both raw mutual entries.
        for (let j = 0; j < n; j++) {
          const sense = `VC${g}${label}${j}`
          const node = `CS${g}${label}${j}`
          lines.push(`${sense} ${nodes[j]} ${node} 0`, `CG${g}${label}${j} ${node} REF ${num(C[j][j] / 2)}`)
          for (let i = 0; i < n; i++) if (i !== j && C[i][j]) lines.push(`FC${g}${label}${i}_${j} ${nodes[i]} REF ${sense} ${num(C[i][j] / C[j][j])}`)
        }
        continue
      }
      for (let i = 0; i < n; i++) lines.push(`CG${g}${label}${i} ${nodes[i]} REF ${num(sum(C[i]) / 2)}`)
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (C[i][j] < 0) lines.push(`CM${g}${label}${i}_${j} ${nodes[i]} ${nodes[j]} ${num(-C[i][j] / 2)}`)
    }
  }
  lines.push('.ends CHANNEL')
  return lines.join('\n') + '\n'
}
