/**
 * Environment Variable and Secrets Helper
 *
 * Handles extracting values from environment bindings that can be either:
 * - Plain strings (local development via .dev.vars)
 * - Secrets Store bindings (production via Cloudflare Secrets Store)
 */

/**
 * Extract a secret value from environment binding
 *
 * @param binding - The environment binding (can be string or Secrets Store binding)
 * @param secretName - Name of the secret (for logging)
 * @returns The secret value as a string, or empty string if not found
 *
 * @example
 * // In local dev (.dev.vars): c.env.image_storage_key = "abc123"
 * const key = await getSecret(c.env.image_storage_key, 'image_storage_key');
 *
 * @example
 * // In production (Secrets Store): c.env.image_storage_key = { get: () => Promise<string> }
 * const key = await getSecret(c.env.image_storage_key, 'image_storage_key');
 */
export async function getSecret(
    binding: any,
    secretName: string
): Promise<string> {
    if (!binding) {
        return '';
    }

    // Case 1: Plain string (local development from .dev.vars)
    if (typeof binding === 'string') {
        return binding;
    }

    // Case 2: Secrets Store binding (production)
    if (typeof binding.get === 'function') {
        try {
            const value = await binding.get();
            return value || '';
        } catch (error) {
            return '';
        }
    }

    // Case 3: Unknown binding type
    return '';
}

/**
 * Extract a secret and throw an error if missing
 *
 * @param binding - The environment binding
 * @param secretName - Name of the secret (for error messages)
 * @returns The secret value as a string
 * @throws Error if the secret is missing or empty
 *
 * @example
 * const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
 */
export async function requireSecret(
    binding: any,
    secretName: string
): Promise<string> {
    const value = await getSecret(binding, secretName);

    if (!value) {
        throw new Error(`Missing required secret: ${secretName}`);
    }

    return value;
}

/**
 * Get an environment variable (plain string only)
 *
 * @param env - The environment object
 * @param varName - Name of the environment variable
 * @param defaultValue - Default value if not found
 * @returns The environment variable value or default
 *
 * @example
 * const zone = getEnvVar(c.env, 'ZONE', 'default-zone');
 */
export function getEnvVar(
    env: any,
    varName: string,
    defaultValue: string = ''
): string {
    return env[varName] || defaultValue;
}

/**
 * Get an environment variable and throw if missing
 *
 * @param env - The environment object
 * @param varName - Name of the environment variable
 * @returns The environment variable value
 * @throws Error if the variable is missing
 *
 * @example
 * const zone = requireEnvVar(c.env, 'ZONE');
 */
export function requireEnvVar(
    env: any,
    varName: string
): string {
    const value = getEnvVar(env, varName);

    if (!value) {
        throw new Error(`Missing required environment variable: ${varName}`);
    }

    return value;
}
