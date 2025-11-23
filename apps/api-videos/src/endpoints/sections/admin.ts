import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { initializeAllIndices, rebuildIndex, getIndexStats } from "../../lib/initializeIndices";
import { logger } from "../../lib/logger";
import { addAuthToSchema } from "../../lib/openapi-auth";

const IndexOperationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  stats: z.object({
    indices: z.array(z.object({
      name: z.string(),
      lastUpdated: z.string(),
      count: z.number(),
      stale: z.boolean(),
    })),
    totalVideos: z.number(),
  }).optional(),
});

/**
 * Admin endpoint to initialize or rebuild video section indices
 * This should be protected by authentication and potentially admin-only access
 */
export class AdminIndexOperations extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Video Sections", "Admin"],
    summary: "Manage Video Section Indices",
    description: "Admin endpoint to initialize, rebuild, or check status of video section indices. Requires authentication.",
    request: {
      query: z.object({
        operation: z.enum(['initialize', 'rebuild', 'status']).describe("Operation to perform"),
        indexType: z.enum(['recent', 'popular', 'trending', 'categories', 'all']).optional().describe("Specific index to rebuild (for rebuild operation)"),
        period: z.enum(['all', 'monthly', 'weekly', 'daily']).optional().describe("Period for popular index rebuild"),
      }),
    },
    responses: {
      "200": {
        description: "Operation completed successfully",
        content: {
          "application/json": {
            schema: IndexOperationResponseSchema,
          },
        },
      },
      "401": {
        description: "Unauthorized - authentication required",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      "403": {
        description: "Forbidden - admin access required",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
    },
  }, 'required');

  async handle(c: any) {
    try {
      // Check authentication
      const auth = c.get('auth');
      if (!auth || !auth.userId) {
        return c.json(
          {
            success: false,
            error: "Authentication required",
          },
          401
        );
      }

      // TODO: Check admin permissions
      // For now, we'll allow any authenticated user (should be restricted in production)
      // if (!isAdmin(auth.userId)) {
      //   return c.json({ success: false, error: "Admin access required" }, 403);
      // }

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { operation, indexType, period } = data.query;

      const videoBucket = c.env.videos;

      switch (operation) {
        case 'initialize':
          // Start initialization in background
          c.executionCtx.waitUntil(
            initializeAllIndices(videoBucket).catch(err =>
              logger.error("Failed to initialize indices", { error: err })
            )
          );

          return c.json({
            success: true,
            message: "Index initialization started in background. This may take several minutes.",
          });

        case 'rebuild':
          if (indexType === 'all') {
            // Rebuild all indices
            c.executionCtx.waitUntil(
              initializeAllIndices(videoBucket).catch(err =>
                logger.error("Failed to rebuild all indices", { error: err })
              )
            );

            return c.json({
              success: true,
              message: "Rebuilding all indices in background. This may take several minutes.",
            });
          } else if (indexType && indexType !== 'all') {
            // Rebuild specific index
            c.executionCtx.waitUntil(
              rebuildIndex(videoBucket, indexType as any, period).catch(err =>
                logger.error(`Failed to rebuild ${indexType} index`, { error: err })
              )
            );

            return c.json({
              success: true,
              message: `Rebuilding ${indexType} index in background.`,
            });
          } else {
            return c.json({
              success: false,
              error: "Index type required for rebuild operation",
            }, 400);
          }

        case 'status':
          // Get current index statistics
          const stats = await getIndexStats(videoBucket);

          return c.json({
            success: true,
            message: "Index status retrieved",
            stats,
          });

        default:
          return c.json({
            success: false,
            error: "Invalid operation",
          }, 400);
      }
    } catch (error) {
      logger.error("Error in admin index operations", { error });
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Internal server error",
        },
        500
      );
    }
  }
}