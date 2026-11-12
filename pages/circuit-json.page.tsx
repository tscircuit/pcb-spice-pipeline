import React, { useMemo, useState } from 'react'
import { BoardPage } from '../site/debugger'
import type { CircuitJson } from '../src/board'

/** Paste or upload records without inventing geometry or simulation declarations. */
export default function CircuitJsonPage(): React.JSX.Element {
  const [text, setText] = useState('[]')
  const [records, setRecords] = useState<CircuitJson>()
  const [error, setError] = useState<string>()
  const models = useMemo(
    () => [
      ...new Set(
        (records ?? [])
          .filter((record) => record.type === 'simulation_ibis_model')
          .map((record) => record.ibis_model_asset.project_relative_path.split('/').at(-1)!),
      ),
    ],
    [records],
  )
  const loadBoard = useMemo(() => async (): Promise<CircuitJson> => records!, [records])
  return (
    <>
      <h1>Paste / upload Circuit JSON</h1>
      <p>Include physical copper, stackup, IBIS declarations and transient channel blocks.</p>
      <label>
        Circuit JSON file{' '}
        <input
          type="file"
          accept=".json"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file)
              void file
                .text()
                .then(setText)
                .catch((cause) => setError(String(cause)))
          }}
        />
      </label>
      <textarea aria-label="Circuit JSON" value={text} onChange={(event) => setText(event.target.value)} />
      <button
        onClick={() => {
          try {
            const value = JSON.parse(text) as unknown
            if (
              !Array.isArray(value) ||
              value.some((record) => !record || typeof record !== 'object' || typeof record.type !== 'string')
            )
              throw new Error('Expected an array of Circuit JSON records')
            setRecords(value as CircuitJson)
            setError(undefined)
          } catch (cause) {
            setError((cause as Error).message)
          }
        }}
      >
        Inspect circuit
      </button>
      {error && <p role="alert">{error}</p>}
      {records && <BoardPage title="Uploaded circuit" load-board={loadBoard} models={models} />}
    </>
  )
}
