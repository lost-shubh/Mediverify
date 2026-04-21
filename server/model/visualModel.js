const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const DEFAULT_MODEL_PATH = path.join(__dirname, 'model.json')

const FALLBACK_MODEL = {
  name: 'MedVerify Visual Fingerprint Baseline',
  version: '1.0.0',
  type: 'feature-baseline',
  trained: false,
  trainedAt: null,
  dataset: {
    authenticSamples: 0,
    counterfeitSamples: 0,
    source: 'Fallback model',
  },
  features: {
    brightness: {
      description: 'Average luminance across RGB channels.',
      authenticMean: 0.62,
      counterfeitMean: 0.47,
      weight: 0.26,
    },
    saturation: {
      description: 'Average color saturation from the mean RGB signature.',
      authenticMean: 0.48,
      counterfeitMean: 0.3,
      weight: 0.24,
    },
    sharpness: {
      description: 'Grayscale standard deviation used as a print clarity proxy.',
      authenticMean: 12.5,
      counterfeitMean: 6.5,
      weight: 0.32,
    },
    contrast: {
      description: 'Average RGB channel spread normalized to the 0-1 range.',
      authenticMean: 0.19,
      counterfeitMean: 0.11,
      weight: 0.18,
    },
  },
  thresholds: {
    manualReviewProbability: 0.35,
    counterfeitProbability: 0.56,
  },
  limitations: [
    'This is a calibrated visual baseline, not a deep-learning image classifier.',
  ],
  nextStepRequirements: [],
}

const FEATURE_LABELS = {
  brightness: 'Brightness',
  saturation: 'Saturation',
  sharpness: 'Sharpness',
  contrast: 'Contrast',
}

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const round = (value, digits = 3) => Number(value.toFixed(digits))

const loadVisualModel = () => {
  try {
    const raw = fs.readFileSync(DEFAULT_MODEL_PATH, 'utf8')
    const parsed = JSON.parse(raw)

    return {
      ...FALLBACK_MODEL,
      ...parsed,
      dataset: {
        ...FALLBACK_MODEL.dataset,
        ...(parsed.dataset || {}),
      },
      thresholds: {
        ...FALLBACK_MODEL.thresholds,
        ...(parsed.thresholds || {}),
      },
      features: {
        ...FALLBACK_MODEL.features,
        ...(parsed.features || {}),
      },
    }
  } catch (error) {
    console.warn('Failed to load trained model artifact, using fallback baseline.', error.message)
    return FALLBACK_MODEL
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

const extractImageMetrics = async (imageSource) => {
  const stats = await sharp(imageSource).stats()
  const rgbChannels = stats.channels.slice(0, 3)

  if (rgbChannels.length < 3) {
    throw new Error('Image must contain RGB color channels.')
  }

  const [r, g, b] = rgbChannels.map((channel) => channel.mean)
  const brightness = (r + g + b) / (rgbChannels.length * 255)
  const { saturation } = toHsl(r, g, b)
  const sharpStats = await sharp(imageSource).greyscale().stats()
  const sharpness = sharpStats.channels[0].stdev
  const contrast =
    rgbChannels.reduce((total, channel) => total + channel.stdev, 0) /
    (rgbChannels.length * 255)

  return {
    brightness: round(brightness),
    saturation: round(saturation),
    sharpness: round(sharpness, 2),
    contrast: round(contrast),
  }
}

const getCounterfeitProgress = (value, authenticMean, counterfeitMean) => {
  if (!Number.isFinite(value) || authenticMean === counterfeitMean) {
    return 0
  }

  if (counterfeitMean > authenticMean) {
    return clamp((value - authenticMean) / (counterfeitMean - authenticMean))
  }

  return clamp((authenticMean - value) / (authenticMean - counterfeitMean))
}

const buildIssues = (featureSignals, status) => {
  const issues = featureSignals
    .filter((signal) => signal.risk >= 0.55)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 3)
    .map((signal) => {
      if (signal.feature === 'sharpness') {
        return 'Print sharpness is drifting toward the counterfeit reference band.'
      }

      return `${FEATURE_LABELS[signal.feature] || signal.feature} is closer to the counterfeit calibration band than the authentic reference.`
    })

  if (issues.length === 0 && status === 'manual-review') {
    issues.push('The scan sits close to the review boundary and should be inspected manually.')
  }

  return issues
}

const scoreMetrics = (metrics, model) => {
  const features = Object.entries(model.features || {})
  const totalWeight =
    features.reduce((total, [, config]) => total + Number(config.weight || 0), 0) || 1

  const featureSignals = features.map(([feature, config]) => {
    const value = Number(metrics[feature])
    const risk = getCounterfeitProgress(
      value,
      Number(config.authenticMean),
      Number(config.counterfeitMean)
    )

    return {
      feature,
      label: FEATURE_LABELS[feature] || feature,
      value: round(value, feature === 'sharpness' ? 2 : 3),
      weight: Number(config.weight || 0),
      weightPercent: Math.round((Number(config.weight || 0) / totalWeight) * 100),
      authenticMean: Number(config.authenticMean),
      counterfeitMean: Number(config.counterfeitMean),
      description: config.description,
      risk: round(risk),
      riskPercent: Math.round(risk * 100),
    }
  })

  const weightedRisk =
    featureSignals.reduce((total, signal) => total + signal.risk * signal.weight, 0) / totalWeight
  const manualReviewProbability = Number(model.thresholds?.manualReviewProbability || 0.35)
  const counterfeitProbabilityThreshold = Number(model.thresholds?.counterfeitProbability || 0.56)

  let status = 'genuine'
  if (weightedRisk >= counterfeitProbabilityThreshold) {
    status = 'suspicious'
  } else if (weightedRisk >= manualReviewProbability) {
    status = 'manual-review'
  }

  const issues = buildIssues(featureSignals, status)
  const certainty =
    status === 'suspicious'
      ? weightedRisk
      : status === 'manual-review'
        ? 0.5 + Math.abs(weightedRisk - 0.5)
        : 1 - weightedRisk

  return {
    status,
    verified: status === 'genuine',
    needsReview: status === 'manual-review',
    confidence: Math.round(clamp(certainty, 0.4, 0.99) * 100),
    counterfeitProbability: Math.round(weightedRisk * 100),
    issues,
    featureSignals,
    model: {
      name: model.name,
      version: model.version,
      type: model.type,
      trained: Boolean(model.trained),
      trainedAt: model.trainedAt || null,
    },
  }
}

module.exports = {
  DEFAULT_MODEL_PATH,
  FEATURE_LABELS,
  extractImageMetrics,
  loadVisualModel,
  scoreMetrics,
}
