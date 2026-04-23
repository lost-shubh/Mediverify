const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const DEFAULT_MODEL_PATH = path.join(__dirname, 'model.json')

const FEATURE_LABELS = {
  brightness: 'Brightness',
  saturation: 'Saturation',
  sharpness: 'Sharpness',
  contrast: 'Contrast',
}

const FEATURE_DESCRIPTIONS = {
  brightness: 'Average luminance across RGB channels.',
  saturation: 'Average color saturation from the mean RGB signature.',
  sharpness: 'Grayscale standard deviation used as a print clarity proxy.',
  contrast: 'Average RGB channel spread normalized to the 0-1 range.',
}

const FEATURE_FLOORS = {
  brightness: 0.02,
  saturation: 0.03,
  sharpness: 0.8,
  contrast: 0.02,
}

const PROFILE_CLASSES = [
  { key: 'reference', label: 'Reference capture', samples: 0 },
  { key: 'consumer', label: 'Consumer capture', samples: 0 },
]

const BINARY_CLASSES = [
  { key: 'authentic', label: 'Authentic reference', samples: 0 },
  { key: 'counterfeit', label: 'Counterfeit reference', samples: 0 },
]

const createProfileFeatureDefaults = () => ({
  brightness: {
    description: FEATURE_DESCRIPTIONS.brightness,
    profiles: {
      reference: { mean: 0.62, stdDev: 0.04 },
      consumer: { mean: 0.57, stdDev: 0.08 },
    },
    weight: 0.26,
  },
  saturation: {
    description: FEATURE_DESCRIPTIONS.saturation,
    profiles: {
      reference: { mean: 0.48, stdDev: 0.03 },
      consumer: { mean: 0.43, stdDev: 0.08 },
    },
    weight: 0.24,
  },
  sharpness: {
    description: FEATURE_DESCRIPTIONS.sharpness,
    profiles: {
      reference: { mean: 12.5, stdDev: 1.1 },
      consumer: { mean: 9.8, stdDev: 2.4 },
    },
    weight: 0.32,
  },
  contrast: {
    description: FEATURE_DESCRIPTIONS.contrast,
    profiles: {
      reference: { mean: 0.19, stdDev: 0.02 },
      consumer: { mean: 0.16, stdDev: 0.03 },
    },
    weight: 0.18,
  },
})

const createBinaryFeatureDefaults = () => ({
  brightness: {
    description: FEATURE_DESCRIPTIONS.brightness,
    profiles: {
      authentic: { mean: 0.62, stdDev: 0.04 },
      counterfeit: { mean: 0.47, stdDev: 0.08 },
    },
    weight: 0.26,
  },
  saturation: {
    description: FEATURE_DESCRIPTIONS.saturation,
    profiles: {
      authentic: { mean: 0.48, stdDev: 0.03 },
      counterfeit: { mean: 0.3, stdDev: 0.08 },
    },
    weight: 0.24,
  },
  sharpness: {
    description: FEATURE_DESCRIPTIONS.sharpness,
    profiles: {
      authentic: { mean: 12.5, stdDev: 1.1 },
      counterfeit: { mean: 6.5, stdDev: 2.4 },
    },
    weight: 0.32,
  },
  contrast: {
    description: FEATURE_DESCRIPTIONS.contrast,
    profiles: {
      authentic: { mean: 0.19, stdDev: 0.02 },
      counterfeit: { mean: 0.11, stdDev: 0.03 },
    },
    weight: 0.18,
  },
})

const startCase = (value) =>
  String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim()

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits))

