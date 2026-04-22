const fs = require('fs')
const path = require('path')

const {
  DEFAULT_MODEL_PATH,
  FEATURE_DESCRIPTIONS,
  extractImageMetrics,
  scoreMetrics,
} = require('../server/model/visualModel')

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'training-data')
const DEFAULT_OUTPUT = DEFAULT_MODEL_PATH
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const FEATURE_NORMALIZATION_FLOORS = {
  brightness: 0.08,
  saturation: 0.08,
  sharpness: 10,
  contrast: 0.08,
}

const KNOWN_LAYOUTS = [
  {
    name: 'authentic-counterfeit',
    decisionMode: 'binary-screening',
    type: 'feature-baseline',
    modelName: 'MedVerify Visual Counterfeit Baseline',
    classes: [
      { key: 'authentic', dir: 'authentic', label: 'Authentic reference' },
      { key: 'counterfeit', dir: 'counterfeit', label: 'Counterfeit reference' },
    ],
    thresholds: {
      manualReviewProbability: 0.35,
      counterfeitProbability: 0.56,
      binaryManualReviewProbability: 0.35,
      binaryFlagProbability: 0.56,
    },
    presentation: {
      scoreLabel: 'Counterfeit probability',
      featureSignalLabel: 'risk',
      featureHint:
        'Higher percentages mean the feature is drifting away from authentic reference samples and toward counterfeit reference samples.',
      clearTitle: 'Likely Genuine',
      clearCopy:
        'The extracted features remain closer to the authentic reference samples than the counterfeit samples.',
      reviewTitle: 'Manual Review Required',
      reviewCopy: 'The upload sits near the model boundary and needs human inspection.',
      flaggedTitle: 'Likely Counterfeit',
      flaggedCopy:
        'Multiple extracted features are closer to the counterfeit reference samples.',
    },
    limitations: [
      'This is a calibrated visual baseline, not a deep-learning image classifier.',
      'It does not read text, QR codes, holograms, or packaging layout semantics.',
    ],
    nextStepRequirements: [
      'Add more labeled authentic and counterfeit samples to improve calibration stability.',
      'Validate the artifact against a held-out evaluation split before making performance claims.',
    ],
  },
  {
    name: 'reference-only',
    decisionMode: 'profile-envelope',
    type: 'profile-baseline',
    modelName: 'MedVerify Authentic Reference Archive Baseline',
    classes: [{ key: 'reference', dir: 'reference', label: 'Authentic reference archive' }],
    thresholds: {
      manualReviewDistance: 1.15,
      flaggedDistance: 1.7,
    },
    presentation: {
      scoreLabel: 'Baseline variance',
      featureSignalLabel: 'variance',
      featureHint:
        'Higher percentages mean the feature is farther away from the authentic reference archive baseline.',
      clearTitle: 'Matches Reference Baseline',
      clearCopy:
        'The upload stays within the authentic reference archive envelope learned from the dataset.',
      reviewTitle: 'Manual Review Required',
      reviewCopy:
        'The upload is near the edge of the authentic reference archive baseline and should be inspected manually.',
      flaggedTitle: 'Outside Reference Baseline',
      flaggedCopy:
        'The upload falls outside the authentic reference archive envelope learned from the dataset.',
    },
    limitations: [
      'This artifact is trained only on authentic reference images, so it is an outlier detector rather than a binary counterfeit classifier.',
      'It does not identify the product; it only checks whether the upload stays inside the learned authentic-reference envelope.',
      'This is a calibrated visual baseline, not a deep-learning image classifier.',
    ],
    nextStepRequirements: [
      'Add consumer/mobile captures for the same products if you want a tighter known-good baseline.',
      'Add true counterfeit images if you want binary counterfeit screening instead of one-class outlier detection.',
    ],
  },
  {
    name: 'reference-consumer',
    decisionMode: 'profile-envelope',
    type: 'profile-baseline',
    modelName: 'MedVerify Visual Authentic Baseline',
    classes: [
      { key: 'reference', dir: 'reference', label: 'Reference capture' },
      { key: 'consumer', dir: 'consumer', label: 'Consumer capture' },
    ],
    thresholds: {
      manualReviewDistance: 1.15,
      flaggedDistance: 1.7,
    },
    presentation: {
      scoreLabel: 'Baseline variance',
      featureSignalLabel: 'variance',
      featureHint:
        'Higher percentages mean the feature is farther away from the known reference and consumer capture bands in the training set.',
      clearTitle: 'Within Known Baseline',
      clearCopy:
        'The upload stays within the reference and consumer capture envelope learned from the dataset.',
      reviewTitle: 'Manual Review Required',
      reviewCopy:
        'The upload is near the edge of the trained baseline and should be inspected manually.',
      flaggedTitle: 'Outside Known Baseline',
      flaggedCopy:
        'The upload falls outside the known reference and consumer capture envelope learned from the dataset.',
    },
    limitations: [
      'This artifact is trained on known-good reference and consumer captures, not counterfeit labels.',
      'If the dataset covers only one product, the resulting baseline is narrow and should not be treated as a general detector.',
      'This is a calibrated visual baseline, not a deep-learning image classifier.',
    ],
    nextStepRequirements: [
      'Add more known-good product images across multiple NDCs and capture conditions to widen the baseline envelope.',
      'Use a true authentic/counterfeit dataset if you want binary counterfeit screening instead of baseline matching.',
    ],
  },
]

