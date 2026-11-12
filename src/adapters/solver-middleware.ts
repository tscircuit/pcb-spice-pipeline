import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { RunSolver, SolverRequest } from '../solver'
import { createNativeSolver } from './native-solver'
import { relativeFile } from './paths'

const exec = promisify(execFile)
const binaries = { ngspice: 'ngspice' } as const
const requestSchema = z
  .object({
    solver: z.literal('ngspice'),
    files: z.record(z.string()),
    args: z.array(z.string()).max(16),
    outputFiles: z.array(z.string()).max(256),
  })
  .strict()
export interface LocalSolver {
  available: boolean
  version?: string
}
export type LocalSolvers = Record<'ngspice', LocalSolver>
export interface SolverMiddlewareOptions {
  runSolver?: RunSolver
  detectSolvers?: () => Promise<LocalSolvers>
  maxRequestBytes?: number
  modelDirectory?: string
  boardFile?: string
}
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void

/** Find only the fixed executable names on the server's PATH; probe them sequentially. */
export async function detectLocalSolvers(): Promise<LocalSolvers> {
  const result = {} as LocalSolvers
  for (const [solver, binary] of Object.entries(binaries) as ['ngspice', string][]) {
    const path = (process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, binary))
    let executable: string | undefined
    for (const candidate of path) {
      try {
        await access(candidate, constants.X_OK)
        executable = candidate
        break
      } catch {
        /* Try the next PATH directory. */
      }
    }
    result[solver] = { available: executable !== undefined }
    if (!executable) continue
    let output = ''
    try {
      const probe = await exec(executable, ['--version'], {
        timeout: 2000,
        maxBuffer: 65536,
        env: { ...process.env, OMP_NUM_THREADS: '1' },
      })
      output = probe.stdout + probe.stderr
    } catch (error) {
      const probe = error as { stdout?: string; stderr?: string }
      output = (probe.stdout ?? '') + (probe.stderr ?? '')
    }
    result[solver].version =
      output
        .split(/\r?\n/)
        .find((line) => /ngspice-/i.test(line))
        ?.replace(/^[*\s]+|[*\s]+$/g, '') ?? 'version unavailable'
  }
  return result
}