const buildDefaultPresentation = (decisionMode, classes) => {
  if (decisionMode === 'binary-screening') {
    const positiveLabel = classes[0]?.label || 'Authentic reference'
    const negativeLabel = classes[1]?.label || 'Counterfeit reference'

    return {
      scoreLabel: 'Counterfeit probability',
      featureSignalLabel: 'risk',
      featureHint: `Higher percentages mean the feature is drifting away from ${positiveLabel.toLowerCase()} and toward ${negativeLabel.toLowerCase()}.`,
      clearTitle: 'Likely Genuine',
      clearCopy: `The extracted features remain closer to ${positiveLabel.toLowerCase()} than ${negativeLabel.toLowerCase()}.`,
      reviewTitle: 'Manual Review Required',
      reviewCopy: 'The upload sits near the model boundary and needs human inspection.',
      flaggedTitle: 'Likely Counterfeit',
      flaggedCopy: `Multiple extracted features are closer to ${negativeLabel.toLowerCase()}.`,
    }
  }

  const classList = classes.map((entry) => entry.label.toLowerCase()).join(' and ')

  return {
    scoreLabel: 'Baseline variance',
    featureSignalLabel: 'variance',
    featureHint: `Higher percentages mean the feature is farther away from the known ${classList} bands in the training set.`,
    clearTitle: 'Within Known Baseline',
    clearCopy: `The upload stays within the ${classList} envelope learned from the dataset.`,
    reviewTitle: 'Manual Review Required',
    reviewCopy: 'The upload is near the edge of the trained baseline and should be inspected manually.',
    flaggedTitle: 'Outside Known Baseline',
    flaggedCopy: `The upload falls outside the known ${classList} envelope learned from the dataset.`,
  }
}

const buildDefaultModel = (decisionMode = 'profile-envelope') => {
  const isBinary = decisionMode === 'binary-screening'
  const classes = isBinary ? BINARY_CLASSES : PROFILE_CLASSES
  const features = isBinary ? createBinaryFeatureDefaults() : createProfileFeatureDefaults()

  return {
    name: isBinary ? 'MedVerify Visual Counterfeit Baseline' : 'MedVerify Visual Authentic Baseline',
    version: '1.1.0',
    type: isBinary ? 'feature-baseline' : 'profile-baseline',
    decisionMode,
    trained: false,
    trainedAt: null,
    dataset: {
      layout: isBinary ? 'authentic-counterfeit' : 'reference-consumer',
      totalSamples: 0,
      source: isBinary
        ? 'No labeled counterfeit dataset has been added to this repo yet.'
        : 'No labeled baseline dataset has been added to this repo yet.',
      classes,
    },
    features,
    thresholds: isBinary
      ? {
          manualReviewProbability: 0.35,
          counterfeitProbability: 0.56,
          binaryManualReviewProbability: 0.35,
          binaryFlagProbability: 0.56,
        }
      : {
          manualReviewDistance: 1.15,
          flaggedDistance: 1.7,
        },
    presentation: buildDefaultPresentation(decisionMode, classes),
    limitations: isBinary
      ? [
          'This is a calibrated visual baseline, not a deep-learning image classifier.',
          'It does not read text, QR codes, holograms, or packaging layout semantics.',
          'The deployed report feed is in-memory and can reset when a serverless instance is recycled.',
        ]
      : [
          'This is a calibrated visual baseline, not a deep-learning image classifier.',
          'Reference and consumer captures are treated as known-good visual profiles, not counterfeit labels.',
          'The baseline can only speak about the products and capture conditions present in the training set.',
        ],
    nextStepRequirements: isBinary
      ? [
          'Add labeled authentic and counterfeit medicine images under training-data/authentic and training-data/counterfeit.',
          'Run npm run train:model to generate a dataset-derived model artifact.',
          'Add durable storage if you need reports to survive Vercel cold starts.',
        ]
      : [
          'Add more known-good product images across multiple NDCs and capture conditions to widen the baseline envelope.',
          'Use a real authentic/counterfeit dataset if you want binary counterfeit screening instead of baseline matching.',
          'Add durable storage if you need reports to survive Vercel cold starts.',
        ],
  }
}

const getFeatureDigits = (feature) => (feature === 'sharpness' ? 2 : 3)

const inferDecisionMode = (parsed) => {
  if (parsed?.decisionMode) {
    return parsed.decisionMode
  }

  if (
    parsed?.dataset?.layout === 'reference-consumer' ||
    parsed?.dataset?.layout === 'reference-only' ||
    parsed?.type === 'profile-baseline'
  ) {
    return 'profile-envelope'
  }

  if (
    parsed?.dataset?.layout === 'authentic-counterfeit' ||
    parsed?.dataset?.authenticSamples !== undefined ||
    parsed?.dataset?.counterfeitSamples !== undefined
  ) {
    return 'binary-screening'
  }

  return 'profile-envelope'
}

