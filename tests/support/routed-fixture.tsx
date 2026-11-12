import React from 'react'
import { readFile } from 'node:fs/promises'
import type { TestContext } from 'node:test'
import { channelCopperScope, connectedSourceIds, type CircuitJson, type CopperScope } from '../../src/board'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import type { RoutedProblem } from '../../src/pipeline'
import { renderCoreSignals } from './core-render'

/** Real TSX geometry without vendor assets, for pure geometry and field checks. */
export async function routedCopper(): Promise<{ circuitJson: CircuitJson; scope: CopperScope }> {
  const circuitJson = await renderCoreSignals(<board width={12} height={8} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    {[['A', -4, 0], ['B', 4, 0], ['C', -4, .35], ['D', 4, .35]].map(([name, x, y]) => <chip key={name} name={String(name)} pcbX={Number(x)} pcbY={Number(y)} pinLabels={{ pin1: 'P' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" /></footprint>} />)}
    <trace from=".A > .P" to=".B > .P" width={.1} pcbPath={['.A > .P', '.B > .P']} />
    <trace from=".C > .P" to=".D > .P" width={.1} pcbPath={['.C > .P', '.D > .P']} />
    <net name="GND" /><copperpour connectsTo="net.GND" layer="bottom" unbroken />
  </board>)
  const trace = circuitJson.find(record => record.type === 'source_trace')!
  if (trace.type !== 'source_trace') throw new Error('Missing TSX trace')
  const ground = circuitJson.find(record => record.type === 'source_net')!
  if (ground.type !== 'source_net') throw new Error('Missing TSX ground')
  return { circuitJson, scope: channelCopperScope(circuitJson, connectedSourceIds(circuitJson, trace.connected_source_port_ids[0]), connectedSourceIds(circuitJson, ground.source_net_id), undefined, 1) }
}

/** Explicitly skip unavailable vendor assets; they are never replaced with synthetic native models. */
export async function routedProblem(context: TestContext, props: React.ComponentProps<typeof TwoTraceBoard> = {}): Promise<RoutedProblem | undefined> {
  if (!process.env.IBIS_MODEL_DIR) {
    context.skip('Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed')
    return
  }
  let bytes: Buffer
  try {
    bytes = await readFile(`${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    context.skip('Local vendor sn74lvc1g04.ibs is unavailable')
    return
  }
  return { circuitJson: await renderCoreSignals(<TwoTraceBoard {...props} />), ibisSources: { 'models/sn74lvc1g04.ibs': bytes.toString('utf8') }, scopeDistanceMm: 1 }
}
