# Contributing to Al Ummah Now

Thank you for your interest in contributing to Al Ummah Now! This project aims to create a comprehensive Islamic content platform, and we welcome contributions from developers, designers, and community members.

## 🎯 How to Contribute

### 1. Code Contributions

**Areas where we need help:**
- Frontend UI/UX improvements
- Backend API development
- Mobile app development
- DevOps and infrastructure
- Testing and quality assurance
- Documentation improvements

### 2. Getting Started

1. **Fork and clone the repository:**
```bash
git clone https://github.com/YOUR_USERNAME/AlUmmahNow.git
cd AlUmmahNow
npm install
```

2. **Set up your development environment:**
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
npm run dev
```

3. **Create a feature branch:**
```bash
git checkout -b feature/your-feature-name
```

### 3. Development Guidelines

**Code Standards:**
- Use TypeScript for all new code
- Follow the existing code style and patterns
- Write meaningful commit messages
- Add JSDoc comments for complex functions
- Ensure mobile responsiveness for UI changes

**Testing:**
- Test your changes in both English and Arabic layouts
- Verify dark/light theme compatibility
- Test on different screen sizes
- Check accessibility compliance

**Before submitting:**
- Run `npm run lint` to check code style
- Test your changes thoroughly
- Update documentation if needed
- Add or update tests for new features

### 4. Pull Request Process

1. **Ensure your branch is up to date:**
```bash
git fetch origin
git rebase origin/main
```

2. **Create a descriptive pull request:**
- Clearly describe what your changes do
- Reference any related issues
- Include screenshots for UI changes
- List any breaking changes

3. **PR Review Process:**
- Maintainers will review your PR
- Address any feedback or requested changes
- Once approved, your PR will be merged

### 5. Issue Reporting

**Bug Reports:**
- Use the bug report template
- Include steps to reproduce
- Provide browser/device information
- Include screenshots if applicable

**Feature Requests:**
- Describe the feature clearly
- Explain the use case and benefits
- Consider implementation complexity
- Check if similar features exist

### 6. Documentation Contributions

Help improve our documentation:
- Fix typos and grammar
- Add missing information
- Improve clarity and examples
- Translate documentation to other languages

## 🏗️ Project Structure

Understanding the codebase:

```
Al Ummah Now Ecosystem:
├── AlUmmahNow (this repo)          # Video Portal UI
├── AlUmmahNowVideos               # API Backend (planned)
├── AlUmmahNowAuth                 # Authentication Service (planned)
├── AlUmmahNowProcessor            # Events & Analytics (planned)
├── AlUmmahNowCMS                  # Content Management (planned)
└── Future components...           # Academy, Chat, etc.
```

**Current Repository Structure:**
```
src/
├── app/                   # Next.js pages and routing
├── components/            # Reusable React components
├── lib/                   # Utilities and API clients
└── interfaces/            # TypeScript type definitions
```

## 🔧 Development Workflow

### Local Development

1. **Start the development server:**
```bash
npm run dev
```

2. **Available scripts:**
```bash
npm run build      # Build for production
npm run lint       # Check code style
npm run preview    # Preview production build
npm run deploy     # Deploy to Cloudflare
```

### Working with the API

The frontend integrates with backend APIs:
- Video management and playback
- User authentication and profiles
- Comments and social interactions
- Search and recommendations

API client is located in `src/lib/api/` with full TypeScript support.

### Internationalization

Support for multiple languages:
- English routes: `/en/`
- Arabic routes: `/ar/` (RTL layout)
- Add new languages by creating route folders
- Ensure proper text direction and layout

## 🎨 Design Guidelines

### UI/UX Principles
- Mobile-first responsive design
- Accessibility compliance (WCAG 2.1)
- Islamic cultural sensitivity
- Clean, modern interface
- Fast loading and smooth interactions

### Component Development
- Use Tailwind CSS for styling
- Support both light and dark themes
- Ensure RTL layout compatibility
- Follow existing component patterns
- Add proper TypeScript interfaces

## 🔒 Security Considerations

**Frontend Security:**
- Validate all user inputs
- Sanitize content display
- Secure authentication flows
- Protect against XSS attacks
- Use Content Security Policy (CSP)

**Content Guidelines:**
- Respect Islamic values and teachings
- Implement content moderation
- Ensure scholarly accuracy
- Maintain family-friendly environment

## 📋 Roadmap Awareness

Familiarize yourself with our development phases:

1. **Phase 1** (Current): Complete Video Portal UI
2. **Phase 2**: Backend APIs and real-time features
3. **Phase 3**: News website and Academy platform
4. **Phase 4**: AI integration and advanced features

See [ROADMAP.md](./ROADMAP.md) for detailed information.

## 🤝 Community Guidelines

### Code of Conduct
- Be respectful and inclusive
- Help others learn and grow
- Focus on constructive feedback
- Maintain Islamic values and ethics
- Welcome newcomers and beginners

### Communication
- Use clear and professional language
- Be patient with questions and feedback
- Share knowledge and best practices
- Collaborate openly and transparently

## 🎖️ Recognition

Contributors will be recognized in:
- Project README and documentation
- Release notes for significant contributions
- Community showcases and features
- Annual contributor appreciation

## 📞 Getting Help

**Need assistance?**
- Check existing issues and documentation
- Ask questions in GitHub Discussions
- Reach out to maintainers
- Join community chat channels

## 📄 License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT License).

---

Thank you for helping build a platform that benefits the global Muslim community! 🌍✨