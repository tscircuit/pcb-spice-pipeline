import type { PackageModel } from './package-model'

export interface SelectedPackageModel {
  pins: string[]; unusedPins: string[]; R: number[][]; L: number[][]; C: number[][]
  selfTerms: { R: number[]; L: number[]; C: number[] }
  capacitanceSignCorrection?: { packageModel: string; negatedEntries: number }
}

/** Scale-normalized LDL factorization: L/C must be definite, R may be semidefinite. */
function checkPositive(matrix: number[][], label: string, strict: boolean): void {
  const size = matrix.length
  if (matrix.some(row => row.length !== size || row.some(value => !Number.isFinite(value)))) throw new Error(`${label}: finite square matrix required`)
  if (matrix.some((row, i) => row[i] < 0)) throw new Error(`${label}: negative diagonal; matrix is not positive ${strict ? 'definite' : 'semidefinite'}`)
  const scale = Math.max(...matrix.map((row, i) => Math.abs(row[i])))
  const work = matrix.map(row => row.map(value => value / (scale || 1)))
  const tolerance = 1e-12
  for (let k = 0; k < size; k++) {
    const pivot = work[k][k]
    if (pivot < -tolerance || (strict && pivot <= tolerance) || (!strict && pivot <= tolerance && work.slice(k + 1).some(row => Math.abs(row[k]) > tolerance))) {
      throw new Error(`${label}: matrix is not positive ${strict ? 'definite' : 'semidefinite'} at pivot ${k + 1}; passive package required`)
    }
    if (pivot <= tolerance) continue
    for (let i = k + 1; i < size; i++) for (let j = i; j < size; j++) {
      work[j][i] = work[i][j] -= work[i][k] * work[j][k] / pivot
    }
  }
}

/** Reject sign conventions that cannot be realized with passive pair/reference capacitors. */
function checkCapacitance(matrix: number[][], label: string): void {
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].some((value, j) => i !== j && value > 0)) throw new Error(`${label}: Maxwell capacitance has positive off-diagonal entries; correction requires uniformly positive couplings and diagonally dominant rows`)
    if (matrix[i].reduce((sum, value) => sum + value, 0) < 0) throw new Error(`${label}: negative reference capacitance (Maxwell row sum)`)
  }
}

/**
 * Open unused series leads (zero current) select principal R/L. Float unused
 * electrostatic conductors (zero incremental charge) by Schur reduction of C.
 * External loads, switching and resonant circulating currents on unused pins are neglected.
 */
export function selectPackageModel(model: PackageModel, pins: string[]): SelectedPackageModel {
  if (new Set(pins).size !== pins.length) throw new Error(`${model.name}: distinct selected package pins required`)
  const indices = pins.map(pin => {
    const index = model.pins.indexOf(pin)
    if (index < 0) throw new Error(`${model.name}: selected package pin ${pin} missing from [Pin Numbers]; scalar fallback is forbidden`)
    return index
  })
  checkPositive(model.R, `${model.name} resistance`, false)
  checkPositive(model.L, `${model.name} inductance`, true)
  const offDiagonal = model.C.flatMap((row, i) => row.filter((value, j) => i !== j && value !== 0))
  const correct = offDiagonal.length > 0 && offDiagonal.every(value => value > 0) && model.C.every((row, i) => row[i] >= row.reduce((sum, value, j) => sum + (i === j ? 0 : Math.abs(value)), 0))
  const C = model.C.map((row, i) => row.map((value, j) => correct && i !== j && value !== 0 ? -value : value))
  checkPositive(C, `${model.name} capacitance`, true)
  checkCapacitance(C, model.name)
  const unused = model.pins.map((_, i) => i).filter(i => !indices.includes(i))
  const work = C.map(row => [...row])
  let active = model.pins.map((_, i) => i)
  for (const k of unused) {
    active = active.filter(i => i !== k)
    for (const i of active) for (const j of active) work[i][j] -= work[i][k] * work[k][j] / work[k][k]
  }
  const selected = { pins, unusedPins: unused.map(i => model.pins[i]), R: indices.map(i => indices.map(j => model.R[i][j])), L: indices.map(i => indices.map(j => model.L[i][j])), C: indices.map(i => indices.map(j => work[i][j])),
    selfTerms: { R: indices.map(i => model.R[i][i]), L: indices.map(i => model.L[i][i]), C: indices.map(i => model.C[i][i]) } }
  checkPositive(selected.L, `${model.name} extracted inductance`, true)
  checkPositive(selected.C, `${model.name} extracted capacitance`, true)
  checkCapacitance(selected.C, `${model.name} extracted`)
  return { ...selected, ...(correct ? { capacitanceSignCorrection: { packageModel: model.name, negatedEntries: offDiagonal.length } } : {}) }
}
