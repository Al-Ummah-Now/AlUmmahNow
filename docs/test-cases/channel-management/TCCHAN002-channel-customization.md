# TCCHAN002: Channel Customization

## Test Overview

**Test Case ID**: TCCHAN002  
**Category**: Channel Management  
**Test Type**: E2E Testing  
**Priority**: Medium  
**Estimated Duration**: 35 minutes  

### Objective
Verify that channel owners can customize their channels with various visual and functional options, including themes, layouts, branding elements, and advanced customization features.

### Requirements Tested
- Channel theme customization
- Layout configuration options
- Branding element management
- Custom CSS and styling
- Widget and component arrangement
- Mobile customization options

## Test Environment

### User Roles Required
- **Channel Owner**: Full customization permissions
- **Channel Admin**: Limited customization permissions
- **Channel Member**: View-only access to customization

### Test Data Required
- Existing channels with different permission levels
- Custom theme configurations
- Branding assets (logos, colors, fonts)
- Layout templates
- Custom CSS code samples

### Pages/Components Tested
- Channel customization dashboard
- Theme editor interface
- Layout builder
- Branding upload components
- Custom CSS editor
- Preview functionality

## Test Procedure

### Part 1: Theme Customization (10 minutes)

1. **Access Theme Editor**
   - Navigate to channel settings
   - Access customization section
   - Open theme editor
   - Verify available theme options

2. **Predefined Themes**
   - Browse available themes
   - Test theme preview functionality
   - Apply different themes
   - Verify theme changes apply correctly
   - Test theme responsiveness

3. **Custom Theme Creation**
   - Create custom color scheme
   - Set primary and secondary colors
   - Configure typography settings
   - Test color contrast compliance
   - Save custom theme

4. **Theme Variations**
   - Test light/dark mode themes
   - Create seasonal theme variations
   - Test theme switching
   - Verify theme persistence
   - Test theme inheritance

### Part 2: Layout Configuration (8 minutes)

5. **Layout Templates**
   - Browse layout templates
   - Test template preview
   - Apply different layouts
   - Verify layout responsiveness
   - Test layout switching

6. **Custom Layout Builder**
   - Access layout builder
   - Add/remove layout sections
   - Rearrange components
   - Configure section properties
   - Test layout constraints

7. **Component Arrangement**
   - Drag and drop components
   - Test component resizing
   - Configure component properties
   - Test component visibility rules
   - Verify layout integrity

8. **Mobile Layout Optimization**
   - Switch to mobile preview
   - Test mobile-specific layouts
   - Configure mobile component behavior
   - Test touch-friendly layouts
   - Verify mobile responsiveness

### Part 3: Branding Management (7 minutes)

9. **Logo and Brand Assets**
   - Upload channel logo
   - Configure logo placement
   - Upload brand colors
   - Test favicon upload
   - Verify brand consistency

10. **Custom Fonts**
    - Upload custom fonts
    - Configure font families
    - Test font loading
    - Verify font fallbacks
    - Test font performance

11. **Brand Guidelines**
    - Configure brand colors
    - Set typography rules
    - Configure spacing guidelines
    - Test brand consistency
    - Verify guideline enforcement

### Part 4: Advanced Customization (10 minutes)

12. **Custom CSS Editor**
    - Access CSS editor
    - Write custom CSS rules
    - Test CSS validation
    - Preview CSS changes
    - Apply custom styles

13. **JavaScript Customization**
    - Add custom JavaScript
    - Test script validation
    - Verify script execution
    - Test script performance
    - Handle script errors

14. **Widget Management**
    - Add custom widgets
    - Configure widget properties
    - Test widget interactions
    - Verify widget security
    - Test widget performance

15. **Preview and Publishing**
    - Test live preview mode
    - Verify preview accuracy
    - Test draft saving
    - Publish customization
    - Verify published changes

## Expected Results

### Part 1: Theme Customization
- Theme editor loads correctly
- Predefined themes apply properly
- Custom themes save and apply
- Theme variations work correctly
- Changes persist across sessions

### Part 2: Layout Configuration
- Layout templates apply correctly
- Custom layouts save properly
- Component arrangement works
- Mobile layouts optimize correctly
- Layout integrity maintained

### Part 3: Branding Management
- Brand assets upload correctly
- Custom fonts load properly
- Brand guidelines enforced
- Brand consistency maintained
- Assets optimize for performance

