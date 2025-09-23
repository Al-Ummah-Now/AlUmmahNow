# Al Ummah Now - Next.js Video Platform

Al Ummah Now is a Next.js 15 video platform application deployed on Cloudflare Workers with R2 storage, featuring authentication via OpenAuth, video streaming, and multi-language support (English/Arabic).

**ALWAYS follow these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Initial Setup and Build
- Install dependencies: `npm install` -- takes 65 seconds. NEVER CANCEL. Set timeout to 120+ seconds.
- Check TypeScript types: `npx tsc --noEmit` -- takes 6 seconds
- Run linting: `npm run lint` -- takes 4 seconds with warnings (acceptable)
- Production build: `npm run build` -- takes 38 seconds. NEVER CANCEL. Set timeout to 90+ minutes.
  - **CRITICAL**: Build fails in network-restricted environments due to Google Fonts. This is a known limitation.
  - In restricted environments, temporarily remove `import { Inter } from "next/font/google"` and `const inter = Inter({})` from `src/app/layout.tsx` and replace `className={inter.className}` with `className="font-inter"`

### Development and Testing
- Start development server: `npm run dev` -- starts in 4 seconds on port 3000 (or next available port)
- Access the application at `http://localhost:3000` or the displayed port
- **VALIDATION SCENARIO**: Always test the homepage loads with header, logo, and "Videos" section. Navigation to `/en` and `/ar` routes should work.
- The app auto-redirects from `/` to `/en/` as the default route

### Cloudflare-Specific Commands
- Generate Cloudflare types: `npm run cf-typegen` -- takes 1 second
- Build for Cloudflare: `opennextjs-cloudflare build` (part of other commands)
- Preview deployment: `npm run preview` -- builds and starts Wrangler dev server
- Deploy: `npm run deploy` -- builds and deploys to Cloudflare Workers
- Dry-run check: `npm run check` -- takes 8 seconds, validates build and types

### Build Timing and Warnings
- **NEVER CANCEL** any build commands - they may take up to 90 minutes in some environments
- Set explicit timeouts of 120+ seconds for `npm install`
- Set explicit timeouts of 120+ minutes for `npm run build` and `npm run check`
- TypeScript version warnings are expected (using 5.7.2 vs supported <5.5.0)
- ESLint warnings about missing dependencies and img elements are acceptable

## Validation

### Manual Testing Requirements
- **CRITICAL**: Always test the full application flow after changes:
  1. Start dev server with `npm run dev`
  2. Navigate to `http://localhost:3000` - should redirect to `/en/`
  3. Verify header with logo and navigation elements render
  4. Check "Videos" section appears with "Load More" button
  5. Test navigation between `/en` and `/ar` routes
  6. Verify responsive design and theme switching works

### Build Validation
- Always run `npm run lint` before committing - 3 warnings are acceptable
- Always run `npx tsc --noEmit` to validate TypeScript types
- Test production build with `npm run build` when making core changes
- Use `npm run cf-typegen` after modifying `wrangler.jsonc` environment variables

## Common Tasks

### Network Limitations
- **CRITICAL**: This environment blocks external API calls including:
  - Google Fonts (causes build failures)
  - CDN resources (fonts.googleapis.com, cdnjs.cloudflare.com)
  - Application APIs (videos.api.alummahnow.net)
- The application will show API errors in console - this is expected in development

### Key Project Structure
```
/home/runner/work/AlUmmahNow/AlUmmahNow/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── en/                # English language routes
│   │   ├── ar/                # Arabic language routes
│   │   ├── api/               # API routes (callback)
│   │   ├── layout.tsx         # Root layout with auth and navigation
│   │   └── page.tsx           # Homepage (redirects to /en)
│   ├── components/            # Reusable UI components
│   │   ├── navigation/        # Header and nav components
│   │   ├── videoCard/         # Video display components
│   │   ├── ui/                # Shadcn/ui components
│   │   └── AuthProvider/      # Authentication context
│   ├── lib/                   # Utilities and business logic
│   │   ├── api/               # OpenAPI client implementation
│   │   ├── clients/           # Legacy API clients
│   │   ├── actions.ts         # Server actions for auth
│   │   └── utility.ts         # Helper functions
│   ├── hooks/                 # Custom React hooks
│   └── interfaces/            # TypeScript type definitions
├── public/                    # Static assets (logo, favicon)
├── .open-next/               # Cloudflare build output (generated)
├── package.json              # Dependencies and scripts
├── next.config.ts            # Next.js configuration
├── wrangler.jsonc            # Cloudflare Workers configuration
├── tailwind.config.ts        # Tailwind CSS configuration
└── cloudflare-env.d.ts       # Cloudflare environment types
```

### Important Files to Check After Changes
- Always verify `src/app/layout.tsx` after authentication changes
- Check `src/lib/api/` after modifying API contracts or endpoints
- Review `wrangler.jsonc` after environment variable changes
- Update `cloudflare-env.d.ts` types after Cloudflare binding changes

### Environment Variables (from wrangler.jsonc)
- `OPENAUTH_ISSUER`: "https://auth.alummahnow.net"
- `API_URL`: Points to videos API
- Cloudflare R2 buckets: `videos` bucket for storage
- BunnyNet CDN keys for image/video delivery

### Dependencies and Architecture
- **Framework**: Next.js 15 with App Router
- **Deployment**: Cloudflare Workers via @opennextjs/cloudflare
- **Authentication**: @openauthjs/openauth with custom auth flow
- **Styling**: Tailwind CSS with custom theme support
- **UI Components**: Radix UI primitives with shadcn/ui patterns
- **API**: OpenAPI-compliant client in `src/lib/api/`
- **Database**: Cloudflare R2 for video storage, external API for metadata

### Common npm Scripts Reference
```bash
npm install           # Install dependencies (65s)
npm run dev          # Development server (4s to start)
npm run build        # Production build (38s)
npm run start        # Start production server
npm run lint         # ESLint checking (4s)
npm run preview      # Build and preview with Wrangler
npm run deploy       # Deploy to Cloudflare Workers  
npm run check        # Full validation (build + types + deploy dry-run)
npm run cf-typegen   # Generate Cloudflare types (1s)
npx tsc --noEmit     # Type checking only (6s)
```

### Performance Expectations
- Development server: Ready in ~4 seconds
- Full production build: 38 seconds (up to 90 minutes in constrained environments)
- Type checking: 6 seconds
- Linting: 4 seconds
- Cloudflare type generation: 1 second

### Known Issues and Workarounds
- **Google Fonts**: Build fails in network-restricted environments - temporarily remove font imports
- **API Calls**: External API calls fail in development - expected behavior
- **TypeScript Version**: Warning about unsupported TypeScript 5.7.2 - safe to ignore
- **ESLint**: 3 warnings about missing dependencies and img elements - acceptable
- **Port Conflicts**: Use `pkill -f "next"` to clean up processes if ports are in use