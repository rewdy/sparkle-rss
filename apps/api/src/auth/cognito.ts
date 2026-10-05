import {
  CognitoIdentityProviderClient,
  type CognitoIdentityProviderClientConfig,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  type InitiateAuthCommandOutput,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export type AuthTokens = { accessToken: string; refreshToken?: string };
export type SignInResult =
  | { type: "authenticated"; tokens: AuthTokens }
  | { type: "new-password-required"; session: string };

export interface CognitoAuth {
  signIn(username: string, password: string): Promise<SignInResult>;
  completeNewPassword(
    username: string,
    newPassword: string,
    session: string,
  ): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<string>;
  revoke(refreshToken: string): Promise<void>;
  forgotPassword(username: string): Promise<void>;
  confirmForgotPassword(
    username: string,
    code: string,
    password: string,
  ): Promise<void>;
}

function tokensFrom(result: InitiateAuthCommandOutput): AuthTokens {
  const accessToken = result.AuthenticationResult?.AccessToken;
  if (!accessToken) throw new Error("missing authentication result");
  return {
    accessToken,
    refreshToken: result.AuthenticationResult?.RefreshToken,
  };
}

export function createCognitoAuth(
  clientId: string,
  config?: CognitoIdentityProviderClientConfig,
): CognitoAuth {
  const client = new CognitoIdentityProviderClient(config ?? {});
  return {
    async signIn(username, password) {
      const result = await client.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: clientId,
          AuthParameters: { USERNAME: username, PASSWORD: password },
        }),
      );
      if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
        if (!result.Session)
          throw new Error("missing Cognito challenge session");
        return { type: "new-password-required", session: result.Session };
      }
      return { type: "authenticated", tokens: tokensFrom(result) };
    },

    async completeNewPassword(username, newPassword, session) {
      const result = await client.send(
        new RespondToAuthChallengeCommand({
          ChallengeName: "NEW_PASSWORD_REQUIRED",
          ClientId: clientId,
          Session: session,
          ChallengeResponses: {
            USERNAME: username,
            NEW_PASSWORD: newPassword,
          },
        }),
      );
      return tokensFrom(result);
    },

    async refresh(refreshToken) {
      const result = await client.send(
        new InitiateAuthCommand({
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: clientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      );
      return tokensFrom(result).accessToken;
    },

    async revoke(refreshToken) {
      await client.send(
        new RevokeTokenCommand({ ClientId: clientId, Token: refreshToken }),
      );
    },

    async forgotPassword(username) {
      await client.send(
        new ForgotPasswordCommand({ ClientId: clientId, Username: username }),
      );
    },

    async confirmForgotPassword(username, code, password) {
      await client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: clientId,
          Username: username,
          ConfirmationCode: code,
          Password: password,
        }),
      );
    },
  };
}
