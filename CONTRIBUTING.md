# Contributing to Al Ummah Now

Thank you for your interest in contributing to Al Ummah Now! This project aims to create a comprehensive Islamic content platform, and we welcome contributions from developers, designers, content creators, and community members who share our vision of providing high-quality Islamic content to the global Muslim community.

## 🎯 How to Contribute

### 1. Code Contributions

**Areas where we need help:**
- Frontend UI/UX improvements
- Backend API development
- Mobile app development (future)
- DevOps and infrastructure
- Testing and quality assurance
- Performance optimization
- Accessibility improvements

### 2. Content & Community Contributions

**Non-technical contributions:**
- Islamic content review and verification
- Translation and localization (Arabic/English)
- Documentation improvements
- Community moderation
- User experience feedback
- Bug reports and feature suggestions

## 🚀 Getting Started

### Development Environment Setup

1. **Fork and clone the repository:**
```bash
git clone https://github.com/YOUR_USERNAME/AlUmmahNow.git
cd AlUmmahNow
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. **Start development server:**
```bash
npm run dev
```

5. **Verify setup:**
   - Navigate to `http://localhost:3000`
   - Test both English (`/en`) and Arabic (`/ar`) routes
   - Verify responsive design on different screen sizes

### 3. Create a feature branch:
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

## 📝 Development Guidelines

### Code Standards

**TypeScript & JavaScript:**
- Use TypeScript for all new code
- Follow existing code style and patterns
- Use meaningful variable and function names
- Add JSDoc comments for complex functions
- Prefer functional programming patterns where appropriate

**Example:**
```typescript
/**
 * Fetches video data with proper error handling and type safety
 * @param videoId - Unique identifier for the video
 * @param headers - Authentication headers
 * @returns Promise containing video data or null if not found
 */
async function getVideoData(
  videoId: string, 
  headers: AuthHeaders
): Promise<VideoObject | null> {
  try {
    return await VideosAPI.getById(videoId, headers);
  } catch (error) {
    console.error('Failed to fetch video:', error);
    return null;
  }
}
```

**React Components:**
- Use functional components with hooks
- Implement proper prop types with TypeScript interfaces
- Follow existing component structure and naming
- Ensure components work in both LTR and RTL layouts
- Add proper accessibility attributes

**CSS & Styling:**
- Use Tailwind CSS classes for consistency
- Follow the existing design system
- Ensure responsive design (mobile-first)
- Support both light and dark themes
- Test RTL layout for Arabic support

### Islamic Content Guidelines

**Content Appropriateness:**
- All content must align with Islamic values and teachings
- Respect cultural sensitivities across different Muslim communities
- Ensure scholarly accuracy in Islamic content
- Maintain family-friendly environment
- Avoid controversial or divisive content

**Scholarly Review:**
- Educational content should be reviewed by qualified Islamic scholars
- Citations and references should be authentic and verifiable
- Translations of Islamic texts should be from recognized sources
- Contemporary issues should reflect mainstream Islamic scholarship

### Testing Requirements

**Before submitting your changes:**
- Test functionality in both English and Arabic layouts
- Verify dark/light theme compatibility
- Test responsive design on different screen sizes
- Check accessibility compliance (WCAG 2.1)
- Ensure proper loading states and error handling

**Running Tests:**
```bash
# Type checking
npm run type-check

# Linting
npm run lint

# Unit tests (when available)
npm run test

# Build verification
npm run build
```

### Commit Message Guidelines

Use conventional commit format:
```
type(scope): description

Examples:
feat(video): add video upload progress tracking
fix(auth): resolve token refresh issue
docs(api): update API documentation
style(ui): improve mobile responsiveness
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: UI/styling changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process or tooling changes

## 🔄 Pull Request Process

### 1. Ensure your branch is up to date:
```bash
git fetch origin
git rebase origin/main
```

### 2. Create a descriptive pull request:

**PR Title Format:**
```
[TYPE] Brief description of changes

Examples:
[FEATURE] Implement video upload with progress tracking
[FIX] Resolve authentication token refresh issue
[DOCS] Add API documentation for video endpoints
```

**PR Description Template:**
```markdown
## 📋 Description
Brief description of what this PR does.

## 🎯 Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## ✅ Testing Done
- [ ] Tested in English and Arabic
- [ ] Verified mobile responsiveness
- [ ] Checked accessibility compliance
- [ ] Tested dark/light themes
- [ ] All tests passing

## 📸 Screenshots
Include screenshots for UI changes.

## 🔗 Related Issues
Fixes #issue_number
Related to #issue_number

