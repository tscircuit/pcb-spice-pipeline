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
