import React from 'react'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg'
import { renderCoreSignals } from '../tests/support/core-render'
import { sampleVoltage } from '../src/observation'
import type { CircuitJson } from '../src/board'
import Single from '../examples/levels/level1-single-ended'
import Differential from '../examples/levels/level1-differential'
import Two from '../examples/levels/level2-two-signals'
import Three from '../examples/levels/level3-three-signals'
import DDR3 from '../examples/levels/level4-ddr3-write'

const boards = { 'level1-single-ended': Single, 'level1-differential': Differential, 'level2-two-signals': Two, 'level3-three-signals': Three, 'level4-ddr3-write': DDR3 }
const evidence = JSON.parse(await readFile('tests/evidence/signal-levels/rfc-boards.json', 'utf8')) as any
const directory = 'runs/example-images'
await mkdir(directory, { recursive: true })

// Isolate DDR3's bounded full-layout attempt so autorouter workers cannot outlive the image command.
if (process.argv[2] === '--ddr3-layout') {
  const { Circuit } = await import(process.env.SI_CORE_MODULE ?? '@tscircuit/core')
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async (url: string) => new Response(await readFile(`${process.env.IBIS_MODEL_DIR ?? 'models'}/${String(url).split('/').at(-1)}`)) } })
  /** Save actual partial copper before terminating a failed or bounded-out render. */
  const save = (status: string, error?: string): void => {
    writeFileSync(`${directory}/ddr3-layout.json`, JSON.stringify({ status, error, records: circuit.db.toArray() }))
    process.exit(0)
  }
  setTimeout(() => save('partial_layout_deadline', 'Full DDR3 layout exceeded the 180000 ms image-render deadline.'), 180000)
  try {
    circuit.add(<DDR3 />)
    await circuit.renderUntilSettled()
    save('rendered')
  } catch (error) { save('partial_core_error', (error as Error).message) }
}

