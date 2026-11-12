import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TestContext } from 'node:test'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createSolverMiddleware,
  detectLocalSolvers,
  type SolverMiddlewareOptions,
} from '../../src/adapters/solver-middleware'

const request = {
  solver: 'ngspice',
  files: { 'simulation.cir': 'title\n.tran 1e-11 4e-8\n.end' },
  args: ['-n', '-b', '-r', 'waveform.raw', 'simulation.cir'],
  outputFiles: ['waveform.raw'],
}
const result = { stdout: 'out', stderr: '', files: { 'waveform.raw': 'raw' } }
/** Bind a real HTTP boundary to an ephemeral loopback port, with deterministic solver IO. */
async function server(t: TestContext, options: SolverMiddlewareOptions = {}): Promise<string> {
  const middleware = createSolverMiddleware({
    runSolver: async () => result,
    detectSolvers: async () => ({ ngspice: { available: true, version: 'ngspice-test' } }),
    ...options,
  })
  const http = createServer((request, response) =>
    middleware(request, response, () => {
      response.writeHead(404)
      response.end()
    }),
  )
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()))
        http.closeAllConnections()
      }),
  )
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`
}
/** Send a JSON solver request through the same route used by the browser. */
async function post(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/run-solver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('reports ngspice only, caches version probes and returns the solver result unchanged', async (t) => {
  let probes = 0
  const url = await server(t, {
    detectSolvers: async () => {
      probes++
      return { ngspice: { available: true, version: 'ngspice-test' } }
    },
    runSolver: async (value) => {
      assert.deepEqual(value, request)
      return result
    },
  })
  assert.deepEqual(await (await fetch(`${url}/api/solvers`)).json(), {
    ngspice: { available: true, version: 'ngspice-test' },
  })
  await fetch(`${url}/api/solvers`)
  assert.equal(probes, 1)
  assert.deepEqual(await (await post(url, request)).json(), result)
  assert.equal((await fetch(`${url}/api/run-solver`)).status, 405)
})

test('rejects unsupported solvers, executable/cwd options, unsafe paths and unsafe ngspice commands before execution', async (t) => {
  let calls = 0
  const url = await server(t, {
    runSolver: async () => {
      calls++
      return result
    },
  })
  for (const value of [
    null,
    { ...request, solver: 'fasthenry' },
    { ...request, solver: 'fastercap' },
    { ...request, cwd: '/tmp' },
    { ...request, executable: '/bin/sh' },
    { ...request, files: { '../escape': '' } },
    { ...request, outputFiles: ['/tmp/escape'] },
    { ...request, args: ['-c', '/tmp/elsewhere'] },
    ...[
      '.control\nshell touch /tmp/escape\n.endc',
      '.control ignored-argument\nshell touch /tmp/escape\n.endc',
      '.include /tmp/secret',
      '.control\ncd /tmp\n.endc',
      '.osdi /tmp/module',
    ].map((deck) => ({ ...request, files: { 'simulation.cir': deck } })),
  ]) {
    assert.equal((await post(url, value)).status, 400)
  }
  assert.equal(calls, 0)
})

test('bounds body size, rejects malformed JSON/content types and rejects foreign hosts/origins', async (t) => {
  const url = await server(t, { maxRequestBytes: 512 })
  assert.equal((await post(url, { ...request, files: { 'simulation.cir': 'x'.repeat(1024) } })).status, 413)
  assert.equal(
    (
      await fetch(`${url}/api/run-solver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  )
  assert.equal((await fetch(`${url}/api/run-solver`, { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await fetch(`${url}/api/solvers`, { headers: { Origin: 'https://example.com' } })).status, 403)
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(`${url}/api/solvers`, { headers: { Host: 'example.com' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    }).on('error', reject)
  })
  assert.equal(status, 403)
})

test('serializes requests, including version probes, and releases the slot after failure', async (t) => {
  let active = 0
  let calls = 0
  const url = await server(t, {
    detectSolvers: async () => {
      assert.equal(active, 0)
      return { ngspice: { available: false } }
    },
    runSolver: async () => {
      assert.equal(active++, 0)
      const call = ++calls
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      active--
      if (call === 1) throw Object.assign(new Error('native timeout'), { code: 'native_timeout' })
      return result
    },
  })
  const replies = await Promise.all([
    post(url, request),
    post(url, request),
    fetch(`${url}/api/solvers`),
    post(url, request),
  ])
  assert.deepEqual(
    replies.map((reply) => reply.status),
    [504, 200, 200, 200],
  )
  assert.equal(calls, 3)
})

test('loads only fixed local asset names and reports missing paths without exposing arbitrary files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solver-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'sn74lvc1g04.ibs'), 'test asset')
  const url = await server(t, { modelDirectory: root })
  assert.deepEqual(await (await fetch(`${url}/api/local-assets/sn74lvc1g04.ibs`)).json(), { text: 'test asset' })
  assert.match(
    ((await (await fetch(`${url}/api/local-assets/sn65hvd72.ibs`)).json()) as { error: string }).error,
    /missing local asset: .*sn65hvd72.ibs/,
  )
  assert.equal((await fetch(`${url}/api/local-assets/secret.txt`)).status, 404)
  await writeFile(join(root, 'ddr3-board.json'), 'local board')
  assert.deepEqual(await (await fetch(`${url}/api/local-assets/ddr3-board.json`)).json(), { text: 'local board' })
  await rm(join(root, 'ddr3-board.json'))
  assert.match(
    ((await (await fetch(`${url}/api/local-assets/ddr3-board.json`)).json()) as { error: string }).error,
    /ddr3-board.json/,
  )
})

test('detects only the fixed ngspice executable on PATH and reports its version or absence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'solver-path-'))
  const previous = process.env.PATH
  t.after(async () => {
    process.env.PATH = previous
    await rm(root, { recursive: true, force: true })
  })
  process.env.PATH = root
  assert.deepEqual(await detectLocalSolvers(), { ngspice: { available: false } })
  await writeFile(join(root, 'ngspice'), '#!/bin/sh\necho ngspice-test\n')
  await chmod(join(root, 'ngspice'), 0o755)
  assert.deepEqual(await detectLocalSolvers(), { ngspice: { available: true, version: 'ngspice-test' } })
})

test('rejects an overfull queue and admits later work after a failed process', { timeout: 3000 }, async (t) => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  t.after(() => release())
  let calls = 0
  const url = await server(t, {
    runSolver: async () => {
      const call = ++calls
      if (call === 1) {
        await blocked
        throw new Error('ngspice failed')
      }
      return result
    },
  })
  const pending = Array.from({ length: 5 }, () => post(url, request))
  const extra = await Promise.race(pending)
  release()
  assert.equal(extra.status, 429)
  const replies = await Promise.all(pending)
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 200, 200, 429, 502])
  assert.equal((await post(url, request)).status, 200)
})
