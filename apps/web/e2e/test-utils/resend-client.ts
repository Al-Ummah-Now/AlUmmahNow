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

        // Find verification email for the specified address (most recent first)
        // Sort by created_at descending to get the newest email
        const sortedEmails = (data.data || []).sort((a: ResendEmailRecord, b: ResendEmailRecord) => {
          const dateA = new Date(a.created_at as string || 0).getTime();
          const dateB = new Date(b.created_at as string || 0).getTime();
          return dateB - dateA; // Most recent first
        });

        const verificationEmail = sortedEmails.find((emailRecord: ResendEmailRecord) => {
          const matches = emailRecord.to?.includes(email) &&
                 (emailRecord.subject?.toLowerCase().includes('verification') ||
                  emailRecord.subject?.toLowerCase().includes('verify') ||
                  emailRecord.subject?.toLowerCase().includes('code'));
          if (matches) {
            logger.debug('Found matching email', {
              to: emailRecord.to,
              subject: emailRecord.subject,
              created_at: emailRecord.created_at
            });
          }
          return matches;
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
    // Strategy: Find all 6-digit numbers that are NOT part of CSS hex colors
    // CSS colors are in format #XXXXXX where X is hex digit (0-9, a-f, A-F)

    // First, try to find codes in prominent HTML elements (most reliable)
    const prominentPatterns = [
      /<h[1-6][^>]*>(\d{6})<\/h[1-6]>/i,
      /<div[^>]*class="[^"]*code[^"]*"[^>]*>(\d{6})<\/div>/i,
      /<span[^>]*class="[^"]*code[^"]*"[^>]*>(\d{6})<\/span>/i,
      /<strong>(\d{6})<\/strong>/i,
      /<b>(\d{6})<\/b>/i,
      /code[^>]*>(\d{6})</i,
    ];

    for (const pattern of prominentPatterns) {
      const match = emailHtml.match(pattern);
      if (match) {
        logger.info('Extracted verification code from prominent element', { code: match[1] });
        return match[1];
      }
    }

    // Find all 6-digit sequences
    const allDigits = emailHtml.match(/\d{6}/g);
    if (!allDigits || allDigits.length === 0) {
      logger.warn('No 6-digit sequences found in email');
      return null;
    }

    // Filter out CSS hex colors by checking if preceded by '#'
    // Also filter out common CSS color codes
    const cssColorCodes = new Set(['333333', '555555', '666666', '999999', 'aaaaaa', 'cccccc', 'ffffff', '000000']);
    const nonCssDigits = allDigits.filter(digit => {
      // Check if this appears to be a CSS color
      const isLikelyCssColor = cssColorCodes.has(digit.toLowerCase()) ||
        emailHtml.includes(`#${digit}`) ||
        emailHtml.includes(`#${digit.toLowerCase()}`);
      return !isLikelyCssColor;
    });

    if (nonCssDigits.length > 0) {
      // Return the last non-CSS 6-digit number (most likely to be the verification code)
      const code = nonCssDigits[nonCssDigits.length - 1];
      logger.info('Extracted verification code (last non-CSS 6-digit)', { code });
      return code;
    }

    // Fallback: return the last 6-digit number
    const code = allDigits[allDigits.length - 1];
    logger.info('Extracted verification code (fallback to last digit)', { code });
    return code;
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