/** Escape data-derived text before inserting it into SVG. */
const escape = (value: unknown): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
/** Fixed precision for readable engineering labels. */
const number = (value: number): string => Number(value.toPrecision(4)).toString()
/** Wrap an exact blocking message without truncating its contents. */
function wrapped(value: string, x: number, y: number, width: number = 105): string {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    if (line.length + word.length > width && line) {
      lines.push(line)
      line = ''
    }
    line += `${line ? ' ' : ''}${word}`
  }
  if (line) lines.push(line)
  return lines.map((line, i) => `<text x="${x}" y="${y + i * 29}" font-size="21">${escape(line)}</text>`).join('')
}
/** Custom two-UI eye drawn from committed adaptive receiver samples, with full-resolution measurements. */
function eyePanel(block: any, signal: any, eye: any, waveform: any, y: number): string {
  const ui = 1 / signal.bit_rate_bps
  const threshold = signal.thresholds[eye.source_port_id]
  const rows = waveform.timestamps_s.map((time: number, i: number) => [time, waveform.voltage_levels[i]])
  const minimum = Math.min(...waveform.voltage_levels, threshold.vil) - .15
  const maximum = Math.max(...waveform.voltage_levels, threshold.vih) + .15
  const left = 120
  const top = y + 65
  const width = 1360
  const height = 295
  /** Map voltage to the plot's vertical coordinate. */
  const py = (value: number): number => top + height * (maximum - value) / (maximum - minimum)
  let svg = `<text x="70" y="${y + 30}" font-size="24">${escape(block.name)} / ${escape(signal.name)} · ${number(eye.eye_height_v)} V × ${number(eye.eye_width_s * 1e9)} ns</text>`
  svg += `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#08111e" stroke="#41536d"/>`
  const first = Math.ceil((block.gate_s - signal.offset_s) / ui - 1e-10)
  const end = rows.at(-1)![0]
  for (let bit = first; signal.offset_s + (bit + 2) * ui <= end * (1 + 1e-12); bit++) {
    const start = signal.offset_s + bit * ui
    const points = Array.from({ length: 401 }, (_, i) => `${left + width * i / 400},${py(sampleVoltage(rows, 1, start + 2 * ui * i / 400))}`).join(' ')
    svg += `<polyline points="${points}" fill="none" stroke="#55e2d0" stroke-opacity="0.17" stroke-width="1.2"/>`
  }
  const setup = signal.mask === 'ibis' ? 0 : signal.mask.setup_s ?? 0
  const hold = signal.mask === 'ibis' ? 0 : signal.mask.hold_s ?? 0
  svg += `<rect x="${left + width * (.5 - setup / ui) / 2}" y="${py(threshold.vih)}" width="${Math.max(1, width * (setup + hold) / ui / 2)}" height="${py(threshold.vil) - py(threshold.vih)}" fill="#ff718740" stroke="#ff7187"/><text x="${left + width * .31}" y="${py(threshold.vih) - 10}" font-size="17" fill="#ff9dad">mask ${number(threshold.vil)}–${number(threshold.vih)} V</text>`
  for (const fraction of [0, .5, 1, 1.5, 2]) svg += `<text x="${left + fraction / 2 * width}" y="${top + height + 27}" text-anchor="middle" font-size="17">${fraction} UI</text>`
  svg += `<text x="${left}" y="${top + height + 56}" font-size="17">Folded after gate ${number(block.gate_s * 1e9)} ns · measurements from ${waveform.full_resolution_samples} full-resolution samples</text>`
  return svg
}
/** Quiet-victim noise relative to the independently settled idle, retaining signed full-resolution peaks. */
function noisePanel(block: any, signal: any, peak: any, waveform: any, y: number): string {
  const samples = waveform.timestamps_s.flatMap((time: number, i: number) => time >= block.gate_s ? [[time, waveform.voltage_levels[i] - peak.idle_voltage_v]] : [])
  const maximum = Math.max(Math.abs(peak.peak_positive_v), Math.abs(peak.peak_negative_v), 1e-6) * 1.3
  const start = samples[0][0]
  const end = samples.at(-1)![0]
  /** Plot y coordinate relative to undisturbed idle. */
  const py = (v: number): number => y + 210 - v / maximum * 130
  const points = samples.map((row: number[]) => `${120 + (row[0] - start) / (end - start) * 1360},${py(row[1])}`).join(' ')
  let svg = `<text x="70" y="${y + 30}" font-size="24">${escape(block.name)} / ${escape(signal.name)} · ${peak.end === 'near' ? 'NEXT' : 'FEXT'} relative to idle ${number(peak.idle_voltage_v)} V</text>`
  svg += `<rect x="120" y="${y + 65}" width="1360" height="290" fill="#08111e" stroke="#41536d"/><path d="M120 ${py(0)} H1480" stroke="#64748b"/><polyline points="${points}" fill="none" stroke="#aab6ff" stroke-width="1.4"/>`
  for (const [label, value] of [['positive', peak.peak_positive_v], ['negative', peak.peak_negative_v]] as const) {
    const nearest = samples.reduce((a: number[], b: number[]) => Math.abs(b[1] - value) < Math.abs(a[1] - value) ? b : a)
    const x = 120 + (nearest[0] - start) / (end - start) * 1360
    svg += `<circle cx="${x}" cy="${py(value)}" r="5" fill="#ffbe6a"/><text x="${Math.min(1200, Math.max(130, x + 10))}" y="${py(value) + (label === 'positive' ? -15 : 28)}" font-size="18" fill="#ffbe6a">${value >= 0 ? '+' : ''}${number(value * 1000)} mV</text>`
  }
  svg += `<text x="120" y="${y + 390}" font-size="17">${number(start * 1e6)}–${number(end * 1e6)} µs · signed peak labels use the full-resolution measurement</text>`
  return svg
}

