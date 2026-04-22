const fs = require('fs')
const os = require('os')
const path = require('path')

const DEFAULT_RXIMAGE_DIR = path.join(os.homedir(), 'Downloads', 'rximage')
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'rximage-prepared')
const SUPPORTED_COLLECTIONS = new Map([
  ['rxnav', 'rxnavImageFileName'],
  ['nlm', 'nlmImageFileName'],
])

const parseArgs = () => {
  const tokens = process.argv.slice(2)
  const args = {}

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) continue

    if (token.includes('=')) {
      const [rawKey, rawValue] = token.slice(2).split('=')
      args[rawKey] = rawValue === undefined ? 'true' : rawValue
      continue
    }

    const nextToken = tokens[index + 1]
    if (nextToken && !nextToken.startsWith('--')) {
      args[token.slice(2)] = nextToken
      index += 1
      continue
    }

    args[token.slice(2)] = 'true'
  }

  return args
}

const parseCsvLine = (line) => {
  const values = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      const nextChar = line[index + 1]
      if (inQuotes && nextChar === '"') {
        current += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true })
}

const stageFile = (sourcePath, destinationPath) => {
  if (fs.existsSync(destinationPath)) {
    return 'existing'
  }

  try {
    fs.linkSync(sourcePath, destinationPath)
    return 'linked'
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM') {
      throw error
    }

    fs.copyFileSync(sourcePath, destinationPath)
    return 'copied'
  }
}

const main = () => {
  const args = parseArgs()
  const rximageDir = path.resolve(args['rximage-dir'] || DEFAULT_RXIMAGE_DIR)
  const outputDir = path.resolve(args['output-dir'] || DEFAULT_OUTPUT_DIR)
  const resolution = String(args.resolution || '1024')
  const collection = String(args.collection || 'rxnav').toLowerCase()
  const fileColumn = SUPPORTED_COLLECTIONS.get(collection)

  if (!fileColumn) {
    throw new Error(`Unsupported collection "${collection}". Use rxnav or nlm.`)
  }

  const tablePath = path.join(rximageDir, 'table.csv')
  if (!fs.existsSync(tablePath)) {
    throw new Error(`rximage table.csv not found under ${rximageDir}`)
  }

  const datasetRoot = path.join(outputDir, `${collection}-${resolution}`)
  const referenceDir = path.join(datasetRoot, 'reference')
  ensureDir(referenceDir)

  const lines = fs.readFileSync(tablePath, 'utf8').trim().split(/\r?\n/)
  const header = parseCsvLine(lines[0])
  const columnIndex = Object.fromEntries(header.map((name, index) => [name, index]))
  const requiredColumns = ['ndc11', 'rxcui', 'name', fileColumn]

  for (const column of requiredColumns) {
    if (columnIndex[column] === undefined) {
      throw new Error(`Missing required column "${column}" in ${tablePath}`)
    }
  }

  const selected = []
  const seenFiles = new Set()
  let linked = 0
  let copied = 0
  let existing = 0
  let missing = 0
  let duplicates = 0

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue

    const row = parseCsvLine(line)
    const fileName = row[columnIndex[fileColumn]]
    if (!fileName) {
      missing += 1
      continue
    }

    const sourcePath = path.join(rximageDir, 'image', 'images', 'gallery', resolution, fileName)
    if (!fs.existsSync(sourcePath)) {
      missing += 1
      continue
    }

    if (seenFiles.has(sourcePath)) {
      duplicates += 1
      continue
    }

    seenFiles.add(sourcePath)
    const destinationPath = path.join(referenceDir, path.basename(fileName))
    const staged = stageFile(sourcePath, destinationPath)

    if (staged === 'linked') linked += 1
    if (staged === 'copied') copied += 1
    if (staged === 'existing') existing += 1

    selected.push({
      ndc11: row[columnIndex.ndc11],
      rxcui: row[columnIndex.rxcui],
      name: row[columnIndex.name],
      collection,
      resolution,
      fileName: path.basename(fileName),
      relativePath: path.relative(datasetRoot, destinationPath).replaceAll('\\', '/'),
    })
  }

  const metadata = {
    source: 'rximage',
    rximageDir,
    preparedAt: new Date().toISOString(),
    collection,
    resolution,
    datasetRoot,
    classLayout: 'reference-only',
    filesPrepared: selected.length,
    linkMode: copied > 0 ? 'mixed' : 'hardlink',
    counts: {
      linked,
      copied,
      existing,
      missing,
      duplicates,
    },
    entries: selected,
  }

  fs.writeFileSync(
    path.join(datasetRoot, 'metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  )

  console.log(`[prepare-rximage] dataset root: ${datasetRoot}`)
  console.log(`[prepare-rximage] class layout: reference-only`)
  console.log(`[prepare-rximage] prepared files: ${selected.length}`)
  console.log(
    `[prepare-rximage] staged via linked=${linked}, copied=${copied}, existing=${existing}, missing=${missing}, duplicates=${duplicates}`
  )
}

try {
  main()
} catch (error) {
  console.error(`[prepare-rximage] ${error.message}`)
  process.exit(1)
}
