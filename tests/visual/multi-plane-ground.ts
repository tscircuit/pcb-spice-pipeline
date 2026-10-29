import { writeFileSync } from 'node:fs'
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg'
import { multiPlaneGround } from '../fixtures/multi-plane-ground.js'

const circuit = await multiPlaneGround()
for (const layer of ['top', 'inner1', 'inner3', 'inner6'] as const) {
  writeFileSync(new URL(`./multi-plane-ground-${layer}.svg`, import.meta.url), convertCircuitJsonToPcbSvg(circuit, { layer, width: 900, height: 600 }))
}
