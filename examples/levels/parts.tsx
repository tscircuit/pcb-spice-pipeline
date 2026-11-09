import React from 'react'

/** Local vendor asset descriptor; vendor bytes are never redistributed. */
const asset = (file: string): { project_relative_path: string; url: string; mimetype: string } => ({ project_relative_path: `models/${file}`, url: `./models/${file}`, mimetype: 'text/plain' })

/** Designed pad fixture for real TI buffer models; internal gate logic is outside IBIS. */
export function Inverter({ name, x, y, driver, groundX = 0 }: { name: string; x: number; y: number; driver: boolean; groundX?: number }): React.JSX.Element {
  const pin = driver ? '4' : '2'
  const label = driver ? 'Y' : 'A'
  return <>
    <chip name={name} pcbX={x} pcbY={y} pinLabels={{ pin2: 'A', pin3: 'GND', pin4: 'Y', pin5: 'VCC' }} connections={{ VCC: 'net.VCC', GND: 'net.GND' }}
      footprint={<footprint>
        <smtpad portHints={[`pin${pin}`]} pcbX={0} pcbY={0} width={.3} height={.3} shape="rect" />
        <smtpad portHints={['pin3']} pcbX={groundX} pcbY={-3.5 - y} width={.5} height={.5} shape="rect" />
        <smtpad portHints={['pin5']} pcbX={0} pcbY={2} width={.5} height={.5} shape="rect" />
      </footprint>} />
    {/* @ts-expect-error Installed props require the removed corner/package props; the test adapter supplies them. */}
    <ibismodel componentRef={`.${name}`} ibisModelAsset={asset('sn74lvc1g04.ibs')} ibisComponentName="LVC1G04_DCK"
      ibisPinNameToPortLabel={{ [pin]: label, '3': 'GND', '5': 'VCC' }}
      ibisPinNameToModelName={{ [pin]: driver ? 'LVC1G04_OUT_33' : 'LVC1G04_IN_33' }}
      ibisPinNameToReferencePortLabels={{ [pin]: { pullup: 'VCC', pulldown: 'GND', powerClamp: 'VCC', groundClamp: 'GND' } }} />
  </>
}
/** Real SN65HVD72 bus buffers in a designed two-pad channel fixture. */
export function Transceiver({ name, x }: { name: string; x: number }): React.JSX.Element {
  return <>
    <chip name={name} pcbX={x} pinLabels={{ pin5: 'GND', pin6: 'A', pin7: 'B', pin8: 'VCC' }} connections={{ VCC: 'net.VCC', GND: 'net.GND' }}
      footprint={<footprint>
        <smtpad portHints={['pin6']} pcbX={0} pcbY={.3} width={.25} height={.25} shape="rect" />
        <smtpad portHints={['pin7']} pcbX={0} pcbY={-.3} width={.25} height={.25} shape="rect" />
        <smtpad portHints={['pin5']} pcbX={0} pcbY={-3.5} width={.5} height={.5} shape="rect" />
        <smtpad portHints={['pin8']} pcbX={0} pcbY={2} width={.5} height={.5} shape="rect" />
      </footprint>} />
    {/* @ts-expect-error Installed props require the removed corner/package props; the test adapter supplies them. */}
    <ibismodel componentRef={`.${name}`} ibisModelAsset={asset('sn65hvd72.ibs')} ibisComponentName="SN65HVD72D"
      ibisPinNameToPortLabel={{ '5': 'GND', '6': 'A', '7': 'B', '8': 'VCC' }} ibisPinNameToModelName={{ '6': 'a_b_p', '7': 'a_b_n' }}
      ibisPinNameToReferencePortLabels={{ '6': { pullup: 'VCC', pulldown: 'GND', powerClamp: 'VCC', groundClamp: 'GND' }, '7': { pullup: 'VCC', pulldown: 'GND', powerClamp: 'VCC', groundClamp: 'GND' } }} />
  </>
}
/** Same-layer finite ground copper avoids inventing missing via-plating data. */
export function Reference(): React.JSX.Element {
  return <>
    <voltagesource name="V3V3" voltage="3.3V" doNotPlace connections={{ pin1: 'net.VCC', pin2: 'net.GND' }} />
    <net name="GND" /><net name="VCC" />
    <copperpour name="POWER" layer="top" connectsTo="net.VCC" unbroken outline={[{ x: -6, y: 1.8 }, { x: 6, y: 1.8 }, { x: 6, y: 4 }, { x: -6, y: 4 }]} />
    <copperpour name="RETURN" layer="top" connectsTo="net.GND" unbroken outline={[{ x: -5.20001, y: -3 }, { x: 5.20001, y: -3 }, { x: 5.20001, y: -4 }, { x: -5.20001, y: -4 }]} />
  </>
}