const round = (value, digits = 4) => Number(value.toFixed(digits))

const buildSourceLabel = (sourcePath) => {
  const parts = path.resolve(sourcePath).split(path.sep).filter(Boolean)
  return parts.slice(-2).join('/')
}

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

const detectLayout = (rootDir) =>
  KNOWN_LAYOUTS.find((layout) =>
    layout.classes.every((entry) => fs.existsSync(path.join(rootDir, entry.dir)))
  ) || null

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

const getFeatureSpread = (feature, classSummaries, classes) => {
  const means = classes.map((entry) => Number(classSummaries[entry.key][feature].mean))
  let maxDifference = 0

  for (let left = 0; left < means.length; left += 1) {
    for (let right = left + 1; right < means.length; right += 1) {
      maxDifference = Math.max(maxDifference, Math.abs(means[left] - means[right]))
    }
  }

  return maxDifference
}

const getSingleClassFeatureWeightScore = (feature, classSummaries, classes) => {
  const summary = classSummaries[classes[0].key]?.[feature]
  const meanValue = Math.abs(Number(summary?.mean || 0))
  const stdDeviation = Number(summary?.stdDev || 0)
  const floor = FEATURE_NORMALIZATION_FLOORS[feature] || 0.1
  const normalizedStd = stdDeviation / Math.max(meanValue, floor)

  return 1 / Math.max(normalizedStd, 0.05)
}

const buildFeatureConfig = (layout, classSummaries) => {
  const featureNames = Object.keys(classSummaries[layout.classes[0].key] || {})
  const useSingleClassWeights = layout.classes.length === 1
  const totalWeightScore =
    featureNames.reduce((total, feature) => {
      return total +
        (useSingleClassWeights
          ? getSingleClassFeatureWeightScore(feature, classSummaries, layout.classes)
          : getFeatureSpread(feature, classSummaries, layout.classes))
    }, 0) || featureNames.length

  return featureNames.reduce((config, feature) => {
    const weightScore = useSingleClassWeights
      ? getSingleClassFeatureWeightScore(feature, classSummaries, layout.classes)
      : getFeatureSpread(feature, classSummaries, layout.classes)
    const profiles = layout.classes.reduce((profileConfig, entry) => {
      const summary = classSummaries[entry.key][feature]
      profileConfig[entry.key] = {
        mean: summary.mean,
        stdDev: summary.stdDev,
      }
      return profileConfig
    }, {})

    config[feature] = {
      description: FEATURE_DESCRIPTIONS[feature],
      profiles,
      weight: round(totalWeightScore > 0 ? weightScore / totalWeightScore : 1 / featureNames.length),
    }

    if (layout.name === 'authentic-counterfeit') {
      config[feature].authenticMean = profiles.authentic.mean
      config[feature].authenticStdDev = profiles.authentic.stdDev
      config[feature].counterfeitMean = profiles.counterfeit.mean
      config[feature].counterfeitStdDev = profiles.counterfeit.stdDev
    }

    return config
  }, {})
}

const quantile = (values, ratio) => {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * ratio
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) {
    return sorted[lower]
  }

  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

