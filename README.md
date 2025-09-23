# Al Ummah Now - Video Portal UI

**An Islamic content platform for scholars' clips, educational content, and community building**

This repository contains the frontend user interface for the Al Ummah Now video platform - a YouTube alternative focused on Islamic content, educational materials, and scholarly discussions.

## 🎯 Project Vision

Al Ummah Now aims to create a comprehensive Islamic content ecosystem including:
- **Video Portal** (this repository) - Video sharing and consumption platform
- **News Website** - Islamic news and articles  
- **Academy Platform** - Educational courses and learning paths
- **Community Features** - Discussion, messaging, and interaction tools

## 📋 Complete Documentation

### 📊 Project Planning & Analysis
- **[🗺️ ROADMAP.md](./ROADMAP.md)** - Comprehensive 4-phase development roadmap with timeline and milestones
- **[📊 FEATURES.md](./FEATURES.md)** - Current implementation analysis (~60% complete) and missing features  
- **[🏗️ ARCHITECTURE.md](./ARCHITECTURE.md)** - Technical system design and microservices architecture

### 🤝 Contributing & Development
- **[🤝 CONTRIBUTING.md](./CONTRIBUTING.md)** - Developer guidelines, setup instructions, and contribution workflow
- **[🐛 Bug Reports](./.github/ISSUE_TEMPLATE/bug_report.yml)** - Report bugs and issues
- **[✨ Feature Requests](./.github/ISSUE_TEMPLATE/feature_request.yml)** - Suggest new features and enhancements
- **[📚 Documentation Requests](./.github/ISSUE_TEMPLATE/documentation_request.yml)** - Request documentation improvements

