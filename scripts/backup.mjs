import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const name = `shujian-${stamp}`
const dir = join(root, 'backups')
const archive = join(dir, name + '.tar.gz')
const manifestPath = join(dir, name + '.json')

const excludes = [
  '.git', 'node_modules', '.tools', 'dist', 'backups', 'artifacts',
  '.local', '.env', '.env.*', '__pycache__', '*.tsbuildinfo',
  '.claude/handover/snapshots',
]

await mkdir(dir, { recursive: true })

// Pass a path relative to cwd: GNU tar reads "C:" in an absolute Windows path as a remote host.
const archiveArg = join('backups', name + '.tar.gz')
const args = ['-czf', archiveArg, ...excludes.flatMap(pattern => ['--exclude', pattern]), '.']
const tar = spawnSync('tar', args, { cwd: root, stdio: 'inherit' })
if (tar.error) {
  console.error('备份失败：找不到 tar。Windows 10+ 自带 tar，请确认 PATH。')
  process.exit(1)
}
if (tar.status !== 0) process.exit(tar.status ?? 1)

const hash = createHash('sha256')
await new Promise((ok, fail) => {
  createReadStream(archive).on('data', chunk => hash.update(chunk)).on('end', ok).on('error', fail)
})
const info = await stat(archive)
const git = (cmd) => spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? ''

const manifest = {
  createdAt: new Date().toISOString(),
  archive,
  bytes: info.size,
  sha256: hash.digest('hex'),
  gitHead: git(['rev-parse', 'HEAD']),
  gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  gitStatus: git(['status', '--short']),
  excludes,
  note: '本地完整工作副本备份（不含依赖、构建产物、密钥与本机配置）。backups/ 不入 Git。',
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log(`备份完成：${archive}`)
console.log(`大小：${(info.size / 1024 / 1024).toFixed(1)} MB`)
console.log(`SHA-256：${manifest.sha256}`)
console.log(`清单：${manifestPath}`)
