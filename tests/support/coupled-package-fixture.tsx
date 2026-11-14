import React from 'react'
import { simulation } from '@tscircuit/core'

// Original synthetic IBIS exercises the package boundary, never substitutes native board evidence.
export const source = `[IBIS Ver] 4.2
[Component] fixture
[Manufacturer] Test
[Package Model] coupled
[Package]
R_pkg 99 99 99
L_pkg 99n 99n 99n
C_pkg 99p 99p 99p
[Pin] signal_name model_name R_pin L_pin C_pin
A1 A input 9 9n 9p
B1 B input 8 8n 8p
V1 VDD POWER 7 7n 7p
G1 VSS GND 6 6n 6p
[Model] input
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 1.5 1.5 1.5
[Define Package Model] coupled
[Manufacturer] Test
[OEM] Test
[Description] Original coupled fixture
[Number Of Pins] 4
[Pin Numbers]
B1
G1
A1
V1
[Model Data]
[Resistance Matrix] Full_matrix
[Row] B1
2 .1 .2 0
[Row] G1
3 0 0
[Row] A1
1 0
[Row] V1
4
[Inductance Matrix] Full_matrix
[Row] B1
4n 0 -1n 0
[Row] G1
1n 0 0
[Row] A1
2n 0
[Row] V1
3n
[Capacitance Matrix] Full_matrix
[Row] B1
3p -.2p -.5p 0
[Row] G1
2p -.1p 0
[Row] A1
2p 0
[Row] V1
1p
[End Model Data]
[End Package Model]
[End]`

/** TSX reproduction has real serialized IBIS pin bindings, with no native board solve. */
export function Board(): React.JSX.Element {
  return <board width={10} height={10} routingDisabled schematicDisabled>
    <chip name="U1" pinLabels={{ A1: 'A', B1: 'B', V1: 'VDD', G1: 'VSS' }} footprint={<footprint>
      {['A1', 'B1', 'V1', 'G1'].map((pin, i) => <React.Fragment key={pin}><smtpad portHints={[pin]} pcbX={i - 1.5} pcbY={0} width={.3} height={.3} shape="rect" /></React.Fragment>)}
    </footprint>} />
    <simulation.ibismodel componentRef=".U1" ibisModelAsset={{ project_relative_path: 'fixture.ibs', url: './fixture.ibs', mimetype: 'text/plain' }} ibisComponentName="fixture"
      ibisPinNameToPortLabel={{ A1: 'A', B1: 'B', V1: 'VDD', G1: 'VSS' }} />
  </board>
}

