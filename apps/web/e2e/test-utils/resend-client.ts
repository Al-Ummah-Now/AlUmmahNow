import { logger } from '@/lib/logger-client';

interface ResendEmailRecord {
  id: string;
  to?: string[];
  subject?: string;
  [key: string]: unknown;
}

/**
 * Resend API client for retrieving verification emails in E2E tests
 *
 * @see https://resend.com/docs/api-reference/introduction
 */
export class ResendTestClient {
  private apiKey: string;
  private baseUrl = 'https://api.resend.com';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Resend API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Retrieves the latest verification email sent to the specified address
   *
   * @param email - Email address to search for
   * @param maxAttempts - Maximum number of retry attempts (default: 10)
   * @param delayMs - Delay between attempts in milliseconds (default: 2000)
   * @returns HTML content of the verification email, or null if not found
   */
  async getVerificationEmail(
    email: string,
    maxAttempts = 10,
    delayMs = 2000
  ): Promise<string | null> {
    logger.info('Waiting for verification email', { email, maxAttempts });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // List recent emails
        const response = await fetch(`${this.baseUrl}/emails`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          logger.error('Failed to fetch emails from Resend', {
            status: response.status,
            statusText: response.statusText,
          });
          throw new Error(`Resend API error: ${response.statusText}`);
        }

        const data = await response.json();

        // Find verification email for the specified address
        const verificationEmail = data.data?.find((emailRecord: ResendEmailRecord) => {
          return emailRecord.to?.includes(email) &&
                 (emailRecord.subject?.toLowerCase().includes('verification') ||
                  emailRecord.subject?.toLowerCase().includes('verify'));
        });

        if (verificationEmail) {
          logger.info('Verification email found', {
            email,
            attempt,
            emailId: verificationEmail.id
          });

          // Fetch the full email content
          const emailResponse = await fetch(
            `${this.baseUrl}/emails/${verificationEmail.id}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (!emailResponse.ok) {
            throw new Error(`Failed to fetch email content: ${emailResponse.statusText}`);
          }

          const emailData = await emailResponse.json();
          return emailData.html || emailData.text || null;
        }

        logger.info('Verification email not found yet', {
          email,
          attempt,
          maxAttempts
        });

        // Wait before next attempt
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

      } catch (error) {
        logger.error('Error fetching verification email', {
          email,
          attempt,
          error
        });

        if (attempt === maxAttempts) {
          throw error;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    logger.warn('Verification email not found after max attempts', {
      email,
      maxAttempts
    });
    return null;
  }

  /**
   * Extracts the verification code from email HTML content
   *
   * Supports common patterns:
   * - 6-digit numeric codes
   * - Alphanumeric codes
   * - Codes in headings, paragraphs, or code blocks
   *
   * @param emailHtml - HTML content of the email
   * @returns Verification code, or null if not found
   */
  extractVerificationCode(emailHtml: string): string | null {
    // Pattern 1: Look for 6-digit codes
    const sixDigitMatch = emailHtml.match(/\b(\d{6})\b/);
    if (sixDigitMatch) {
      logger.info('Extracted 6-digit verification code');
      return sixDigitMatch[1];
    }

    // Pattern 2: Look for codes in common HTML patterns
    // e.g., <h1>123456</h1> or <p>Your code: ABC123</p>
    const codePatterns = [
      /<h[1-6]>([A-Z0-9]{4,8})<\/h[1-6]>/i,
      /<code>([A-Z0-9]{4,8})<\/code>/i,
      /<strong>([A-Z0-9]{4,8})<\/strong>/i,
      /code:\s*([A-Z0-9]{4,8})/i,
      /verification code:\s*([A-Z0-9]{4,8})/i,
    ];

    for (const pattern of codePatterns) {
      const match = emailHtml.match(pattern);
      if (match) {
        logger.info('Extracted verification code using pattern', {
          pattern: pattern.source
        });
        return match[1];
      }
    }

    logger.warn('Could not extract verification code from email');
    return null;
  }

  /**
   * Deletes an email by ID (cleanup after tests)
   *
   * @param emailId - Email ID to delete
   */
  async deleteEmail(emailId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/emails/${emailId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete email: ${response.statusText}`);
      }

      logger.info('Email deleted successfully', { emailId });
    } catch (error) {
      logger.error('Error deleting email', { emailId, error });
      throw error;
    }
  }
}
