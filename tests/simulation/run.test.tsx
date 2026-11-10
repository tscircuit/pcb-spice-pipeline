import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Single from '../support/unit-single-ended'
import { renderSignals } from '../support/signal-render'
import { prepareBlocks } from '../../src/pipeline/signals'
import { geometryFromCircuitJson } from '../../src/board'
import { admitBuffers, compileBuffers } from '../../src/buffers'
import { generalDeclarations, electricalSources, modelRunDefinition, bindExperiments, runExperiment } from '../../src/simulation'
import { rootScope } from '../../src/kernel'

const modelDir = process.env.IBIS_MODEL_DIR

test('native transient admission rejects error logs and incomplete recording coverage', { skip: !modelDir }, async () => {
  const ibis = { 'models/sn74lvc1g04.ibs': await readFile(`${modelDir}/sn74lvc1g04.ibs`) }
  const [prepared] = prepareBlocks(await renderSignals(<Single />), ibis)
  const geometry = geometryFromCircuitJson(prepared.circuit, prepared.settings)
  const declarations = generalDeclarations(prepared.circuit, geometry, prepared.settings)
  const admitted = admitBuffers(declarations.models, ibis, {}, rootScope('buffers'))
  const compiled = compileBuffers(admitted.value, declarations.plans, modelRunDefinition)
  const bound = bindExperiments({ ...declarations, electrical: electricalSources(prepared.circuit, prepared.settings, declarations.nodes) }, geometry, compiled)
  for (const [code, start, end, stdout] of [
    ['native_solver', 0, prepared.duration, 'Error: transient aborted'],
    ['simulation_start', prepared.duration / 2, prepared.duration, ''],
    ['simulation_duration', 0, prepared.duration / 2, ''],
  ] as const) {
    /**
     *
     */
    const runSolver = async (): Promise<{ stdout: string; stderr: string; files: Record<string, string> }> => ({ stdout, stderr: '', files: { 'waveform.dat': `time probe0\n${start} 0\n${end} 1\n` } })
    await assert.rejects(runExperiment({ runSolver, progress: () => {} }, rootScope('simulation'), bound, 0, geometry, prepared.settings, [{ R: [[1]], L: [[1e-9]], C: [[1e-12]] }]), { code })
  }
})
