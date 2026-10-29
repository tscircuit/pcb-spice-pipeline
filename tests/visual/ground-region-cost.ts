import { writeFileSync } from 'node:fs'
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg'
import { nativeDdrTimeout } from '../fixtures/native-ddr-timeout.js'

const board = { width: 100, height: 68 }
for (const [name, ground] of [['local', { width: 22, height: 14 }], ['wide', { width: 96, height: 64 }]] as const) {
  const { records } = await nativeDdrTimeout({ board, ground })
  const bottom = convertCircuitJsonToPcbSvg(records, { layer: 'bottom', width: 1000, height: 680 })
  writeFileSync(new URL(`./ground-region-${name}-bottom.svg`, import.meta.url), bottom)
  if (name === 'local') {
    const top = convertCircuitJsonToPcbSvg(records, { layer: 'top', width: 1000, height: 680 })
    writeFileSync(new URL('./ground-region-top.svg', import.meta.url), top)
    const closeup = convertCircuitJsonToPcbSvg(records, { layer: 'top', width: 1000, height: 600,
      viewport: { minX: -9, minY: -5, maxX: 9, maxY: 5 } })
    writeFileSync(new URL('./ground-region-top-closeup.svg', import.meta.url), closeup)
  }
}
