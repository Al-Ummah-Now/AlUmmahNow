# Web Application Architecture

## Overview

The **web** application is a Next.js 15 frontend deployed on Cloudflare Workers using @opennextjs/cloudflare. It provides a bilingual (English/Arabic) user interface with RTL support for the Al Ummah Now Islamic content platform.

## Technology Stack

### Core Framework
- **Next.js 15** with App Router
- **React 19** with Server Components
- **TypeScript** with strict type checking
- **Tailwind CSS** for styling
- **Cloudflare Workers** deployment platform

### Key Libraries
- **@opennextjs/cloudflare** - Next.js adapter for Cloudflare Workers
- **Video.js** - Video player with quality selection
- **OpenAuth** - JWT authentication integration
- **@al-ummah/shared-types** - Shared TypeScript types

## Architecture Patterns

### 1. Bilingual Routing Architecture
```
apps/web/src/app/
├── en/                    # English routes (LTR)
│   ├── (auth)/           # Auth group routes
│   ├── dashboard/        # User dashboard
│   ├── videos/           # Video browsing
│   └── ...
├── ar/                   # Arabic routes (RTL)
│   ├── (auth)/           # Auth group routes
│   ├── dashboard/        # User dashboard
│   ├── videos/           # Video browsing
│   └── ...
└── layout.tsx           # Root layout
```

### 2. Component Architecture
```
apps/web/src/components/
├── [component]/
│   ├── index.tsx         # LTR version
│   └── rtl/
│       └── index.tsx     # RTL version
├── ui/                   # Base UI components
├── layout/               # Layout components
└── providers/            # Context providers
```

### 3. API Client Architecture
```
apps/web/src/lib/api/
├── client.ts             # OpenAPI client configuration
├── types.ts              # API type definitions
└── endpoints/            # Endpoint-specific clients
    ├── videos.ts
    ├── channels.ts
    └── auth.ts
```

## Key Architectural Components

### 1. Authentication System
- **OpenAuth Integration**: JWT-based authentication via auth.alummahnow.net
- **Server Actions**: Authentication logic in `src/lib/actions.ts`
- **Middleware**: Route protection and session management
- **Token Management**: Secure token storage and refresh

### 2. Video Player Architecture
- **Video.js Integration**: Custom video player with quality selection
- **Bunny CDN Streaming**: Optimized video delivery
- **Responsive Design**: Mobile-first video player controls
- **Accessibility**: WCAG compliant player controls

### 3. State Management
- **React Server Components**: Server-side rendering for static content
- **Client Components**: Interactive UI elements with state
- **Context Providers**: Global state management
- **URL State**: Query parameters for filtering and pagination

### 4. Data Flow Architecture
```
User Interaction → Client Component → Server Action → API Client → Backend API
                ↓
            UI Update ← React State ← Response Processing ← API Response
```

## Directory Structure Deep Dive

### `/src/app/` - App Router Structure
- **Route Groups**: `(auth)` for authenticated routes
- **Parallel Routes**: Loading and error states
- **Layout Files**: Shared UI and metadata
- **Page Components**: Route-specific content

### `/src/components/` - Component Library
- **Reusable Components**: LTR/RTL variants
- **UI Components**: Design system components
- **Layout Components**: Header, footer, navigation
- **Feature Components**: Video player, comments, etc.

### `/src/lib/` - Utility Libraries
- **API Clients**: OpenAPI-generated clients
- **Authentication**: JWT handling and session management
- **Utilities**: Helper functions and constants
- **Actions**: Server actions for form handling

## Performance Optimizations

### 1. Cloudflare Workers Optimizations
- **Edge Caching**: Static assets cached at edge locations
- **Server-Side Rendering**: Initial HTML rendered at edge
- **Minimal Bundle Size**: Tree-shaking and code splitting
- **Cold Start Optimization**: Fast Workers initialization

### 2. Next.js Optimizations
- **App Router**: Efficient server/client component boundaries
- **Image Optimization**: Next.js Image component with CDN
- **Font Optimization**: Google Fonts with display swap
- **Code Splitting**: Automatic route-based splitting

### 3. Frontend Optimizations
- **Lazy Loading**: Components loaded on demand
- **Virtual Scrolling**: Large lists optimized
- **Debounced Search**: Reduced API calls
- **Progressive Enhancement**: Core functionality without JavaScript

## Security Architecture

### 1. Authentication Security
- **JWT Validation**: Server-side token verification
- **CSRF Protection**: Built-in Next.js protections
- **Secure Cookies**: HttpOnly, SameSite, Secure flags
- **Session Management**: Automatic token refresh

### 2. Data Security
- **Input Validation**: Zod schema validation
- **XSS Prevention**: React's built-in protections
- **Content Security Policy**: Strict CSP headers
- **HTTPS Enforcement**: All requests over HTTPS

