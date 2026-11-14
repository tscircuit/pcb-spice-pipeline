import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPackageModel } from '../../src/buffers/package-matrix'
import type { PackageModel } from '../../src/buffers/package-model'

test('open unused leads retain principal R/L and floating-charge capacitance, with passive extracted matrices', () => {
  const model: PackageModel = { name: 'fixture', manufacturer: 'test', oem: 'test', description: 'test', pins: ['B', 'unused', 'A'],
    R: [[1, .1, -.2], [.1, 2, 0], [-.2, 0, 3]], L: [[4e-9, 1e-9, -5e-10], [1e-9, 3e-9, 0], [-5e-10, 0, 2e-9]],
    C: [[3e-12, -1e-12, -5e-13], [-1e-12, 2e-12, -5e-13], [-5e-13, -5e-13, 4e-12]] }
  const selected = selectPackageModel(model, ['A', 'B'])
  assert.deepEqual(selected.pins, ['A', 'B'])
  assert.deepEqual(selected.R, [[3, -.2], [-.2, 1]])
  assert.deepEqual(selected.L, [[2e-9, -5e-10], [-5e-10, 4e-9]])
  assert.ok(Math.abs(selected.C[0][0] - 3.875e-12) < 1e-26)
  assert.ok(Math.abs(selected.C[1][1] - 2.5e-12) < 1e-26)
  assert.ok(Math.abs(selected.C[0][1] + .75e-12) < 1e-26)
  assert.deepEqual(selected.unusedPins, ['unused'])
  assert.equal(selected.selfTerms.C[0], 4e-12, 'metadata retains original self C before floating reduction')
  assert.throws(() => selectPackageModel(model, ['A', 'VSS']), /VSS.*missing.*scalar fallback is forbidden/)
  for (const field of ['L', 'C'] as const) {
    assert.throws(() => selectPackageModel({ ...model, [field]: [[1, 2, 0], [2, 1, 0], [0, 0, 1]] }, model.pins), /positive definite|Maxwell/)
    assert.throws(() => selectPackageModel({ ...model, [field]: [[1, -1, 0], [-1, 1, 0], [0, 0, 1]] }, model.pins), /positive definite/)
    assert.throws(() => selectPackageModel({ ...model, [field]: [[1, 0, 0], [0, 1, 2], [0, 2, 1]] }, ['B']), /positive definite|Maxwell/, 'invalid unused blocks cannot disappear during reduction')
  }
  assert.throws(() => selectPackageModel({ ...model, C: [[1, .1, -.1], [.1, 1, 0], [-.1, 0, 1]] }, model.pins), /Maxwell.*positive off-diagonal/)
  assert.throws(() => selectPackageModel({ ...model, C: [[1, -2, 0], [-2, 5, 0], [0, 0, 1]] }, model.pins), /reference capacitance/)
  assert.throws(() => selectPackageModel({ ...model, R: [[1, 2, 0], [2, 1, 0], [0, 0, 1]] }, model.pins), /resistance.*positive semidefinite/)
  assert.doesNotThrow(() => selectPackageModel({ ...model, R: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] }, model.pins))
  assert.doesNotThrow(() => selectPackageModel({ ...model, R: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] }, model.pins), 'rank-deficient passive resistance is supported')
})

import { parsePackageModel } from '../../src/buffers/package-model'
import { energyFacts, maxwellFacts, vendorText } from '../support/golden-checks'

test('golden invariants: AM335x vendor package L, C are SPD with |k| < 1 and C is Maxwell after sign correction', async context => {
  // A passive reciprocal lumped package (IBIS 7.x [Define Package Model]; Paul, Inductance: Loop and Partial, ch. 5):
  // L and C symmetric positive definite, every |k| = |M_ij|/sqrt(L_ii L_jj) < 1; R PSD; the Maxwell C has positive
  // diagonal, non-positive off-diagonal entries and non-negative row sums. Tolerances are floating point only.
  const text = await vendorText(context, 'sprm552c.ibs')
  if (!text) return
  const model = parsePackageModel(text, 'am335x_zcz')
  const selected = selectPackageModel(model, model.pins)
  const L = energyFacts(model.L)
  const C = energyFacts(selected.C)
  const R = energyFacts(model.R)
  const maxwell = maxwellFacts(selected.C)
  const self = model.L.map((row, i) => row[i])
  const mutual = model.L.map((row, i) => row.reduce((sum, value, j) => sum + (i === j ? 0 : Math.abs(value)), 0))
  const positiveRaw = model.C.flat().filter((value, index) => index % (model.pins.length + 1) !== 0 && value > 0).length
  context.diagnostic(JSON.stringify({ pins: model.pins.length, L, C, R, maxwell, rawPositiveOffDiagonalC: positiveRaw, signCorrection: selected.capacitanceSignCorrection,
    selfLnH: [Math.min(...self) * 1e9, Math.max(...self) * 1e9], summedMutualLnH: [Math.min(...mutual) * 1e9, Math.max(...mutual) * 1e9], largestKPins: L.pair.map(i => model.pins[i]) }))
  assert.ok(L.asymmetry <= 1e-12 && L.minimumEigenvalue > 0 && L.coupling < 1, `L: ${JSON.stringify(L)}`)
  assert.ok(C.asymmetry <= 1e-12 && C.minimumEigenvalue > 0 && C.coupling < 1, `C: ${JSON.stringify(C)}`)
  assert.ok(R.minimumEigenvalue >= -1e-12 * R.maximumEigenvalue, `R: ${JSON.stringify(R)}`)
  assert.ok(maxwell.minimumDiagonal > 0 && maxwell.maximumOffDiagonal <= 0 && maxwell.minimumRowSum >= -1e-9, `Maxwell: ${JSON.stringify(maxwell)}`)
})
