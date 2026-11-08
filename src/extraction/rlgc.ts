import { numerics } from '../kernel'
import { fail } from './diagnostics'
import { validateMatrix } from './checks'
import { scale, sum, type Matrix } from './linalg'
import type { ExtractedStage } from './types'

export interface StageMatrices { R: Matrix; L: Matrix; C: Matrix }
/** Stable significant digits avoid platform-specific formatting noise. */
const num = (v: number): string => Number(v.toPrecision(numerics.netlistDigits)).toString()
/** Emits passive matrix R/L/K plus fitted RL and RC branches. Cell count is owned by extraction. */
export function channelSpice(extracted: readonly ExtractedStage[], lanes: number): string {
  if (!extracted.length || !Number.isInteger(lanes) || lanes < 1) fail('matrix_dimension', 'A nonempty channel with physical endpoints is required')
  for (const stage of extracted) {
    if (!Number.isInteger(stage.cells) || stage.cells < 1 || !Array.isArray(stage.ports) || stage.ports.length !== stage.R.length) fail('matrix_dimension', 'Each segment needs derived cells and a port for every conductor')
    for (const kind of ['R', 'L', 'C'] as const) {
      if (stage[kind].length !== stage.ports.length) fail('matrix_dimension', `${kind}: segment dimensions disagree`)
      validateMatrix(stage[kind], kind, numerics.matrixReciprocity)
    }
  }
  const lines = ['* Automatic coupled RLGC: 2D BEM; positive-real Foster skin/dielectric branches',
    `.subckt CHANNEL ${Array.from({ length: lanes }, (_, i) => `IN${i}`).concat(Array.from({ length: lanes }, (_, i) => `OUT${i}`), ['REF']).join(' ')}`]
  for (const e of extracted) for (let cell = 0; cell < e.cells; cell++) {
    const g = `S${e.stage}C${cell}`
    const n = e.R.length
    const before = e.ports.map((p, i) => cell === 0 ? p.from : `N${g}_${i}`)
    const after = e.ports.map((p, i) => cell === e.cells - 1 ? p.to : `NS${e.stage}C${cell + 1}_${i}`)
    const R = scale(e.R, 1 / e.cells)
    const L = scale(e.L, 1 / e.cells)
    const total = e.dielectric.fit.weights.reduce((s, w, i) => s + w / e.dielectric.fit.poles[i], 0)
    const C = e.C.map((row, i) => row.map((v, j) => (v - total * e.dielectric.matrix[i][j]) / e.cells))
    validateMatrix(C, 'instantaneous dielectric C', numerics.matrixReciprocity)
    for (let i = 0; i < n; i++) {
      lines.push(`VS${g}_${i} ${before[i]} I${g}_${i} 0`, `R${g}_${i} I${g}_${i} R${g}_${i} ${num(R[i][i])}`)
      let tail = `R${g}_${i}`
      for (let j = 0; j < n; j++) if (j !== i && R[i][j]) {
        const next = `H${g}_${i}_${j}`
        lines.push(`H${g}_${i}_${j} ${tail} ${next} VS${g}_${j} ${num(R[i][j])}`)
        tail = next
      }
      for (let b = 0; b < e.skin.fit.weights.length; b++) {
        const matrix = scale(e.skin.matrix, e.skin.fit.weights[b] / e.cells)
        if (!matrix.some(row => row.some(v => v !== 0))) continue
        const factor = validateMatrix(matrix, 'skin branch', numerics.matrixReciprocity).cholesky
        for (let mode = 0; mode < n; mode++) if (factor[i][mode]) {
          const next = `T${g}B${b}_${i}_${mode}`
          lines.push(`E${g}B${b}_${i}_${mode} ${tail} ${next} M${g}B${b}_${mode} REF ${num(factor[i][mode])}`)
          tail = next
        }
        if (i === 0) for (let mode = 0; mode < n; mode++) {
          lines.push(`RF${g}B${b}_${mode} M${g}B${b}_${mode} REF 1`, `LF${g}B${b}_${mode} M${g}B${b}_${mode} REF ${num(1 / e.skin.fit.poles[b])}`)
          for (let j = 0; j < n; j++) if (factor[j][mode]) lines.push(`FF${g}B${b}_${mode}_${j} REF M${g}B${b}_${mode} VS${g}_${j} ${num(factor[j][mode])}`)
        }
      }
      lines.push(`L${g}_${i} ${tail} ${after[i]} ${num(L[i][i])}`)
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (L[i][j]) lines.push(`K${g}_${i}_${j} L${g}_${i} L${g}_${j} ${num(L[i][j] / Math.sqrt(L[i][i] * L[j][j]))}`)
    for (const [side, nodes] of [['A', before], ['B', after]] as const) {
      /** Realizes a positive-definite shunt by an exact ideal-transformer congruence. */
      const modal = (matrix: Matrix, pole: number | undefined, branch: string): void => {
        if (!matrix.some(row=>row.some(v=>v!==0))) return
        const unit = Math.max(...matrix.map((row,i)=>row[i]))
        const factor = validateMatrix(scale(matrix,1/unit),'dielectric shunt',numerics.matrixReciprocity).cholesky
        for (let mode=0;mode<n;mode++) {
          const label = `${g}${side}${branch}_${mode}`
          const terms = nodes.map((node,i)=>({node,gain:factor[i][mode]})).filter(t=>t.gain!==0)
          for (let i=0;i<terms.length;i++) {
            const from = i ? `E${label}_${i}` : `M${label}`
            const to = i===terms.length-1 ? 'REF' : `E${label}_${i+1}`
            lines.push(`ED${label}_${i} ${from} ${to} ${terms[i].node} REF ${num(terms[i].gain)}`)
            lines.push(`FD${label}_${i} ${terms[i].node} REF VD${label} ${num(terms[i].gain)}`)
          }
          lines.push(`VD${label} M${label} D${label} 0`)
          if (pole!==undefined) lines.push(`RD${label} D${label} RC${label} ${num(1/unit)}`,`CD${label} RC${label} REF ${num(unit/pole)}`)
          else lines.push(`CD${label} D${label} REF ${num(unit)}`)
        }
      }
      const maxwell = C.every((row,i)=>sum(row)>=0 && row.every((v,j)=>i===j || v<=0))
      if (!maxwell) modal(scale(C,1/2),undefined,'C')
      else {
        const pairs: [number,number,number][] = C.map((row,i)=>[i,-1,sum(row)])
        for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) pairs.push([i,j,-C[i][j]])
        for (const [i,j,value] of pairs) if (value>0) lines.push(`C${g}${side}_${i}_${j<0?'G':j} ${nodes[i]} ${j<0?'REF':nodes[j]} ${num(value/2)}`)
      }
      e.dielectric.fit.weights.forEach((w,b)=>modal(scale(e.dielectric.matrix,w/(2*e.cells)),e.dielectric.fit.poles[b],`D${b}`))
    }
  }
  lines.push('.ends CHANNEL')
  return lines.join('\n') + '\n'
}
