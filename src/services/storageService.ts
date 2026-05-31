/**
 * S3-compatible object storage (AWS S3 / MinIO) with presigned upload/download URLs.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'

const UPLOAD_TTL_SECONDS = 15 * 60
const DOWNLOAD_TTL_SECONDS = 5 * 60

let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.S3_ENDPOINT
    const region = process.env.S3_REGION ?? 'us-east-1'
    const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin'
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin'

    s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return s3Client
}

function getBucket(): string {
  return process.env.S3_BUCKET ?? 'tenant-documents'
}

export function contentTypeToExtension(contentType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  }
  const ext = map[contentType.toLowerCase()]
  if (!ext) {
    const parts = contentType.split('/')
    const fallback = parts[parts.length - 1]?.split('+')[0]
    return fallback && fallback.length <= 10 ? fallback : 'bin'
  }
  return ext
}

export function buildTenantDocumentObjectKey(
  tenantId: string,
  docType: string,
  contentType: string,
): string {
  const ext = contentTypeToExtension(contentType)
  return `tenant-documents/${tenantId}/${docType}/${randomUUID()}.${ext}`
}

export async function generatePresignedUpload(
  key: string,
  contentType: string,
  ttlSeconds = UPLOAD_TTL_SECONDS,
): Promise<{ uploadUrl: string; expiresAt: string }> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  })
  const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: ttlSeconds })
  return {
    uploadUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

export async function generatePresignedDownload(
  key: string,
  ttlSeconds = DOWNLOAD_TTL_SECONDS,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  })
  const downloadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: ttlSeconds })
  return {
    downloadUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

export const STORAGE_TTL = {
  UPLOAD_SECONDS: UPLOAD_TTL_SECONDS,
  DOWNLOAD_SECONDS: DOWNLOAD_TTL_SECONDS,
} as const