const calibrateProfileThresholds = (artifact, classSamples, classes) => {
  const distances = classes
    .flatMap((entry) =>
      classSamples[entry.key].map((sample) => scoreMetrics(sample, artifact).summary.weightedDeviation)
    )
    .filter((value) => Number.isFinite(value))

  if (distances.length === 0) {
    return artifact.thresholds
  }

  const p85 = quantile(distances, 0.85)
  const p95 = quantile(distances, 0.95)
  const observedMax = Math.max(...distances)

  if (classes.length === 1) {
    const manualReviewDistance = round(Math.max(1.25, p95 + 0.15), 3)
    const flaggedDistance = round(
      Math.max(manualReviewDistance + 0.75, observedMax + 0.5),
      3
    )

    return {
      manualReviewDistance,
      flaggedDistance,
      observedP95Distance: round(p95, 3),
      observedMaxDistance: round(observedMax, 3),
    }
  }

  const manualReviewDistance = round(Math.max(1.05, p85 + 0.15), 3)
  const flaggedDistance = round(
    Math.max(manualReviewDistance + 0.35, p95 + 0.35, observedMax + 0.2),
    3
  )

  return {
    manualReviewDistance,
    flaggedDistance,
    observedP95Distance: round(p95, 3),
    observedMaxDistance: round(observedMax, 3),
  }
}

const buildDataset = (layout, classSamples, source) => {
  const classes = layout.classes.map((entry) => ({
    key: entry.key,
    label: entry.label,
    samples: classSamples[entry.key].length,
  }))
  const totalSamples = classes.reduce((total, entry) => total + entry.samples, 0)
  const dataset = {
    layout: layout.name,
    totalSamples,
    source,
    classes,
  }

  if (layout.name === 'authentic-counterfeit') {
    dataset.authenticSamples = classSamples.authentic.length
    dataset.counterfeitSamples = classSamples.counterfeit.length
  }

  return dataset
}

const buildModelArtifact = ({ layout, classSamples, classSummaries, source }) => {
  const features = buildFeatureConfig(layout, classSummaries)
  const artifact = {
    name: layout.modelName,
    version: '1.1.0',
    type: layout.type,
    decisionMode: layout.decisionMode,
    trained: true,
    trainedAt: new Date().toISOString(),
    dataset: buildDataset(layout, classSamples, source),
    features,
    thresholds: { ...layout.thresholds },
    presentation: layout.presentation,
    limitations: layout.limitations,
    nextStepRequirements: layout.nextStepRequirements,
  }

  if (layout.decisionMode === 'profile-envelope') {
    const calibration = calibrateProfileThresholds(artifact, classSamples, layout.classes)
    artifact.thresholds = {
      manualReviewDistance: calibration.manualReviewDistance,
      flaggedDistance: calibration.flaggedDistance,
    }
    artifact.dataset.trainingEnvelope = {
      observedP95Distance: calibration.observedP95Distance,
      observedMaxDistance: calibration.observedMaxDistance,
    }
  }

  return artifact
}

const main = async () => {
  const args = parseArgs()
  const dataDir = path.resolve(args['data-dir'] || DEFAULT_DATA_DIR)
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT)
  const layout = detectLayout(dataDir)
  const sourceLabel = args['source-label'] || buildSourceLabel(dataDir)

  if (!layout) {
    throw new Error(
      'Training data not found. Expected training-data/authentic + training-data/counterfeit, training-data/reference + training-data/consumer, or training-data/reference.'
    )
  }

  const classFiles = layout.classes.reduce((accumulator, entry) => {
    accumulator[entry.key] = collectImageFiles(path.join(dataDir, entry.dir))
    return accumulator
  }, {})

  for (const entry of layout.classes) {
    if (classFiles[entry.key].length === 0) {
      throw new Error(`No supported images were found under ${path.join(dataDir, entry.dir)}.`)
    }

    console.log(`[train-model] ${entry.key} files: ${classFiles[entry.key].length}`)
  }

  const classSamples = {}
  for (const entry of layout.classes) {
    classSamples[entry.key] = await extractDatasetMetrics(entry.key, classFiles[entry.key])
  }

  for (const entry of layout.classes) {
    if (classSamples[entry.key].length === 0) {
      throw new Error(`No readable ${entry.key} images were available after feature extraction.`)
    }
  }

  const classSummaries = layout.classes.reduce((summaries, entry) => {
    summaries[entry.key] = summarizeMetrics(classSamples[entry.key])
    return summaries
  }, {})

  const artifact = buildModelArtifact({
    layout,
    classSamples,
    classSummaries,
    source: sourceLabel,
  })

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

  console.log(`[train-model] detected layout: ${layout.name}`)
  console.log(`[train-model] wrote model artifact to ${outputPath}`)
  console.log(
    `[train-model] training summary: ${artifact.dataset.classes
      .map((entry) => `${entry.key}=${entry.samples}`)
      .join(', ')}`
  )
}

main().catch((error) => {
  console.error(`[train-model] ${error.message}`)
  process.exit(1)
})
