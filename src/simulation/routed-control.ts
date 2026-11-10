import type { SimulationPlan } from './types'

/** Periodic stop/resume checkpoints preserve native state and allow bounded runtime projections. */
export function routedControl(probes: SimulationPlan['probes'], saved: string, step: number, duration: number): string[] {
  const cuts: number[] = [Math.min(1e-12, duration / 4)]
  for (let time = 5e-10; time < duration - 1e-15; time += 5e-10) cuts.push(time)
  const lines = ['.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=17', `save ${saved}`, ...cuts.map(time => `stop when time = ${time}`)]
  for (const [index, time] of [...cuts, duration].entries()) {
    lines.push(index ? 'resume' : `tran ${step} ${duration} 0 ${step}`)
    for (const [i, probe] of probes.entries()) lines.push(`let probe${i} = v(${probe.signalNode})${probe.referenceNode === '0' ? '' : `-v(${probe.referenceNode})`}`)
    lines.push(`wrdata waveform.dat ${probes.map((_, i) => `probe${i}`).join(' ')}`, `echo SI_PROGRESS ${time}`)
  }
  return [...lines, 'quit', '.endc', '.end']
}
