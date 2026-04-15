# M10: Figma Extraction Dogfood Plan

## Prerequisites
- Figma MCP connected (either @anthropics/figma-mcp or figma-console)
- A real Figma file with variables and text styles
- .brand/ directory initialized

## Test Files (suggested)

1. **Column Five brand file** — full token set, known colors/fonts for validation
2. **ATTA brand file** — extracted VIC exists for comparison
3. **Any client Figma file** with defined variables and text styles

## Test Steps

### Step 1: Plan mode
```
brand_extract_figma mode="plan" figma_file_key="YOUR_FILE_KEY"
```
Expected: returns a list of required Figma MCP calls

### Step 2: Collect Figma data
Using the connected Figma MCP:
```
get_variable_defs for the file → variables array
get_styles for the file → text styles array
search for Logo component → export as SVG
```

### Step 3: Ingest mode
```
brand_extract_figma mode="ingest" variables=[...] styles=[...] logo_svg="<svg>..."
```
Expected:
- core-identity.yaml updated with figma-sourced colors (confidence: high)
- Typography entries with font-size and font-weight (not just family)
- source-catalog.json updated with source: "figma"
- brandcode_figma_import_v1 artifact in response

### Step 4: Verify quality
- Compare extracted colors to known brand colors
- Check if type hierarchy is captured (h1 size, body size, weights)
- Verify source_priority puts figma above web
- Run brand_compile and check if figma values take precedence

## Known Gaps to Investigate
- Does the ingest handle variable aliases correctly?
- Does it capture color mode variants (light/dark)?
- How does it handle variables with complex resolved values?
- Does the brandcode_figma_import_v1 artifact work in Brand Loader?

## Success Criteria
- Figma extraction produces higher-confidence data than web extraction
- Type hierarchy (font sizes, weights per heading) is captured
- Color roles are inferred from Figma variable naming conventions
- Source catalog correctly tracks figma as the source
