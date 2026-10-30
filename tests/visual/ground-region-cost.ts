import { writeFileSync } from 'node:fs'
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg'
import { nativeDdrTimeout } from '../fixtures/native-ddr-timeout.js'

const label = (svg: string, y: number, lines: readonly string[]) => svg.replace('</svg>',
  `<g fill="white" font-family="sans-serif" font-size="14" text-anchor="middle">${lines.map((line, i) =>
    `<text x="500" y="${y + i * 20}">${line}</text>`).join('')}</g></svg>`)

const board = { width: 100, height: 68 }
for (const [name, ground] of [['local', { width: 22, height: 14 }], ['wide', { width: 96, height: 64 }]] as const) {
  const { records, deck } = await nativeDdrTimeout({ board, ground })
  const groundEdges = (deck.match(/^Eg\d+_\d+ /gm) ?? []).length
  const bottom = convertCircuitJsonToPcbSvg(records, { layer: 'bottom', width: 1000, height: 680 })
  writeFileSync(new URL(`./ground-region-${name}-bottom.svg`, import.meta.url), label(bottom, 380, [
    `${name === 'local' ? 'Local' : 'Board-sized'} ground: ${ground.width} × ${ground.height} mm`,
    `${groundEdges.toLocaleString('en-US')} ground segments · 1.5 mm mesh`,
    'Same 100 × 68 mm board and signal routes',
  ]))
  if (name === 'local') {
    const top = convertCircuitJsonToPcbSvg(records, { layer: 'top', width: 1000, height: 680 })
    writeFileSync(new URL('./ground-region-top.svg', import.meta.url), label(top, 400, [
      'Top: identical DQ / DQS / DQSn routes', '100 × 68 mm board · ground plane on bottom',
    ]))
    const closeup = convertCircuitJsonToPcbSvg(records, { layer: 'top', width: 1000, height: 600,
      viewport: { minX: -9, minY: -5, maxX: 9, maxY: 5 } })
    writeFileSync(new URL('./ground-region-top-closeup.svg', import.meta.url), label(closeup, 490, [
      'Same three signal routes and two ground vias', 'Top closeup · U1 to U3',
    ]))
  }
}
