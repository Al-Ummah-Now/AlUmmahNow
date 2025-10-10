# Al-Ummah Now Videos API - GitHub Copilot Instructions

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## AI Assistant Compatibility

These instructions are compatible with:
- **GitHub Copilot** - Primary coding agent support
- **Claude (Anthropic)** - Full instruction compatibility for development workflows
- **MCP (Model Context Protocol)** - Configured for seamless integration with MCP-enabled systems

## Working Effectively

### Initial Setup & Dependencies
- `npm install` - Install all dependencies (takes ~10-15 seconds)
- No additional SDK downloads required - uses Node.js v20+ and Wrangler CLI

### Build & Validation Commands  
- `npx tsc --noEmit` - Type check TypeScript (takes ~2-3 seconds)
- `npx wrangler deploy --dry-run` - Validate deployment bundle (takes ~1-2 seconds)
- **NEVER CANCEL**: All build operations complete in under 5 seconds. Use timeout of 30+ seconds for safety.

### Development Server
- `npm run dev` or `wrangler dev` - Start local development server on http://127.0.0.1:8686
- NEVER CANCEL: Server startup takes 10-15 seconds. Use timeout of 60+ seconds.
- Server includes hot reload - changes in `src/` automatically refresh
- Interactive documentation available at http://127.0.0.1:8686/

### Deployment
- `wrangler login` - Authenticate with Cloudflare (one-time setup)
- `npm run deploy` or `wrangler deploy` - Deploy to Cloudflare Workers
- NEVER CANCEL: Deployment takes 5-10 seconds. Use timeout of 60+ seconds.

### Network Configuration Notes
- **Claude/MCP Integration**: Repository configured for Claude and MCP compatibility
- **Cloudflare Access**: If experiencing DNS blocks for `*.cloudflare.com` domains, network allowlist may be required
- **Local Development**: All development can be done locally without external Cloudflare API calls

## Validation & Testing

### Authentication Testing
Always test authentication scenarios after making auth-related changes:

1. **Test public endpoints**: `curl http://127.0.0.1:8686/api/videos`
2. **Test auth required endpoints**: `curl http://127.0.0.1:8686/auth-test` (should succeed even without token in dev)
3. **Test protected operations**: `curl -X POST http://127.0.0.1:8686/api/videos` (should return 401)
4. **Test with invalid token**: `curl -H "Authorization: Bearer invalid" http://127.0.0.1:8686/auth-test`

### Manual API Validation Scenarios
Always run these scenarios after making changes:

1. **OpenAPI Documentation**: Visit http://127.0.0.1:8686/ - verify Swagger UI loads
2. **Schema Validation**: Visit http://127.0.0.1:8686/openapi.json - verify JSON is valid
3. **Health Check**: `curl http://127.0.0.1:8686/api/videos` - should return `{"cursor":"","limit":9,"data":[]}`
4. **Authentication Flow**: Click 🔐 Authorize button in Swagger UI - verify auth modal works

### Linting & Code Quality
- **No formal linter configured** - Follow existing TypeScript patterns
- **No test suite exists** - focus on manual validation scenarios above
- **No CI/CD pipeline** - manual testing is critical

## Codebase Navigation

### Project Structure
```
src/
├── index.ts              # Main router and app setup
├── endpoints/            # API endpoint implementations
│   ├── auth/            # Authentication endpoints
│   ├── video/           # Video management endpoints  
│   ├── profile/         # User profile endpoints
│   ├── playlist/        # Playlist endpoints
│   └── channel/         # Channel endpoints
├── middleware/          # Authentication and other middleware
│   ├── auth.ts         # JWT authentication logic
│   ├── auth-config.ts  # Auth configuration
│   └── auth-subjects.ts # Auth subject helpers
└── lib/                # Utility libraries
    ├── bunny/          # Bunny.net streaming integration
    ├── model/          # Data models and types
    ├── openapi-auth.ts # OpenAPI auth helpers
    └── types.ts        # TypeScript type definitions
```

