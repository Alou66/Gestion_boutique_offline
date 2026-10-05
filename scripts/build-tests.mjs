import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

/**
 * Bundles the TypeScript test files (and the main process services they import)
 * into `dist-test/`, then `node --test` runs them.
 *
 * - `electron` is aliased to a stub: the services only need `app.getPath` to be
 *   pointed at a temporary folder, they do not need an Electron runtime.
 * - `better-sqlite3` stays external: it is a native module and must be required
 *   from node_modules at runtime.
 *
 * esbuild is already part of the project through Vite: no new dependency.
 */
const root = process.cwd()
const testsDir = path.join(root, 'tests')
const outDir = path.join(root, 'dist-test')

const entryPoints = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => path.join(testsDir, file))

if (entryPoints.length === 0) {
  throw new Error('No test file found in tests/*.test.ts')
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints,
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3'],
  alias: {
    electron: path.join(testsDir, 'stubs', 'electron.ts'),
    // Same alias as vite.config.ts, so the renderer modules can be tested.
    '@': path.join(root, 'src'),
  },
  logLevel: 'warning',
})

console.log(`Tests bundled into ${path.relative(root, outDir)}`)