const normalizeClassEntry = (entry, fallbackSamples = 0) => {
  const key = String(entry?.key || entry?.name || '').trim()

  if (!key) {
    return null
  }

  return {
    key,
    label: entry?.label || startCase(key),
    samples: Number(entry?.samples ?? fallbackSamples ?? 0),
  }
}

const inferClasses = (parsed, decisionMode) => {
  const datasetClasses = Array.isArray(parsed?.dataset?.classes)
    ? parsed.dataset.classes.map((entry) => normalizeClassEntry(entry)).filter(Boolean)
    : []

  if (datasetClasses.length >= 1) {
    return datasetClasses
  }

  const featureEntry = Object.values(parsed?.features || {}).find(
    (config) => config && typeof config === 'object'
  )
  const profileKeys = Object.keys(featureEntry?.profiles || {})

  if (profileKeys.length >= 1) {
    return profileKeys.map((key) =>
      normalizeClassEntry(
        {
          key,
          label: startCase(key),
          samples: parsed?.dataset?.samples?.[key] || 0,
        },
        0
      )
    )
  }

  if (decisionMode === 'binary-screening') {
    return [
      normalizeClassEntry(
        {
          key: 'authentic',
          label: 'Authentic reference',
          samples: parsed?.dataset?.authenticSamples || 0,
        },
        0
      ),
      normalizeClassEntry(
        {
          key: 'counterfeit',
          label: 'Counterfeit reference',
          samples: parsed?.dataset?.counterfeitSamples || 0,
        },
        0
      ),
    ]
  }

  return PROFILE_CLASSES.map((entry) => ({ ...entry }))
}

const normalizeFeatureProfiles = (feature, classes) => {
  if (feature?.profiles && typeof feature.profiles === 'object') {
    return classes.reduce((profiles, entry) => {
      const config = feature.profiles[entry.key]
      if (!config) return profiles

      profiles[entry.key] = {
        mean: Number(config.mean),
        stdDev: Number(config.stdDev || 0),
      }
      return profiles
    }, {})
  }

  if (feature?.authenticMean !== undefined || feature?.counterfeitMean !== undefined) {
    return {
      authentic: {
        mean: Number(feature.authenticMean),
        stdDev: Number(feature.authenticStdDev || 0),
      },
      counterfeit: {
        mean: Number(feature.counterfeitMean),
        stdDev: Number(feature.counterfeitStdDev || 0),
      },
    }
  }

  return {}
}

const normalizeFeatures = (parsedFeatures, classes, defaultFeatures) => {
  const features = {}
  const featureKeys = new Set([
    ...Object.keys(defaultFeatures || {}),
    ...Object.keys(parsedFeatures || {}),
  ])

  for (const featureKey of featureKeys) {
    const fallback = defaultFeatures?.[featureKey] || {
      description: FEATURE_DESCRIPTIONS[featureKey],
      profiles: {},
      weight: 0,
    }
    const parsed = parsedFeatures?.[featureKey] || {}
    const profiles = normalizeFeatureProfiles(parsed, classes)
    const mergedProfiles =
      Object.keys(profiles).length > 0 ? profiles : normalizeFeatureProfiles(fallback, classes)

    features[featureKey] = {
      description: parsed.description || fallback.description || FEATURE_DESCRIPTIONS[featureKey],
      weight: Number(parsed.weight ?? fallback.weight ?? 0),
      profiles: mergedProfiles,
    }

    if (mergedProfiles.authentic) {
      features[featureKey].authenticMean = mergedProfiles.authentic.mean
      features[featureKey].authenticStdDev = mergedProfiles.authentic.stdDev
    }

    if (mergedProfiles.counterfeit) {
      features[featureKey].counterfeitMean = mergedProfiles.counterfeit.mean
      features[featureKey].counterfeitStdDev = mergedProfiles.counterfeit.stdDev
    }
  }

  return features
}

const normalizeThresholds = (thresholds, decisionMode, defaults) => {
  if (decisionMode === 'binary-screening') {
    const manualReviewProbability = Number(
      thresholds?.binaryManualReviewProbability ??
        thresholds?.manualReviewProbability ??
        defaults.thresholds.binaryManualReviewProbability
    )
    const counterfeitProbability = Number(
      thresholds?.binaryFlagProbability ??
        thresholds?.counterfeitProbability ??
        defaults.thresholds.binaryFlagProbability
    )

    return {
      manualReviewProbability,
      counterfeitProbability,
      binaryManualReviewProbability: manualReviewProbability,
      binaryFlagProbability: counterfeitProbability,
    }
  }

  return {
    manualReviewDistance: Number(
      thresholds?.manualReviewDistance ?? defaults.thresholds.manualReviewDistance
    ),
    flaggedDistance: Number(thresholds?.flaggedDistance ?? defaults.thresholds.flaggedDistance),
  }
}