/** Admit the pipeline's fixed batch arguments and contained file references, never arbitrary CLI flags. */
function solverRequest(value: unknown): SolverRequest {
  const request = requestSchema.parse(value)
  const paths = [...Object.keys(request.files), ...request.outputFiles]
  if (!Object.keys(request.files).length || Object.keys(request.files).length > 256)
    throw new Error('Expected 1–256 input files')
  paths.forEach(relativeFile)
  const args = JSON.stringify(request.args)
  const outputs = JSON.stringify(request.outputFiles)
  if (request.solver === 'ngspice') {
    if (
      !(
        (args === '["-n","-b","-r","waveform.raw","simulation.cir"]' && outputs === '["waveform.raw"]') ||
        (args === '["-n","-b","simulation.cir"]' && outputs === '["waveform.dat"]')
      ) ||
      !Object.hasOwn(request.files, 'simulation.cir')
    )
      throw new Error('Expected pipeline ngspice batch arguments')
    for (const body of Object.values(request.files)) {
      let control = false
      for (const line of body.split(/\r?\n/).map((line) => line.trim())) {
        if (!line || line.startsWith('*')) continue
        if (/^\.control$/i.test(line)) {
          control = true
        } else if (/^\.endc$/i.test(line)) {
          control = false
        } else if (
          control &&
          !/^(?:set (?:wr_singlescale|wr_vecnames|numdgt=17)|save all|tran [\d.eE+\s-]+|let probe\d+ = [vV\d()n.eE+\s-]+|wrdata waveform\.dat(?: probe\d+)+|quit)$/i.test(
            line,
          )
        )
          throw new Error('Unsupported ngspice control command')
        else if (/^\.(?:include|inc|lib)\s/i.test(line)) {
          const path = line.split(/\s+/)[1].replace(/^['"]|['"]$/g, '')
          relativeFile(path)
          if (!Object.hasOwn(request.files, path)) throw new Error('Include must name a supplied input file')
        } else if (/^\.(?:sp|hdl|osdi|pre_osdi)\b/i.test(line)) throw new Error('External ngspice modules are disabled')
      }
    }
  }
  return request
}

/** Read bounded UTF-8 JSON with a deadline, releasing listeners on every path. */
async function readRequest(request: IncomingMessage, limit: number): Promise<unknown> {
  const bytes: Buffer[] = []
  return new Promise((resolve, reject) => {
    let size = 0
    /** Stop accepting a slow or oversized body without accumulating more bytes. */
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      request.removeListener('data', data)
      request.removeListener('end', end)
      request.removeListener('error', finish)
      request.removeListener('aborted', aborted)
      if (error) {
        request.resume()
        reject(error)
      }
    }
    /** Reject a disconnected request promptly. */
    const aborted = (): void => finish(new Error('Request aborted'))
    /** Count bytes before storing each chunk. */
    const data = (chunk: Buffer): void => {
      size += chunk.length
      if (size > limit) finish(Object.assign(new Error('Request body too large'), { status: 413 }))
      else bytes.push(chunk)
    }
    /** Parse only a complete body. */
    const end = (): void => {
      finish()
      try {
        resolve(JSON.parse(Buffer.concat(bytes).toString('utf8')))
      } catch {
        reject(new Error('Expected JSON request'))
      }
    }
    const timer = setTimeout(() => finish(Object.assign(new Error('Request body timed out'), { status: 408 })), 10000)
    request.on('data', data).once('end', end).once('error', finish).once('aborted', aborted)
  })
}

/** Same-origin local API. Native runs and version probes share one bounded queue and one CPU thread. */
export function createSolverMiddleware({
  runSolver = createNativeSolver({ timeoutMs: 120000 }),
  detectSolvers = detectLocalSolvers,
  maxRequestBytes = 16 * 1024 * 1024,
  modelDirectory = process.env.IBIS_MODEL_DIR ?? 'models',
  boardFile = process.env.SI_DDR3_BOARD,
}: SolverMiddlewareOptions = {}): Middleware {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  let solvers: Promise<LocalSolvers> | undefined
  /** Limit queued memory and preserve the slot even when a solver fails. */
  const queue = <T>(run: () => Promise<T>): Promise<T> => {
    if (pending >= 4) return Promise.reject(Object.assign(new Error('Local solver queue is full'), { status: 429 }))
    pending++
    const next = tail.then(run)
    tail = next
      .catch(() => undefined)
      .finally(() => {
        pending--
      })
    return next
  }
  return (request, response, next) => {
    const path = request.url?.split('?')[0] ?? ''
    if (!path.startsWith('/api/')) {
      next()
      return
    }
    /** JSON errors remain readable by the browser adapter; assets are never cached or exported. */
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(JSON.stringify(body))
    }
    /** Handle only the three local API routes; do not expose arbitrary filesystem reads. */
    const handle = async (): Promise<void> => {
      if (
        !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '') ||
        (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
      ) {
        send(403, { error: 'Expected same-origin 127.0.0.1 request' })
        return
      }
      if (path === '/api/solvers' && request.method === 'GET') {
        solvers ??= queue(detectSolvers).catch((error) => {
          solvers = undefined
          throw error
        })
        send(200, await solvers)
      } else if (path.startsWith('/api/local-assets/') && request.method === 'GET') {
        const name = path.slice('/api/local-assets/'.length)
        const file =
          name === 'ddr3-board.json'
            ? boardFile
            : ['sn74lvc1g04.ibs', 'sn65hvd72.ibs', 'sprm552c.ibs', 'W631GG6MB-12.ibs'].includes(name)
              ? join(modelDirectory, name)
              : undefined
        if (!file) {
          send(404, { error: `missing local asset: ${name === 'ddr3-board.json' ? 'SI_DDR3_BOARD (unset)' : name}` })
          return
        }
        try {
          send(200, { text: await readFile(file, 'utf8') })
        } catch {
          send(404, { error: `missing local asset: ${file}` })
        }
      } else if (path === '/api/run-solver' && request.method === 'POST') {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
          send(415, { error: 'Expected application/json' })
          return
        }
        const input = solverRequest(await readRequest(request, maxRequestBytes))
        try {
          send(200, await queue(() => runSolver(input)))
        } catch (error) {
          send(
            (error as { status?: number; code?: string }).status ??
              ((error as { code?: string }).code === 'native_timeout' ? 504 : 502),
            { error: (error as Error).message },
          )
        }
      } else
        send(path === '/api/solvers' || path === '/api/run-solver' ? 405 : 404, {
          error: 'Unknown API route or method',
        })
    }
    void handle().catch((error: Error & { status?: number }) => send(error.status ?? 400, { error: error.message }))
  }
}
