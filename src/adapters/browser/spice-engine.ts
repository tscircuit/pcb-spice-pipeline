import { Simulation } from 'eecircuit-engine'
import { formatSpiceVectors, spiceProbeRows } from '../../observation'
import type { SolverResult } from '../../solver'
import { fail } from '../diagnostics'

/** The production worker calls this same engine path exercised by the opt-in Node parity test. */
export async function runSpiceEngine(deck: string, progress: (message: string) => void = (): void => undefined): Promise<SolverResult> {
  const duration = Number(/^\.tran\s+\S+\s+(\S+)/mi.exec(deck)?.[1])
  if (!Number.isFinite(duration) || duration <= 0 || /^\.control\b/mi.test(deck)) fail('native_solver', 'Expected a declarative routed .tran deck')
  const engine = new Simulation()
  progress('Initializing ngspice WASM')
  await engine.start()
  try {
    engine.setNetList(deck)
    progress('Running ngspice transient')
    const result = await engine.runSim()
    const stdout = engine.getInfo()
    const stderr = engine.getError().join('\n')
    const diagnostic = (stdout + '\n' + stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
    if (diagnostic) fail('native_solver', `WASM ngspice: ${diagnostic.trim()}`)
    if (result.dataType !== 'real') fail('native_solver', 'Expected real transient engine vectors')
    const text = formatSpiceVectors(result.data)
    const times = spiceProbeRows(text, []).map(row => row[0])
    if (times[0] !== 0 || Math.abs(times.at(-1)! - duration) > duration * 1e-8) fail('native_solver', `WASM ngspice did not complete ${duration} s; final time ${times.at(-1)} s`)
    return { stdout, stderr, files: { 'waveform.raw': text } }
  } catch (error) {
    fail('native_solver', `${String(error)}\n${engine.getInfo()}\n${engine.getError().join('\n')}`)
  }
}