### 🔗 Project Management
- **[📋 Project Board](https://github.com/users/meywd/projects/1/views/1)** - Track development progress and milestones
- **[📋 Issues](https://github.com/meywd/AlUmmahNow/issues)** - Current tasks, bugs, and feature requests

## 🌐 Live Demo

A live deployment is available at: [https://al-ummah-now.templates.workers.dev](https://al-ummah-now.templates.workers.dev)

*Updated to resolve merge conflicts*

## 🚀 Current Status

**Phase**: Foundation Development (Video Portal UI)  
**Progress**: ~60% Complete

### ✅ Implemented Features
- Next.js 15 with TypeScript and Tailwind CSS
- Video player with Video.js integration
- Complete OpenAPI-based API client
- Authentication system using OpenAuth
- Bilingual support (English/Arabic) with RTL layout
- User profiles, channels, and playlist management
- Comment system and social interactions
- Responsive design and dark/light themes

### 🔧 In Development
- Video upload functionality
- Real-time notifications and live features
- Advanced search and content discovery
- Mobile app companion
- Content moderation tools

## 🛠️ Technology Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS
- **Authentication**: OpenAuth with JWT tokens
- **Video Player**: Video.js with custom controls
- **Deployment**: Cloudflare Workers via OpenNext
- **Styling**: Tailwind CSS with dark/light themes
- **Internationalization**: Built-in RTL support

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account for deployment

### Development Setup

1. **Clone and install dependencies:**
# Al Ummah Now - Video Portal UI

**An Islamic content platform for scholars' clips, educational content, and community building**

This repository contains the frontend user interface for the Al Ummah Now video platform - a YouTube alternative focused on Islamic content, educational materials, and scholarly discussions.

## 🎯 Project Vision

Al Ummah Now aims to create a comprehensive Islamic content ecosystem including:
- **Video Portal** (this repository) - Video sharing and consumption platform
- **News Website** - Islamic news and articles  
- **Academy Platform** - Educational courses and learning paths
- **Community Features** - Discussion, messaging, and interaction tools

## 📋 Complete Documentation

### 📊 Project Planning & Analysis
- **[🗺️ ROADMAP.md](./ROADMAP.md)** - Comprehensive 4-phase development roadmap with timeline and milestones
- **[📊 FEATURES.md](./FEATURES.md)** - Current implementation analysis (~60% complete) and missing features  
- **[🏗️ ARCHITECTURE.md](./ARCHITECTURE.md)** - Technical system design and microservices architecture

### 🤝 Contributing & Development
- **[🤝 CONTRIBUTING.md](./CONTRIBUTING.md)** - Developer guidelines, setup instructions, and contribution workflow
- **[🐛 Bug Reports](./.github/ISSUE_TEMPLATE/bug_report.yml)** - Report bugs and issues
- **[✨ Feature Requests](./.github/ISSUE_TEMPLATE/feature_request.yml)** - Suggest new features and enhancements
- **[📚 Documentation Requests](./.github/ISSUE_TEMPLATE/documentation_request.yml)** - Request documentation improvements

### 🔗 Project Management
- **[📋 Project Board](https://github.com/users/meywd/projects/1/views/1)** - Track development progress and milestones
- **[📋 Issues](https://github.com/meywd/AlUmmahNow/issues)** - Current tasks, bugs, and feature requests

## 🌐 Live Demo

A live deployment is available at: [https://al-ummah-now.templates.workers.dev](https://al-ummah-now.templates.workers.dev)

*Updated to resolve merge conflicts*

## 🚀 Current Status

**Phase**: Foundation Development (Video Portal UI)  
**Progress**: ~60% Complete

### ✅ Implemented Features
- Next.js 15 with TypeScript and Tailwind CSS
- Video player with Video.js integration
- Complete OpenAPI-based API client
- Authentication system using OpenAuth
- Bilingual support (English/Arabic) with RTL layout
- User profiles, channels, and playlist management
- Comment system and social interactions
- Responsive design and dark/light themes

### 🔧 In Development
- Video upload functionality
- Real-time notifications and live features
- Advanced search and content discovery
- Mobile app companion
- Content moderation tools

## 🛠️ Technology Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS
- **Authentication**: OpenAuth with JWT tokens
- **Video Player**: Video.js with custom controls
- **Deployment**: Cloudflare Workers via OpenNext
- **Styling**: Tailwind CSS with dark/light themes
- **Internationalization**: Built-in RTL support

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account for deployment

### Development Setup

1. **Clone and install dependencies:**
```bash
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow
npm install
```

2. **Set up environment variables:**
git clone https://github.com/meywd/AlUmmahNow.git
cd AlUmmahNow
npm install
```

2. **Set up environment variables:**
```bash
# Copy example environment file
cp .env.example .env.local

# Configure required variables:
# - NEXT_PUBLIC_API_URL: Backend API endpoint
# - ClientId: OAuth client ID
# - Issuer: OAuth issuer URL
```

3. **Start development server:**
# Copy example environment file
cp .env.example .env.local

# Configure required variables:
# - NEXT_PUBLIC_API_URL: Backend API endpoint
# - ClientId: OAuth client ID
# - Issuer: OAuth issuer URL
```

3. **Start development server:**
```bash
npm run dev
```

4. **Open your browser:**
Navigate to [http://localhost:3000](http://localhost:3000)

### Production Deployment

```bash
# Build and deploy to Cloudflare Workers
npm run deploy

# Or preview before deployment
npm run preview
```

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── en/                # English language routes
│   ├── ar/                # Arabic language routes (RTL)
│   └── api/               # API routes
├── components/            # React components
│   ├── Header/            # Navigation header
│   ├── videoPlayer/       # Video playback component
│   ├── AuthProvider/      # Authentication context
│   └── ...
├── lib/                   # Utility libraries
│   ├── api/               # OpenAPI client implementation
│   ├── auth.ts            # Authentication utilities
│   └── actions.ts         # Server actions
└── interfaces/            # TypeScript type definitions
```

## 🔌 API Integration

The frontend integrates with the Al Ummah Now API ecosystem:

```typescript
// Example API usage
import { VideosAPI, ChannelsAPI } from '@/lib/api';

// Get videos with pagination
const videos = await VideosAPI.list({ limit: 20, cursor: 'next_page' });

// Get channel details
const channel = await ChannelsAPI.getById('channel-id');

// Create authenticated requests
const headers = { channelId: 'user-channel', userId: 'user-id' };
await VideosAPI.create(videoData, headers);
```

## 🌍 Internationalization

Built-in support for English and Arabic:

- **English**: `/en/` routes with LTR layout
- **Arabic**: `/ar/` routes with RTL layout
- **Components**: Dual implementations for proper text direction
- **Navigation**: Language-aware routing and UI

## 🎨 Customization

### Themes
- Light and dark mode support
- Configurable via `src/components/themeProvider.tsx`
- Tailwind CSS classes for consistent styling

### Video Player
- Customizable Video.js configuration
- Support for multiple video qualities
- Adaptive bitrate streaming ready

## 🔒 Authentication

Integrated with OpenAuth for secure authentication:
- JWT token management with refresh rotation
- OAuth provider support (Google, Apple)
- Protected routes and middleware
- Session management

## 🤝 Contributing

We welcome contributions to the Al Ummah Now platform:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and test thoroughly
4. **Commit changes**: `git commit -m 'Add amazing feature'`
5. **Push to branch**: `git push origin feature/amazing-feature`
6. **Open a Pull Request**

### Development Guidelines
- Follow TypeScript best practices
- Maintain component modularity
- Test both English and Arabic layouts
- Ensure mobile responsiveness
- Add JSDoc comments for complex functions

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## 📊 Analytics & Monitoring

The platform includes built-in analytics:
- User engagement tracking
- Video performance metrics
- API usage monitoring
- Error reporting and logging

## 🔮 Upcoming Features

See [ROADMAP.md](./ROADMAP.md) for detailed development plans:

- **Phase 1**: Video upload, live streaming, advanced search
- **Phase 2**: Mobile apps, AI recommendations, moderation tools
- **Phase 3**: Academy platform, news integration, community features
- **Phase 4**: AI chat, messaging, advanced analytics

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- **Documentation**: Check the [FEATURES.md](./FEATURES.md) and [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Issues**: Open an issue on GitHub
- **Community**: Join our discussions for feature requests and feedback

---

Built with ❤️ for the Muslim community worldwide.
4. **Open your browser:**
Navigate to [http://localhost:3000](http://localhost:3000)

### Production Deployment

```bash
# Build and deploy to Cloudflare Workers
npm run deploy

# Or preview before deployment
npm run preview
```

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── en/                # English language routes
│   ├── ar/                # Arabic language routes (RTL)
│   └── api/               # API routes
├── components/            # React components
│   ├── Header/            # Navigation header
│   ├── videoPlayer/       # Video playback component
│   ├── AuthProvider/      # Authentication context
│   └── ...
├── lib/                   # Utility libraries
│   ├── api/               # OpenAPI client implementation
│   ├── auth.ts            # Authentication utilities
│   └── actions.ts         # Server actions
└── interfaces/            # TypeScript type definitions
```

## 🔌 API Integration

The frontend integrates with the Al Ummah Now API ecosystem:

```typescript
// Example API usage
import { VideosAPI, ChannelsAPI } from '@/lib/api';

// Get videos with pagination
const videos = await VideosAPI.list({ limit: 20, cursor: 'next_page' });

// Get channel details
const channel = await ChannelsAPI.getById('channel-id');

// Create authenticated requests
const headers = { channelId: 'user-channel', userId: 'user-id' };
await VideosAPI.create(videoData, headers);
```

## 🌍 Internationalization

Built-in support for English and Arabic:

- **English**: `/en/` routes with LTR layout
- **Arabic**: `/ar/` routes with RTL layout
- **Components**: Dual implementations for proper text direction
- **Navigation**: Language-aware routing and UI

## 🎨 Customization

### Themes
- Light and dark mode support
- Configurable via `src/components/themeProvider.tsx`
- Tailwind CSS classes for consistent styling

### Video Player
- Customizable Video.js configuration
- Support for multiple video qualities
- Adaptive bitrate streaming ready

## 🔒 Authentication

Integrated with OpenAuth for secure authentication:
- JWT token management with refresh rotation
- OAuth provider support (Google, Apple)
- Protected routes and middleware
- Session management

## 🤝 Contributing

We welcome contributions to the Al Ummah Now platform:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and test thoroughly
4. **Commit changes**: `git commit -m 'Add amazing feature'`
5. **Push to branch**: `git push origin feature/amazing-feature`
6. **Open a Pull Request**

### Development Guidelines
- Follow TypeScript best practices
- Maintain component modularity
- Test both English and Arabic layouts
- Ensure mobile responsiveness
- Add JSDoc comments for complex functions

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## 📊 Analytics & Monitoring

The platform includes built-in analytics:
- User engagement tracking
- Video performance metrics
- API usage monitoring
- Error reporting and logging

## 🔮 Upcoming Features

See [ROADMAP.md](./ROADMAP.md) for detailed development plans:

- **Phase 1**: Video upload, live streaming, advanced search
- **Phase 2**: Mobile apps, AI recommendations, moderation tools
- **Phase 3**: Academy platform, news integration, community features
- **Phase 4**: AI chat, messaging, advanced analytics

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- **Documentation**: Check the [FEATURES.md](./FEATURES.md) and [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Issues**: Open an issue on GitHub
- **Community**: Join our discussions for feature requests and feedback

---

Built with ❤️ for the Muslim community worldwide.