const normalizeDataset = (dataset, classes, defaults) => {
  const normalizedClasses = classes.map((entry) => {
    const datasetEntry = Array.isArray(dataset?.classes)
      ? dataset.classes.find((candidate) => candidate?.key === entry.key)
      : null

    return {
      ...entry,
      label: datasetEntry?.label || entry.label,
      samples: Number(datasetEntry?.samples ?? entry.samples ?? 0),
    }
  })

  const totalSamples =
    Number(dataset?.totalSamples) ||
    normalizedClasses.reduce((total, entry) => total + Number(entry.samples || 0), 0)

  const normalizedDataset = {
    ...defaults.dataset,
    ...(dataset || {}),
    layout: dataset?.layout || defaults.dataset.layout,
    totalSamples,
    classes: normalizedClasses,
  }

  if (!normalizedDataset.source) {
    normalizedDataset.source = defaults.dataset.source
  }

  if (normalizedDataset.layout === 'authentic-counterfeit') {
    normalizedDataset.authenticSamples = Number(
      dataset?.authenticSamples ??
        normalizedClasses.find((entry) => entry.key === 'authentic')?.samples ??
        0
    )
    normalizedDataset.counterfeitSamples = Number(
      dataset?.counterfeitSamples ??
        normalizedClasses.find((entry) => entry.key === 'counterfeit')?.samples ??
        0
    )
  }

  return normalizedDataset
}

const normalizeModel = (parsed = {}) => {
  const decisionMode = inferDecisionMode(parsed)
  const defaults = buildDefaultModel(decisionMode)
  const classes = inferClasses(parsed, decisionMode)
  const features = normalizeFeatures(parsed.features, classes, defaults.features)

  return {
    ...defaults,
    ...parsed,
    name: parsed.name || defaults.name,
    version: parsed.version || defaults.version,
    type: parsed.type || defaults.type,
    decisionMode,
    trained: Boolean(parsed.trained ?? defaults.trained),
    trainedAt: parsed.trainedAt || defaults.trainedAt,
    dataset: normalizeDataset(parsed.dataset, classes, defaults),
    thresholds: normalizeThresholds(parsed.thresholds, decisionMode, defaults),
    presentation: {
      ...defaults.presentation,
      ...(parsed.presentation || {}),
    },
    features,
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations : defaults.limitations,
    nextStepRequirements: Array.isArray(parsed.nextStepRequirements)
      ? parsed.nextStepRequirements
      : defaults.nextStepRequirements,
  }
}

const loadVisualModel = () => {
  try {
    const raw = fs.readFileSync(DEFAULT_MODEL_PATH, 'utf8')
    return normalizeModel(JSON.parse(raw))
  } catch (error) {
    console.warn('Failed to load trained model artifact, using fallback baseline.', error.message)
    return normalizeModel()
  }
}

const toHsl = (r, g, b) => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  }

  return { saturation: s, lightness: l }
}

const getChannelStats = (buffer, channels) => {
  const channelCount = Math.max(Number(channels || 0), 1)
  const pixels = buffer.length / channelCount
  const sums = new Array(channelCount).fill(0)
  const squareSums = new Array(channelCount).fill(0)

  for (let index = 0; index < buffer.length; index += channelCount) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = buffer[index + channel]
      sums[channel] += value
      squareSums[channel] += value * value
    }
  }

  return sums.map((sum, channel) => {
    const average = sum / pixels
    const variance = Math.max(squareSums[channel] / pixels - average * average, 0)

    return {
      mean: average,
      stdev: Math.sqrt(variance),
    }
  })
}

