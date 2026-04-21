# MedVerify
"Every fake pill is a system failure"

Counterfeit medicine detection demo built for hackathons. Upload a medicine image, score its visual fingerprint against the current model artifact, and see live counterfeit reports on a map.

## Setup

1. Install dependencies
```
cd client
npm install
cd ../server
npm install
```

2. Run the services
```
cd server
npm start
```
In a second terminal:
```
cd client
npm run dev
```

Server runs on `http://localhost:3001` and the client runs on `http://localhost:5173`.

## What Is Deployed

- A Vite/React frontend hosted on Vercel.
- A Node/Express API exposed through `api/index.js`.
- A visual fingerprint detector backed by `server/model/model.json`.
- openFDA NDC lookup for medicine suggestions and manufacturer metadata.

## Models In Use

### 1. MedVerify Visual Fingerprint Baseline
- Type: feature-based baseline, not a deep-learning CNN.
- Runtime file: `server/model/model.json`
- Feature extractor: `server/model/visualModel.js`
- Current features:
  - Brightness from RGB channel means
  - Saturation from HSL conversion
  - Sharpness from grayscale standard deviation
  - Contrast from average RGB channel spread

The scan computes those features with `sharp`, compares them against authentic and counterfeit calibration bands, and returns:
- `genuine`
- `manual-review`
- `suspicious`

### 2. openFDA NDC Lookup
- This is not an ML model.
- It enriches the report flow with brand, generic, manufacturer, and NDC data.

### 3. Live Threat Map
- This is a crowdsourced report layer, not a trained model.
- Reports are currently stored in memory.

## Training The Detector

There was no labeled image dataset in this repo, so there was nothing honest to train against yet. I added the training pipeline and model artifact support.

Expected dataset layout:

```text
training-data/
  authentic/
    image-1.jpg
    ...
  counterfeit/
    image-1.jpg
    ...
```

Run training:

```bash
npm run train:model
```

Optional custom paths:

```bash
npm run train:model -- --data-dir ./training-data --output ./server/model/model.json
```

That script:
- extracts image features for each labeled sample
- computes authentic and counterfeit class means
- derives feature weights from class separation
- writes a deployable model artifact back to `server/model/model.json`

## Notes

- Reports are stored in-memory and reset when the server restarts.
- On Vercel, that means reports are ephemeral and may reset when a serverless instance is recycled.
- The live map uses Leaflet + OpenStreetMap tiles (no API key required).
- Dataset reference (for future model training): MEDetect dataset on Roboflow Universe (CC BY 4.0, 4.8k images, authentic vs counterfeit classes). https://universe.roboflow.com/medetect/medetect-9kphx
- The report form queries the FDA NDC directory via the openFDA API to suggest medicine names and manufacturer details.

## Vercel Deployment

This repo is Vercel-ready: the frontend is built from `client/` and the API runs as a Vercel Serverless Function from `api/index.js`.
