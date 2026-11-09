import { rootScope, type Artifact } from '../kernel'
import { preparedBoard, channelGeometry, circuitArtifact } from '../board'
import { extractChannel } from '../extraction'
import { assertConverter, admitBuffers, compileBuffers, ibisAssembly } from '../buffers'
import {
  generalDeclarations, electricalSources, safeSimulationPlans, modelRunDefinition, bindExperiments, electricalNodeMap,
  runIdle, runExperiment, experimentResult,
} from '../simulation'
import { waveformConvergence } from '../observation'
import type { Chain, ObservedRun, Stage } from './state'

/** Private native stages; public RFC measurements are assembled after numerical acceptance. */
export const admit: Stage<'input', 'admitted'> = {
  name: 'admit', from: 'input', to: 'admitted',
  run: ({ options }) => {
    const modeling = options.modeling
    const board = preparedBoard(options.circuitJson)
    assertConverter()
    return {
      state: { phase: 'admitted', options, board, modeling },
      artifacts: [rootScope('pipeline').child('inputs').json('modeling.json', modeling), circuitArtifact(board, rootScope('board'))],
    }
  },
}

export const declare: Stage<'admitted', 'declared'> = {
  name: 'declare', from: 'admitted', to: 'declared',
  run: state => {
    const { board, modeling, options } = state
    const geometry = channelGeometry(board, modeling, rootScope('board'))
    const declarations = generalDeclarations(board.circuitJson, geometry.value, modeling)
    const electrical = electricalSources(board.circuitJson, modeling, declarations.nodes)
    const plans = safeSimulationPlans(declarations.plans)
    const buffers = admitBuffers(declarations.models, options.ibisSources, modeling, rootScope('buffers'))
    return {
      state: { ...state, phase: 'declared', geometry: geometry.value, experiments: { ...declarations, electrical }, plans, buffers: buffers.value },
      artifacts: [...buffers.artifacts, ...geometry.artifacts, electricalNodeMap(declarations.nodes, electrical, rootScope('simulation'))],
    }
  },
}

export const bind: Stage<'declared', 'bound'> = {
  name: 'bind', from: 'declared', to: 'bound',
  run: state => {
    const compiled = compileBuffers(state.buffers, state.experiments.plans, modelRunDefinition)
    const bound = bindExperiments(state.experiments, state.geometry, compiled)
    return { state: { ...state, phase: 'bound', compiled, bound }, artifacts: [] }
  },
}

export const extract: Stage<'bound', 'extracted'> = {
  name: 'extract', from: 'bound', to: 'extracted',
  run: async (state, ctx) => {
    const channel = await extractChannel(state.geometry, state.modeling, rootScope('extraction'), ctx)
    return { state: { ...state, phase: 'extracted', channel: channel.value }, artifacts: channel.artifacts }
  },
}

/** Large adaptive waveforms are retained for the accepted run; refinement history keeps hashes and native requests. */
const waveformArtifact = (artifact: Artifact): boolean => /(?:^|\/)waveform\.(?:dat|csv|json)$/.test(artifact.path)

