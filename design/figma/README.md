# Figma Design Files

## JSON to Figma Plugin Compatibility

This directory contains multiple JSON formats for different Figma plugins. The "Select something to populate matches" error typically occurs when:

1. **No frame is selected** - Most plugins require you to select a frame/component first
2. **Layer names don't match** - The JSON keys must match layer names in Figma
3. **Wrong JSON format** - Different plugins expect different structures

---

## Available Files

### 1. `figma-ui-structure.json` (Original)
**Format:** Array of frames with nested children
**Best For:** Reference only - not directly importable

### 2. `figma-content-data.json` (Recommended)
**Format:** Structured content with `textContent` key-value pairs
**Best For:** Content Reel, JSON to Figma, Able Plugin

**Usage:**
1. Create frames and text layers in Figma manually
2. Name text layers to match keys (e.g., `navTitle_proof`, `card_coinbaseKyc_title`)
3. Select the parent frame
4. Run plugin and select `figma-content-data.json`
5. Plugin will populate text matching the keys

### 3. `figma-api-format.json`
**Format:** Figma REST API compatible structure
**Best For:** Figma API integrations, custom scripts

### 4. `figma-populate-data.json`
**Format:** Array with `#LayerName` keys
**Best For:** Data Populator, Figma Populate plugins

**Usage:**
1. Create a component/frame in Figma
2. Name text layers with `#` prefix (e.g., `#Nav Title`, `#CTA Text`)
3. Select the frame
4. Run plugin with this file
5. Each array item represents one screen's content

### 5. `figma-design-tokens.json`
**Format:** Design Tokens format (DTCG compatible)
**Best For:** Tokens Studio, Style Dictionary, Figma Tokens

---

## Workflow for "JSON to Figma" Plugin

Most "JSON to Figma" plugins work by **populating existing layers**, not creating new ones.

### Step-by-Step:

1. **Create the UI manually in Figma** (or use a template)
2. **Name your text layers** to match JSON keys
3. **Select the frame** you want to populate
4. **Run the plugin** and load the JSON
5. **Map fields** if the plugin requires it

### Common Naming Conventions:

| JSON Key Style | Plugin |
|----------------|--------|
| `#Layer Name` | Data Populator |
| `{{layerName}}` | Content Reel |
| `layerName` | JSON to Figma |
| `layer_name` | Able Plugin |

---

## Color Reference (Hex)

| Token | Value | Usage |
|-------|-------|-------|
| Background Primary | `#0F1419` | Main app background |
| Background Secondary | `#1A2332` | Cards, elevated surfaces |
| Border Primary | `#2D3748` | Card borders |
| Text Primary | `#FFFFFF` | Headings |
| Text Secondary | `#9CA3AF` | Body text |
| Text Tertiary | `#6B7280` | Muted text |
| Info/Primary | `#3B82F6` | Links, buttons |
| Success | `#10B981` | Completed states |
| Warning/Brand | `#F59E0B` | Accents, logo |
| Error | `#EF4444` | Error states |

---

## Typography

| Style | Font | Size | Weight |
|-------|------|------|--------|
| Display Large | SF Pro Display | 32px | 700 |
| Heading H1 | SF Pro Display | 24px | 700 |
| Heading H2 | SF Pro Display | 20px | 600 |
| Body Large | SF Pro Text | 17px | 400 |
| Body Medium | SF Pro Text | 16px | 400 |
| Caption | SF Pro Text | 14px | 400 |
| Small | SF Pro Text | 12px | 400 |
| Mono | SF Mono | 14px | 400 |

---

## Screen Dimensions

- **Width:** 393px (iPhone 14 Pro)
- **Height:** 852px
- **Status Bar:** 44px
- **Tab Bar:** 83px (including home indicator)