const computeEdgeDensity = (buffer, width, height, channels = 1) => {
  if (width < 2 || height < 2) {
    return 0
  }

  let strongEdges = 0
  let comparisons = 0
  const threshold = 18

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = (y * width + x) * channels
      const current = buffer[index]
      const right = buffer[index + channels]
      const down = buffer[index + width * channels]
      const delta = Math.max(Math.abs(current - right), Math.abs(current - down))

      if (delta >= threshold) {
        strongEdges += 1
      }

      comparisons += 1
    }
  }

  return comparisons > 0 ? strongEdges / comparisons : 0
}

const isSkinTone = (r, g, b) => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    max - min > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b
  )
}

const computeSkinToneCoverage = (buffer, width, height, channels = 3) => {
  if (channels < 3 || width < 1 || height < 1) {
    return {
      skinToneCoverage: 0,
      centerSkinToneCoverage: 0,
    }
  }

  let skinPixels = 0
  let totalPixels = 0
  let centerSkinPixels = 0
  let centerPixels = 0
  const centerLeft = Math.floor(width * 0.2)
  const centerRight = Math.ceil(width * 0.8)
  const centerTop = Math.floor(height * 0.2)
  const centerBottom = Math.ceil(height * 0.8)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels
      const r = buffer[index]
      const g = buffer[index + 1]
      const b = buffer[index + 2]
      const skinTone = isSkinTone(r, g, b)

      totalPixels += 1
      if (skinTone) {
        skinPixels += 1
      }

      if (x >= centerLeft && x < centerRight && y >= centerTop && y < centerBottom) {
        centerPixels += 1
        if (skinTone) {
          centerSkinPixels += 1
        }
      }
    }
  }

  return {
    skinToneCoverage: totalPixels > 0 ? skinPixels / totalPixels : 0,
    centerSkinToneCoverage: centerPixels > 0 ? centerSkinPixels / centerPixels : 0,
  }
}

const extractImageMetrics = async (imageSource) => {
  const colorImage = sharp(imageSource).rotate().removeAlpha().toColourspace('srgb')
  const { data: rgbBuffer, info: rgbInfo } = await colorImage
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const rgbChannels = getChannelStats(rgbBuffer, rgbInfo.channels).slice(0, 3)

  if (rgbChannels.length < 3) {
    throw new Error('Image must contain RGB color channels.')
  }

  const [r, g, b] = rgbChannels.map((channel) => channel.mean)
  const brightness = (r + g + b) / (rgbChannels.length * 255)
  const { saturation } = toHsl(r, g, b)
  const { data: grayscaleBuffer, info: grayscaleInfo } = await colorImage
    .clone()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const grayscaleChannel = getChannelStats(grayscaleBuffer, grayscaleInfo.channels)[0]
  const sharpness = grayscaleChannel.stdev
  const edgeDensity = computeEdgeDensity(
    grayscaleBuffer,
    grayscaleInfo.width,
    grayscaleInfo.height,
    grayscaleInfo.channels
  )
  const contrast =
    rgbChannels.reduce((total, channel) => total + channel.stdev, 0) /
    (rgbChannels.length * 255)
  const { skinToneCoverage, centerSkinToneCoverage } = computeSkinToneCoverage(
    rgbBuffer,
    rgbInfo.width,
    rgbInfo.height,
    rgbInfo.channels
  )

  return {
    brightness: round(brightness),
    saturation: round(saturation),
    sharpness: round(sharpness, 2),
    contrast: round(contrast),
    edgeDensity: round(edgeDensity),
    skinToneCoverage: round(skinToneCoverage),
    centerSkinToneCoverage: round(centerSkinToneCoverage),
  }
}