export const simulate: Stage<'extracted', 'simulated'> = {
  name: 'simulate', from: 'extracted', to: 'simulated',
  run: async (state, ctx) => {
    const runs: ObservedRun[] = []
    const artifacts: Artifact[] = []
    for (const [index, plan] of state.plans.entries()) {
      const base = rootScope('simulation').child('experiments', plan.simulationExperimentId)
      let scope = base
      let assembly = ibisAssembly(state.compiled[index], scope.handTo('buffers'))
      const idlePlan = { ...plan, stimuli: plan.stimuli.map(stimulus => ({ ...stimulus, initial_state: Number(stimulus.transmission_pattern.bits[0]) as 0 | 1,
        transmission_pattern: { ...stimulus.transmission_pattern, bits: stimulus.transmission_pattern.bits[0] } })) }
      const idleModels = compileBuffers(state.buffers, [idlePlan], modelRunDefinition)
      const idleBound = { ...state.bound, plans: [idlePlan], compiled: idleModels }
      const idle = await runIdle(ctx, base.child('undisturbed-idle'), idleBound, 0, state.geometry, state.modeling, state.channel.matrices)
      artifacts.push(...idle.artifacts)
      let run = await runExperiment(ctx, scope, state.bound, index, state.geometry, state.modeling, state.channel.matrices)
      artifacts.push(...assembly.artifacts, ...run.artifacts.filter(artifact => !waveformArtifact(artifact)))
      const convergence: unknown[] = []
      const settled = { time: false, space: false }
      const gate = state.modeling.measurementGate ?? 0
      let accepted = false
      for (let refinement = 1; refinement <= 10; refinement++) {
        const previous = run
        const dimension = refinement % 2 ? 'time' : 'space'
        if (dimension === 'time') plan.maxStepSeconds /= 2
        else {
          if (state.modeling.sections === 128) throw Object.assign(new Error(`${plan.name}: section refinement reached 128 before convergence`), { convergence })
          state.modeling.sections = Math.min(128, state.modeling.sections * 2)
        }
        scope = base.child(`numerical-refinement-${refinement}`)
        assembly = ibisAssembly(state.compiled[index], scope.handTo('buffers'))
        run = await runExperiment(ctx, scope, state.bound, index, state.geometry, state.modeling, state.channel.matrices).catch(error => {
          throw Object.assign(error, { convergence })
        })
        artifacts.push(...assembly.artifacts, ...run.artifacts.filter(artifact => !waveformArtifact(artifact)))
        const check = waveformConvergence(previous.value.rows, run.value.rows, gate, idle.value.voltages)
        settled[dimension] = check.accepted
        if (!check.accepted) settled[dimension === 'time' ? 'space' : 'time'] = false
        convergence.push({ previous_waveform_csv_sha256: previous.value.waveformCsvSha256, waveform_csv_sha256: run.value.waveformCsvSha256, dimension, sections: state.modeling.sections, step_s: plan.maxStepSeconds, ...check })
        ctx.progress(`${plan.name}: sections=${state.modeling.sections}, step=${plan.maxStepSeconds}, peaks=${check.probes.map(p => p.peak_change_v).join(',')}, accepted=${check.accepted}`)
        if (settled.time && settled.space) {
          accepted = true
          break
        }
      }
      if (!accepted) throw Object.assign(new Error(`${plan.name}: sections/timestep and per-probe signed peaks did not converge within 1% + 1 mV after ten independent refinements`), { convergence })
      artifacts.push(...run.artifacts.filter(waveformArtifact))
      artifacts.push(base.json('numerical-convergence.json', { definition: 'Independent section and timestep refinements; per-probe time-weighted RMS over all native timestamps and both signed idle-relative extrema must converge', relative_tolerance: .01, absolute_tolerance_v: .001, checks: convergence }))
      runs.push({ run: run.value, assembly: assembly.value, solverInvocations: convergence.length + 1 + idle.value.solverInvocations, idleVoltages: idle.value.voltages })
    }
    return { state: { ...state, phase: 'simulated', runs }, artifacts }
  },
}

export const observe: Stage<'simulated', 'observed'> = {
  name: 'observe', from: 'simulated', to: 'observed',
  run: state => {
    const experimentResults = state.runs.map(({ run, assembly, solverInvocations }) => ({ ...experimentResult(run, assembly), solverInvocations }))
    return { state: { ...state, phase: 'observed', experimentResults }, artifacts: [] }
  },
}

export const seal: Stage<'observed', 'sealed'> = {
  name: 'seal', from: 'observed', to: 'sealed',
  run: state => {
    const limitations = [...state.geometry.approximations, ...state.compiled.flatMap(models => models.flatMap(model => model.warnings ?? [])),
      'Only selected channel components/passives and explicit ideal source rails are simulated; unrelated board electronics excluded',
      'Finite observed transient eyes; no implicit traffic, random jitter, BER extrapolation, protocol compliance or hardware accuracy claim',
      'Maximum solver integration step and display resolution are separate settings']
    return {
      state: { phase: 'sealed', result: {
        circuitJson: state.options.circuitJson, modeling: state.modeling,
        idleVoltages: state.runs[0]?.idleVoltages, geometry: state.geometry, matrices: state.channel.matrices, experiments: state.experimentResults, limitations,
      } },
      artifacts: [],
    }
  },
}

const stages = [admit, declare, bind, extract, simulate, observe, seal] as const
/** Compile error if a stage is missing, duplicated or out of order. */
export const STAGES: Chain<typeof stages> = stages
