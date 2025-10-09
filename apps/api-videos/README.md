# Al-Ummah Now Videos API

A Cloudflare Worker API with OpenAPI 3.1 using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This API provides video content management with JWT authentication, privacy controls, and comprehensive OpenAPI documentation.

## 📚 Documentation

| Document | Audience | Purpose |
|----------|----------|---------|
| [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md) | Developers | Complete API reference, architecture, and technical guide |
| [ROADMAP.md](./ROADMAP.md) | All Stakeholders | Feature roadmap and development phases |
| [AUTHENTICATION.md](./AUTHENTICATION.md) | API Users | How to authenticate and use the API |
| [DEVELOPER_AUTH_GUIDE.md](./DEVELOPER_AUTH_GUIDE.md) | API Developers | How to add auth to endpoints |
| This README | Everyone | Quick start and development setup |

**Additional Resources**:
- 🚀 [Live API Documentation](https://videos.api.alummahnow.net/) - Interactive Swagger UI
- 📋 [Project Board](https://github.com/users/meywd/projects/1/views/1) - Development status and planning
- 🐛 [Issue Templates](.github/ISSUE_TEMPLATE/) - Bug reports, feature requests, documentation

## Get started

### Prerequisites
- **Node.js**: v20.19.5+ ([Download](https://nodejs.org/))
- **Cloudflare Account**: [Sign up](https://workers.dev) (free tier is sufficient)
- **Git**: For repository management

### Quick Setup (5 minutes)

```bash
# 1. Clone and install dependencies
git clone https://github.com/meywd/AlUmmahNowVideos.git
cd AlUmmahNowVideos
npm install                    # Takes ~10-15 seconds

# 2. Authenticate with Cloudflare
npx wrangler login            # Opens browser for authentication

# 3. Start development server
npm run dev                   # Takes ~10-15 seconds to start

# 4. Open interactive API documentation
open http://127.0.0.1:8686   # Swagger UI with JWT authentication
```

### Verification Steps

After setup, verify everything works:

```bash
# ✓ Test public API endpoint
curl http://127.0.0.1:8686/api/videos

# ✓ Verify OpenAPI schema
curl http://127.0.0.1:8686/openapi.json | jq .

# ✓ Test authentication endpoint (development mode)
curl http://127.0.0.1:8686/auth-test
```

Expected responses:
- Videos endpoint: `{"cursor":"","limit":9,"data":[]}`
- Auth test: `{"message":"🎉 Authentication successful!",...}`

### Production Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy               # or: npx wrangler deploy

# Your API will be available at:
# https://your-worker-name.your-subdomain.workers.dev
```

## Features

- 🔐 **JWT Authentication** - Integration with OpenAuth (SST)
- 🔒 **Privacy Controls** - Public/private content filtering
- 📖 **OpenAPI Documentation** - Auto-generated with auth requirements
- 🌐 **CORS Support** - Comprehensive cross-origin resource sharing
- 🛡️ **Type Safety** - Full TypeScript with Zod validation
- 📊 **Analytics** - Queue-based event tracking

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. Authentication middleware in `src/middleware/`.
4. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

### Development Workflow

```bash
# Start development server (with hot reload)
npm run dev                   # Server starts at http://127.0.0.1:8686

# Verify TypeScript compilation
npx tsc --noEmit             # Check for type errors

# Validate deployment bundle
npx wrangler deploy --dry-run # Test deployment without publishing
```

### Interactive API Testing

1. **Open Documentation**: Navigate to `http://127.0.0.1:8686/`
2. **Authorize API Access**: Click the 🔐 **Authorize** button
3. **Enter JWT Token**: Format: `Bearer your-jwt-token-here`
4. **Test Endpoints**: Use the interactive interface to test API calls

### Key Development URLs

| URL | Purpose | Description |
|-----|---------|-------------|
| `http://127.0.0.1:8686/` | **Interactive Docs** | Swagger UI with authentication support |
| `http://127.0.0.1:8686/openapi.json` | **API Schema** | OpenAPI 3.1 specification |
| `http://127.0.0.1:8686/auth-test` | **Auth Testing** | Verify JWT authentication |
| `http://127.0.0.1:8686/api/videos` | **Public API** | Test public endpoints |

### Authentication Testing

```bash
# Test public endpoints (no authentication required)
curl http://127.0.0.1:8686/api/videos

# Test authentication endpoint (works in development mode)
curl http://127.0.0.1:8686/auth-test

# Test with JWT token (in production)
curl -H "Authorization: Bearer your-jwt-token" http://127.0.0.1:8686/auth-test
```

### Common Development Tasks

**Adding New Endpoints**:
1. Create endpoint file in `src/endpoints/[category]/`
2. Use authentication helper: `addAuthToSchema()` from `../../lib/openapi-auth`
3. Register endpoint in `src/index.ts`
4. Test with Swagger UI

**Debugging Issues**:
- Check console output in terminal running `npm run dev`
- Inspect network requests in browser developer tools
- Use `/auth-test` endpoint to verify authentication flow
- Review OpenAPI validation errors in responses

**Code Quality Checks**:
```bash
# Type checking
npx tsc --noEmit

# Deployment validation  
npx wrangler deploy --dry-run

# Manual testing scenarios (see TECHNICAL_DOCUMENTATION.md)
```

## API Documentation URLs

- **Interactive Docs**: `/` - Swagger UI with full JWT authentication support (🔐 Authorize button)
- **OpenAPI Schema**: `/openapi.json` - Enhanced schema with security schemes and auth requirements
- **Auth Test Endpoint**: `/auth-test` - Test JWT authentication (requires Bearer token)
