# MedVerify
"Every fake pill is a system failure"

Counterfeit medicine detection demo built for hackathons. Upload a medicine image, compare its visual fingerprint against a reference batch, and see live counterfeit reports on a map.

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

## Image Fingerprinting Logic

The server reads the uploaded image with Sharp and computes:
- Average brightness from RGB channel means.
- Color saturation using HSL conversion from the average RGB.
- Sharpness proxy using grayscale standard deviation.

The scan compares brightness and saturation against a stored "genuine" fingerprint. If either deviates by more than 15%, the batch is flagged as suspicious.

## Notes

- Reports are stored in-memory and reset when the server restarts.
- The live map uses Leaflet + OpenStreetMap tiles (no API key required).
- Dataset reference (for future model training): MEDetect dataset on Roboflow Universe (CC BY 4.0, 4.8k images, authentic vs counterfeit classes). https://universe.roboflow.com/medetect/medetect-9kphx
