import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BASE_COMMIT, BASE_SOURCE_SHA256, caseInput, digest, loadCases, prediction } from './fixtures.mjs'

const argv = process.argv.slice(2)
function option(name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`)
  return argv[index + 1]
}

const routerPath = option('--router')
const destination = option('--out')
const source = (routerPath
  ? readFileSync(routerPath, 'utf8')
  : execFileSync('git', ['show', `${BASE_COMMIT}:router.mjs`], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' })
).replace(/\r\n/g, '\n')
if (digest(source) !== BASE_SOURCE_SHA256) throw new Error('Baseline source does not match the pinned commit')

const { cases, checksum } = loadCases()
// The pinned CLI compares argv[1] directly with its resolved module path.
const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'amr-baseline-')))
const tempRouter = join(tempDir, 'router.mjs')
try {
  writeFileSync(tempRouter, source)
  const { decide } = await import(pathToFileURL(tempRouter))
  const rows = cases.map(row => {
    const { prompt, options } = caseInput(row)
    return { id: row.id, ...prediction(decide(prompt, options)) }
  })
  const catalogs = Object.fromEntries(['kimi', 'claude'].map(profile => {
    const listed = execFileSync(process.execPath, [tempRouter, 'models', '--profile', profile], {
      encoding: 'utf8', timeout: 8000,
    })
    return [profile, JSON.parse(listed).map(({ id, modalities, contextK, priceIn, priceOut }) => ({
      id, modalities, contextK, priceIn, priceOut,
    }))]
  }))
  const header = {
    schemaVersion: 2, baseCommit: BASE_COMMIT, sourceSha256: BASE_SOURCE_SHA256, fixtureSha256: checksum, catalogs,
  }
  const output = JSON.stringify(header, null, 2).slice(0, -2) + ',\n  "rows": [\n' +
    rows.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n'
  if (destination) writeFileSync(destination, output)
  else process.stdout.write(output)
} finally {
  unlinkSync(tempRouter)
  rmdirSync(tempDir)
}