### 3. API Security
- **Rate Limiting**: Client-side request throttling
- **Error Handling**: Secure error responses
- **Data Sanitization**: User input cleaning
- **CORS Configuration**: Proper cross-origin settings

## Deployment Architecture

### 1. Cloudflare Workers Deployment
```yaml
# wrangler.preview.jsonc
{
  "compatibility_date": "2024-01-01",
  "main": ".worker-nextjs/index.mjs",
  "assets": ".worker-nextjs/assets"
}
```

### 2. Environment Configuration
- **Preview**: Development and testing
- **Staging**: Pre-production validation
- **Production**: Live deployment

### 3. Build Process
- **Next.js Build**: Optimized production build
- **Worker Bundle**: Cloudflare Workers compatible bundle
- **Asset Optimization**: Image and font optimization
- **Type Checking**: Strict TypeScript validation

## Monitoring and Observability

### 1. Performance Monitoring
- **Web Vitals**: Core Web Vitals tracking
- **Bundle Analysis**: Bundle size monitoring
- **Load Performance**: Page load time tracking
- **User Experience**: Interaction metrics

### 2. Error Monitoring
- **Error Boundaries**: React error catching
- **Client Errors**: Frontend error tracking
- **Network Errors**: API failure monitoring
- **User Reports**: Error reporting system

### 3. Analytics Integration
- **User Behavior**: Page views and interactions
- **Performance Metrics**: Load times and errors
- **Business Metrics**: Video engagement and conversion
- **Custom Events**: Feature-specific tracking

## Development Workflow

### 1. Local Development
```bash
pnpm web:dev              # Start development server
http://localhost:3000      # English version
http://localhost:3000/ar  # Arabic version
```

### 2. Build Process
```bash
pnpm --filter @al-ummah/web build    # Production build
pnpm --filter @al-ummah/web type-check # Type validation
```

### 3. Testing Strategy
- **Unit Tests**: Component testing with Jest
- **Integration Tests**: API integration testing
- **E2E Tests**: User flow testing
- **Visual Testing**: RTL/LTR consistency

## Key Architectural Decisions

### 1. Next.js 15 with App Router
**Decision**: Adopt Next.js 15 with App Router for improved performance and developer experience.

**Rationale**:
- Server Components reduce client-side JavaScript
- Improved caching strategies
- Better TypeScript integration
- Enhanced security model

### 2. Cloudflare Workers Deployment
**Decision**: Deploy on Cloudflare Workers using @opennextjs/cloudflare.

**Rationale**:
- Global edge network for low latency
- Serverless scaling without cold starts
- Cost-effective for Islamic content platform
- Integrated with existing Cloudflare infrastructure

### 3. Bilingual Architecture
**Decision**: Implement separate route trees for English and Arabic.

**Rationale**:
- Proper RTL support for Arabic
- SEO-friendly URLs for both languages
- Independent content management
- Cultural and religious context preservation

### 4. OpenAuth Integration
**Decision**: Use external authentication service (OpenAuth).

**Rationale**:
- Separation of concerns
- Professional security implementation
- Reduced development complexity
- Compliance with authentication standards

## Integration Points

### 1. API Integration
- **REST API**: Communication with api-videos backend
- **WebSocket**: Real-time updates from websocket-server
- **Authentication**: JWT token management
- **Error Handling**: Consistent error responses

### 2. CDN Integration
- **Bunny CDN**: Video streaming and image delivery
- **Cloudflare CDN**: Static asset delivery
- **Cache Strategy**: Edge caching for performance
- **Fallback Mechanisms**: Graceful degradation

### 3. Analytics Integration
- **User Tracking**: Anonymous usage analytics
- **Performance Monitoring**: Real user monitoring
- **Business Intelligence**: Video engagement metrics
- **Privacy Compliance**: GDPR and data protection

## Future Architecture Considerations

### 1. Scalability
- **Micro-Frontends**: Potential for feature-based splitting
- **Edge Computing**: Enhanced edge processing capabilities
- **CDN Optimization**: Advanced caching strategies
- **Performance Budgets**: Automated performance enforcement

### 2. Feature Enhancements
- **Progressive Web App**: Offline capabilities and app-like experience
- **Advanced Search**: Full-text search with filters
- **Personalization**: AI-driven content recommendations
- **Social Features**: Community engagement tools

### 3. Technical Debt
- **Component Library**: Mature design system implementation
- **Testing Coverage**: Comprehensive test suite expansion
- **Documentation**: Living architecture documentation
- **Code Quality**: Automated quality gates

## Conclusion

The web application architecture is designed for scalability, performance, and maintainability while serving a bilingual Islamic audience. The combination of Next.js 15, Cloudflare Workers, and modern web technologies provides a solid foundation for the Al Ummah Now platform's growth and evolution.

The architecture prioritizes user experience through fast load times, responsive design, and proper RTL support, while maintaining security best practices and operational excellence through comprehensive monitoring and deployment automation.