for (const [name, Board] of Object.entries(boards)) {
  if (process.env.SI_IMAGE_ONLY && process.env.SI_IMAGE_ONLY !== name) continue
  const source = await readFile(`examples/levels/${name}.tsx`)
  const sourceHash = createHash('sha256').update(source).digest('hex')
  const cases = evidence.cases.filter((item: any) => item.example === name)
  if (cases.some((item: any) => item.example_sha256 && item.example_sha256 !== sourceHash)) throw new Error(`${name}: committed evidence does not match the TSX`)
  let records: CircuitJson
  let layoutStatus = 'Routed through real core at image-generation time'
  if (name === 'level4-ddr3-write') {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/render-example-images.tsx', '--ddr3-layout'], { stdio: 'inherit', timeout: 190000 })
    const layout = JSON.parse(await readFile(`${directory}/ddr3-layout.json`, 'utf8'))
    records = layout.records
    if (layout.status !== 'rendered') layoutStatus = layout.status === 'partial_layout_deadline' ? 'Partial real-core PCB: full autorouting exceeded 180 s' : 'Partial real-core PCB: source admission failed'
  } else records = await renderCoreSignals(<Board />)
  const copper = records.filter(record => record.type.startsWith('pcb_') && !record.type.includes('silkscreen')) as Parameters<typeof convertCircuitJsonToPcbSvg>[0]
  let body = `<rect width="1600" height="100%" fill="#101b2b"/><g fill="#edf4ff" font-family="DejaVu Sans, sans-serif"><text x="55" y="48" font-size="30">${escape(name)}</text><text x="55" y="82" font-size="19" fill="#b7c9df">${escape(layoutStatus)} · no silkscreen</text>`
  for (const [i, layer] of ['top', 'bottom'].entries()) {
    const svg = convertCircuitJsonToPcbSvg(copper, { width: 735, height: 350, layer: layer as 'top' | 'bottom', shouldDrawErrors: false, shouldDrawRatsNest: false, showCourtyards: false, showPcbGroups: false, showSolderMask: false, showSolderPaste: false, showPcbNotes: false, showFabricationNotes: false, includeVersion: false, backgroundColor: '#0b1422' })
    body += `<text x="${55 + i * 780}" y="120" font-size="22">${layer === 'top' ? 'Top copper' : records.some(r => r.type === 'pcb_copper_pour' && r.layer === 'bottom') ? 'Bottom copper / ground pour' : 'Bottom copper'}</text><svg x="${45 + i * 780}" y="140" width="735" height="350">${svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg>`
  }
  body += `<text x="55" y="525" font-size="17" fill="#b7c9df">${records.filter(r => r.type === 'pcb_trace').length} traces · ${records.filter(r => r.type === 'pcb_via').length} vias · ${records.filter(r => r.type === 'pcb_copper_pour').length} ground pour(s) · source ${sourceHash.slice(0, 12)}</text>`
  let y = 570
  for (const item of cases) {
    if (item.status !== 'verified_native') {
      const message = item.error.split('\n\n')[0]
      body += `<rect x="45" y="${y}" width="1510" height="165" rx="8" fill="#352431"/><text x="70" y="${y + 37}" font-size="24" fill="#ffb7c4">${escape(item.block ?? 'Simulation')} · no accepted simulation output</text>`
      if (item.blocked_by_request_sha256) body += `<text x="70" y="${y + 65}" font-size="17" fill="#b7c9df">Shared TRAFFIC request ${item.blocked_by_request_sha256.slice(0, 12)}; no quiet transient ran.</text>`
      body += wrapped(message, 70, y + (item.blocked_by_request_sha256 ? 100 : 79))
      y += 190
      continue
    }
    const blocks = JSON.parse(gunzipSync(await readFile(`tests/evidence/signal-levels/${item.plot_file}`)).toString())
    for (const block of blocks) for (const record of block.results) {
      if (!['simulation_signal_eye', 'simulation_signal_crosstalk'].includes(record.type)) continue
      const signal = block.signals.find((signal: any) => signal.simulation_signal_id === record.simulation_signal_id)
      const waveform = block.results.find((wave: any) => wave.type === 'simulation_signal_waveform' && wave.simulation_signal_id === record.simulation_signal_id && wave.source_port_id === record.source_port_id)
      body += record.type === 'simulation_signal_eye' ? eyePanel(block, signal, record, waveform, y) : noisePanel(block, signal, record, waveform, y)
      y += 440
    }
  }
  body += `<text x="55" y="${y + 22}" font-size="17" fill="#b7c9df">Native acceptance criteria remain unchanged. Missing measurements are unavailable, never zero.</text></g>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${y + 55}" viewBox="0 0 1600 ${y + 55}">${body}</svg>`
  await writeFile(`${directory}/${name}.svg`, svg)
  await writeFile(`examples/levels/${name}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 1600 }, font: { loadSystemFonts: true } }).render().asPng())
  console.log(`${name}.png: 1600 × ${y + 55}`)
}
