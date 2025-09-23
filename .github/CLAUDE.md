# Claude AI Instructions for Al Ummah Now

This document provides specific instructions for Claude AI when working on the Al Ummah Now Next.js video platform.

## Project Overview

Al Ummah Now is a Next.js 15 video platform application deployed on Cloudflare Workers with R2 storage, featuring authentication via OpenAuth, video streaming, and multi-language support (English/Arabic).

## Claude-Specific Guidelines

### Use All Available MCP Tools
- Leverage all Model Context Protocol (MCP) tools for maximum efficiency
- Use multiple tool calls simultaneously when performing independent operations
- Prioritize exploring repository structure before making changes

### Development Approach
- Always validate commands before documenting them
- Test build processes with proper timeout settings
- Document actual timing measurements for commands
- Account for network restrictions in constrained environments

### Code Quality Standards
- Follow existing code patterns and conventions
- Use TypeScript strictly - all files should have proper typing
- Maintain consistency with existing ESLint and Prettier configurations
- Respect the existing project architecture (Next.js App Router, Cloudflare Workers)

### Network-Aware Development
- Be aware of external API blocking in development environments
- Document workarounds for network-restricted scenarios
- Test both local development and production build scenarios
- Account for Google Fonts and CDN limitations

### Authentication & Security
- Understand the OpenAuth implementation in `src/lib/actions.ts`
- Respect authentication flows and user context
- Handle authentication errors gracefully
- Maintain security best practices for token handling

### API Integration
- Use the OpenAPI client implementation in `src/lib/api/`
- Maintain backward compatibility with existing client files
- Handle API errors appropriately (network calls may fail in development)
- Follow the established pattern for error handling and null returns

### UI/UX Considerations
- Support both English and Arabic language routes (`/en/` and `/ar/`)
- Maintain responsive design principles
- Use existing Tailwind CSS theme system
- Ensure dark mode compatibility
- Test navigation between language routes

### Testing Strategy
- Always test the complete user flow after changes
- Validate homepage functionality (header, logo, Videos section)
- Test navigation between routes
- Verify responsive design on different screen sizes
- Take screenshots to validate UI changes

### Build and Deployment
- Understand Cloudflare Workers deployment via @opennextjs/cloudflare
- Be aware of build timing expectations (38 seconds to 90+ minutes)
- Never cancel long-running builds
- Use appropriate timeout settings for all commands
- Test both development and production builds

### Environment Variables
- Understand the Cloudflare environment configuration in `wrangler.jsonc`
- Respect R2 bucket bindings and BunnyNet CDN integration
- Handle missing environment variables gracefully
- Use `npm run cf-typegen` after modifying environment variables

## Key Commands Reference

```bash
# Dependencies and setup
npm install                    # 65 seconds, timeout: 120+ seconds

# Development
npm run dev                    # 4 seconds to start
npm run build                  # 38 seconds, up to 90+ minutes
npm run lint                   # 4 seconds, 3 warnings acceptable
npx tsc --noEmit              # 6 seconds for type checking

# Cloudflare-specific
npm run cf-typegen            # 1 second, generates types
npm run preview               # Build + Wrangler dev server
npm run deploy                # Deploy to Cloudflare Workers
npm run check                 # Full validation (8 seconds)
```

## Common Patterns

### Error Handling
```typescript
try {
  const result = await apiCall();
  if (!result) {
    // Handle null return (network error)
    return null;
  }
  return result;
} catch (error) {
  console.error('Operation failed:', error);
  return null;
}
```

### Authentication Check
```typescript
import { authenticated } from '@/lib/actions';

const user = await authenticated();
if (!user) {
  // Handle unauthenticated state
  return;
}
```

### API Client Usage
```typescript
import { VideosAPI } from '@/lib/api';

const videos = await VideosAPI.list({ limit: 10 });
if (!videos) {
  // Handle API error
  return;
}
```

## File Locations to Remember

- **Main app entry**: `src/app/page.tsx` (redirects to `/en/`)
- **Authentication**: `src/lib/actions.ts`
- **API clients**: `src/lib/api/`
- **Components**: `src/components/`
- **Language routes**: `src/app/en/` and `src/app/ar/`
- **Configuration**: `next.config.ts`, `wrangler.jsonc`, `tailwind.config.ts`
- **Types**: `src/interfaces/`, `cloudflare-env.d.ts`

## Always Remember

1. **Test thoroughly** - Run the complete user flow after changes
2. **Document limitations** - Note network restrictions and workarounds  
3. **Use proper timeouts** - Never cancel builds prematurely
4. **Validate commands** - Test every instruction before documenting
5. **Take screenshots** - Visual validation of UI changes
6. **Follow patterns** - Use existing code conventions and architectures