## 📝 Additional Notes
Any additional context or notes for reviewers.
```

### 3. PR Review Process:
- Maintainers will review your PR within 2-3 business days
- Address any feedback or requested changes promptly
- Keep PR focused and atomic (one feature/fix per PR)
- Once approved, your PR will be merged

## 🐛 Issue Reporting

### Bug Reports
Use the bug report template and include:
- Clear steps to reproduce
- Expected vs actual behavior
- Browser/device information
- Screenshots if applicable
- Console errors or logs

### Feature Requests
Use the feature request template and include:
- Clear problem statement
- Proposed solution
- User stories and use cases
- Technical considerations
- Islamic values alignment

### Documentation Requests
Use the documentation request template for:
- Missing documentation
- Unclear or outdated docs
- Translation needs
- Tutorial requests

## 🏗️ Project Structure

Understanding the codebase:

```
Al Ummah Now Ecosystem:
├── AlUmmahNow (this repo)          # Video Portal UI
├── AlUmmahNowVideos               # API Backend (planned)
├── AlUmmahNowAuth                 # Authentication Service (planned)
├── AlUmmahNowProcessor            # Events & Analytics (planned)
└── AlUmmahNowCMS                  # Content Management (planned)
```

**Current Repository Structure:**
```
src/
├── app/                   # Next.js App Router pages
│   ├── [locale]/         # Internationalized routes (en/ar)
│   ├── api/              # API routes and middleware
│   └── globals.css       # Global styles
├── components/           # Reusable React components
│   ├── ui/              # Base UI components
│   ├── video/           # Video-related components
│   ├── navigation/      # Navigation components
│   └── auth/            # Authentication components
├── lib/                 # Utilities and configurations
│   ├── api/             # API client implementation
│   ├── auth/            # Authentication utilities
│   └── utils/           # Helper functions
└── types/               # TypeScript type definitions
```

## 🔧 Development Workflow

### Local Development

**Available Scripts:**
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Check code style
npm run type-check   # TypeScript type checking
npm run preview      # Preview production build locally
```

### Working with APIs

The frontend integrates with backend APIs:
```typescript
// Example API usage
import { VideosAPI } from '@/lib/api';

// Get videos with authentication
const headers = { 
  channelId: 'user-channel-id', 
  userId: 'user-id' 
};
const videos = await VideosAPI.list({ limit: 20 }, headers);
```

### Internationalization

**Adding new text:**
- English routes: `/src/app/en/`
- Arabic routes: `/src/app/ar/`
- Ensure proper RTL layout support
- Test text direction and alignment

