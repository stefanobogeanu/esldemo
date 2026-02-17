# ESL Demo Simplified

A lightweight 2-part app:
- `server`: Node.js + Express proxy layer over FintechOS APIs
- `client`: React UI that renders journey steps dynamically

## Project structure

- `server`: backend API wrappers for Digital Journey + PFAPI
- `client`: React app with dynamic forms and offers cards UI
- `.env`: runtime configuration for both API integrations

## Install

From project root:

```bash
cd server
npm install

cd ../client
npm install
```

## Run backend

```bash
cd server
npm run dev
```

Backend runs at `http://localhost:3000`.

## Run frontend

In a separate terminal:

```bash
cd client
npm run dev
```

Frontend runs at `http://localhost:5173`.

## Journey flow (UI + backend)

1. On app load, frontend initializes the journey using `POST /api/journey/init`.
2. Backend calls FintechOS journey metadata + start + first load-step.
3. Frontend renders fields from the returned step payload.
4. `Next` and `Previous` buttons are shown based on:
   - `properties.nextButton.show`
   - `properties.previousButton.show`
5. On `Next` / `Previous`, frontend sends:
   - `externalId`
   - `values: [{ attribute, value }]`
6. Backend calls the corresponding FintechOS API and returns the updated step.
7. Frontend redraws the page using the new step response.

## Offers flow (PFAPI)

When the current step title is `Offers`, the frontend calls:

- `POST /api/offers/available`

The backend then performs two PFAPI calls:

1. `POST {FINTECHOS_AVAILABLE_OFFERS}/available`
2. `GET {FINTECHOS_OFFER_DETAILS_ENDPOINT}/{offerId}/details` for each available offer

The API response is normalized to:

```json
{
  "offers": [
    {
      "offerId": "...",
      "offerName": "...",
      "offerCode": "...",
      "cards": [
        {
          "cardId": "...",
          "cardTitle": "...",
          "description": "...",
          "benefits": ["..."]
        }
      ]
    }
  ]
}
```

Frontend flattens `offers[].cards[]` into card tiles and allows selecting one offer (stored in `sessionStorage`).

## Backend endpoints

- `GET /api/health`
- `POST /api/journey/init`
- `POST /api/journey/load-step`
- `POST /api/journey/next`
- `POST /api/journey/previous`
- `POST /api/offers/available`

## Required environment variables

At minimum:

- `PORT`
- `FINTECHOS_BASE_URL`
- `FINTECHOS_CULTURE`
- `FINTECHOS_START_ENDPOINT`
- `FINTECHOS_LOAD_METADATA_ENDPOINT`
- `FINTECHOS_LOAD_STEP_ENDPOINT`
- `FINTECHOS_NEXT_ENDPOINT`
- `FINTECHOS_PREVIOUS_ENDPOINT`
- Auth for journey APIs:
  - `FINTECHOS_USER_NAME` + `FINTECHOS_PASSWORD`, or
  - `FINTECHOS_CLIENT_ID` + `FINTECHOS_CLIENT_SECRET`
- PFAPI settings:
  - `FINTECHOS_PFAPI_BASE_URL` (optional, defaults to `FINTECHOS_BASE_URL`)
  - `FINTECHOS_PFAPI_TOKEN_ENDPOINT`
  - `FINTECHOS_AVAILABLE_OFFERS`
  - `FINTECHOS_OFFER_DETAILS_ENDPOINT` (optional, defaults to `/pfapi/api/v1/product/offer`)

Optional defaults used by `/api/offers/available`:

- `DEFAULT_JOURNEY_PRODUCT`
- `DEFAULT_JOURNEY_CLASS`
- `DEFAULT_PRODUCT_DEPENDENCY`

Configuration is loaded from root `.env`.
