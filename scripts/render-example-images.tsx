import React from 'react'
import { simulation } from '@tscircuit/core'
import { access, readFile, writeFile, mkdir, readdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg'
import { renderCoreSignals } from '../tests/support/core-render'
import Single from '../examples/level1-single-ended/level1-single-ended'
import Differential from '../examples/level1-differential/level1-differential'
import Two from '../examples/level2-two-channels/level2-two-channels'
import Three from '../examples/level3-three-channels/level3-three-channels'
import DDR3 from '../examples/level4-ddr3-write/level4-ddr3-write'
import type { CircuitJson } from '../src/board'
import type { SimulationSignalWaveform } from 'circuit-json'

const levels = [
  { name: 'level1-single-ended', Board: Single, runs: ['single'] },
  { name: 'level1-differential', Board: Differential, runs: ['differential'] },
  { name: 'level2-two-channels', Board: Two, runs: ['two'] },
  { name: 'level3-three-channels', Board: Three, runs: ['three/TRAFFIC', 'three/XTALK_LOW', 'three/XTALK_HIGH'] },
  { name: 'level4-ddr3-write', Board: DDR3, runs: ['ddr3'] },
]
const root = process.env.SI_RUN_ROOT ?? 'runs/final-rfc'
const evidence: unknown[] = []
const outputs: unknown[] = []
const paragraphs: string[] = []
/** Escape data-derived labels in SVG. */
const escape = (value: unknown): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
/** Compact engineering labels, without changing the data. */
const number = (value: number): string => Number(value.toPrecision(4)).toString()
/** Read a full accepted waveform, archived losslessly by the native runner. */
async function waveform(directory: string, id: string): Promise<SimulationSignalWaveform> {
  const file = `${directory}/waveforms/${id}.json`
  try {
    return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return JSON.parse(gunzipSync(await readFile(`${file}.gz`)).toString())
  }
}
/** Canonical physical/electrical input identity, excluding simulation blocks and render diagnostics. */
function boardIdentity(records: CircuitJson): string {
  const types = new Set(['pcb_board', 'pcb_trace', 'pcb_via', 'pcb_copper_pour', 'pcb_smtpad', 'pcb_plated_hole', 'pcb_stackup', 'pcb_port', 'source_component', 'source_port', 'source_net', 'source_trace', 'simulation_ibis_model'])
  const sorted = records.filter(record => types.has(record.type)).map(record => JSON.stringify(record)).sort()
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}
/** Retain the first/last sample and native extrema in each display/export bucket. */
function selectedIndices(values: number[], stride: number): number[] {
  if (stride === 1) return Array.from({ length: values.length }, (_, i) => i)
  const indices = new Set([0, values.length - 1])
  for (let i = 0; i < values.length; i += stride) {
    let low = i
    let high = i
    for (let j = i; j < Math.min(values.length, i + stride); j++) {
      if (values[j] < values[low]) low = j
      if (values[j] > values[high]) high = j
    }
    indices.add(low)
    indices.add(high)
  }
  return [...indices].sort((a, b) => a - b)
}
/** Wrap a stop message in the figure without clipping it. */
function wrapped(value: string, y: number): { svg: string; height: number } {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    if (line.length + word.length > 110 && line) {
      lines.push(line)
      line = ''
    }
    line += `${line ? ' ' : ''}${word}`
  }
  if (line) lines.push(line)
  return { svg: lines.map((text, i) => `<text x="75" y="${y + 75 + 27 * i}" font-size="19">${escape(text)}</text>`).join(''), height: 110 + 27 * lines.length }
}
/** Plot CSV samples in volts and actual time, with an idle line for every quiet endpoint. */
function panel(block: string, rows: { channel: string; end: string; time: number; voltage: number; idle?: number }[], y: number): string {
  let low = Infinity
  let high = -Infinity
  let end = 0
  for (const row of rows) {
    low = Math.min(low, row.voltage, row.idle ?? row.voltage)
    high = Math.max(high, row.voltage, row.idle ?? row.voltage)
    end = Math.max(end, row.time)
  }
  const margin = Math.max(.015, (high - low) * .08)
  low -= margin
  high += margin
  const scale = end < 1e-6 ? 1e9 : 1e6
  const unit = scale === 1e9 ? 'ns' : 'µs'
  const top = y + 85
  const height = 265
  /** Vertical position in volts. */
  const py = (value: number): number => top + height * (high - value) / (high - low)
  let svg = `<text x="60" y="${y + 28}" font-size="25">${escape(block)}</text><rect x="125" y="${top}" width="1380" height="${height}" fill="#08111e" stroke="#40536a"/>`
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.channel} / ${row.end}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  const colors = ['#56d9ed', '#ffcc66', '#c49bff', '#ff8195']
  let index = 0
  for (const [name, values] of groups) {
    const color = colors[index % colors.length]
    const stride = Math.max(1, Math.ceil(values.length / 5000))
    const points = selectedIndices(values.map(row => row.voltage), stride).map(i => `${125 + 1380 * values[i].time / end},${py(values[i].voltage)}`).join(' ')
    svg += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.3"/>`
    const idle = values[0].idle
    if (idle !== undefined) svg += `<path d="M125 ${py(idle)}H1505" stroke="${color}" stroke-dasharray="9 7" stroke-opacity=".8"/>`
    svg += `<text x="${125 + index * 330}" y="${y + 61}" font-size="18" fill="${color}">${escape(name)}${idle === undefined ? '' : ` · idle ${number(idle)} V`}</text>`
    index++
  }
  for (let i = 0; i <= 4; i++) {
    const x = 125 + 1380 * i / 4
    const voltage = low + (high - low) * i / 4
    svg += `<path d="M${x} ${top}v${height}" stroke="#ffffff15"/><text x="${x}" y="${top + height + 27}" text-anchor="middle" font-size="17">${number(end * scale * i / 4)}</text><text x="110" y="${py(voltage) + 6}" text-anchor="end" font-size="17">${Math.abs(voltage) < (high - low) * 1e-4 ? '0' : Math.abs(voltage) < .001 ? voltage.toExponential(1) : number(voltage)}</text>`
  }
  return svg + `<text x="815" y="${top + height + 58}" font-size="19">Time (${unit})</text><text x="25" y="${top + 130}" font-size="19" transform="rotate(-90 25 ${top + 130})">Voltage (V)</text>`
}
for (const { name, Board, runs } of levels) {
  if (process.argv[2] && process.argv[2] !== name) continue
  const directory = `examples/${name}`
  await mkdir(directory, { recursive: true })
  const summaries: any[] = []
  const traces: { directory: string; block: string; channel: string; record: SimulationSignalWaveform }[] = []
  let totalBytes = 0
  let expectedBoard: string | undefined
  for (const run of runs) {
    const path = `${root}/${run}`
    const summary = JSON.parse(await readFile(`${path}/summary.json`, 'utf8'))
    const input = JSON.parse(await readFile(`${path}/input.json`, 'utf8')) as CircuitJson
    const identity = boardIdentity(input)
    if (summary.status === 'verified_native') {
      if (expectedBoard && expectedBoard !== identity) throw new Error(`${name}: block inputs disagree on the physical board`)
      expectedBoard = identity
    }
    const sourceHash = createHash('sha256').update(await readFile(`${directory}/${name}.tsx`)).digest('hex')
    if (summary.example_sha256 !== sourceHash) throw new Error(`${name}: evidence does not match the current TSX`)
    const extraction: unknown[] = []
    for (const block of summary.blocks ?? []) {
      const directory = `${path}/blocks/${block.simulation_signal_integrity_id}`
      for (const stage of await readdir(directory)) if (/^stage-\d+$/.test(stage)) {
        const matrix = JSON.parse(await readFile(`${directory}/${stage}/extraction.json`, 'utf8'))
        extraction.push({ stage: matrix.stage, frequency_hz: matrix.frequencyHz, R_mesh_delta: matrix.checks.convergence.R, L_mesh_delta: matrix.checks.convergence.L, C_auto_residual: matrix.checks.capConvergence, signal_C_reciprocity: matrix.checks.C.reciprocityResidual })
      }
    }
    const clean = { ...summary, implementation_head: undefined, acquisition_checkout_head: summary.acquisition_checkout_head ?? summary.implementation_head, core_module: '../core/dist/index.js', extraction, error: summary.error?.split('\n')[0], run_directory: path }
    summaries.push(clean)
    evidence.push(clean)
    if (summary.status !== 'verified_native') continue
    for (const block of summary.blocks) for (const result of block.results) {
      if (result.type !== 'simulation_signal_waveform') continue
      const record = await waveform(path, result.simulation_signal_waveform_id)
      result.full_resolution_sha256 = createHash('sha256').update(JSON.stringify(record)).digest('hex')
      const fullPath = `${path}/waveforms/${result.simulation_signal_waveform_id}.json`
      result.full_resolution_evidence = await access(`${fullPath}.gz`).then(() => `${fullPath}.gz`, () => fullPath)
      const source = input.find(source => source.type === 'simulation_signal' && source.simulation_signal_id === record.simulation_signal_id)
      const channel = source?.type === 'simulation_signal' ? source.name : record.simulation_signal_id
      let fullBytes = 0
      for (let i = 0; i < record.timestamps_s.length; i++) fullBytes += `${block.name},${channel},${record.end},${record.source_port_id},${record.timestamps_s[i]},${record.voltage_levels[i]}${record.idle_voltage_v === undefined ? '' : `,${record.idle_voltage_v}`}\n`.length
      totalBytes += fullBytes
      traces.push({ directory: path, block: block.name, channel, record })
    }
  }
  const hasQuiet = traces.some(trace => trace.record.idle_voltage_v !== undefined)
  const csvHeader = `block,channel,end,pin,time_s,voltage_v${hasQuiet ? ',idle_voltage_v' : ''}\n`
  totalBytes += csvHeader.length + (hasQuiet ? traces.filter(trace => trace.record.idle_voltage_v === undefined).reduce((sum, trace) => sum + trace.record.timestamps_s.length, 0) : 0)
  const decimated = totalBytes > 10_000_000
  const exportFile = await open(`${directory}/simoutput.csv`, 'w')
  await exportFile.write(csvHeader)
  let exported = 0
  for (const trace of traces) {
    const { record } = trace
    const stride = decimated ? Math.max(2, Math.ceil(totalBytes / 8_500_000) * 2) : 1
    const indices = selectedIndices(record.voltage_levels, stride)
    let buffer = ''
    for (const i of indices) {
      buffer += `${trace.block},${trace.channel},${record.end},${record.source_port_id},${record.timestamps_s[i]},${record.voltage_levels[i]}${hasQuiet ? `,${record.idle_voltage_v ?? ''}` : ''}\n`
      if (buffer.length > 100000) {
        await exportFile.write(buffer)
        buffer = ''
      }
    }
    if (buffer) await exportFile.write(buffer)
    exported += indices.length
  }
  await exportFile.close()
  // The physical DDR layout can render independently of its intentionally unsupported SI block.
  const tree = Board()
  const physical = name === 'level4-ddr3-write' ? React.cloneElement(tree, {}, React.Children.toArray(tree.props.children).filter(child => !React.isValidElement(child) || child.type !== simulation.pcbtransientchannelsimulation)) : <Board />
  let records: CircuitJson
  try {
    records = await renderCoreSignals(physical)
  }
  catch (error) {
    const partial = (error as { circuitJson?: CircuitJson }).circuitJson
    if (!partial?.some(record => record.type === 'pcb_trace')) throw error
    records = partial
  }
  if (expectedBoard && boardIdentity(records) !== expectedBoard) throw new Error(`${name}: current real-core PCB differs from the native input; regenerate native evidence first`)
  const copper = records.filter(record => record.type.startsWith('pcb_') && !record.type.includes('silkscreen')) as Parameters<typeof convertCircuitJsonToPcbSvg>[0]
  const multilayer = records.some(record => record.type === 'pcb_board' && (record.num_layers ?? 2) > 2)
  let body = `<rect width="1600" height="100%" fill="#101b2b"/><g fill="#edf4ff" font-family="DejaVu Sans, sans-serif"><text x="55" y="48" font-size="30">${name}</text><text x="55" y="82" font-size="18" fill="#b7c9df">Routed PCB rendered from this TSX through real core at generation time · no silkscreen</text>`
  for (const [i, layer] of ['top', multilayer ? 'all' : 'bottom'].entries()) {
    const svg = convertCircuitJsonToPcbSvg(copper, { width: 735, height: 350, ...(layer === 'all' ? {} : { layer: layer as 'top' | 'bottom' }), shouldDrawErrors: false, shouldDrawRatsNest: false, showCourtyards: false, showPcbGroups: false, showSolderMask: false, showSolderPaste: false, showPcbNotes: false, showFabricationNotes: false, includeVersion: false, backgroundColor: '#0b1422' })
    body += `<text x="${55 + i * 780}" y="120" font-size="22">${layer === 'all' ? 'All copper layers' : `${layer} copper`}</text><svg x="${45 + i * 780}" y="140" width="735" height="350">${svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg>`
  }
  body += `<text x="55" y="525" font-size="17" fill="#b7c9df">${records.filter(record => record.type === 'pcb_trace').length} traces · ${records.filter(record => record.type === 'pcb_via').length} vias · ${records.filter(record => record.type === 'pcb_copper_pour').length} pours · ${exported} CSV rows${decimated ? ' (CSV decimated; full accepted data retained in evidence)' : ''}</text>`
  const csvRows = (await readFile(`${directory}/simoutput.csv`, 'utf8')).trim().split('\n').slice(1).map(line => {
    const [block, channel, end, pin, time, voltage, idle] = line.split(',')
    return { block, channel, end, pin, time: Number(time), voltage: Number(voltage), ...(idle ? { idle: Number(idle) } : {}) }
  })
  let y = 570
  for (const summary of summaries) {
    if (summary.status !== 'verified_native') {
      const block = summary.run_directory.split('/').at(-1)
      const message = wrapped(summary.error, y)
      body += `<rect x="45" y="${y}" width="1510" height="${message.height}" rx="8" fill="#352431"/><text x="75" y="${y + 37}" font-size="24" fill="#ffb7c4">${escape(block)} · ${summary.native_requests.length} solver calls · no accepted waveform</text>${message.svg}`
      y += message.height + 25
      continue
    }
    for (const block of summary.blocks) {
      const label = block.name.startsWith('simulation_signal_integrity_') ? 'Capture' : block.name
      const rows = csvRows.filter(row => row.block === block.name)
      const switching = rows.filter(row => row.idle === undefined)
      if (switching.length) {
        body += panel(`${label} · receiver waveforms`, switching, y)
        y += 445
      }
      const quiet = rows.filter(row => row.idle !== undefined)
      if (quiet.length) {
        body += panel(`${label} · quiet receiver and driver (dashed = undisturbed idle)`, quiet, y)
        y += 445
      }
    }
  }
  body += `<text x="55" y="${y + 20}" font-size="16" fill="#b7c9df">1% + 1 mV waveform convergence; R/L mesh 5%; C auto 2%; raw signal-block reciprocity 2.5%.</text></g>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${y + 50}" viewBox="0 0 1600 ${y + 50}">${body}</svg>`
  await writeFile(`${directory}/${name}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 1600 }, font: { loadSystemFonts: true } }).render().asPng())
  const files = Object.fromEntries(await Promise.all([`${name}.tsx`, `${name}.png`, 'simoutput.csv'].map(async file => {
    const bytes = await readFile(`${directory}/${file}`)
    return [file, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
  })))
  outputs.push({ level: name, files, rendered_board_sha256: boardIdentity(records), accepted_board_sha256: expectedBoard, csv_rows: exported, csv_decimated: decimated, full_long_csv_bytes: totalBytes })
  const outcome = summaries.map(summary => {
    if (summary.status !== 'verified_native') return `${summary.run_directory.split('/').at(-1)}: stopped after ${number(summary.seconds)} s, ${summary.native_requests.length} solver calls: \`${summary.error}\`.`
    return summary.blocks.map((block: any) => {
      const checks = Object.entries(summary.convergence).filter(([path]) => path.endsWith('numerical-convergence.json')).flatMap(([, value]: any) => value.checks.slice(-2).flatMap((check: any) => check.probes))
      return `${block.name}: ${number(block.duration_s * 1e6)} µs accepted; wall ${number(summary.seconds)} s (${number(summary.native_requests.reduce((sum: number, call: any) => sum + (call.reused_from ? 0 : call.wall_seconds), 0))} s fresh native calls); convergence deltas RMS ≤ ${number(Math.max(...checks.map((check: any) => check.rms_v)))} V, signed extrema ≤ ${number(Math.max(...checks.map((check: any) => check.peak_change_v)))} V.`
    }).join(' ')
  }).join(' ')
  const extraction = [...new Set(summaries.flatMap(summary => summary.extraction.map((check: any) => `R/L mesh deltas ${number(check.R_mesh_delta * 100)}%/${number(check.L_mesh_delta * 100)}%, C auto residual ${number(check.C_auto_residual * 100)}%, signal-block reciprocity ${number(check.signal_C_reciprocity * 100)}%.`)))].join(' ')
  const detail = `${decimated ? `CSV only is decimated by native min/max buckets (${exported} rows; full CSV would be ${totalBytes} bytes).` : `CSV retains all ${exported} native sample rows.`} Full data: \`${root}\` (local, ignored); hashes and convergence: \`tests/evidence/signal-levels/\`.`
  await writeFile(`${directory}/README.md`, `${outcome} ${extraction}\n\n${detail}\n`)
  paragraphs.push(`**${name}.** ${outcome} ${extraction} ${detail}\n\n![${name}](${name}/${name}.png)`)
  console.log(`${name}: ${exported} CSV rows, ${1600} × ${y + 50}`)
}
await writeFile('tests/evidence/signal-levels/rfc-boards.json', JSON.stringify({ source_identity_note: 'Acquisition checkout heads record Git HEAD while working-tree edits were present; exact native requests and result bytes are validated against final source in request-identity.json', rfc_head: '89a263537ebc143315849f005024f84c1efa5635', native_timeout_ms: 1200000, OMP_NUM_THREADS: 1, maximum_native_processes: 1, acceptance: { R_L_mesh: .05, C_auto: .02, signal_C_reciprocity: .025, transient: 'Independent timestep and section checks; per-probe time-weighted RMS and signed extrema, 1% + 1 mV' }, outputs, cases: evidence }, null, 2) + '\n')
await writeFile('examples/README.md', `# Native transient channel examples\n\nWith the built sibling overlays and local vendor files, run \`OMP_NUM_THREADS=1 IBIS_MODEL_DIR=models SI_CORE_MODULE="$(cd ../core && pwd)/dist/index.js" TSX_TSCONFIG_PATH=examples/tsconfig.json NGSPICE_BIN=/opt/homebrew/bin/ngspice node --max-old-space-size=6000 --import tsx scripts/render-example-images.tsx\` to regenerate every PNG and CSV from the full accepted evidence in \`${root}\`. To recreate that evidence first, use the same environment with \`scripts/run-signal-levels.tsx\`; every case/block runs sequentially, each process has a 1200000 ms bound, and DDR3 must stop before native execution. Exact completed native requests can be reused with \`SI_EXTRACTION_CACHE=<directories separated by colons> SI_REPLAY_COMPLETE_NATIVE=1\`. PNG lower panels plot the exported CSV in actual time and volts.\n\n${paragraphs.join('\n\n')}\n`)