const validateImageMetrics = (metrics) => {
  const brightness = Number(metrics?.brightness)
  const saturation = Number(metrics?.saturation)
  const sharpness = Number(metrics?.sharpness)
  const contrast = Number(metrics?.contrast)
  const edgeDensity = Number(metrics?.edgeDensity)
  const skinToneCoverage = Number(metrics?.skinToneCoverage)
  const centerSkinToneCoverage = Number(metrics?.centerSkinToneCoverage)

  if (
    ![
      brightness,
      saturation,
      sharpness,
      contrast,
      edgeDensity,
      skinToneCoverage,
      centerSkinToneCoverage,
    ].every(Number.isFinite)
  ) {
    const error = new Error('Could not extract a reliable visual fingerprint from this image.')
    error.statusCode = 400
    throw error
  }

  const isNearSolidFrame = contrast < 0.015 && sharpness < 2
  const isBlankWhiteCapture = brightness > 0.94 && saturation < 0.04 && contrast < 0.02
  const isBlankDarkCapture = brightness < 0.06 && contrast < 0.02 && sharpness < 2
  const isLowInformationCapture =
    saturation < 0.02 && contrast < 0.012 && sharpness < 1.5
  const isLikelyPortraitLikeCapture =
    skinToneCoverage > 0.18 &&
    centerSkinToneCoverage > 0.24 &&
    edgeDensity < 0.11 &&
    contrast < 0.16

  if (isBlankWhiteCapture || isBlankDarkCapture || isNearSolidFrame || isLowInformationCapture) {
    const error = new Error(
      'The image does not contain enough medicine-packaging detail. Upload a clear photo of the blister pack, label, or bottle.'
    )
    error.statusCode = 400
    throw error
  }

  if (isLikelyPortraitLikeCapture) {
    const error = new Error(
      'This looks like a face or portrait photo, not a medicine package. Upload a clear photo of the blister pack, label, or bottle only.'
    )
    error.statusCode = 400
    throw error
  }
}

const getProfileEntries = (config, classes, feature) =>
  classes
    .map((entry) => {
      const profile = config.profiles?.[entry.key]

      if (!profile || !Number.isFinite(Number(profile.mean))) {
        return null
      }

      return {
        key: entry.key,
        label: entry.label,
        mean: Number(profile.mean),
        stdDev: Number(profile.stdDev || 0),
        digits: getFeatureDigits(feature),
      }
    })
    .filter(Boolean)

const getProfileScale = (feature, profiles, profile) => {
  const means = profiles.map((entry) => entry.mean)
  const spread = means.length > 1 ? Math.max(...means) - Math.min(...means) : 0
  const fallbackScale = FEATURE_FLOORS[feature] || 0.05
  const relativeSpread = spread > 0 ? spread / Math.max(profiles.length, 2) : 0

  return Math.max(Number(profile.stdDev || 0), relativeSpread, fallbackScale)
}

const buildFeatureProfiles = (profiles) =>
  profiles.map((profile) => ({
    key: profile.key,
    label: profile.label,
    mean: round(profile.mean, profile.digits),
  }))

const buildResultPresentation = (status, presentation) => ({
  title:
    status === 'flagged'
      ? presentation.flaggedTitle
      : status === 'manual-review'
        ? presentation.reviewTitle
        : presentation.clearTitle,
  copy:
    status === 'flagged'
      ? presentation.flaggedCopy
      : status === 'manual-review'
        ? presentation.reviewCopy
        : presentation.clearCopy,
  tone: status === 'flagged' ? 'rose' : status === 'manual-review' ? 'amber' : 'emerald',
  scoreLabel: presentation.scoreLabel,
  featureSignalLabel: presentation.featureSignalLabel,
  featureHint: presentation.featureHint,
})

const getBinaryProgress = (value, authenticMean, counterfeitMean) => {
  if (!Number.isFinite(value) || authenticMean === counterfeitMean) {
    return 0
  }

  if (counterfeitMean > authenticMean) {
    return clamp((value - authenticMean) / (counterfeitMean - authenticMean))
  }

  return clamp((authenticMean - value) / (authenticMean - counterfeitMean))
}

const buildBinaryIssues = (featureSignals, status, model) => {
  const positiveLabel = model.dataset.classes[0]?.label || 'Authentic reference'
  const negativeLabel = model.dataset.classes[1]?.label || 'Counterfeit reference'
  const issues = featureSignals
    .filter((signal) => signal.signalPercent >= 55)
    .sort((a, b) => b.signalPercent - a.signalPercent)
    .slice(0, 3)
    .map((signal) => {
      if (signal.feature === 'sharpness') {
        return `Print sharpness is drifting away from ${positiveLabel.toLowerCase()} and toward ${negativeLabel.toLowerCase()}.`
      }

      return `${signal.label} is closer to ${negativeLabel.toLowerCase()} than ${positiveLabel.toLowerCase()}.`
    })

  if (issues.length === 0 && status === 'manual-review') {
    issues.push('The scan sits close to the review boundary and should be inspected manually.')
  }

  return issues
}

