---
title: Personal Private Cloud Vault
emoji: "🗂️"
colorFrom: blue
colorTo: teal
sdk: docker
app_port: 7860
---

# Personal Private Cloud Vault

A single-user private vault for moving files between your own devices without a visible login flow.

## Features

- Upload from phone or desktop
- Store images, videos, text, PDFs, presentations, archives, and other files
- Search and filter by time, type, name, and size
- Preview images, videos, text, and PDF files in the browser
- Edit notes, tags, favorites, and soft-delete state
- Chunked uploads with retry support

## Run locally

```bash
npm start
```

Default address:

```text
http://127.0.0.1:3000
```

## Storage layout

- File blobs: `storage/files`
- Temporary chunks: `storage/tmp`
- File metadata: `data/vault.json`
- Upload sessions: `data/uploads.json`

## Notes

- This is a personal single-user vault, not a multi-user sharing system.
- Data stored on ephemeral hosting can be lost when the container restarts.
- PPT and PPTX currently fall back to download-first behavior instead of full online preview.

## Storage drivers

The app supports two storage modes:

- `local` (default): store file blobs inside `storage/files`
- `s3`: store file blobs in an S3-compatible object store such as Backblaze B2

### Backblaze B2 / S3 environment variables

Set these variables when you want object storage instead of local disk:

```text
STORAGE_DRIVER=s3
S3_REGION=us-west-004
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY_ID=your-key-id
S3_SECRET_ACCESS_KEY=your-application-key
```

Optional:

```text
S3_PUBLIC_BASE_URL=https://f005.backblazeb2.com/file/your-bucket-name
```

`S3_PUBLIC_BASE_URL` is only used for metadata display. Downloads and previews still stream through the app.