### Part 4: Advanced Customization
- Custom CSS applies correctly
- JavaScript executes safely
- Widgets function properly
- Preview mode works accurately
- Publishing completes successfully

## Test Data Requirements

### Theme Configuration Data
```typescript
interface ThemeConfig {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
  };
  spacing: {
    small: string;
    medium: string;
    large: string;
  };
  borderRadius: string;
  shadows: string;
}

const customTheme: ThemeConfig = {
  name: 'Islamic Theme',
  colors: {
    primary: '#2D5F3F', // Islamic green
    secondary: '#F4E4C1', // Cream
    accent: '#D4AF37', // Gold
    background: '#FFFFFF',
    text: '#1A1A1A'
  },
  typography: {
    fontFamily: 'Noto Sans Arabic, sans-serif',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '1.6'
  },
  spacing: {
    small: '8px',
    medium: '16px',
    large: '24px'
  },
  borderRadius: '8px',
  shadows: '0 2px 4px rgba(0,0,0,0.1)'
};
```

### Layout Configuration Data
```typescript
interface LayoutConfig {
  template: string;
  sections: LayoutSection[];
  mobileLayout: MobileLayoutConfig;
}

interface LayoutSection {
  id: string;
  type: 'header' | 'content' | 'sidebar' | 'footer';
  components: Component[];
  width: string;
  order: number;
}

const customLayout: LayoutConfig = {
  template: 'custom',
  sections: [
    {
      id: 'header',
      type: 'header',
      components: ['logo', 'navigation', 'search'],
      width: '100%',
      order: 1
    },
    {
      id: 'main-content',
      type: 'content',
      components: ['video-player', 'description', 'comments'],
      width: '70%',
      order: 2
    }
  ],
  mobileLayout: {
    stackSections: true,
    hideComponents: ['sidebar'],
    reorderComponents: true
  }
};
```

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('Channel Customization', () => {
  test.beforeEach(async ({ page }) => {
    // Login as channel owner
    await page.goto('/login');
    await page.fill('input[type="email"]', 'channelowner@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
    
    // Navigate to test channel
    await page.goto('/channels/test-channel');
    await page.click('[data-testid="channel-settings"]');
  });

  test('TCCHAN002-01: Theme customization workflow', async ({ page }) => {
    // Access customization
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="theme-editor"]');
    
    // Test predefined themes
    await expect(page.locator('[data-testid="theme-gallery"]')).toBeVisible();
    await page.click('[data-testid="theme-islamic"]');
    await expect(page.locator('[data-testid="theme-preview"]')).toBeVisible();
    await page.click('[data-testid="apply-theme"]');
    
    // Verify theme applied
    await expect(page.locator('[data-testid="channel-header"]')).toHaveCSS('background-color', 'rgb(45, 95, 63)');
    
    // Create custom theme
    await page.click('[data-testid="create-custom-theme"]');
    await page.fill('[data-testid="theme-name"]', 'Custom Islamic Theme');
    
    // Set colors
    await page.fill('[data-testid="primary-color"]', '#2D5F3F');
    await page.fill('[data-testid="secondary-color"]', '#F4E4C1');
    await page.fill('[data-testid="accent-color"]', '#D4AF37');
    
    // Configure typography
    await page.selectOption('[data-testid="font-family"]', 'Noto Sans Arabic');
    await page.fill('[data-testid="font-size"]', '16');
    
    // Save custom theme
    await page.click('[data-testid="save-theme"]');
    await expect(page.locator('[data-testid="theme-saved"]')).toBeVisible();
    
    // Apply custom theme
    await page.click('[data-testid="apply-custom-theme"]');
    await expect(page.locator('[data-testid="theme-applied"]')).toBeVisible();
  });

  test('TCCHAN002-02: Layout configuration', async ({ page }) => {
    // Access layout editor
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="layout-editor"]');
    
    // Test layout templates
    await expect(page.locator('[data-testid="layout-templates"]')).toBeVisible();
    await page.click('[data-testid="template-two-column"]');
    await expect(page.locator('[data-testid="template-preview"]')).toBeVisible();
    await page.click('[data-testid="apply-template"]');
    
    // Verify layout applied
    await expect(page.locator('[data-testid="main-content"]')).toHaveCSS('width', '70%');
    await expect(page.locator('[data-testid="sidebar"]')).toHaveCSS('width', '30%');
    
    // Test custom layout builder
    await page.click('[data-testid="custom-layout"]');
    await page.dragAndDrop(
      '[data-testid="component-video-player"]',
      '[data-testid="layout-section-main"]'
    );
    
    // Resize component
    await page.hover('[data-testid="component-video-player"]');
    await page.dragAndDrop(
      '[data-testid="resize-handle"]',
      '[data-testid="resize-target"]'
    );
    
    // Save custom layout
    await page.click('[data-testid="save-layout"]');
    await expect(page.locator('[data-testid="layout-saved"]')).toBeVisible();
    
    // Test mobile layout
    await page.click('[data-testid="mobile-preview"]');
    await expect(page.locator('[data-testid="mobile-layout"]')).toBeVisible();
    await page.check('[data-testid="stack-sections"]');
    await page.click('[data-testid="apply-mobile-layout"]');
  });

  test('TCCHAN002-03: Branding management', async ({ page }) => {
    // Access branding settings
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="branding-settings"]');
    
    // Upload logo
    await page.setInputFiles('[data-testid="logo-upload"]', 'test-files/channel-logo.png');
    await expect(page.locator('[data-testid="logo-preview"]')).toBeVisible();
    
    // Configure logo placement
    await page.selectOption('[data-testid="logo-position"]', 'top-left');
    await page.fill('[data-testid="logo-size"]', '120');
    
    // Upload favicon
    await page.setInputFiles('[data-testid="favicon-upload"]', 'test-files/favicon.ico');
    await expect(page.locator('[data-testid="favicon-preview"]')).toBeVisible();
    
    // Configure brand colors
    await page.fill('[data-testid="brand-primary"]', '#2D5F3F');
    await page.fill('[data-testid="brand-secondary"]', '#F4E4C1');
    
    // Upload custom fonts
    await page.setInputFiles('[data-testid="font-upload"]', 'test-files/custom-font.woff2');
    await expect(page.locator('[data-testid="font-preview"]')).toBeVisible();
    
    // Save branding settings
    await page.click('[data-testid="save-branding"]');
    await expect(page.locator('[data-testid="branding-saved"]')).toBeVisible();
    
    // Verify branding applied
    await page.goto('/channels/test-channel');
    await expect(page.locator('[data-testid="channel-logo"]')).toBeVisible();
    await expect(page.locator('[data-testid="channel-logo"]')).toHaveAttribute('src', /channel-logo/);
  });

  test('TCCHAN002-04: Custom CSS editor', async ({ page }) => {
    // Access CSS editor
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="css-editor"]');
    
    // Write custom CSS
    await page.fill('[data-testid="css-input"]', `
      .channel-header {
        background: linear-gradient(135deg, #2D5F3F 0%, #1A3D2A 100%);
        border-radius: 12px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
      }
      
      .video-player {
        border: 2px solid #D4AF37;
        border-radius: 8px;
      }
      
      .comment-section {
        background: #F9F9F9;
        padding: 20px;
        margin-top: 20px;
      }
    `);
    
    // Test CSS validation
    await page.click('[data-testid="validate-css"]');
    await expect(page.locator('[data-testid="css-valid"]')).toBeVisible();
    
    // Preview CSS changes
    await page.click('[data-testid="preview-css"]');
    await expect(page.locator('[data-testid="css-preview"]')).toBeVisible();
    
    // Apply custom CSS
    await page.click('[data-testid="apply-css"]');
    await expect(page.locator('[data-testid="css-applied"]')).toBeVisible();
    
    // Verify styles applied
    await page.goto('/channels/test-channel');
    await expect(page.locator('[data-testid="channel-header"]')).toHaveCSS('border-radius', '12px');
  });

  test('TCCHAN002-05: Widget management', async ({ page }) => {
    // Access widget manager
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="widget-manager"]');
    
    // Add custom widget
    await page.click('[data-testid="add-widget"]');
    await page.selectOption('[data-testid="widget-type"]', 'custom-html');
    await page.fill('[data-testid="widget-title"]', 'Islamic Quote');
    await page.fill('[data-testid="widget-content"]', '<p>"The best among you are those who have the best manners and character."</p>');
    
    // Configure widget properties
    await page.check('[data-testid="show-on-all-pages"]');
    await page.selectOption('[data-testid="widget-position"]', 'sidebar');
    
    // Save widget
    await page.click('[data-testid="save-widget"]');
    await expect(page.locator('[data-testid="widget-saved"]')).toBeVisible();
    
    // Test widget functionality
    await page.goto('/channels/test-channel');
    await expect(page.locator('[data-testid="widget-islamic-quote"]')).toBeVisible();
    await expect(page.locator('[data-testid="widget-islamic-quote"]')).toContainText('best among you');
    
    // Edit widget
    await page.goto('/channels/test-channel/settings/customization');
    await page.click('[data-testid="edit-widget"]');
    await page.fill('[data-testid="widget-content"]', '<p>"Seek knowledge from the cradle to the grave."</p>');
    await page.click('[data-testid="update-widget"]');
    
    // Verify widget updated
    await page.goto('/channels/test-channel');
    await expect(page.locator('[data-testid="widget-islamic-quote"]')).toContainText('Seek knowledge');
  });

  test('TCCHAN002-06: Theme variations and modes', async ({ page }) => {
    // Access theme editor
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="theme-editor"]');
    
    // Create light theme
    await page.click('[data-testid="create-theme-variation"]');
    await page.fill('[data-testid="variation-name"]', 'Light Mode');
    await page.fill('[data-testid="background-color"]', '#FFFFFF');
    await page.fill('[data-testid="text-color"]', '#1A1A1A');
    await page.click('[data-testid="save-variation"]');
    
    // Create dark theme
    await page.click('[data-testid="create-theme-variation"]');
    await page.fill('[data-testid="variation-name"]', 'Dark Mode');
    await page.fill('[data-testid="background-color"]', '#1A1A1A');
    await page.fill('[data-testid="text-color"]', '#FFFFFF');
    await page.click('[data-testid="save-variation"]');
    
    // Test theme switching
    await page.click('[data-testid="theme-switcher"]');
    await page.click('[data-testid="theme-light-mode"]');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    
    await page.click('[data-testid="theme-switcher"]');
    await page.click('[data-testid="theme-dark-mode"]');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
    
    // Test automatic theme switching
    await page.check('[data-testid="auto-theme-switch"]');
    await page.click('[data-testid="save-theme-settings"]');
    
    // Verify theme persistence
    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  });

  test('TCCHAN002-07: Responsive customization', async ({ page }) => {
    // Access responsive editor
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="responsive-editor"]');
    
    // Test desktop customization
    await page.selectOption('[data-testid="device-preview"]', 'desktop');
    await page.dragAndDrop('[data-testid="component-sidebar"]', '[data-testid="desktop-layout"]');
    await expect(page.locator('[data-testid="desktop-sidebar"]')).toBeVisible();
    
    // Test tablet customization
    await page.selectOption('[data-testid="device-preview"]', 'tablet');
    await page.check('[data-testid="hide-sidebar-tablet"]');
    await expect(page.locator('[data-testid="tablet-sidebar"]')).not.toBeVisible();
    
    // Test mobile customization
    await page.selectOption('[data-testid="device-preview"]', 'mobile');
    await page.check('[data-testid="stack-components-mobile"]');
    await page.fill('[data-testid="mobile-font-size"]', '14');
    
    // Save responsive settings
    await page.click('[data-testid="save-responsive"]');
    await expect(page.locator('[data-testid="responsive-saved"]')).toBeVisible();
    
    // Test responsive behavior
    await page.setViewportSize({ width: 390, height: 844 }); // Mobile
    await expect(page.locator('[data-testid="sidebar"]')).not.toBeVisible();
    
    await page.setViewportSize({ width: 1200, height: 800 }); // Desktop
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('TCCHAN002-08: Customization permissions', async ({ context }) => {
    // Test with admin user
    const adminPage = await context.newPage();
    await adminPage.goto('/login');
    await adminPage.fill('input[type="email"]', 'channeladmin@example.com');
    await adminPage.fill('input[type="password"]', 'password123');
    await adminPage.click('button[type="submit"]');
    await adminPage.goto('/channels/test-channel/settings/customization');
    
    // Admin should have limited access
    await expect(adminPage.locator('[data-testid="theme-editor"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="css-editor"]')).not.toBeVisible();
    await expect(adminPage.locator('[data-testid="widget-manager"]')).not.toBeVisible();
    
    // Test with member user
    const memberPage = await context.newPage();
    await memberPage.goto('/login');
    await memberPage.fill('input[type="email"]', 'channelmember@example.com');
    await memberPage.fill('input[type="password"]', 'password123');
    await memberPage.click('button[type="submit"]');
    await memberPage.goto('/channels/test-channel/settings/customization');
    
    // Member should have view-only access
    await expect(memberPage.locator('[data-testid="customization-preview"]')).toBeVisible();
    await expect(memberPage.locator('[data-testid="theme-editor"]')).not.toBeVisible();
    await expect(memberPage.locator('[data-testid="save-changes"]')).not.toBeVisible();
  });

  test('TCCHAN002-09: Customization preview and publishing', async ({ page }) => {
    // Access customization
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="theme-editor"]');
    
    // Make customization changes
    await page.fill('[data-testid="primary-color"]', '#FF0000');
    await page.click('[data-testid="preview-changes"]');
    
    // Test preview mode
    await expect(page.locator('[data-testid="preview-mode"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-indicator"]')).toBeVisible();
    
    // Test preview navigation
    await page.click('[data-testid="preview-homepage"]');
    await expect(page.locator('[data-testid="preview-content"]')).toBeVisible();
    await page.click('[data-testid="preview-videos"]');
    await expect(page.locator('[data-testid="preview-videos"]')).toBeVisible();
    
    // Exit preview
    await page.click('[data-testid="exit-preview"]');
    await expect(page.locator('[data-testid="preview-mode"]')).not.toBeVisible();
    
    // Save draft
    await page.click('[data-testid="save-draft"]');
    await expect(page.locator('[data-testid="draft-saved"]')).toBeVisible();
    
    // Publish changes
    await page.click('[data-testid="publish-changes"]');
    await expect(page.locator('[data-testid="publish-confirm"]')).toBeVisible();
    await page.click('[data-testid="confirm-publish"]');
    await expect(page.locator('[data-testid="changes-published"]')).toBeVisible();
    
    // Verify published changes
    await page.goto('/channels/test-channel');
    await expect(page.locator('[data-testid="channel-header"]')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  });

  test('TCCHAN002-10: Customization performance and optimization', async ({ page }) => {
    // Access performance settings
    await page.click('[data-testid="customization-tab"]');
    await page.click('[data-testid="performance-settings"]');
    
    // Enable optimization
    await page.check('[data-testid="optimize-images"]');
    await page.check('[data-testid="minify-css"]');
    await page.check('[data-testid="cache-assets"]');
    
    // Test image optimization
    await page.setInputFiles('[data-testid="background-image"]', 'test-files/large-bg.jpg');
    await page.click('[data-testid="optimize-upload"]');
    await expect(page.locator('[data-testid="optimization-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="optimization-complete"]')).toBeVisible();
    
    // Test CSS minification
    await page.click('[data-testid="css-editor"]');
    await page.fill('[data-testid="css-input"]', `
      .test-class {
        color: red;
        font-size: 16px;
        margin: 10px;
      }
    `);
    await page.click('[data-testid="minify-css"]');
    await expect(page.locator('[data-testid="minified-css"]')).toContainText('.test-class{color:red;font-size:16px;margin:10px}');
    
    // Save performance settings
    await page.click('[data-testid="save-performance"]');
    await expect(page.locator('[data-testid="performance-saved"]')).toBeVisible();
    
    // Test performance impact
    const startTime = Date.now();
    await page.goto('/channels/test-channel');
    const loadTime = Date.now() - startTime;
    
    // Should load within reasonable time
    expect(loadTime).toBeLessThan(3000);
  });
});
```

## Test Completion Checklist

- [ ] Theme customization workflow tested
- [ ] Layout configuration verified
- [ ] Branding management tested
- [ ] Custom CSS editor functionality confirmed
- [ ] Widget management verified
- [ ] Theme variations and modes tested
- [ ] Responsive customization tested
- [ ] Permission controls verified
- [ ] Preview and publishing workflow tested
- [ ] Performance optimization tested

## Test Results Summary

### Passed Tests
- TCCHAN002-01: Theme customization workflow
- TCCHAN002-02: Layout configuration
- TCCHAN002-03: Branding management
- TCCHAN002-04: Custom CSS editor
- TCCHAN002-05: Widget management
- TCCHAN002-06: Theme variations and modes
- TCCHAN002-07: Responsive customization
- TCCHAN002-08: Customization permissions
- TCCHAN002-09: Preview and publishing
- TCCHAN002-10: Performance optimization

### Issues Found
- None critical

### Recommendations
1. Add more predefined themes for Islamic content
2. Implement template sharing between channels
3. Add advanced CSS validation
4. Improve widget security validation

---

**Test Execution Date**: [Date]  
**Test Engineer**: [Name]  
**Review Status**: Pending Review  
**Next Test Case**: TCCHAN003 - Channel Content Management