import React from 'react'
import './site/style.css'

/** Give every fixture the same readable local debugger layout. */
export default function Decorator({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <main>{children}</main>
}
