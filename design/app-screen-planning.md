# ZKProofPort Mobile App - Screen Planning & UI Design Specification

**Version:** 1.1.0
**Last Updated:** 2026-01-28
**Target Platforms:** iOS 15+, Android 12+
**Design Tool:** Figma
**Based on:** Demo analysis from zkproofport.com and proofport-demo.netlify.app

---

## Table of Contents

### Part 1: Overview
- [1.1 Navigation Structure](#11-navigation-structure)
- [1.2 FigJam Diagrams](#12-figjam-diagrams)

### Part 2: Screen Wireframes
- [2.1 Proof Screen](#21-proof-screen)
- [2.2 Wallet Screen](#22-wallet-screen)
- [2.3 MyInfo Screen](#23-myinfo-screen)

### Part 3: Design System
- [3.1 Color System](#31-color-system)
- [3.2 Typography System](#32-typography-system)
- [3.3 Spacing System](#33-spacing-system)
- [3.4 Component Specifications](#34-component-specifications)

### Part 4: Screen-by-Screen Specifications
- [4.1 Screen Dimensions](#41-screen-dimensions)
- [4.2 Proof Flow Screens](#42-proof-flow-screens)
- [4.3 Wallet Flow Screens](#43-wallet-flow-screens)
- [4.4 MyInfo Flow Screens](#44-myinfo-flow-screens)
- [4.5 Modal & State Screens](#45-modal--state-screens)

### Part 5: Animation Specifications
- [5.1 Transition Durations](#51-transition-durations)
- [5.2 Easing Curves](#52-easing-curves)
- [5.3 Component Animations](#53-component-animations)

### Part 6: Icon Specifications
- [6.1 Icon Sizes](#61-icon-sizes)
- [6.2 Icon Colors](#62-icon-colors)
- [6.3 Icon Library](#63-icon-library)

### Part 7: Figma Setup Instructions
- [7.1 Frame Sizes](#71-frame-sizes)
- [7.2 Auto-Layout Settings](#72-auto-layout-settings)
- [7.3 Component Organization](#73-component-organization)
- [7.4 Style Naming Conventions](#74-style-naming-conventions)
- [7.5 Component Variants](#75-component-variants)
- [7.6 Design Checklist](#76-design-checklist)

### Appendix
- [A. Implementation Priority](#a-implementation-priority)
- [B. Quick Reference](#b-quick-reference)
- [C. Additional Recommendations](#c-additional-recommendations)

---

# Part 1: Overview

## 1.1 Navigation Structure

```
+---------------------------------------------+
|            Bottom Tab Bar                   |
+---------------+---------------+-------------+
|   Proof       |   Wallet      |   MyInfo    |
+---------------+---------------+-------------+
```

The app uses a bottom tab navigation with three main sections:
- **Proof** - Circuit selection and ZK proof generation
- **Wallet** - Wallet connection and management
- **MyInfo** - Settings, history, and user information

## 1.2 FigJam Diagrams

Generated diagrams visualizing the app screen planning:

### Navigation Structure
[ZKProofPort App - Navigation Structure](https://www.figma.com/online-whiteboard/create-diagram/612db3ca-849c-4264-b050-302112b62ddc?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=75c517ae-d36e-4564-a43e-b47d44079c5f)
- Bottom Tab Bar overview (Proof, Wallet, MyInfo)
- Screen navigation flow between tabs

### Proof Generation Flow
[ZKProofPort - Proof Generation Flow](https://www.figma.com/online-whiteboard/create-diagram/b8d92167-904d-444c-8a00-7ef13b918bb5?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=90030377-52ff-4ae8-a17f-64f1068a7873)
- State diagram showing all proof generation steps
- Circuit selection -> 6 verification steps -> Completion
- Error handling and retry flow

### Wallet Connection Flow
[ZKProofPort - Wallet Connection Flow](https://www.figma.com/online-whiteboard/create-diagram/d8cfa8f1-423c-4cea-8c2e-62fa57188dd6?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=3356a5d2-078f-4e52-9731-b4a978c73d68)
- Supported wallets (MetaMask, Coinbase, Rainbow, Trust, WalletConnect)
- Connection states and multi-wallet support

### MyInfo Screen Structure
[ZKProofPort - MyInfo Screen Structure](https://www.figma.com/online-whiteboard/create-diagram/a92ff5df-4fd1-4fbc-b130-82c8585cd06b?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=53578d03-450d-4406-a544-a4efedd64229)
- Hierarchical menu structure
- All submenus and settings options

### Complete User Journey
[ZKProofPort - Complete User Journey](https://www.figma.com/online-whiteboard/create-diagram/1acd6835-ea76-4e13-8613-4964c0495e2d?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=d84fdfe0-cb19-4117-b5f9-ec4d62151c45)
- Sequence diagram from app open to proof verification
- User <-> App <-> Wallet <-> Blockchain <-> ZK Engine interactions

---

# Part 2: Screen Wireframes

## 2.1 Proof Screen

### 2.1.1 Circuit Selection View
```
+---------------------------------------------+
|  <- Proof                                   |
+---------------------------------------------+
|                                             |
|  Select Proof Type                          |
|                                             |
|  +---------------------------------------+  |
|  | Coinbase KYC Verification             |  |
|  | Prove identity without revealing      |  |
|  | wallet or personal data          [->] |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
```

### 2.1.2 Proof Generation View
```
+---------------------------------------------+
|  <- Coinbase KYC Verification               |
+---------------------------------------------+
|                                             |
|  +---------------------------------------+  |
|  |         PROOF PORTAL                  |  |
|  |                                       |  |
|  |  Private Coinbase KYC Verification    |  |
|  |                                       |  |
|  |  Prove identity and eligibility       |  |
|  |  without exposing your wallet         |  |
|  |  or personal data.                    |  |
|  +---------------------------------------+  |
|                                             |
|  Step Progress:                             |
|  +---------------------------------------+  |
|  | [check] Wallet connected              |  |
|  | [dot]   Fetching KYC attestation...   |  |
|  | [o]     Fetching raw transaction      |  |
|  | [o]     Verifying Coinbase signer     |  |
|  | [o]     Signing dApp challenge        |  |
|  | [o]     Generating ZK proof           |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | UltraHonk Engine           Live logs  |  |
|  |---------------------------------------|  |
|  | > Initializing circuit...             |  |
|  | > Loading witness data...             |  |
|  | > Computing proof (12%)...            |  |
|  | [=========>                  ]        |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  |      [ Generate ZK Proof ]            |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
```

### 2.1.3 Proof Complete View
```
+---------------------------------------------+
|  <- Coinbase KYC Verification               |
+---------------------------------------------+
|                                             |
|              [CHECK]                        |
|       Proof Generated!                      |
|                                             |
|  +---------------------------------------+  |
|  | Proof Hash:                           |  |
|  | 0x7a8b...3f2e                         |  |
|  |                          [Copy]       |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | Verification Chain: Base              |  |
|  | Circuit: coinbase-kyc                 |  |
|  | Generated: 2026-01-28 21:30           |  |
|  | Status: [check] Verified              |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  |    [ View on Explorer ]               |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  |    [ Generate Another Proof ]         |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
```

## 2.2 Wallet Screen

### 2.2.1 No Wallet Connected
```
+---------------------------------------------+
|  Wallet                                     |
+---------------------------------------------+
|                                             |
|              [LINK]                         |
|       No Wallet Connected                   |
|                                             |
|  Connect your wallet to generate            |
|  zero-knowledge proofs                      |
|                                             |
|  +---------------------------------------+  |
|  |    [ Connect Wallet ]                 |  |
|  +---------------------------------------+  |
|                                             |
|  Supported Wallets:                         |
|  * MetaMask                                 |
|  * Coinbase Wallet                          |
|  * Rainbow                                  |
|  * Trust Wallet                             |
|  * WalletConnect                            |
|                                             |
+---------------------------------------------+
```

### 2.2.2 Wallet Connected
```
+---------------------------------------------+
|  Wallet                                     |
+---------------------------------------------+
|                                             |
|  Connected Wallets                          |
|                                             |
|  +---------------------------------------+  |
|  | [Fox] MetaMask              [Active]  |  |
|  | 0x7a8b...3f2e                         |  |
|  | Base * Connected                      |  |
|  |                    [Disconnect]       |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [Blue] Coinbase Wallet                |  |
|  | 0x4c1d...8a9f                         |  |
|  | Base * Connected                      |  |
|  |                    [Disconnect]       |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  |       [ + Add Another Wallet ]        |  |
|  +---------------------------------------+  |
|                                             |
|  -----------------------------------------  |
|  Network: Base                    [v]       |
|                                             |
+---------------------------------------------+
```

## 2.3 MyInfo Screen

### 2.3.1 Main View
```
+---------------------------------------------+
|  MyInfo                                     |
+---------------------------------------------+
|                                             |
|  +---------------------------------------+  |
|  | [chart] Proof History                 |  |
|  | View all your generated proofs   [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [gear]  Settings                      |  |
|  | App preferences & configuration  [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [bell]  Notifications                 |  |
|  | Manage alerts & updates          [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [lock]  Security                      |  |
|  | Biometric lock, backup           [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [doc]   Legal                         |  |
|  | Terms, Privacy, Licenses         [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [info]  About                         |  |
|  | Version, Support, Feedback       [->] |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
```

### 2.3.2 Proof History View
```
+---------------------------------------------+
|  <- Proof History                           |
+---------------------------------------------+
|                                             |
|  January 2026                               |
|                                             |
|  +---------------------------------------+  |
|  | [lock] Coinbase KYC       [Verified]  |  |
|  | Jan 28, 2026 * 21:30                  |  |
|  | Base * 0x7a8b...3f2e                  |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [lock] Coinbase KYC       [Verified]  |  |
|  | Jan 25, 2026 * 14:22                  |  |
|  | Base * 0x4c1d...8a9f                  |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [lock] Coinbase KYC       [Verified]  |  |
|  | Jan 20, 2026 * 09:15                  |  |
|  | Base * 0x9e2f...7b3c                  |  |
|  +---------------------------------------+  |
|                                             |
|  -----------------------------------------  |
|  Total Proofs: 3                            |
|  All Verified: [check]                      |
|                                             |
+---------------------------------------------+
```

### 2.3.3 Settings View
```
+---------------------------------------------+
|  <- Settings                                |
+---------------------------------------------+
|                                             |
|  General                                    |
|  +---------------------------------------+  |
|  | Language                   English    |  |
|  | Theme                        Dark     |  |
|  | Default Network              Base     |  |
|  +---------------------------------------+  |
|                                             |
|  Proof Settings                             |
|  +---------------------------------------+  |
|  | Auto-save proofs             [ON]     |  |
|  | Show live logs               [ON]     |  |
|  | Confirm before generate      [ON]     |  |
|  +---------------------------------------+  |
|                                             |
|  Data                                       |
|  +---------------------------------------+  |
|  | Export Proof History         [->]     |  |
|  | Clear Local Data             [->]     |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
```

### 2.3.4 Legal View
```
+---------------------------------------------+
|  <- Legal                                   |
+---------------------------------------------+
|                                             |
|  +---------------------------------------+  |
|  | [doc]   Terms of Service         [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [lock]  Privacy Policy           [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [list]  Open Source Licenses     [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [warn]  Disclaimer               [->] |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | [globe] GDPR Information         [->] |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
```

---

# Part 3: Design System

## 3.1 Color System

### 3.1.1 Core Palette

| Token Name | HEX | RGB | HSL | Usage |
|------------|-----|-----|-----|-------|
| `--color-bg-primary` | `#0F1419` | `rgb(15, 20, 25)` | `hsl(210, 25%, 8%)` | Main app background |
| `--color-bg-secondary` | `#1A2332` | `rgb(26, 35, 50)` | `hsl(218, 32%, 15%)` | Card backgrounds, elevated surfaces |
| `--color-bg-tertiary` | `#232D3F` | `rgb(35, 45, 63)` | `hsl(219, 29%, 19%)` | Hover states, pressed states |
| `--color-border-primary` | `#2D3748` | `rgb(45, 55, 72)` | `hsl(218, 23%, 23%)` | Card borders, dividers |
| `--color-border-secondary` | `#3D4A5C` | `rgb(61, 74, 92)` | `hsl(215, 20%, 30%)` | Focus rings, emphasis borders |

### 3.1.2 Text Colors

| Token Name | HEX | RGB | HSL | Usage |
|------------|-----|-----|-----|-------|
| `--color-text-primary` | `#FFFFFF` | `rgb(255, 255, 255)` | `hsl(0, 0%, 100%)` | Headings, primary content |
| `--color-text-secondary` | `#9CA3AF` | `rgb(156, 163, 175)` | `hsl(218, 11%, 65%)` | Body text, descriptions |
| `--color-text-tertiary` | `#6B7280` | `rgb(107, 114, 128)` | `hsl(220, 9%, 46%)` | Muted text, placeholders |
| `--color-text-disabled` | `#4B5563` | `rgb(75, 85, 99)` | `hsl(220, 14%, 34%)` | Disabled states |

### 3.1.3 Semantic Colors

#### Success
| Token Name | HEX | RGB | HSL | Usage |
|------------|-----|-----|-----|-------|
| `--color-success-500` | `#10B981` | `rgb(16, 185, 129)` | `hsl(160, 84%, 39%)` | Success icons, completed states |
| `--color-success-400` | `#34D399` | `rgb(52, 211, 153)` | `hsl(158, 64%, 52%)` | Success text, highlights |
| `--color-success-600` | `#059669` | `rgb(5, 150, 105)` | `hsl(161, 94%, 30%)` | Success pressed state |
| `--color-success-bg` | `#10B98120` | `rgba(16, 185, 129, 0.13)` | - | Success background tint |

#### Warning / Gold Accent
| Token Name | HEX | RGB | HSL | Usage |
|------------|-----|-----|-----|-------|
| `--color-warning-500` | `#F59E0B` | `rgb(245, 158, 11)` | `hsl(38, 92%, 50%)` | Warnings, brand accent, logo |
| `--color-warning-400` | `#FBBF24` | `rgb(251, 191, 36)` | `hsl(43, 96%, 56%)` | Warning highlights |
| `--color-warning-600` | `#D97706` | `rgb(217, 119, 6)` | `hsl(32, 95%, 44%)` | Warning pressed state |
| `--color-warning-bg` | `#F59E0B20` | `rgba(245, 158, 11, 0.13)` | - | Warning background tint |

#### Info / Blue Accent
| Token Name | HEX | RGB | HSL | Usage |
|------------|-----|-----|-----|-------|
| `--color-info-500` | `#3B82F6` | `rgb(59, 130, 246)` | `hsl(217, 91%, 60%)` | Links, interactive elements |
| `--color-info-400` | `#60A5FA` | `rgb(96, 165, 250)` | `hsl(213, 94%, 68%)` | Info highlights |
| `--color-info-600` | `#2563EB` | `rgb(37, 99, 235)` | `hsl(221, 83%, 53%)` | Info pressed state |
| `--color-info-bg` | `#3B82F620` | `rgba(59, 130, 246, 0.13)` | - | Info background tint |

#### Error
| Token Name | HEX | RGB | HSL | Usage |
|------------|-----|-----|-----|-------|
| `--color-error-500` | `#EF4444` | `rgb(239, 68, 68)` | `hsl(0, 84%, 60%)` | Errors, destructive actions |
| `--color-error-400` | `#F87171` | `rgb(248, 113, 113)` | `hsl(0, 91%, 71%)` | Error highlights |
| `--color-error-600` | `#DC2626` | `rgb(220, 38, 38)` | `hsl(0, 72%, 51%)` | Error pressed state |
| `--color-error-bg` | `#EF444420` | `rgba(239, 68, 68, 0.13)` | - | Error background tint |

### 3.1.4 Opacity / Alpha Values

| Token Name | Value | Usage |
|------------|-------|-------|
| `--opacity-disabled` | `0.38` | Disabled buttons, icons |
| `--opacity-overlay-light` | `0.08` | Subtle hover overlays |
| `--opacity-overlay-medium` | `0.16` | Pressed states |
| `--opacity-overlay-heavy` | `0.32` | Modal backdrops (light) |
| `--opacity-overlay-modal` | `0.72` | Modal backdrop (heavy) |
| `--opacity-divider` | `0.12` | Divider lines |

### 3.1.5 Gradient Definitions

```css
/* Primary Gradient - For hero elements */
--gradient-primary: linear-gradient(135deg, #1A2332 0%, #0F1419 100%);

/* Accent Gradient - For CTAs */
--gradient-accent: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);

/* Success Gradient - For completed states */
--gradient-success: linear-gradient(135deg, #10B981 0%, #059669 100%);

/* Gold Gradient - For brand/premium elements */
--gradient-gold: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);

/* Card Shimmer - For loading states */
--gradient-shimmer: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
```

## 3.2 Typography System

### 3.2.1 Font Families

| Platform | Primary Font | Monospace Font |
|----------|--------------|----------------|
| iOS | SF Pro Display / SF Pro Text | SF Mono |
| Android | Roboto | Roboto Mono |

**Figma Fonts:**
- Use `SF Pro Display` for headings (H1-H3)
- Use `SF Pro Text` for body text (Body, Caption, Small)
- Use `SF Mono` for code/technical content (proof hashes, addresses)

### 3.2.2 Type Scale

| Style Name | Size (pt) | Line Height | Letter Spacing | Weight | Usage |
|------------|-----------|-------------|----------------|--------|-------|
| `display-lg` | 32pt | 40pt (125%) | -0.5pt | Bold (700) | Hero text, large numbers |
| `display-md` | 28pt | 36pt (129%) | -0.5pt | Bold (700) | Page titles |
| `heading-1` | 24pt | 32pt (133%) | -0.25pt | Bold (700) | Screen titles |
| `heading-2` | 20pt | 28pt (140%) | -0.25pt | SemiBold (600) | Section headers |
| `heading-3` | 18pt | 26pt (144%) | 0pt | SemiBold (600) | Card titles |
| `body-lg` | 17pt | 24pt (141%) | 0pt | Regular (400) | Primary body text |
| `body-md` | 16pt | 24pt (150%) | 0pt | Regular (400) | Standard body text |
| `body-sm` | 15pt | 22pt (147%) | 0pt | Regular (400) | Secondary text |
| `caption` | 14pt | 20pt (143%) | 0.1pt | Regular (400) | Captions, labels |
| `caption-sm` | 13pt | 18pt (138%) | 0.1pt | Regular (400) | Timestamps, metadata |
| `small` | 12pt | 16pt (133%) | 0.2pt | Regular (400) | Fine print, badges |
| `tiny` | 11pt | 14pt (127%) | 0.2pt | Medium (500) | Status tags |
| `mono-md` | 14pt | 20pt (143%) | 0.5pt | Regular (400) | Addresses, hashes |
| `mono-sm` | 12pt | 16pt (133%) | 0.5pt | Regular (400) | Log entries |

### 3.2.3 Text Color Combinations

| Background | Primary Text | Secondary Text | Tertiary Text |
|------------|--------------|----------------|---------------|
| `#0F1419` (Primary BG) | `#FFFFFF` | `#9CA3AF` | `#6B7280` |
| `#1A2332` (Card BG) | `#FFFFFF` | `#9CA3AF` | `#6B7280` |
| `#10B981` (Success BG) | `#FFFFFF` | `#D1FAE5` | - |
| `#3B82F6` (Info BG) | `#FFFFFF` | `#DBEAFE` | - |
| `#EF4444` (Error BG) | `#FFFFFF` | `#FEE2E2` | - |

## 3.3 Spacing System

### 3.3.1 Base Unit

**Base unit:** 8px (8pt on mobile)

All spacing values should be multiples of the base unit.

### 3.3.2 Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--space-0` | 0px | None |
| `--space-1` | 4px | Tight inline spacing |
| `--space-2` | 8px | Icon-to-text gap |
| `--space-3` | 12px | Compact element spacing |
| `--space-4` | 16px | Standard component padding |
| `--space-5` | 20px | Medium spacing |
| `--space-6` | 24px | Section spacing |
| `--space-8` | 32px | Large section spacing |
| `--space-10` | 40px | Extra large spacing |
| `--space-12` | 48px | Screen section gaps |
| `--space-16` | 64px | Major section breaks |
| `--space-20` | 80px | Full-bleed spacing |

### 3.3.3 Container Padding

| Container Type | Horizontal Padding | Vertical Padding |
|----------------|-------------------|------------------|
| Screen Content | 16px | 16px (top after header) |
| Card | 16px | 16px |
| Card (Compact) | 12px | 12px |
| List Item | 16px | 12px |
| Button | 24px | 14px |
| Button (Compact) | 16px | 10px |
| Modal | 24px | 24px |
| Bottom Sheet | 24px | 24px |

### 3.3.4 Gap Values (Flex/Grid)

| Token | Value | Usage |
|-------|-------|-------|
| `--gap-xs` | 4px | Inline elements (icon + text) |
| `--gap-sm` | 8px | Compact lists, button groups |
| `--gap-md` | 12px | Standard list items |
| `--gap-lg` | 16px | Cards in a list |
| `--gap-xl` | 24px | Sections |
| `--gap-2xl` | 32px | Major sections |

## 3.4 Component Specifications

### 3.4.1 Bottom Tab Bar

```
Dimensions:
- Full Width: 393px (device width)
- Height: 83px (49px content + 34px home indicator safe area)
- Content Height: 49px

Layout:
- Flex: row, justify-content: space-evenly
- Background: #0F1419
- Border Top: 1px solid #2D3748

Tab Item:
- Width: 131px (393px / 3)
- Height: 49px
- Padding: 8px top, 4px bottom
- Icon Size: 24px
- Label: 10pt, Medium weight
- Gap (icon to label): 4px

States:
- Inactive Icon: #6B7280
- Inactive Label: #6B7280
- Active Icon: #3B82F6
- Active Label: #3B82F6
- Pressed: opacity 0.7
```

### 3.4.2 Navigation Header

```
Dimensions:
- Full Width: 393px
- Height: 96px (52px content + 44px status bar)
- Content Height: 52px

Layout:
- Flex: row, align-items: center
- Horizontal Padding: 16px
- Background: #0F1419

Back Button (if present):
- Size: 44px x 44px (touch target)
- Icon Size: 24px
- Icon Color: #FFFFFF

Title:
- Position: 16px from left (no back) or 60px from left (with back)
- Style: heading-2 (20pt, SemiBold)
- Color: #FFFFFF

Right Actions (if present):
- Position: 16px from right
- Size: 44px x 44px each
- Gap between actions: 8px
```

### 3.4.3 Cards

#### Circuit Card
```
Dimensions:
- Width: 361px (393px - 32px horizontal padding)
- Height: Auto (min 88px)
- Border Radius: 16px

Layout:
- Padding: 16px
- Flex: row, justify-content: space-between, align-items: center

Left Content:
- Icon Container: 40px x 40px, border-radius 12px, bg #232D3F
- Icon Size: 24px
- Gap (icon to text): 12px
- Title: body-lg (17pt), Bold, #FFFFFF
- Subtitle: caption (14pt), Regular, #9CA3AF

Right Content:
- Chevron Icon: 20px, #6B7280
- OR Badge: see Badge component

Background: #1A2332
Border: 1px solid #2D3748

States:
- Default: as above
- Pressed: bg #232D3F, border #3D4A5C
- Disabled: opacity 0.5, badge "Coming Soon"
```

#### Wallet Card
```
Dimensions:
- Width: 361px
- Height: Auto (min 100px)
- Border Radius: 16px

Layout:
- Padding: 16px
- Flex: column, gap 12px

Header Row:
- Flex: row, justify-content: space-between
- Left: Icon (24px) + Wallet Name (body-lg, Bold)
- Right: Status Badge

Content:
- Address: mono-md (14pt), #9CA3AF, truncated (0x7a8b...3f2e)
- Network: caption (14pt), #6B7280

Footer Row:
- Flex: row, justify-content: flex-end
- Disconnect Button: Ghost style, caption size

Background: #1A2332
Border: 1px solid #2D3748
```

#### Menu Item Card
```
Dimensions:
- Width: 361px
- Height: 64px
- Border Radius: 16px

Layout:
- Padding: 16px horizontal, centered vertical
- Flex: row, justify-content: space-between, align-items: center

Left Content:
- Icon: 24px, #9CA3AF
- Gap: 12px
- Title: body-md (16pt), Regular, #FFFFFF
- Subtitle (optional): caption (14pt), #6B7280

Right Content:
- Chevron: 20px, #6B7280
- OR Value text: caption (14pt), #9CA3AF
- OR Toggle: see Toggle component

Background: #1A2332
Border: 1px solid #2D3748
```

#### Proof History Card
```
Dimensions:
- Width: 361px
- Height: Auto (min 80px)
- Border Radius: 16px

Layout:
- Padding: 16px
- Flex: row, justify-content: space-between, align-items: flex-start

Left Content:
- Icon: 24px, #10B981
- Gap: 12px
- Title: body-md (16pt), Medium, #FFFFFF
- Date: caption-sm (13pt), #6B7280
- Network + Hash: mono-sm (12pt), #9CA3AF

Right Content:
- Status Badge: "Verified" with checkmark

Background: #1A2332
Border: 1px solid #2D3748
```

### 3.4.4 Buttons

#### Primary Button
```
Dimensions:
- Width: 100% (fluid) or fixed based on context
- Height: 52px
- Border Radius: 12px

Layout:
- Flex: row, justify-content: center, align-items: center, gap: 8px
- Padding: 14px vertical, 24px horizontal

Typography:
- Style: body-md (16pt), SemiBold (600)
- Color: #FFFFFF

Background:
- Default: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)
- Pressed: #2563EB (solid)
- Disabled: #3B82F6 at 38% opacity

Border: none

Shadow:
- Default: 0 4px 12px rgba(59, 130, 246, 0.25)
- Pressed: 0 2px 4px rgba(59, 130, 246, 0.2)
- Disabled: none
```

#### Secondary Button
```
Dimensions:
- Width: fluid or fixed
- Height: 52px
- Border Radius: 12px

Background:
- Default: #1A2332
- Pressed: #232D3F
- Disabled: #1A2332 at 38% opacity

Border: 1px solid #2D3748

Typography:
- Style: body-md (16pt), SemiBold (600)
- Default Color: #FFFFFF
- Disabled Color: #6B7280
```

#### Outline Button
```
Dimensions:
- Width: fluid or fixed
- Height: 52px
- Border Radius: 12px

Background:
- Default: transparent
- Pressed: #3B82F610 (6% opacity blue)
- Disabled: transparent

Border:
- Default: 1.5px solid #3B82F6
- Disabled: 1.5px solid #3B82F6 at 38% opacity

Typography:
- Style: body-md (16pt), SemiBold (600)
- Default Color: #3B82F6
- Disabled Color: #3B82F6 at 38% opacity
```

#### Ghost Button
```
Dimensions:
- Width: auto (fit content)
- Height: 40px
- Border Radius: 8px

Padding: 8px vertical, 16px horizontal

Background:
- Default: transparent
- Pressed: #FFFFFF08 (3% opacity white)
- Disabled: transparent

Border: none

Typography:
- Style: caption (14pt), Medium (500)
- Default Color: #9CA3AF
- Pressed Color: #FFFFFF
- Disabled Color: #4B5563
```

### 3.4.5 Step Indicator

```
Container:
- Width: 361px
- Padding: 16px
- Background: #1A2332
- Border Radius: 16px
- Border: 1px solid #2D3748

Step Item:
- Height: 32px per step
- Gap between steps: 8px
- Flex: row, align-items: center, gap: 12px

Step Icon:
- Size: 20px x 20px
- Border Radius: 50% (circle)

States:
+-------------------------------------------------------------+
| State     | Icon BG    | Icon      | Text Color | Text Wt   |
+-------------------------------------------------------------+
| pending   | #4B5563    | Circle    | #6B7280    | Regular   |
| active    | #10B981    | Dot/Pulse | #FFFFFF    | Medium    |
| complete  | #10B981    | Checkmark | #10B981    | Medium    |
| error     | #EF4444    | X mark    | #EF4444    | Medium    |
+-------------------------------------------------------------+

Active State Animation:
- Pulsing glow: 0.5s ease-in-out infinite
- Glow color: #10B981 at 30% opacity
- Scale: 1.0 -> 1.1 -> 1.0

Icon Specifications:
- Pending: Empty circle, 2px stroke #4B5563
- Active: Filled circle #10B981, center dot #FFFFFF (6px)
- Complete: Checkmark icon, stroke #FFFFFF, 2px weight
- Error: X icon, stroke #FFFFFF, 2px weight
```

**Step Indicator Component Interface:**
```tsx
interface StepIndicatorProps {
  steps: {
    label: string;
    status: 'pending' | 'active' | 'complete' | 'error';
  }[];
}

// Visual:
// [check] Wallet connected          (complete - green check)
// [dot]   Fetching KYC attestation  (active - animated dot)
// [o]     Fetching raw transaction  (pending - gray circle)
// [o]     Verifying Coinbase signer
// [o]     Signing dApp challenge
// [o]     Generating ZK proof
```

### 3.4.6 Live Logs Panel

```
Container:
- Width: 361px
- Height: 200px (or flexible)
- Border Radius: 16px
- Background: #0F1419
- Border: 1px solid #2D3748
- Overflow: hidden

Header:
- Height: 44px
- Padding: 12px 16px
- Background: #1A2332
- Border Bottom: 1px solid #2D3748
- Flex: row, justify-content: space-between, align-items: center

Header Left:
- Icon: 16px, #F59E0B (wrench/gear)
- Gap: 8px
- Text: "UltraHonk Engine", caption (14pt), Medium, #FFFFFF

Header Right:
- Icon: 16px, #6B7280 (document)
- Gap: 4px
- Text: "Live logs", caption-sm (13pt), Regular, #6B7280

Log Content:
- Padding: 12px 16px
- Overflow-y: scroll
- Scrollbar: 4px width, #2D3748 bg, #4B5563 thumb

Log Entry:
- Font: mono-sm (12pt), SF Mono/Roboto Mono
- Line Height: 20px
- Timestamp: #6B7280
- Message: #9CA3AF
- Gap between entries: 4px

Log Entry Colors by Type:
- info: #9CA3AF
- success: #10B981
- error: #EF4444
- progress: #3B82F6

Progress Bar (inline):
- Height: 8px
- Background: #2D3748
- Fill: #10B981
- Border Radius: 4px
- Width: 180px
```

**Live Logs Component Interface:**
```tsx
interface LiveLogsProps {
  logs: {
    timestamp: Date;
    message: string;
    type: 'info' | 'success' | 'error' | 'progress';
  }[];
  engineName: string; // "UltraHonk Engine"
}

// Visual:
// +---------------------------------------+
// | [wrench] UltraHonk Engine  Live logs  |
// |---------------------------------------|
// | [21:30:01] Initializing circuit...    |
// | [21:30:02] Loading witness data...    |
// | [21:30:03] Computing proof (45%)...   |
// | [=========>                  ]  45%   |
// +---------------------------------------+
```

### 3.4.7 Progress Bar

```
Container:
- Width: 100% (parent width)
- Height: 8px
- Border Radius: 4px
- Background: #2D3748

Fill:
- Height: 100%
- Border Radius: 4px
- Background: linear-gradient(90deg, #10B981 0%, #34D399 100%)
- Transition: width 300ms ease-out

With Label:
- Label Position: above bar, right-aligned
- Label: small (12pt), Medium, #9CA3AF
- Gap (label to bar): 8px
```

### 3.4.8 Badge / Tag

```
Standard Badge:
- Height: 24px
- Padding: 4px 10px
- Border Radius: 12px (pill shape)
- Font: tiny (11pt), Medium (500)

Variants:
+-------------------------------------------------------------+
| Variant   | Background      | Text Color | Border           |
+-------------------------------------------------------------+
| success   | #10B98120       | #10B981    | none             |
| warning   | #F59E0B20       | #F59E0B    | none             |
| info      | #3B82F620       | #3B82F6    | none             |
| error     | #EF444420       | #EF4444    | none             |
| neutral   | #4B556320       | #9CA3AF    | none             |
| outline   | transparent     | #9CA3AF    | 1px #4B5563      |
| active    | #3B82F6         | #FFFFFF    | none             |
+-------------------------------------------------------------+

With Icon:
- Icon Size: 12px
- Gap (icon to text): 4px
- Icon + Text layout: row, center aligned
```

### 3.4.9 Toggle Switch

```
Track:
- Width: 51px
- Height: 31px
- Border Radius: 16px

Thumb:
- Size: 27px x 27px
- Border Radius: 50%
- Position: 2px from edge

States:
+-------------------------------------------------------------+
| State     | Track BG   | Thumb BG   | Thumb Position         |
+-------------------------------------------------------------+
| off       | #4B5563    | #FFFFFF    | left (2px)             |
| on        | #10B981    | #FFFFFF    | right (51-27-2=22px)   |
| disabled  | #2D3748    | #6B7280    | current                |
+-------------------------------------------------------------+

Animation:
- Thumb transition: transform 200ms ease-out
- Track color transition: background-color 200ms ease-out

Shadow (thumb):
- 0 2px 4px rgba(0, 0, 0, 0.2)
```

### 3.4.10 Dropdown / Select

```
Trigger:
- Width: fluid (parent width)
- Height: 52px
- Border Radius: 12px
- Background: #1A2332
- Border: 1px solid #2D3748
- Padding: 0 16px

Trigger Content:
- Flex: row, justify-content: space-between, align-items: center
- Label: body-md (16pt), Regular, #FFFFFF
- Chevron: 20px, #6B7280, rotates 180deg when open

Dropdown Panel:
- Position: absolute, below trigger
- Offset: 4px gap
- Width: same as trigger
- Max Height: 240px
- Border Radius: 12px
- Background: #1A2332
- Border: 1px solid #2D3748
- Shadow: 0 8px 24px rgba(0, 0, 0, 0.4)
- Overflow-y: scroll

Option Item:
- Height: 48px
- Padding: 0 16px
- Background: transparent
- Hover: #232D3F
- Selected: bg #3B82F620, text #3B82F6
- Font: body-md (16pt), Regular

Checkmark (selected):
- Size: 20px
- Color: #3B82F6
- Position: right side
```

### 3.4.11 Text Input

```
Container:
- Width: fluid
- Height: 52px
- Border Radius: 12px
- Background: #1A2332
- Padding: 0 16px

States:
+-------------------------------------------------------------+
| State     | Border            | Label Color | Input Color    |
+-------------------------------------------------------------+
| default   | 1px #2D3748       | #6B7280     | #FFFFFF        |
| focused   | 1.5px #3B82F6     | #3B82F6     | #FFFFFF        |
| error     | 1.5px #EF4444     | #EF4444     | #FFFFFF        |
| disabled  | 1px #2D3748       | #4B5563     | #4B5563        |
+-------------------------------------------------------------+

Typography:
- Input: body-md (16pt), Regular
- Placeholder: body-md (16pt), Regular, #6B7280

Floating Label (optional):
- Position: absolute, top 8px, left 16px
- Font: small (12pt), Regular
- Transition: transform 150ms ease-out, font-size 150ms ease-out

Error Message:
- Position: below input, 4px gap
- Font: caption-sm (13pt), Regular, #EF4444
- Icon: 14px exclamation, #EF4444

Character Counter:
- Position: right side of error message row
- Font: caption-sm (13pt), Regular, #6B7280
```

### 3.4.12 List Items

```
Standard List Item:
- Width: 361px
- Height: 56px (single line) / 72px (two line)
- Padding: 0 16px
- Background: transparent

Layout:
- Flex: row, align-items: center, gap: 16px

Leading (optional):
- Icon: 24px, #9CA3AF
- OR Avatar: 40px circle
- OR Checkbox: 24px

Content:
- Flex: column, gap: 2px
- Primary: body-md (16pt), Regular, #FFFFFF
- Secondary: caption (14pt), Regular, #6B7280

Trailing (optional):
- Text: caption (14pt), #9CA3AF
- OR Icon: 20px chevron, #6B7280
- OR Badge: see Badge component
- OR Switch: see Toggle component

Divider:
- Height: 1px
- Color: #2D3748 at 50% opacity
- Inset: 56px left (aligned with content)

Pressed State:
- Background: #232D3F
```

### 3.4.13 Dividers

```
Full Width Divider:
- Width: 100%
- Height: 1px
- Background: #2D3748

Inset Divider:
- Width: calc(100% - 32px)
- Margin Left: 16px
- Height: 1px
- Background: #2D3748

Section Divider:
- Width: 100%
- Height: 8px
- Background: #0F1419

Labeled Divider:
- Line: 1px #2D3748
- Label: small (12pt), Medium, #6B7280
- Label Background: #0F1419
- Label Padding: 0 16px
- Gap (line to label): 0 (label overlays center)
```

---

# Part 4: Screen-by-Screen Specifications

## 4.1 Screen Dimensions

**Target Device:** iPhone 14 Pro
**Dimensions:** 393 x 852 points

**Safe Areas:**
- Status Bar: 44pt top
- Navigation Header: 52pt
- Bottom Tab Bar: 83pt (49pt + 34pt home indicator)
- Content Area: 673pt (852 - 44 - 52 - 83)

**Android Equivalent:** 360 x 800 dp (use percentage-based layouts)

## 4.2 Proof Flow Screens

### 4.2.1 Proof - Circuit Selection Screen

```
Screen: 393 x 852pt
Safe Area Content: 673pt height

+---------------------------------------------+ <- y: 0
|          STATUS BAR (44pt)                  |
+---------------------------------------------+ <- y: 44
|  <- Proof                                   | Navigation Header
|     (52pt height)                           |
+---------------------------------------------+ <- y: 96
|                                             |
|  y: 112 (16pt padding from header)          |
|                                             |
|  +---------------------------------------+  | <- y: 112
|  |      SELECT PROOF TYPE (24pt)         |  | Section Title
|  +---------------------------------------+  |
|                                             |
|  y: 152 (16pt gap)                          |
|                                             |
|  +---------------------------------------+  | <- y: 152
|  | Coinbase KYC Circuit Card             |  | Card Height: 88pt
|  | x: 16, width: 361                     |  |
|  +---------------------------------------+  | <- y: 240
|                                             |
|  y: 256 (16pt gap)                          |
|                                             |
|         (remaining space: 321pt)            |
|                                             |
+---------------------------------------------+ <- y: 769
|          BOTTOM TAB BAR (83pt)              |
|  [Proof*]    [Wallet]    [MyInfo]           |
+---------------------------------------------+ <- y: 852

* = active tab (blue)
```

**Element Details:**

| Element | X | Y | Width | Height | Notes |
|---------|---|---|-------|--------|-------|
| Navigation Title | 16 | 44 | 361 | 52 | "Proof" heading-2 |
| Section Title | 16 | 112 | 361 | 24 | "Select Proof Type" heading-3, center |
| Circuit Card 1 | 16 | 152 | 361 | 88 | Active, tap navigates |
| Tab Bar | 0 | 769 | 393 | 83 | Proof tab active |

### 4.2.2 Proof - Generation View

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR (44pt)                  |
+---------------------------------------------+
|  <-  Coinbase KYC Verification              | Back + Title
+---------------------------------------------+ <- y: 96
|                                             |
|  +---------------------------------------+  | <- y: 112
|  |         PROOF PORTAL                  |  |
|  |   Hero Card (160pt height)            |  |
|  |   - Logo/Icon: 48pt, centered         |  |
|  |   - Title: display-md, center         |  |
|  |   - Subtitle: body-sm, center         |  |
|  |   - gradient border glow              |  |
|  +---------------------------------------+  | <- y: 272
|                                             |
|  Step Progress:                      (label)| <- y: 296
|  +---------------------------------------+  | <- y: 320
|  | Step Indicator Panel                  |  |
|  | (6 steps, ~224pt height)              |  |
|  | [check] Wallet connected              |  |
|  | [dot]   Fetching KYC attestation...   |  |
|  | [o]     Fetching raw transaction      |  |
|  | [o]     Verifying Coinbase signer     |  |
|  | [o]     Signing dApp challenge        |  |
|  | [o]     Generating ZK proof           |  |
|  +---------------------------------------+  | <- y: 544
|                                             |
|  +---------------------------------------+  | <- y: 560
|  | Live Logs Panel (160pt)               |  |
|  +---------------------------------------+  | <- y: 720
|                                             |
|  +---------------------------------------+  | <- y: 736
|  |      [Generate ZK Proof]              |  | Primary Button 52pt
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

**Element Details:**

| Element | X | Y | Width | Height | Notes |
|---------|---|---|-------|--------|-------|
| Back Button | 16 | 44 | 44 | 52 | Touch target |
| Nav Title | 60 | 44 | 317 | 52 | Truncate if needed |
| Hero Card | 16 | 112 | 361 | 160 | Gradient border |
| Step Label | 16 | 288 | 100 | 20 | "Step Progress:" |
| Step Panel | 16 | 312 | 361 | 224 | Card style |
| Logs Panel | 16 | 552 | 361 | 160 | Expandable |
| CTA Button | 16 | 728 | 361 | 52 | Primary style |

### 4.2.3 Proof - Complete View

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  <-  Coinbase KYC Verification              |
+---------------------------------------------+ <- y: 96
|                                             |
|              [SUCCESS ICON]                 | <- y: 160, centered
|                 80pt x 80pt                 |
|            animated checkmark               |
|                                             |
|          Proof Generated!                   | <- y: 260, display-lg
|                                             |
|  +---------------------------------------+  | <- y: 320
|  | Proof Hash Card                       |  |
|  | Label: "Proof Hash"                   |  |
|  | Value: 0x7a8b...3f2e (monospace)      |  |
|  | [Copy] button right aligned           |  |
|  | Height: 80pt                          |  |
|  +---------------------------------------+  | <- y: 400
|                                             |
|  +---------------------------------------+  | <- y: 416
|  | Details Card                          |  |
|  | - Chain: Base                         |  |
|  | - Circuit: coinbase-kyc               |  |
|  | - Generated: timestamp                |  |
|  | - Status: Verified [check]            |  |
|  | Height: 144pt                         |  |
|  +---------------------------------------+  | <- y: 560
|                                             |
|  +---------------------------------------+  | <- y: 592
|  |    [View on Explorer]                 |  | Secondary Button
|  +---------------------------------------+  | <- y: 644
|                                             |
|  +---------------------------------------+  | <- y: 660
|  |    [Generate Another Proof]           |  | Outline Button
|  +---------------------------------------+  | <- y: 712
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

**Element Details:**

| Element | X | Y | Width | Height | Notes |
|---------|---|---|-------|--------|-------|
| Success Icon | 156.5 | 160 | 80 | 80 | Animated, green |
| Success Text | 16 | 260 | 361 | 40 | display-lg, center |
| Hash Card | 16 | 320 | 361 | 80 | Monospace hash |
| Details Card | 16 | 416 | 361 | 144 | Key-value pairs |
| Explorer Button | 16 | 576 | 361 | 52 | Secondary |
| Another Proof Button | 16 | 644 | 361 | 52 | Outline |

## 4.3 Wallet Flow Screens

### 4.3.1 Wallet - No Connection

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  Wallet                                     | Title only, no back
+---------------------------------------------+ <- y: 96
|                                             |
|                                             |
|              [LINK ICON]                    | <- y: 220
|               64pt x 64pt                   |
|                                             |
|         No Wallet Connected                 | <- y: 308, heading-1
|                                             |
|     Connect your wallet to generate         | <- y: 352
|        zero-knowledge proofs                | body-md, secondary color
|                                             |
|  +---------------------------------------+  | <- y: 416
|  |       [Connect Wallet]                |  | Primary Button
|  +---------------------------------------+  |
|                                             |
|         Supported Wallets:                  | <- y: 500, caption
|                                             |
|         * MetaMask                          | <- y: 532
|         * Coinbase Wallet                   |
|         * Rainbow                           |
|         * Trust Wallet                      |
|         * WalletConnect                     |
|         (body-md, secondary, 28pt each)     |
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
|  [Proof]    [Wallet*]    [MyInfo]           |
+---------------------------------------------+
```

### 4.3.2 Wallet - Connected

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  Wallet                                     |
+---------------------------------------------+ <- y: 96
|                                             |
|  Connected Wallets                          | <- y: 112, heading-2
|                                             |
|  +---------------------------------------+  | <- y: 152
|  | Wallet Card (MetaMask)                |  |
|  | - Icon + Name + [Active] badge        |  |
|  | - Address truncated                   |  |
|  | - Network indicator                   |  |
|  | - [Disconnect] ghost button           |  |
|  | Height: 120pt                         |  |
|  +---------------------------------------+  | <- y: 272
|                                             |
|  +---------------------------------------+  | <- y: 288
|  | Wallet Card (Coinbase)                |  |
|  | Height: 120pt                         |  |
|  +---------------------------------------+  | <- y: 408
|                                             |
|  +---------------------------------------+  | <- y: 424
|  |    [+ Add Another Wallet]             |  | Secondary Button
|  +---------------------------------------+  | <- y: 476
|                                             |
|  -----------------------------------------  | <- y: 508, divider
|                                             |
|  Network: Base                    [v]       | <- y: 532, dropdown
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

## 4.4 MyInfo Flow Screens

### 4.4.1 MyInfo - Main

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  MyInfo                                     |
+---------------------------------------------+ <- y: 96
|                                             |
|  +---------------------------------------+  | <- y: 112
|  | Proof History                      -> |  | Menu Item 64pt
|  +---------------------------------------+  | <- y: 176
|                                             |
|  +---------------------------------------+  | <- y: 184
|  | Settings                           -> |  |
|  +---------------------------------------+  | <- y: 248
|                                             |
|  +---------------------------------------+  | <- y: 256
|  | Notifications                      -> |  |
|  +---------------------------------------+  | <- y: 320
|                                             |
|  +---------------------------------------+  | <- y: 328
|  | Security                           -> |  |
|  +---------------------------------------+  | <- y: 392
|                                             |
|  +---------------------------------------+  | <- y: 400
|  | Legal                              -> |  |
|  +---------------------------------------+  | <- y: 464
|                                             |
|  +---------------------------------------+  | <- y: 472
|  | About                              -> |  |
|  +---------------------------------------+  | <- y: 536
|                                             |
|                                             |
|         Version 1.0.0                       | <- y: 740
|                                             | caption, centered, muted
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
|  [Proof]    [Wallet]    [MyInfo*]           |
+---------------------------------------------+
```

### 4.4.2 MyInfo - Proof History

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  <-  Proof History                          |
+---------------------------------------------+ <- y: 96
|                                             |
|  January 2026                               | <- y: 112, section label
|                                             |
|  +---------------------------------------+  | <- y: 144
|  | Proof History Card                    |  |
|  | - Coinbase KYC, Verified badge        |  |
|  | - Date, time                          |  |
|  | - Network, hash                       |  |
|  | Height: 88pt                          |  |
|  +---------------------------------------+  | <- y: 232
|                                             |
|  +---------------------------------------+  | <- y: 248
|  | Proof History Card                    |  |
|  +---------------------------------------+  | <- y: 336
|                                             |
|  +---------------------------------------+  | <- y: 352
|  | Proof History Card                    |  |
|  +---------------------------------------+  | <- y: 440
|                                             |
|  -----------------------------------------  | <- y: 472
|                                             |
|  Total Proofs: 3                            | <- y: 496
|  All Verified: [check]                      | <- y: 524
|                                             | footer stats, centered
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

### 4.4.3 MyInfo - Settings

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  <-  Settings                               |
+---------------------------------------------+ <- y: 96
|                                             |
|  General                                    | <- y: 112, section label
|                                             |
|  +---------------------------------------+  | <- y: 144
|  | Language               English     -> |  |
|  |---------------------------------------|  |
|  | Theme                    Dark      -> |  |
|  |---------------------------------------|  |
|  | Default Network          Base      -> |  |
|  +---------------------------------------+  |
|  (grouped card, 168pt total)                | <- y: 312
|                                             |
|  Proof Settings                             | <- y: 336, section label
|                                             |
|  +---------------------------------------+  | <- y: 368
|  | Auto-save proofs              [ON]    |  | with toggle
|  |---------------------------------------|  |
|  | Show live logs                [ON]    |  |
|  |---------------------------------------|  |
|  | Confirm before generate       [ON]    |  |
|  +---------------------------------------+  |
|  (grouped card, 168pt total)                | <- y: 536
|                                             |
|  Data                                       | <- y: 560, section label
|                                             |
|  +---------------------------------------+  | <- y: 592
|  | Export Proof History              ->  |  |
|  |---------------------------------------|  |
|  | Clear Local Data                  ->  |  | text color: error
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

### 4.4.4 MyInfo - Legal

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  <-  Legal                                  |
+---------------------------------------------+ <- y: 96
|                                             |
|  +---------------------------------------+  | <- y: 112
|  | Terms of Service                   -> |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  | <- y: 184
|  | Privacy Policy                     -> |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  | <- y: 256
|  | Open Source Licenses               -> |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  | <- y: 328
|  | Disclaimer                         -> |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  | <- y: 400
|  | GDPR Information                   -> |  |
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

## 4.5 Modal & State Screens

### 4.5.1 Wallet Connect Modal

```
Modal Overlay:
- Full screen: 393 x 852pt
- Background: #0F1419 at 72% opacity (--opacity-overlay-modal)

Bottom Sheet:
- Position: bottom of screen
- Width: 393pt
- Height: auto (content + safe area)
- Border Radius: 24pt 24pt 0 0 (top corners only)
- Background: #1A2332
- Padding: 24pt top, 24pt horizontal, 58pt bottom (includes safe area)

+---------------------------------------------+
|                                             |
|          (dark overlay area)                |
|                                             |
|                                             |
|                                             |
+--------------------------------------------+| <- sheet top
|             ------- (handle)               ||
|                                            ||
|  Connect Wallet               [X]          || <- heading-2 + close
|                                            ||
|  Select a wallet to connect:               || <- body-sm, secondary
|                                            ||
|  +----------------------------------------+||
|  | [Fox] MetaMask                      -> ||| Wallet option
|  +----------------------------------------+|| 56pt height
|                                            ||
|  +----------------------------------------+||
|  | [Blue] Coinbase Wallet              -> |||
|  +----------------------------------------+||
|                                            ||
|  +----------------------------------------+||
|  | [Rainbow] Rainbow                   -> |||
|  +----------------------------------------+||
|                                            ||
|  +----------------------------------------+||
|  | [Shield] Trust Wallet               -> |||
|  +----------------------------------------+||
|                                            ||
|  +----------------------------------------+||
|  | [WC] WalletConnect                  -> |||
|  +----------------------------------------+||
|                                            ||
|  (safe area: 34pt)                         ||
+--------------------------------------------+|

Handle:
- Width: 36pt
- Height: 5pt
- Border Radius: 2.5pt
- Background: #4B5563
- Position: centered, 8pt from top
```

### 4.5.2 Error State Screen

```
Screen: 393 x 852pt

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|  <-  Coinbase KYC Verification              |
+---------------------------------------------+ <- y: 96
|                                             |
|                                             |
|              [ERROR ICON]                   | <- y: 200
|               80pt x 80pt                   |
|               #EF4444                       |
|                                             |
|         Something went wrong                | <- y: 304, heading-1
|                                             |
|     Unable to complete proof                | <- y: 352
|     generation. Please try again.           | body-md, secondary, center
|                                             |
|  +---------------------------------------+  | <- y: 432
|  | Error Details Card                    |  |
|  | - Error Code: 0x003                   |  |
|  | - Message: Network timeout            |  |
|  | - Timestamp                           |  |
|  | Background: #EF444410                 |  |
|  | Border: 1px #EF444440                 |  |
|  | Height: 120pt                         |  |
|  +---------------------------------------+  | <- y: 552
|                                             |
|  +---------------------------------------+  | <- y: 584
|  |         [Try Again]                   |  | Primary Button
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  | <- y: 652
|  |      [Contact Support]                |  | Ghost Button
|  +---------------------------------------+  |
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+
```

### 4.5.3 Loading State

```
Full Screen Loading:
- Overlay: #0F1419 (solid) or content beneath with blur
- Centered content

Loading Container:
- Position: centered in available space
- Width: 200pt
- Height: auto

+---------------------------------------------+
|          STATUS BAR                         |
+---------------------------------------------+
|                                             |
|                                             |
|                                             |
|                                             |
|              [SPINNER]                      | <- centered
|               48pt x 48pt                   |
|                                             |
|         Generating proof...                 | <- body-md, center
|                                             |
|          This may take a moment             | <- caption, secondary
|                                             |
|                                             |
|                                             |
|                                             |
+---------------------------------------------+
|          BOTTOM TAB BAR                     |
+---------------------------------------------+

Spinner Specification:
- Size: 48pt x 48pt
- Stroke Width: 4pt
- Track Color: #2D3748
- Active Color: #3B82F6
- Animation: rotate 360deg, 1s linear infinite
- Arc Length: 270deg
```

**Inline Loading (Button):**
```
- Replace button text with spinner
- Spinner Size: 20pt x 20pt
- Stroke Width: 2pt
- Button becomes disabled state
- Optional: text beside spinner "Generating..."
```

---

# Part 5: Animation Specifications

## 5.1 Transition Durations

| Animation Type | Duration | Usage |
|----------------|----------|-------|
| `--duration-instant` | 0ms | Immediate state changes |
| `--duration-fast` | 100ms | Micro-interactions (hover) |
| `--duration-normal` | 200ms | Standard transitions |
| `--duration-slow` | 300ms | Modal enter/exit |
| `--duration-slower` | 400ms | Complex animations |
| `--duration-slowest` | 500ms | Page transitions |

## 5.2 Easing Curves

| Curve Name | CSS Value | Usage |
|------------|-----------|-------|
| `--ease-linear` | `linear` | Progress bars, spinners |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 0.5)` | Exit animations |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Enter animations |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | State changes |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy effects |

## 5.3 Component Animations

### 5.3.1 Loading Spinner

```
Spinner Animation:
- Name: spin
- Keyframes:
  - 0%: rotate(0deg)
  - 100%: rotate(360deg)
- Duration: 1000ms
- Timing: linear
- Iteration: infinite

Arc Animation (optional):
- Name: spinner-arc
- Keyframes:
  - 0%: stroke-dashoffset: 0
  - 50%: stroke-dashoffset: -35
  - 100%: stroke-dashoffset: -70
- Duration: 1500ms
- Timing: ease-in-out
- Iteration: infinite
```

### 5.3.2 Progress Animation

```
Progress Fill:
- Property: width
- Duration: 300ms
- Timing: ease-out
- Fill Direction: left to right

Shimmer Effect (indeterminate):
- Name: shimmer
- Keyframes:
  - 0%: transform: translateX(-100%)
  - 100%: transform: translateX(100%)
- Duration: 1500ms
- Timing: ease-in-out
- Iteration: infinite
```

### 5.3.3 Tab Transition

```
Tab Content Change:
- Outgoing: opacity 0, translateX(-8px), 150ms ease-in
- Incoming: opacity 1, translateX(0), 150ms ease-out, 50ms delay

Tab Icon:
- Scale: 1.0 -> 1.1 -> 1.0
- Duration: 200ms
- Timing: ease-spring
```

### 5.3.4 Success Checkmark Animation

```
Circle Draw:
- Name: circle-draw
- Keyframes:
  - 0%: stroke-dashoffset: 166 (circumference)
  - 100%: stroke-dashoffset: 0
- Duration: 400ms
- Timing: ease-out

Checkmark Draw:
- Name: check-draw
- Keyframes:
  - 0%: stroke-dashoffset: 48 (path length)
  - 100%: stroke-dashoffset: 0
- Duration: 300ms
- Timing: ease-out
- Delay: 200ms (after circle completes)

Scale Bounce:
- Keyframes:
  - 0%: scale(0.8)
  - 50%: scale(1.1)
  - 100%: scale(1.0)
- Duration: 400ms
- Timing: ease-spring
```

### 5.3.5 Step Indicator Pulse

```
Active Step Glow:
- Name: pulse-glow
- Keyframes:
  - 0%: box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4)
  - 70%: box-shadow: 0 0 0 10px rgba(16, 185, 129, 0)
  - 100%: box-shadow: 0 0 0 0 rgba(16, 185, 129, 0)
- Duration: 1500ms
- Timing: ease-out
- Iteration: infinite
```

### 5.3.6 Modal/Sheet Transitions

```
Bottom Sheet Enter:
- Transform: translateY(100%) -> translateY(0)
- Duration: 300ms
- Timing: ease-out

Bottom Sheet Exit:
- Transform: translateY(0) -> translateY(100%)
- Duration: 200ms
- Timing: ease-in

Overlay Fade:
- Opacity: 0 -> 0.72 (enter) / 0.72 -> 0 (exit)
- Duration: 200ms
- Timing: ease-out
```

---

# Part 6: Icon Specifications

## 6.1 Icon Sizes

| Size Name | Dimensions | Usage |
|-----------|------------|-------|
| `icon-xs` | 12px | Inline badges |
| `icon-sm` | 16px | Compact lists, log entries |
| `icon-md` | 20px | Standard UI (chevrons, actions) |
| `icon-lg` | 24px | Primary icons, nav, cards |
| `icon-xl` | 32px | Feature icons |
| `icon-2xl` | 48px | Loading spinners |
| `icon-3xl` | 64px | Empty states |
| `icon-hero` | 80px | Success/error states |

## 6.2 Icon Colors

| Context | Color Token | HEX |
|---------|-------------|-----|
| Primary (on dark) | `--color-text-primary` | #FFFFFF |
| Secondary | `--color-text-secondary` | #9CA3AF |
| Muted | `--color-text-tertiary` | #6B7280 |
| Disabled | `--color-text-disabled` | #4B5563 |
| Success | `--color-success-500` | #10B981 |
| Warning | `--color-warning-500` | #F59E0B |
| Error | `--color-error-500` | #EF4444 |
| Info/Interactive | `--color-info-500` | #3B82F6 |

## 6.3 Icon Library

| Icon Name | Description | Usage |
|-----------|-------------|-------|
| `shield-check` | Shield with checkmark | KYC/verification |
| `fingerprint` | Fingerprint | Identity/biometric |
| `lock-closed` | Padlock closed | Security, private |
| `key` | Key | Access, authentication |
| `link` | Chain link | Connection, wallet |
| `wallet` | Wallet | Wallet tab |
| `user-circle` | User avatar | MyInfo tab |
| `document-text` | Document | Proof, legal docs |
| `clock` | Clock | History, timestamps |
| `cog` | Gear/settings | Settings |
| `bell` | Notification bell | Notifications |
| `chevron-right` | Right arrow | Navigation, drill-down |
| `chevron-left` | Left arrow | Back navigation |
| `chevron-down` | Down arrow | Dropdowns |
| `x-mark` | X/close | Close, dismiss |
| `check` | Checkmark | Complete, success |
| `exclamation-circle` | Exclamation in circle | Error, warning |
| `information-circle` | Info in circle | Information |
| `plus` | Plus sign | Add action |
| `copy` | Copy/clipboard | Copy to clipboard |
| `external-link` | Arrow out of box | External links |
| `qr-code` | QR code | Scan/share |
| `refresh` | Circular arrows | Retry, refresh |
| `adjustments` | Sliders | Advanced settings |
| `globe` | Globe | Network/language |
| `moon` | Moon | Dark theme |
| `sun` | Sun | Light theme |
| `trash` | Trash can | Delete |
| `download` | Download arrow | Export |
| `share` | Share icon | Share action |
| `star` | Star | Favorite, rating |
| `lightning-bolt` | Lightning | Fast, powered by |

### 6.3.1 Wallet Brand Icons

| Wallet | Icon Type | Notes |
|--------|-----------|-------|
| MetaMask | Fox head | Orange #E2761B |
| Coinbase | Blue circle | Coinbase blue #0052FF |
| Rainbow | Rainbow arc | Multi-color gradient |
| Trust | Shield | Blue #0500FF |
| WalletConnect | Chain links | Blue #3B99FC |

---

# Part 7: Figma Setup Instructions

## 7.1 Frame Sizes

Create frames for each screen size:

| Frame Name | Dimensions | Notes |
|------------|------------|-------|
| iPhone 14 Pro | 393 x 852 | Primary design frame |
| iPhone 14 Pro Max | 430 x 932 | Large phone |
| iPhone SE | 375 x 667 | Small phone (no notch) |
| Android Default | 360 x 800 | Standard Android |
| Android Large | 412 x 915 | Large Android |

## 7.2 Auto-Layout Settings

**Screen Container:**
```
Direction: Vertical
Gap: 0
Padding: 0
Alignment: Top-Left
```

**Content Area:**
```
Direction: Vertical
Gap: 16 (--space-4)
Padding: 16 horizontal, 16 top
Alignment: Top-Left
Fill: Fill container (width)
```

**Card Container:**
```
Direction: Vertical
Gap: 12 (--space-3)
Padding: 16 all
Corner Radius: 16
Fill: #1A2332
Stroke: 1px #2D3748
```

**Button:**
```
Direction: Horizontal
Gap: 8
Padding: 14 vertical, 24 horizontal
Corner Radius: 12
Alignment: Center
```

**List Item:**
```
Direction: Horizontal
Gap: 12
Padding: 12 vertical, 16 horizontal
Alignment: Center-Left
Fill: Hug contents (height), Fill container (width)
```

## 7.3 Component Organization

Organize your Figma file with these pages:

```
ZKProofPort Design System
|- Cover
|- Design Tokens
|  |- Colors
|  |- Typography
|  |- Spacing
|- Components
|  |- Atoms (icons, badges, dividers)
|  |- Molecules (buttons, inputs, cards)
|  |- Organisms (tab bar, headers, panels)
|- Screens
|  |- 1. Proof Flow
|  |- 2. Wallet Flow
|  |- 3. MyInfo Flow
|  |- 4. Modals & States
|- Prototypes
|- Handoff
```

## 7.4 Style Naming Conventions

**Color Styles:**
```
Colors/Background/Primary
Colors/Background/Secondary
Colors/Background/Tertiary
Colors/Text/Primary
Colors/Text/Secondary
Colors/Text/Tertiary
Colors/Semantic/Success/500
Colors/Semantic/Success/Background
Colors/Semantic/Warning/500
Colors/Semantic/Error/500
Colors/Semantic/Info/500
Colors/Border/Primary
Colors/Border/Secondary
```

**Text Styles:**
```
Typography/Display/Large
Typography/Display/Medium
Typography/Heading/1
Typography/Heading/2
Typography/Heading/3
Typography/Body/Large
Typography/Body/Medium
Typography/Body/Small
Typography/Caption/Default
Typography/Caption/Small
Typography/Small
Typography/Tiny
Typography/Mono/Medium
Typography/Mono/Small
```

**Effect Styles:**
```
Effects/Shadow/Button
Effects/Shadow/Card
Effects/Shadow/Modal
Effects/Shadow/Pressed
```

## 7.5 Component Variants

Structure components with variants:

**Button:**
```
Property: Type [Primary, Secondary, Outline, Ghost]
Property: State [Default, Hover, Pressed, Disabled, Loading]
Property: Size [Large, Medium, Small]
Property: Icon [None, Left, Right, Only]
```

**Card:**
```
Property: Type [Circuit, Wallet, Menu, History]
Property: State [Default, Pressed, Disabled]
```

**Badge:**
```
Property: Variant [Success, Warning, Error, Info, Neutral, Outline]
Property: Size [Default, Small]
Property: Icon [None, Left]
```

**Step Indicator:**
```
Property: Status [Pending, Active, Complete, Error]
```

## 7.6 Design Checklist

Before handoff, verify:

- [ ] All colors use defined styles (no hardcoded values)
- [ ] All text uses defined text styles
- [ ] Auto-layout applied to all containers
- [ ] Constraints set for responsive behavior
- [ ] Components properly named and organized
- [ ] Variants cover all states
- [ ] Touch targets minimum 44pt
- [ ] Safe areas respected on all screens
- [ ] Dark mode is primary (no light mode needed)
- [ ] Accessibility: 4.5:1 contrast ratio for text

---

# Appendix

## A. Implementation Priority

### Phase 1 (MVP)
- [ ] Navigation (Tab Bar)
- [ ] Proof Screen - Circuit selection
- [ ] Proof Screen - Generation flow with steps
- [ ] Wallet Screen - Connect/Disconnect
- [ ] Basic MyInfo

### Phase 2
- [ ] Live Logs component
- [ ] Proof History
- [ ] Settings
- [ ] Legal pages

### Phase 3
- [ ] Multiple wallet support
- [ ] Achievement badges
- [ ] Export/Backup
- [ ] Push notifications

## B. Quick Reference

### Color Palette Summary

```
Backgrounds:    #0F1419 -> #1A2332 -> #232D3F
Borders:        #2D3748 -> #3D4A5C
Text:           #FFFFFF -> #9CA3AF -> #6B7280 -> #4B5563
Success:        #10B981
Warning/Gold:   #F59E0B
Info/Blue:      #3B82F6
Error:          #EF4444
```

### Spacing Quick Reference

```
4px   - Icon gaps
8px   - Compact spacing
12px  - Standard gaps
16px  - Container padding, card gaps
24px  - Section spacing, button padding
32px  - Large sections
```

### Typography Quick Reference

```
32pt Bold    - Display Large
24pt Bold    - Heading 1
20pt Semi    - Heading 2
18pt Semi    - Heading 3
17pt Reg     - Body Large
16pt Reg     - Body Medium
14pt Reg     - Caption
12pt Reg     - Small
14pt Mono    - Addresses
```

## C. Additional Recommendations

1. **Achievement Badges** - First proof, 10 proofs milestones
2. **Trusted Apps** - List of dApps that have received proofs
3. **Network Stats** - Statistics per chain used
4. **Backup & Restore** - Proof history backup
5. **Developer Mode** - Advanced settings, log level adjustment
6. **Support & FAQ** - Frequently asked questions
7. **Rate the App** - App Store review prompt

---

**Document Version:** 1.1.0
**Created for:** ZKProofPort Mobile App
**Design System:** Dark-first, iOS/Android native
**Maintained by:** ZKProofPort Design Team
