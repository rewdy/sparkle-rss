import { config } from 'dotenv';

config(); // apps/api/.env
config({ path: '../../.env' }); // repo root .env (shared local config)

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  allowInsecureDevAuth: process.env.ALLOW_INSECURE_DEV_AUTH === 'true',
  spikeUsername: optional('SPIKE_USERNAME'),
  spikeApiToken: optional('SPIKE_API_TOKEN'),
  cognitoIssuer: optional('COGNITO_ISSUER'),
  cognitoClientId: optional('COGNITO_CLIENT_ID'),
  awsRegion: optional('AWS_REGION') ?? 'us-east-1',
  webOrigins: (optional('WEB_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
};

export function spikeCredentialsConfigured(): boolean {
  return Boolean(env.spikeUsername && env.spikeApiToken);
}
