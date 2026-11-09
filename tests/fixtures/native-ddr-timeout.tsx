import { Circuit } from '@tscircuit/core'
import React from 'react'
import type { AnyCircuitElement } from 'circuit-json'
import type { NumericalSettings } from '../../src/pipeline'
import { geometryFromCircuitJson } from '../../src/board'
import { fastHenryDeck } from '../../src/extraction'

const lanes = ['DQ', 'DQS', 'DQSn'] as const
/**
 * Extraction-only reduction of the AM3352 DDR timeout. No vendor model or eye
 * result is needed to reproduce the process deadline before transient analysis.
 */
export default function NativeDdrTimeout(): React.JSX.Element {
  return <board width={20} height={14} layers={4} thickness={1.6}
    fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    {(['U1', 'U3'] as const).map((name, i) => <React.Fragment key={name}>
      <chip name={name} pcbX={i ? 6 : -6} pcbY={0}
        pinLabels={{ pin1: 'DQ', pin2: 'DQS', pin3: 'DQSn', pin4: 'GND' }}
        connections={{ GND: 'net.GND' }} footprint={<footprint>
          {['DQ', 'DQS', 'DQSn', 'GND'].map((_, p) => <React.Fragment key={p}><smtpad
            portHints={[`pin${p + 1}`]} pcbX={0} pcbY={1 - p} width={.3} height={.3} shape="rect" /></React.Fragment>)}
        </footprint>} />
      {/* Declaration only: this extraction test never opens an IBIS file. */}
      <silkscreentext text={name} pcbX={i ? 6 : -6} pcbY={2} fontSize={.8} />
      <via name={`GND_${name}`} pcbX={(i ? 6 : -6) + .4} pcbY={-2}
        holeDiameter={.2} outerDiameter={.4} layers={['top', 'inner1', 'inner2', 'bottom']} connectsTo="net.GND" />
      <trace from={`.${name} > .GND`} to={`.GND_${name} > .top`} width={.15}
        connectsTo={[`.${name} > .GND`, `.GND_${name} > .top`, 'net.GND']}
        pcbPath={[`.${name} > .GND`, `.GND_${name} > .top`]} />
    </React.Fragment>)}
    {lanes.map(name => <trace key={name} name={`${name}_ROUTE`} from={`.U1 > .${name}`}
      to={`.U3 > .${name}`} width={.1} pcbPath={[`.U1 > .${name}`, `.U3 > .${name}`]} />)}
    {lanes.map((name, i) => <React.Fragment key={name}><silkscreentext text={name} pcbX={0} pcbY={1.3 - i} fontSize={.4} /></React.Fragment>)}
    <net name="GND" />
    <copperpour name="REFERENCE" layer="bottom" connectsTo="net.GND" unbroken
      outline={[{ x: -9, y: -6 }, { x: 9, y: -6 }, { x: 9, y: 6 }, { x: -9, y: 6 }]} />
  </board>
}

/** Renders the DDR timeout board and builds its refinement FastHenry deck, the step that hits the process deadline. */
export async function nativeDdrTimeout(): Promise<{ records: AnyCircuitElement[]; deck: string }> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<NativeDdrTimeout />)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson()
  const modeling: NumericalSettings = {
    reduction: 'routed-copper', sections: 12, relativePermittivity: 4.1,
    lanes: lanes.map(name => ({ port: name, from: { component: 'U1', port: name }, to: { component: 'U3', port: name } })),
    channelReference: { component: 'U1', port: 'GND' }, groundReturn: { component: 'U3', port: 'GND' },
    viaPlatingMm: .025, viaEquivalentWidthMm: .1, omitThroughViaStubs: true,
    extraction: { minimumHz: 1, maximumHz: 1e9, modelHz: 1e8, filaments: 3, refinementFilaments: 5,
      convergenceTolerance: .05, capTolerance: .02, reciprocityTolerance: .025, dcResistanceTolerance: .002, maxPanelLengthMm: 2, groundMeshMm: 3 },
  }
  const geometry = geometryFromCircuitJson(records, modeling)
  const deck = fastHenryDeck(geometry.cells[0], { ...modeling.extraction,
    minimumHz: modeling.extraction.modelHz, maximumHz: modeling.extraction.modelHz,
    filaments: modeling.extraction.refinementFilaments, groundMeshMm: modeling.extraction.groundMeshMm! / 2 })
  return { records, deck }
}
