import React from 'react'
import { simulation } from '@tscircuit/core'
import { readFile } from 'node:fs/promises'
import type { CircuitJson } from '../../src/board'
import { renderCoreSignals } from './core-render'

const cpu = ['M3', 'M4', 'N1', 'N2', 'N3', 'N4', 'P3', 'P4', 'M2', 'P1', 'P2']
const dram = ['F2', 'G2', 'E3', 'H3', 'F8', 'H7', 'F7', 'H8', 'E7', 'F3', 'G3']

/** Only declarations are retained from this TSX; every physical record comes from the full board. */
function Signals(): React.JSX.Element {
  return <board width={10} height={10} layers={8} fabricatorPreset="jlcpcb_standard" routingDisabled schematicDisabled>
    {([['U1', cpu, 'E5', 'A1', 'sprm552c.ibs', 'am335x_zcz'], ['U3', dram, 'A1', 'B1', 'W631GG6MB-12.ibs', 'W631GG6MB-12']] as const).map(([name, pins, power, ground, file, component]) => <React.Fragment key={name}>
      <chip name={name} pinLabels={Object.fromEntries([...pins, power, ground].map(pin => [pin, pin]))} footprint={<footprint>
        {[...pins, power, ground].map((pin, i) => <smtpad key={pin} portHints={[pin]} pcbX={i / 2} pcbY={0} width={.2} height={.2} shape="rect" />)}
      </footprint>} />
      <trace from={`.${name} > .${power}`} to="net.VDDQ" /><trace from={`.${name} > .${ground}`} to="net.GND" />
      <simulation.ibismodel componentRef={`.${name}`} ibisModelAsset={{ project_relative_path: `models/${file}`, url: `./models/${file}`, mimetype: 'text/plain' }}
        ibisComponentName={component} ibisPinNameToPortLabel={Object.fromEntries([...pins, power, ground].map(pin => [pin, pin]))}
        ibisPinNameToModelName={Object.fromEntries(pins.map((pin, i) => [pin, name === 'U3' ? 'ODT_off' : i === 9 ? 'Model_579' : i === 10 ? 'Model_771' : 'Model_257']))}
        ibisPinNameToReferencePortLabels={Object.fromEntries(pins.map(pin => [pin, { pullup: power, pulldown: ground, powerClamp: power, groundClamp: ground }]))} />
    </React.Fragment>)}
    {cpu.map((pin, i) => <trace key={pin} from={`.U1 > .${pin}`} to={`.U3 > .${dram[i]}`} />)}
    <differentialpair positiveConnection=".U1 > .P1" negativeConnection=".U1 > .P2" />
    <simulation.pcbtransientchannelsimulation name="DDR3_LOWER_WRITE" bitRate="800Mbps" allowUnroutedTraces>
      {cpu.slice(0, 9).map((pin, i) => <simulation.pcbchannel key={pin} name={i === 8 ? 'DQM0' : `DQ${i}`}
        driverRef={{ pin: `.U1 > .${pin}`, model: 'Model_257' }} receiverRef={{ pin: `.U3 > .${dram[i]}`, model: 'ODT_off' }} />)}
      <simulation.pcbchannel name="DQS0" driverRef={{ pin: { p: '.U1 > .P1', n: '.U1 > .P2' }, model: { p: 'Model_579', n: 'Model_771' } }}
        receiverRef={{ pin: { p: '.U3 > .F3', n: '.U3 > .G3' }, model: { p: 'ODT_off', n: 'ODT_off' } }} pattern="clock" offset="0.5UI" />
    </simulation.pcbtransientchannelsimulation>
  </board>
}

/** Append TSX-derived SI records without changing any source-board geometry, netlist or stackup. */
export async function fullBoardDdr3(path: string): Promise<CircuitJson> {
  const board: CircuitJson = JSON.parse(await readFile(path, 'utf8'))
  const declarations = await renderCoreSignals(<Signals />)
  const ids = new Map<string, string>()
  for (const component of declarations.filter(record => record.type === 'source_component')) {
    const actual = board.filter(record => record.type === 'source_component').find(record => record.name === component.name)
    if (!actual) throw new Error(`Full board is missing ${component.name}`)
    ids.set(component.source_component_id, actual.source_component_id)
    for (const port of declarations.filter(record => record.type === 'source_port' && record.source_component_id === component.source_component_id)) {
      const target = board.filter(record => record.type === 'source_port').find(record => record.source_component_id === actual.source_component_id && record.name === port.name)
      if (!target) throw new Error(`Full board is missing ${component.name}.${port.name}`)
      ids.set(port.source_port_id, target.source_port_id)
    }
  }
  /** Remap only declaration identities; never synthesize or transform physical copper. */
  function remap(value: unknown): unknown {
    if (typeof value === 'string') return ids.get(value) ?? value
    if (Array.isArray(value)) return value.map(remap)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remap(entry)]))
    return value
  }
  const scope = board.find(record => record.type === 'pcb_board')!.subcircuit_id
  const records = declarations.filter(record => ['simulation_signal_integrity', 'simulation_signal', 'simulation_ibis_model'].includes(record.type))
    .map(record => ({ ...remap(record) as CircuitJson[number], subcircuit_id: scope }))
  for (const record of records) if (record.type === 'simulation_signal_integrity') record.allow_unrouted_traces = false
  return [...board, ...records]
}