const scoreBinaryModel = (metrics, model) => {
  const features = Object.entries(model.features || {})
  const totalWeight =
    features.reduce((total, [, config]) => total + Number(config.weight || 0), 0) || 1

  const featureSignals = features.map(([feature, config]) => {
    const digits = getFeatureDigits(feature)
    const profiles = getProfileEntries(config, model.dataset.classes, feature)
    const authenticProfile = profiles.find((entry) => entry.key === 'authentic') || profiles[0]
    const counterfeitProfile =
      profiles.find((entry) => entry.key === 'counterfeit') || profiles[1] || profiles[0]
    const value = Number(metrics[feature])
    const risk = getBinaryProgress(value, authenticProfile?.mean, counterfeitProfile?.mean)

    return {
      feature,
      label: FEATURE_LABELS[feature] || feature,
      value: round(value, digits),
      weight: Number(config.weight || 0),
      weightPercent: Math.round((Number(config.weight || 0) / totalWeight) * 100),
      description: config.description,
      signalPercent: Math.round(risk * 100),
      signalLabel: model.presentation.featureSignalLabel,
      risk: round(risk),
      profileMeans: buildFeatureProfiles(profiles),
      closestProfile:
        risk >= 0.5
          ? {
              key: counterfeitProfile?.key,
              label: counterfeitProfile?.label,
              mean: round(counterfeitProfile?.mean, digits),
            }
          : {
              key: authenticProfile?.key,
              label: authenticProfile?.label,
              mean: round(authenticProfile?.mean, digits),
            },
    }
  })

  const weightedRisk =
    featureSignals.reduce((total, signal) => total + signal.risk * signal.weight, 0) / totalWeight
  const manualReviewProbability = Number(model.thresholds.binaryManualReviewProbability || 0.35)
  const counterfeitProbabilityThreshold = Number(model.thresholds.binaryFlagProbability || 0.56)

  let status = 'clear'
  if (weightedRisk >= counterfeitProbabilityThreshold) {
    status = 'flagged'
  } else if (weightedRisk >= manualReviewProbability) {
    status = 'manual-review'
  }

  const issues = buildBinaryIssues(featureSignals, status, model)
  const certainty =
    status === 'flagged'
      ? weightedRisk
      : status === 'manual-review'
        ? 0.5 + Math.abs(weightedRisk - 0.5)
        : 1 - weightedRisk

  return {
    status,
    verified: status === 'clear',
    needsReview: status === 'manual-review',
    confidence: Math.round(clamp(certainty, 0.4, 0.99) * 100),
    scorePercent: Math.round(weightedRisk * 100),
    scoreLabel: model.presentation.scoreLabel,
    counterfeitProbability: Math.round(weightedRisk * 100),
    issues,
    featureSignals,
    closestProfile:
      weightedRisk >= 0.5
        ? model.dataset.classes.find((entry) => entry.key === 'counterfeit') || model.dataset.classes[1]
        : model.dataset.classes.find((entry) => entry.key === 'authentic') || model.dataset.classes[0],
    model: {
      name: model.name,
      version: model.version,
      type: model.type,
      decisionMode: model.decisionMode,
      trained: Boolean(model.trained),
      trainedAt: model.trainedAt || null,
    },
    presentation: buildResultPresentation(status, model.presentation),
    summary: {
      weightedRisk: round(weightedRisk),
      manualReviewThreshold: round(manualReviewProbability),
      flaggedThreshold: round(counterfeitProbabilityThreshold),
    },
  }
}

const buildEnvelopeIssues = (featureSignals, status) => {
  if (status === 'clear') {
    return []
  }

  const issues = featureSignals
    .filter((signal) => signal.signalPercent >= 60)
    .sort((a, b) => b.signalPercent - a.signalPercent)
    .slice(0, 3)
    .map(
      (signal) =>
        `${signal.label} is outside the usual ${signal.closestProfile?.label?.toLowerCase() || 'known'} band from the training set.`
    )

  if (issues.length === 0 && status === 'manual-review') {
    issues.push('The scan sits near the trained baseline boundary and should be inspected manually.')
  }

  return issues
}

