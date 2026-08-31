import { S3Client } from "@aws-sdk/client-s3";

/** Uses AWS defaults in production, or an S3-compatible local endpoint. */
export function createS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) return new S3Client({});

  return new S3Client({
    endpoint,
    forcePathStyle: true,
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });
}
