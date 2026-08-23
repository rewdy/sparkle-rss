import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = process.env.COGNITO_ISSUER;
const clientId = process.env.COGNITO_CLIENT_ID;
const accessToken = process.env.COGNITO_ACCESS_TOKEN;

if (!issuer || !clientId || !accessToken) {
  throw new Error('COGNITO_ISSUER, COGNITO_CLIENT_ID and COGNITO_ACCESS_TOKEN are required');
}

// Cognito ACCESS tokens carry no `aud` claim (that is an ID-token thing); they
// identify the client via `client_id`. So: verify signature + issuer via jose,
// then assert client_id and token_use ourselves.
const start = Date.now();
const { payload } = await jwtVerify(
  accessToken,
  createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
  { issuer },
);
console.log(`verified in ${Date.now() - start}ms`);
if (payload.client_id !== clientId) {
  throw new Error(`client_id mismatch: ${payload.client_id}`);
}
if (payload.token_use !== 'access') {
  throw new Error(`unexpected token_use: ${payload.token_use}`);
}
if (payload.username !== 'spike') {
  throw new Error(`unexpected username: ${payload.username}`);
}
console.log('sub:', payload.sub);
console.log('SPIKE B: jose JWKS verification against live Cognito OK');