const scoreProfileEnvelope = (metrics, model) => {
  const features = Object.entries(model.features || {})
  const totalWeight =
    features.reduce((total, [, config]) => total + Number(config.weight || 0), 0) || 1
  const manualReviewDistance = Number(model.thresholds.manualReviewDistance || 1.15)
  const flaggedDistance = Number(model.thresholds.flaggedDistance || 1.7)

  const featureSignals = features.map(([feature, config]) => {
    const digits = getFeatureDigits(feature)
    const value = Number(metrics[feature])
    const profiles = getProfileEntries(config, model.dataset.classes, feature)
    const distances = profiles.map((profile) => {
      const scale = getProfileScale(feature, profiles, profile)

      return {
        key: profile.key,
        label: profile.label,
        mean: profile.mean,
        distance: Number.isFinite(value) ? Math.abs(value - profile.mean) / scale : 0,
      }
    })

    distances.sort((a, b) => a.distance - b.distance)
    const closest = distances[0] || null
    const nearestDistance = Number(closest?.distance || 0)

    return {
      feature,
      label: FEATURE_LABELS[feature] || feature,
      value: round(value, digits),
      weight: Number(config.weight || 0),
      weightPercent: Math.round((Number(config.weight || 0) / totalWeight) * 100),
      description: config.description,
      signalPercent: Math.round(clamp(nearestDistance / flaggedDistance, 0, 1) * 100),
      signalLabel: model.presentation.featureSignalLabel,
      nearestDistance: round(nearestDistance),
      profileMeans: buildFeatureProfiles(profiles),
      closestProfile: closest
        ? {
            key: closest.key,
            label: closest.label,
            mean: round(closest.mean, digits),
          }
        : null,
      distances: distances.map((entry) => ({
        key: entry.key,
        label: entry.label,
        distance: round(entry.distance),
      })),
    }
  })

  const weightedDeviation =
    featureSignals.reduce((total, signal) => total + signal.nearestDistance * signal.weight, 0) /
    totalWeight

  let status = 'clear'
  if (weightedDeviation >= flaggedDistance) {
    status = 'flagged'
  } else if (weightedDeviation >= manualReviewDistance) {
    status = 'manual-review'
  }

  const profileScores = model.dataset.classes
    .map((entry) => {
      const weightedDistance =
        featureSignals.reduce((total, signal) => {
          const match = signal.distances.find((candidate) => candidate.key === entry.key)
          return total + Number(match?.distance || 0) * signal.weight
        }, 0) / totalWeight

      return {
        key: entry.key,
        label: entry.label,
        weightedDistance: round(weightedDistance),
      }
    })
    .sort((a, b) => a.weightedDistance - b.weightedDistance)

  const normalizedDeviation = clamp(weightedDeviation / flaggedDistance, 0, 1)
  const confidenceBase =
    status === 'clear'
      ? 1 - normalizedDeviation * 0.45
      : status === 'flagged'
        ? 0.55 + normalizedDeviation * 0.35
        : 0.55 + Math.abs(normalizedDeviation - 0.5) * 0.25

  return {
    status,
    verified: status === 'clear',
    needsReview: status === 'manual-review',
    confidence: Math.round(clamp(confidenceBase, 0.45, 0.99) * 100),
    scorePercent: Math.round(normalizedDeviation * 100),
    scoreLabel: model.presentation.scoreLabel,
    counterfeitProbability: null,
    issues: buildEnvelopeIssues(featureSignals, status),
    featureSignals,
    closestProfile: profileScores[0] || null,
    model: {
      name: model.name,
      version: model.version,
      type: model.type,
      decisionMode: model.decisionMode,
      trained: Boolean(model.trained),
      trainedAt: model.trainedAt || null,
    },
    presentation: buildResultPresentation(status, model.presentation),
    summary: {
      weightedDeviation: round(weightedDeviation),
      manualReviewDistance: round(manualReviewDistance),
      flaggedDistance: round(flaggedDistance),
    },
  }
}

const scoreMetrics = (metrics, modelInput) => {
  const model = normalizeModel(modelInput)

  if (model.decisionMode === 'binary-screening') {
    return scoreBinaryModel(metrics, model)
  }

  return scoreProfileEnvelope(metrics, model)
}

module.exports = {
  DEFAULT_MODEL_PATH,
  FEATURE_DESCRIPTIONS,
  FEATURE_LABELS,
  extractImageMetrics,
  loadVisualModel,
  normalizeModel,
  scoreMetrics,
  validateImageMetrics,
}
