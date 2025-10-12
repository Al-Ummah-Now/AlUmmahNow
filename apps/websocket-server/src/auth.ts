/**
 * JWT Authentication for WebSocket connections
 * Validates JWT tokens using OpenAuth subjects
 */

import { createClient } from "@openauthjs/openauth/client";
import { z } from 'zod';
import { createSubjects } from '@openauthjs/openauth/subject';

// Define the user subject schema (must match api-videos)
export const subjects = createSubjects({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
  }),
});

// Type for the decoded JWT payload
export interface AuthPayload {
  sub: string; // Subject (user ID)
  email?: string;
  iat: number; // Issued at
  exp: number; // Expiration
  aud?: string; // Audience
  iss?: string; // Issuer
}

/**
 * Validate JWT token with OpenAuth signature verification
 */
export async function validateJWT(token: string, env: Env): Promise<AuthPayload | null> {
  try {
    // Create OpenAuth client
    const client = createClient({
      clientID: env.ClientId || '',
      issuer: env.Issuer || '',
    });

    // Verify the token using OpenAuth client with subjects
    const result = await client.verify(subjects, token, { refresh: undefined });

    // Check if verification was successful
    if ('subject' in result && result.subject) {
      const openAuthPayload = result.subject.properties;
      const now = Math.floor(Date.now() / 1000);

      const payload: AuthPayload = {
        sub: openAuthPayload.id || '',
        email: openAuthPayload.email || '',
        exp: now + 3600, // Default 1 hour from now
        iat: now,
        aud: env.Audience,
        iss: env.Issuer,
      };

      return payload;
    }

    return null;
  } catch (error) {
    console.error('JWT validation error:', error);
    return null;
  }
}

/**
 * Basic JWT validation (payload only, no signature verification)
 * Used as fallback or for development
 */
export async function validateJWTBasic(token: string): Promise<AuthPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload
    const payload = JSON.parse(atob(parts[1])) as AuthPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error('Basic JWT validation error:', error);
    return null;
  }
}
