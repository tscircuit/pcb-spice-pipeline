import { Simulation, type ResultType } from 'eecircuit-engine'
import { formatSpiceVectors } from '../../observation'
import type { SolverResult } from '../../solver'
import { fail } from '../diagnostics'

/** Admit only finite, complete transient API vectors, preserving ngspice diagnostics. */
export function spiceEngineResult(result: ResultType, duration: number, stdout: string, stderr: string): SolverResult {
  const diagnostic = (stdout + '\n' + stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|timestep too small)\b/i.test(line))
  if (diagnostic) fail('native_solver', `WASM ngspice: ${diagnostic.trim()}`)
  if (result.dataType !== 'real') return fail('native_solver', 'Expected real transient engine vectors')
  const times = result.data.find(vector => vector.name.toLowerCase() === 'time')?.values
  if (!times || times.length !== result.numPoints || times[0] !== 0 || times.some((time, i) => !Number.isFinite(time) || i > 0 && time < times[i - 1]) || Math.abs(times.at(-1)! - duration) > duration * 1e-8)
    fail('native_solver', `WASM ngspice did not complete ${duration} s; final time ${times?.at(-1)} s`)
  return { stdout, stderr, files: { 'waveform.raw': formatSpiceVectors(result.data) } }
}

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
    return spiceEngineResult(result, duration, engine.getInfo(), engine.getError().join('\n'))
  } catch (error) {
    fail('native_solver', `${String(error)}\n${engine.getInfo()}\n${engine.getError().join('\n')}`)
  }
}
