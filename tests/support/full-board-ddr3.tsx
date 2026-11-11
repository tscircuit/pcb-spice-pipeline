import React from 'react'
import { simulation } from '@tscircuit/core'
import { readFile } from 'node:fs/promises'
import type { CircuitJson } from '../../src/board'
import { renderCoreSignals } from './core-render'

const cpu = ['M3', 'M4', 'N1', 'N2', 'N3', 'N4', 'P3', 'P4', 'M2', 'P1', 'P2']
const dram = ['F2', 'G2', 'E3', 'H3', 'F8', 'H7', 'F7', 'H8', 'E7', 'F3', 'G3']
export const addrCmdPins = [
  ['A0', 'F3', 'N3'], ['A1', 'H1', 'P7'], ['A2', 'E4', 'P3'], ['A3', 'C3', 'N2'],
  ['A4', 'C2', 'P8'], ['A5', 'B1', 'P2'], ['A6', 'D5', 'R8'], ['A7', 'E2', 'R2'],
  ['A8', 'D4', 'T8'], ['A9', 'C1', 'R3'], ['A10', 'F4', 'L7'], ['A11', 'F2', 'R7'],
  ['A12', 'E3', 'N7'], ['BA0', 'C4', 'M2'], ['BA1', 'E1', 'N8'], ['BA2', 'B3', 'M3'],
  ['CASn', 'F1', 'K3'], ['RASn', 'G4', 'J3'], ['CSn0', 'H2', 'L2'], ['CKE', 'G3', 'K9'],
  ['ODT', 'G1', 'K1'], ['WEn', 'B2', 'L3'], ['CK', 'D2', 'J7'], ['CKn', 'D1', 'K7'],
] as const
export interface Ddr3Options { block?: 'DDR3_LOWER_WRITE' | 'DDR3_ADDR_CMD'; pattern?: 'prbs7' | 'simultaneous' | 'quiet' | 'victim-even' | 'victim-odd' | 'isolated-a4'; durationSeconds?: number; driverModel?: 'Model_352' | 'Model_345' | 'Model_273'; nets?: readonly string[] }

