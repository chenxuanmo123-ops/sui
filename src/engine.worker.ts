/// <reference lib="webworker" />
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { installSQL, runAggregate, runExplore, runCompare } from './analytics'
import { dropExtraTable, installExtraTable, runConsoleQuery } from './sql-console'
let db: Database | undefined, hash = ''
const SQL = initSqlJs({locateFile: () => wasmUrl})
self.onmessage = async ({data}) => {
 try {
  const runtime = await SQL
  if (!db || hash !== data.dataset.fingerprint) { db?.close(); db = new runtime.Database(); hash=''; installSQL(db, data.dataset); hash=data.dataset.fingerprint }
  const result = data.type === 'aggregate' ? runAggregate(db,data.dataset,data.mapping,data.question,data.analysisId,data.scope) : data.type === 'compare' ? runCompare(db,data.dataset,data.spec) : data.type === 'query' ? runConsoleQuery(db,data.sql) : data.type === 'table' ? (data.table ? installExtraTable(db,data.table) : dropExtraTable(db)) : runExplore(db,data.dataset,data.spec)
  self.postMessage({id:data.id,result})
 } catch(e) {self.postMessage({id:data.id,error:e instanceof Error?e.message:String(e)})}
}