### Key Files to Know
- `src/index.ts` - Main router, middleware setup, CORS configuration
- `src/middleware/auth.ts` - JWT authentication implementation
- `src/lib/openapi-auth.ts` - Authentication helpers for OpenAPI schemas
- `wrangler.jsonc` - Cloudflare Workers configuration
- `worker-configuration.d.ts` - TypeScript types for Cloudflare Workers

### Important Patterns
- **Authentication**: Import `addAuthToSchema` from `../../lib/openapi-auth` for endpoint auth
- **Error Responses**: Use standard format `{success: false, error: "message"}`
- **OpenAPI Schemas**: All endpoints use Zod for validation and OpenAPI generation
- **R2 Storage**: Video, profile, channel, and playlist data stored in R2 buckets

## Framework & Dependencies

### Core Technology Stack
- **Cloudflare Workers** - Serverless runtime environment
- **Hono** - Fast web framework for edge computing
- **Chanfana** - OpenAPI 3.1 integration for Hono
- **Zod** - Schema validation and TypeScript integration
- **@openauthjs/openauth** - JWT authentication integration

### Cloudflare Workers Bindings
The app uses these Cloudflare resources (configured in wrangler.jsonc):
- **R2 Buckets**: videos, profiles, channels, playlists
- **KV Storage**: AUTH_STORAGE for authentication data
- **Queues**: Event tracking and analytics
- **Secrets**: Bunny.net streaming keys and image storage keys

### Development Notes
- **No database** - uses R2 object storage and KV for persistence
- **No build step required** - TypeScript compiled on-the-fly by Wrangler
- **Environment isolation** - preview bindings used in development
- **CORS enabled** - all origins allowed for development

## Common Workflows

### Adding New Endpoints
1. Create endpoint file in appropriate `src/endpoints/` subdirectory
2. Import and register in `src/index.ts`
3. Add authentication middleware if required
4. Use `addAuthToSchema` helper for OpenAPI documentation
5. Test with both Swagger UI and curl commands

### Modifying Authentication
1. Update logic in `src/middleware/auth.ts`  
2. Check auth helpers in `src/lib/openapi-auth.ts`
3. Always test authentication scenarios listed above
4. Verify both authenticated and public endpoints work correctly

### Working with R2 Storage
1. Reference bindings in `worker-configuration.d.ts`
2. Use environment bindings: `videos`, `profiles`, `channels`, `playlists`
3. Check existing patterns in endpoint implementations
4. Test with actual data operations in development server

### Debugging Authentication Issues
1. Check `src/middleware/auth.ts` for JWT validation logic
2. Review OpenAPI schema auth configuration
3. Test `/auth-test` endpoint for basic auth verification
4. Inspect browser network tab when using Swagger UI

## Common Repository Commands

The following are frequently referenced commands and their typical outputs:

### Repository Root Files
```bash
ls -la
```
Output:
- `AUTHENTICATION.md` - API authentication guide for users
- `DEVELOPER_AUTH_GUIDE.md` - Authentication guide for developers 
- `README.md` - General project documentation
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `wrangler.jsonc` - Cloudflare Workers configuration
- `worker-configuration.d.ts` - Auto-generated types for Cloudflare bindings

### Sample Endpoint Structure  
```bash
find src/endpoints -name "*.ts" | head -5
```
Typical files:
- `./video/videoCreate.ts` - Create video endpoint
- `./video/videoList.ts` - List videos endpoint  
- `./playlist/playlistCreate.ts` - Create playlist endpoint
- `./profile/profileFetch.ts` - Fetch profile endpoint
- `./auth/authTest.ts` - Authentication test endpoint

### Package Information
- **Node.js**: v20.19.5 required
- **npm**: v10.8.2 or later
- **Wrangler**: v4.11.1+ (v4.38.0+ recommended)

### AI Assistant Compatibility Notes
- **GitHub Copilot**: Primary target for these instructions
- **Claude Integration**: Fully compatible with Claude-based development workflows
- **MCP Configuration**: Ready for Model Context Protocol implementations

Remember: This is a Cloudflare Workers application - traditional Node.js patterns may not apply. Always test in the Wrangler development environment.