/** Only declarations are retained from this TSX; every physical record comes from the full board. */
function Signals({ 'addr-cmd': addrCmd, pattern = 'prbs7', 'duration-seconds': duration = 8e-9, 'driver-model': driverModel = 'Model_352', nets }: { 'addr-cmd': boolean; pattern?: Ddr3Options['pattern']; 'duration-seconds'?: number; 'driver-model'?: Ddr3Options['driverModel']; nets?: readonly string[] }): React.JSX.Element {
  const cpuPins = addrCmd ? addrCmdPins.map(([, pin]) => pin) : cpu
  const dramPins = addrCmd ? addrCmdPins.map(([, , pin]) => pin) : dram
  return <board width={30} height={10} layers={8} thickness={1.2} fabricatorPreset="jlcpcb_standard" routingDisabled schematicDisabled>
    {([['U1', cpuPins, 'E5', 'A1', 'sprm552c.ibs', 'am335x_zcz'], ['U3', dramPins, 'A1', 'B1', 'W631GG6MB-12.ibs', 'W631GG6MB-12']] as const).map(([name, pins, power, ground, file, component]) => <React.Fragment key={name}>
      <chip name={name} pinLabels={Object.fromEntries([...pins, power, ground].map(pin => [pin, pin]))} footprint={<footprint>
        {[...pins, power, ground].map((pin, i) => <React.Fragment key={pin}><smtpad portHints={[pin]} pcbX={i / 2} pcbY={0} width={.2} height={.2} shape="rect" /></React.Fragment>)}
      </footprint>} />
      <trace from={`.${name} > .${power}`} to="net.VDDQ" /><trace from={`.${name} > .${ground}`} to="net.GND" />
      <simulation.ibismodel componentRef={`.${name}`} ibisModelAsset={{ project_relative_path: `models/${file}`, url: `./models/${file}`, mimetype: 'text/plain' }}
        ibisComponentName={component} ibisPinNameToPortLabel={Object.fromEntries([...pins, power, ground].map(pin => [pin, pin]))}
        ibisPinNameToModelName={Object.fromEntries(pins.map((pin, i) => [pin, name === 'U3' ? addrCmd ? 'CMD' : 'ODT_60' : addrCmd ? i >= 22 ? 'Model_343' : driverModel : i === 9 ? 'Model_655' : i === 10 ? 'Model_847' : 'Model_336']))}
        ibisPinNameToReferencePortLabels={Object.fromEntries(pins.map(pin => [pin, { pullup: power, pulldown: ground, powerClamp: power, groundClamp: ground }]))} />
    </React.Fragment>)}
    {cpuPins.map((pin, i) => <React.Fragment key={pin}><trace from={`.U1 > .${pin}`} to={`.U3 > .${dramPins[i]}`} /></React.Fragment>)}
    {!addrCmd && <differentialpair positiveConnection=".U1 > .P1" negativeConnection=".U1 > .P2" />}
    {addrCmd ? <simulation.pcbtransientchannelsimulation name="DDR3_ADDR_CMD" bitRate="400Mbps" duration={duration} allowUnroutedTraces>
      {addrCmdPins.map(([name, from, to], i) => nets && !nets.includes(name) ? null : <simulation.pcbchannel key={name} name={name}
        driverRef={{ pin: `.U1 > .${from}`, model: i >= 22 ? 'Model_343' : driverModel }} receiverRef={{ pin: `.U3 > .${to}`, model: 'CMD' }}
        bitRate={i >= 22 ? '800Mbps' : '400Mbps'}
        pattern={pattern === 'isolated-a4' ? name === 'A4' ? 'prbs7' : '0' : i >= 22 ? i === 22 ? '0001111111111111' : '1110000000000000' : pattern === 'quiet' || pattern === 'victim-even' && i % 2 === 0 || pattern === 'victim-odd' && i % 2 === 1 ? '0' : pattern === 'simultaneous' ? '01' : 'prbs7'}
        seed={32 + i * 7 % 32} />)}
    </simulation.pcbtransientchannelsimulation> : <simulation.pcbtransientchannelsimulation name="DDR3_LOWER_WRITE" bitRate="800Mbps" allowUnroutedTraces>
      {cpu.slice(0, 9).map((pin, i) => <React.Fragment key={pin}><simulation.pcbchannel name={i === 8 ? 'DQM0' : `DQ${i}`}
        driverRef={{ pin: `.U1 > .${pin}`, model: 'Model_336' }} receiverRef={{ pin: `.U3 > .${dram[i]}`, model: 'ODT_60' }} /></React.Fragment>)}
      <simulation.pcbchannel name="DQS0" driverRef={{ pin: { p: '.U1 > .P1', n: '.U1 > .P2' }, model: { p: 'Model_655', n: 'Model_847' } }}
        receiverRef={{ pin: { p: '.U3 > .F3', n: '.U3 > .G3' }, model: { p: 'ODT_60', n: 'ODT_60' } }} pattern="clock" offset="0.5UI" />
    </simulation.pcbtransientchannelsimulation>}
  </board>
}

/** Preserve all source-board records; append TSX SI declarations and the requested preset when absent. */
export async function fullBoardDdr3(path: string, options: Ddr3Options = {}): Promise<CircuitJson> {
  const board: CircuitJson = JSON.parse(await readFile(path, 'utf8'))
  const declarations = await renderCoreSignals(<Signals addr-cmd={options.block === 'DDR3_ADDR_CMD'} pattern={options.pattern} duration-seconds={options.durationSeconds} driver-model={options.driverModel} nets={options.nets} />)
  const ids = new Map<string, string>()
  for (const component of declarations.filter(record => record.type === 'source_component')) {
    const actual = board.filter(record => record.type === 'source_component').find(record => record.name === component.name)
    if (!actual) throw new Error(`Full board is missing ${component.name}`)
    ids.set(component.source_component_id, actual.source_component_id)
    for (const port of declarations.filter(record => record.type === 'source_port').filter(record => record.source_component_id === component.source_component_id)) {
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
  const physicalBoard = board.find(record => record.type === 'pcb_board')!
  if (physicalBoard.thickness !== 1.2 || physicalBoard.num_layers !== 8) throw new Error('DDR3 fixture requires the supplied 1.2 mm eight-layer JLC08121H-3313 board')
  if (!board.some(record => record.type === 'pcb_stackup')) {
    const stackup = declarations.find(record => record.type === 'pcb_stackup')!
    board.push({ ...stackup, pcb_board_id: physicalBoard.pcb_board_id, subcircuit_id: scope })
  }
  const records = declarations.filter(record => ['simulation_signal_integrity', 'simulation_signal', 'simulation_ibis_model'].includes(record.type))
    .map(record => ({ ...remap(record) as CircuitJson[number], ...('subcircuit_id' in record ? { subcircuit_id: scope } : {}) }))
  for (const record of records) if (record.type === 'simulation_signal_integrity') record.allow_unrouted_traces = false
  return [...board, ...records]
}
