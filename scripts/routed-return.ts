import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { geometryFromCircuitJson } from '../src/board'
import { extractRouteReturn, type RouteReturn } from '../src/extraction'
import type { PreparedBlock } from '../src/pipeline/signals'
import { rootScope } from '../src/kernel'
import type { SolverRequest } from '../src/solver'
import { guardedFields } from './guarded-fields'

/** Read lossless native archives without changing request identity. */
async function archive(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return gunzipSync(await readFile(`${path}.gz`)).toString()
  }
}

/** Reuse exact completed field requests only; missing requests use the bounded serial field runner. */
export async function routedReturn(block: PreparedBlock, directory: string): Promise<RouteReturn> {
  const cache = new Map<string, string>()
  /** Index field calls, never accepted waveforms or approximately matched geometry. */
  const index = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) {
      const child = `${path}/${entry.name}`
      if (/^native-\d+-fasthenry$/.test(entry.name)) {
        const request = JSON.parse(await readFile(`${child}/request.json`, 'utf8')) as SolverRequest
        cache.set(createHash('sha256').update(JSON.stringify(request)).digest('hex'), child)
      } else if (!/^native-/.test(entry.name)) await index(child)
    }
  }
  if (process.env.SI_EXTRACTION_CACHE) for (const path of process.env.SI_EXTRACTION_CACHE.split(':')) await index(path)
  // Match the accepted 3D field contract: selected signal paths and the two endpoint
  // reference leads. Multi-net rail extraction is not part of that model.
  const geometry = geometryFromCircuitJson(block.circuit, { ...block.settings, copperScope: undefined })
  const calls: Record<string, unknown>[] = []
  const result = await extractRouteReturn(geometry, block.settings, rootScope('extraction'), { progress: console.log, runSolver: async request => {
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const previous = cache.get(digest)
    const path = `${directory}/native-${calls.length}-${request.solver}`
    calls.push({ request_sha256: digest, ...(previous ? { reused_from: previous } : {}) })
    await mkdir(path, { recursive: true })
    await writeFile(`${path}/request.json`, JSON.stringify(request))
    if (previous) return { stdout: await archive(`${previous}/stdout.log`), stderr: await archive(`${previous}/stderr.log`), files: Object.fromEntries(await Promise.all(request.outputFiles.map(async file => [file, await archive(`${previous}/${file}`)]))) }
    if (process.env.SI_REQUIRE_COMPLETE_CACHE === '1') throw new Error(`Exact return extraction cache missing: ${digest}`)
    return guardedFields(request, path)
  } }, process.env.SI_ROUTE_RETURN === 'series' ? 'series' : 'closure')
  await writeFile(`${directory}/return-extraction.json`, JSON.stringify({ geometry, calls, result: result.value }, null, 2))
  return result.value
}
