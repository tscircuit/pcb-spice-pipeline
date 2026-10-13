#!/usr/bin/env node
import { resolve } from 'node:path'
import { loadEntry,runPipeline } from './pipeline.mjs'
const args=process.argv.slice(2),entry=args[0],index=args.indexOf('--out')
if(!entry||index<1||!args[index+1]) {console.error('Usage: pcb-spice-pipeline entry.json|entry.tsx --out FRESH_DIRECTORY');process.exit(2)}
try {const receipt=await runPipeline({...await loadEntry(entry),outputDir:resolve(args[index+1]),onProgress:console.log});console.log(JSON.stringify({receipt:resolve(args[index+1],'receipt.json'),metrics:receipt.metrics},null,2))}
catch(e) {console.error(e.message);process.exitCode=1}