**Component Development:**
```typescript
// Support both languages with proper text direction
const VideoCard = ({ video, locale }: VideoCardProps) => {
  const isRTL = locale === 'ar';
  
  return (
    <div className={`video-card ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Component content */}
    </div>
  );
};
```

## 🎨 Design Guidelines

### UI/UX Principles
- **Islamic Aesthetics**: Clean, respectful design that reflects Islamic values
- **Accessibility First**: WCAG 2.1 compliance for all users
- **Mobile First**: Responsive design starting from mobile
- **Performance**: Fast loading and smooth interactions
- **Clarity**: Clear navigation and intuitive user flows

### Component Development
```typescript
// Example component with proper TypeScript and accessibility
interface VideoPlayerProps {
  video: VideoObject;
  autoplay?: boolean;
  locale: 'en' | 'ar';
  onVideoEnd?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  video,
  autoplay = false,
  locale,
  onVideoEnd
}) => {
  return (
    <div 
      className="video-player"
      role="region"
      aria-label={`Video player: ${video.title}`}
    >
      {/* Player implementation */}
    </div>
  );
};
```

### Theme Support
```css
/* Support both light and dark themes */
.video-card {
  @apply bg-white dark:bg-gray-800;
  @apply text-gray-900 dark:text-gray-100;
  @apply border border-gray-200 dark:border-gray-700;
}
```

## 🔒 Security Considerations

### Frontend Security
- **Input Validation**: Validate all user inputs client-side and server-side
- **XSS Prevention**: Sanitize content display, especially user-generated content
- **Authentication**: Secure token handling and storage
- **HTTPS**: All communications must use HTTPS
- **Content Security Policy**: Follow CSP guidelines

### Content Security
```typescript
// Example of secure content handling
const sanitizeUserContent = (content: string): string => {
  // Remove potentially harmful HTML/JavaScript
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em'],
    ALLOWED_ATTR: []
  });
};
```

## 📊 Performance Guidelines

### Frontend Performance
- **Bundle Size**: Keep JavaScript bundles under 250KB compressed
- **Loading Speed**: Target < 3 seconds for First Contentful Paint
- **Images**: Use Next.js Image optimization
- **Caching**: Implement proper browser and CDN caching
- **Lazy Loading**: Implement for images and non-critical components

### Video Performance
```typescript
// Example of optimized video loading
const VideoComponent = ({ videoId }: { videoId: string }) => {
  const [isInView, setIsInView] = useState(false);
  
  // Only load video when in viewport
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    });
    
    if (videoRef.current) {
      observer.observe(videoRef.current);
    }
    
    return () => observer.disconnect();
  }, []);
  
  return (
    <div ref={videoRef}>
      {isInView && <VideoPlayer videoId={videoId} />}
    </div>
  );
};
```

## 📋 Roadmap Awareness

Familiarize yourself with our development phases:

1. **Phase 1** (Current): Complete Video Portal UI
   - Video upload functionality
   - Real-time features
   - Advanced search
   - Content moderation tools

2. **Phase 2**: Backend APIs and Infrastructure
   - Video management API
   - Authentication service
   - Analytics processing

3. **Phase 3**: Content Platform Expansion
   - News website integration
   - Academy platform
   - Mobile applications

4. **Phase 4**: Advanced Features
   - AI-powered recommendations
   - Live streaming
   - Community features

See [ROADMAP.md](./ROADMAP.md) for detailed information.

## 🤝 Community Guidelines

### Code of Conduct

**Our Principles:**
- **Respect**: Treat all community members with respect and kindness
- **Inclusivity**: Welcome newcomers and people of all skill levels
- **Islamic Values**: Uphold Islamic principles in all interactions
- **Constructive**: Provide helpful, constructive feedback
- **Collaboration**: Work together towards common goals

**Expected Behavior:**
- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

**Unacceptable Behavior:**
- Trolling, insulting/derogatory comments, and personal attacks
- Public or private harassment
- Publishing others' private information without permission
- Content that contradicts Islamic values
- Other conduct which could reasonably be considered inappropriate

### Communication

**Best Practices:**
- **Clear Communication**: Use clear, professional language
- **Patience**: Be patient with questions and different skill levels
- **Knowledge Sharing**: Help others learn and grow
- **Islamic Greetings**: Feel free to use Islamic greetings (السلام عليكم)
- **Constructive Feedback**: Focus on the code/idea, not the person

**Language Support:**
- English is the primary language for development discussions
- Arabic is welcome for content-related discussions
- Use clear, simple language for non-native speakers

## 🎖️ Recognition

Contributors will be recognized through:

### Hall of Contributors
- **Code Contributors**: Listed in repository contributors
- **Documentation Contributors**: Credited in documentation sections
- **Community Contributors**: Featured in community showcases
- **Islamic Content Reviewers**: Acknowledged in scholarly review sections

### Contribution Levels
- **🌟 Star Contributor**: Significant ongoing contributions
- **⚡ Core Contributor**: Regular, high-quality contributions
- **🚀 Rising Contributor**: Promising new contributor
- **📚 Documentation Expert**: Excellence in documentation
- **🔍 Quality Assurance**: Excellence in testing and bug reporting

## 📞 Getting Help

### Development Support
- **Documentation**: Check [ARCHITECTURE.md](./ARCHITECTURE.md) and [ROADMAP.md](./ROADMAP.md)
- **GitHub Issues**: Search existing issues or create new ones
- **Discussions**: Use GitHub Discussions for questions and ideas
- **Code Review**: Request help in pull request comments

### Islamic Content Guidance
- **Scholarly Review**: For Islamic content verification
- **Cultural Sensitivity**: For cross-cultural considerations
- **Translation Support**: For Arabic-English translation help

### Getting Started Help
- **First-time Contributors**: Look for issues labeled `good-first-issue`
- **Documentation**: Issues labeled `documentation` are great for beginners
- **Mentorship**: Senior contributors are available to help newcomers

## 📄 License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT License). This ensures that Al Ummah Now remains open source and accessible to the global Muslim community.

## 🙏 Thank You

We deeply appreciate your interest in contributing to Al Ummah Now. Together, we're building a platform that serves the global Muslim community with authentic Islamic content, educational resources, and meaningful connections.

**May Allah ﷻ bless your efforts and make this work beneficial for the Ummah.**

---

**جزاكم الله خيراً - May Allah reward you with goodness**

For additional questions or guidance, please don't hesitate to reach out through GitHub issues or discussions.