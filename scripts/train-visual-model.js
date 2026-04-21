const fs = require('fs')
const path = require('path')

const {
  DEFAULT_MODEL_PATH,
  extractImageMetrics,
  loadVisualModel,
} = require('../server/model/visualModel')

const FEATURE_DESCRIPTIONS = {
  brightness: 'Average luminance across RGB channels.',
  saturation: 'Average color saturation from the mean RGB signature.',
  sharpness: 'Grayscale standard deviation used as a print clarity proxy.',
  contrast: 'Average RGB channel spread normalized to the 0-1 range.',
}

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'training-data')
const DEFAULT_OUTPUT = DEFAULT_MODEL_PATH
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

const round = (value, digits = 4) => Number(value.toFixed(digits))

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

const collectImageFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const resolvedPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      return collectImageFiles(resolvedPath)
    }

    return SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [resolvedPath] : []
  })
}

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length

const stdDev = (values, average) => {
  if (values.length <= 1) {
    return 0
  }

  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length

  return Math.sqrt(variance)
}

const summarizeMetrics = (samples) => {
  const featureNames = Object.keys(samples[0] || {})

  return featureNames.reduce((summary, feature) => {
    const values = samples.map((sample) => Number(sample[feature]))
    const average = mean(values)
    summary[feature] = {
      mean: round(average),
      stdDev: round(stdDev(values, average)),
    }
    return summary
  }, {})
}

const extractDatasetMetrics = async (label, files) => {
  const samples = []

  for (const filePath of files) {
    try {
      const metrics = await extractImageMetrics(filePath)
      samples.push(metrics)
    } catch (error) {
      console.warn(`[train-model] skipped ${label} sample ${filePath}: ${error.message}`)
    }
  }

  return samples
}

const buildModelArtifact = ({ authenticSummary, counterfeitSummary, authenticCount, counterfeitCount, source }) => {
  const currentModel = loadVisualModel()
  const featureNames = Object.keys(authenticSummary)
  const diffTotals = featureNames.reduce((total, feature) => {
    return total + Math.abs(authenticSummary[feature].mean - counterfeitSummary[feature].mean)
  }, 0)

  const features = featureNames.reduce((config, feature) => {
    const difference = Math.abs(authenticSummary[feature].mean - counterfeitSummary[feature].mean)

    config[feature] = {
      description: FEATURE_DESCRIPTIONS[feature],
      authenticMean: authenticSummary[feature].mean,
      counterfeitMean: counterfeitSummary[feature].mean,
      authenticStdDev: authenticSummary[feature].stdDev,
      counterfeitStdDev: counterfeitSummary[feature].stdDev,
      weight: round(diffTotals > 0 ? difference / diffTotals : 1 / featureNames.length),
    }

    return config
  }, {})

  return {
    ...currentModel,
    version: currentModel.version,
    trained: true,
    trainedAt: new Date().toISOString(),
    dataset: {
      authenticSamples: authenticCount,
      counterfeitSamples: counterfeitCount,
      source,
    },
    features,
  }
}

const main = async () => {
  const args = parseArgs()
  const dataDir = path.resolve(args['data-dir'] || DEFAULT_DATA_DIR)
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT)
  const authenticDir = path.join(dataDir, 'authentic')
  const counterfeitDir = path.join(dataDir, 'counterfeit')

  const authenticFiles = collectImageFiles(authenticDir)
  const counterfeitFiles = collectImageFiles(counterfeitDir)

  if (authenticFiles.length === 0 || counterfeitFiles.length === 0) {
    throw new Error(
      'Training data not found. Expected images under training-data/authentic and training-data/counterfeit.'
    )
  }

  console.log(`[train-model] authentic files: ${authenticFiles.length}`)
  console.log(`[train-model] counterfeit files: ${counterfeitFiles.length}`)

  const authenticSamples = await extractDatasetMetrics('authentic', authenticFiles)
  const counterfeitSamples = await extractDatasetMetrics('counterfeit', counterfeitFiles)

  if (authenticSamples.length === 0 || counterfeitSamples.length === 0) {
    throw new Error('No readable images were available after feature extraction.')
  }

  const authenticSummary = summarizeMetrics(authenticSamples)
  const counterfeitSummary = summarizeMetrics(counterfeitSamples)
  const artifact = buildModelArtifact({
    authenticSummary,
    counterfeitSummary,
    authenticCount: authenticSamples.length,
    counterfeitCount: counterfeitSamples.length,
    source: dataDir,
  })

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

  console.log(`[train-model] wrote model artifact to ${outputPath}`)
  console.log(
    `[train-model] training summary: authentic=${artifact.dataset.authenticSamples}, counterfeit=${artifact.dataset.counterfeitSamples}`
  )
}

main().catch((error) => {
  console.error(`[train-model] ${error.message}`)
  process.exit(1)
})
