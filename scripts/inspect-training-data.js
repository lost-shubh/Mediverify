const fs = require('fs')
const path = require('path')

const { extractImageMetrics } = require('../server/model/visualModel')

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'training-data')
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const KNOWN_CLASS_LAYOUTS = [
  { name: 'trainer-native', authentic: 'authentic', counterfeit: 'counterfeit' },
  { name: 'reference-consumer', authentic: 'reference', counterfeit: 'consumer' },
]

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

const collectFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const resolvedPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      return collectFiles(resolvedPath)
    }

    return [resolvedPath]
  })
}

const collectImageFiles = (dirPath) =>
  collectFiles(dirPath).filter((filePath) =>
    SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  )

const relative = (root, target) => path.relative(root, target).replaceAll('\\', '/')

const summarizeSplit = (root, dirName) => {
  const dirPath = path.join(root, dirName)
  const allFiles = collectFiles(dirPath)
  const supportedImages = collectImageFiles(dirPath)
  const unsupportedFiles = allFiles.filter(
    (filePath) => !SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  )

  return {
    name: dirName,
    exists: fs.existsSync(dirPath),
    totalFiles: allFiles.length,
    supportedImages: supportedImages.length,
    unsupportedFiles: unsupportedFiles.length,
    unsupportedExamples: unsupportedFiles.slice(0, 5).map((filePath) => relative(root, filePath)),
    imageExamples: supportedImages.slice(0, 5).map((filePath) => relative(root, filePath)),
    imagePaths: supportedImages,
  }
}

const readRootNotes = (root) => {
  const candidates = ['README', 'README.txt', 'README.md', 'readme', 'readme.txt', 'readme.md']

  for (const candidate of candidates) {
    const resolvedPath = path.join(root, candidate)
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      return fs.readFileSync(resolvedPath, 'utf8')
    }
  }

  return ''
}

const detectLayout = (root) => {
  for (const layout of KNOWN_CLASS_LAYOUTS) {
    const authenticDir = path.join(root, layout.authentic)
    const counterfeitDir = path.join(root, layout.counterfeit)

    if (fs.existsSync(authenticDir) && fs.existsSync(counterfeitDir)) {
      return layout
    }
  }

  return null
}

const verifyReadableImages = async (files) => {
  let readable = 0
  const failures = []

  for (const filePath of files) {
    try {
      await extractImageMetrics(filePath)
      readable += 1
    } catch (error) {
      failures.push({
        file: filePath,
        message: error.message,
      })
    }
  }

  return {
    readable,
    failures,
  }
}

const buildAssessment = ({
  root,
  layout,
  authenticSummary,
  counterfeitSummary,
  authenticReadability,
  counterfeitReadability,
  notes,
}) => {
  const trainerInputCompatible =
    Boolean(layout) &&
    authenticSummary.supportedImages > 0 &&
    counterfeitSummary.supportedImages > 0 &&
    authenticReadability.readable > 0 &&
    counterfeitReadability.readable > 0

  const profileBaselineCompatible =
    layout?.name === 'reference-consumer' &&
    authenticSummary.supportedImages > 0 &&
    counterfeitSummary.supportedImages > 0 &&
    authenticReadability.readable > 0 &&
    counterfeitReadability.readable > 0

  const smokeTestConvertible = profileBaselineCompatible

  const notesLower = notes.toLowerCase()
  const looksLikeCaptureQualitySplit =
    layout?.name === 'reference-consumer' ||
    notesLower.includes('consumer grade') ||
    notesLower.includes('reference (high quality)')

  const looksLikeSingleProductDataset = /ndc\s+\d{4,5}-\d{3,4}-\d{2}/i.test(notes)

  const suitableForRealCounterfeitTraining =
    trainerInputCompatible && !looksLikeCaptureQualitySplit && !looksLikeSingleProductDataset

  const recommendations = []

  if (!layout) {
    recommendations.push(
      'Add class folders named authentic/counterfeit for binary screening or reference/consumer for baseline-profile training.'
    )
  }

  if (profileBaselineCompatible) {
    recommendations.push(
      'The current trainer can use this dataset to build a known-good baseline artifact from reference and consumer captures.'
    )
    recommendations.push(
      'Do not use this dataset to claim counterfeit detection performance, because it appears to separate capture quality or source rather than authenticity.'
    )
  }

  if (looksLikeSingleProductDataset) {
    recommendations.push(
      'This sample appears to cover a single NDC/product, so it is too narrow for a general counterfeit detector.'
    )
  }

  if (authenticSummary.unsupportedFiles > 0 || counterfeitSummary.unsupportedFiles > 0) {
    recommendations.push(
      'Ignore or remove unsupported files such as spreadsheets, text files, and camera RAW files before training.'
    )
  }

  if (authenticReadability.failures.length > 0 || counterfeitReadability.failures.length > 0) {
    recommendations.push('Some supported image files could not be decoded by sharp and should be removed.')
  }

  if (trainerInputCompatible && suitableForRealCounterfeitTraining) {
    recommendations.push('This dataset is structurally compatible for real training with the current script.')
  }

  return {
    datasetRoot: root,
    detectedLayout: layout ? layout.name : 'unknown',
    trainerInputCompatible,
    profileBaselineCompatible,
    smokeTestConvertible,
    suitableForRealCounterfeitTraining,
    looksLikeCaptureQualitySplit,
    looksLikeSingleProductDataset,
    recommendations,
  }
}

const main = async () => {
  const args = parseArgs()
  const dataDir = path.resolve(args['data-dir'] || DEFAULT_DATA_DIR)

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Dataset directory does not exist: ${dataDir}`)
  }

  const notes = readRootNotes(dataDir)
  const layout = detectLayout(dataDir)
  const authenticName = layout?.authentic || 'authentic'
  const counterfeitName = layout?.counterfeit || 'counterfeit'

  const authenticSummary = summarizeSplit(dataDir, authenticName)
  const counterfeitSummary = summarizeSplit(dataDir, counterfeitName)
  const authenticReadability = await verifyReadableImages(authenticSummary.imagePaths)
  const counterfeitReadability = await verifyReadableImages(counterfeitSummary.imagePaths)

  const report = {
    assessment: buildAssessment({
      root: dataDir,
      layout,
      authenticSummary,
      counterfeitSummary,
      authenticReadability,
      counterfeitReadability,
      notes,
    }),
    splits: {
      authenticLike: {
        ...authenticSummary,
        readableImages: authenticReadability.readable,
        unreadableExamples: authenticReadability.failures
          .slice(0, 5)
          .map((entry) => ({
            file: relative(dataDir, entry.file),
            message: entry.message,
          })),
      },
      counterfeitLike: {
        ...counterfeitSummary,
        readableImages: counterfeitReadability.readable,
        unreadableExamples: counterfeitReadability.failures
          .slice(0, 5)
          .map((entry) => ({
            file: relative(dataDir, entry.file),
            message: entry.message,
          })),
      },
    },
    rootNotesPreview: notes ? notes.trim().split(/\r?\n/).slice(0, 6) : [],
  }

  delete report.splits.authenticLike.imagePaths
  delete report.splits.counterfeitLike.imagePaths

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(`[inspect-training-data] ${error.message}`)
  process.exit(1)
})
