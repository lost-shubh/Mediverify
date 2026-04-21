# MedVerify

MedVerify is a counterfeit medicine detection demo built for hackathons. It lets a user upload a medicine image, score it against a lightweight visual screening model, submit suspicious reports, and view those reports on a live map.

Live app: `https://medverify-navy.vercel.app`

## What It Does

- Scans a medicine image and returns a screening result.
- Shows a confidence score, counterfeit probability, and feature-level signals.
- Lets users submit suspicious medicine reports with location metadata.
- Displays reports on a live Leaflet map.
- Queries the openFDA NDC API for medicine suggestions and manufacturer metadata.

## Current Scan Outcomes

The app currently returns one of these screening states:

- `Likely Genuine`
- `Manual Review Required`
- `Likely Counterfeit`

This is a screening demo, not a certified diagnostic or regulatory system.

## Stack

- Frontend: React + Vite + Tailwind CSS
- Mapping: Leaflet + React Leaflet
- Backend: Node.js + Express
- Image processing: `sharp`
- Hosting: Vercel
- External data: openFDA NDC API

## Project Structure

```text
api/                 Vercel serverless entrypoints
client/              React frontend
scripts/             Training and utility scripts
server/              Express API and visual model runtime
server/model/        Model artifact and feature scoring logic
```

## How The Detector Works

The current detector is a feature-based visual baseline. It is not a deep-learning classifier.

For each uploaded image, the backend extracts:

- brightness
- saturation
- sharpness
- contrast

Those signals are compared against the reference values in `server/model/model.json`, and the API returns:

- overall status
- confidence
- counterfeit probability
- feature-level explanations

## Local Development

### 1. Install dependencies

```bash
npm install
cd client && npm install
cd ../server && npm install
```

### 2. Run the backend

```bash
npm run dev:server
```

### 3. Run the frontend

In a second terminal:

```bash
npm run dev:client
```

Local URLs:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3001`

## Available Scripts

From the repo root:

```bash
npm run dev:server
npm run dev:client
npm run build:client
npm run lint:client
npm run train:model
```

## API Endpoints

The deployed API exposes:

- `GET /api/health`
- `GET /api/model-info`
- `GET /api/reports`
- `POST /api/report`
- `POST /api/scan`
- `GET /api/ndc/search?query=...`

## Training The Model

If you want to replace the fallback baseline with a dataset-derived artifact, add labeled images in this layout:

```text
training-data/
  authentic/
    image-1.jpg
  counterfeit/
    image-1.jpg
```

Then run:

```bash
npm run train:model
```

Optional arguments:

```bash
npm run train:model -- --data-dir ./training-data --output ./server/model/model.json
```

The training script:

- extracts the same image features used at runtime
- computes class means and spread
- derives feature weights
- writes a deployable model artifact

## Deployment Notes

- The frontend is built from `client/`.
- The API runs on Vercel serverless functions under `api/`.
- Reports are stored in memory.
- On Vercel, report data is ephemeral and can reset when the instance is recycled.

## Important Limitations

- This is a hackathon demo, not a medical device.
- The detector does not read printed text, QR codes, holograms, or packaging semantics.
- The current report store is not durable.
- Model quality depends entirely on the quality of any future labeled dataset.

## Future Improvements

- Durable database-backed reports
- Better image quality checks before scoring
- Authenticated reporting
- Real training dataset and evaluation metrics
- Packaging text and OCR-based validation

## License

MIT
