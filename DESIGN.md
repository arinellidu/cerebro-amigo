---
name: Cérebro Amigo — Signal Boundary
description: A clinical AI system rendered as an inspectable signal path with explicit human boundaries.
colors:
  vacuum: "#03070c"
  vacuum-soft: "#07101a"
  detector-steel: "#11283a"
  detector-line: "#1f4058"
  detector-label: "#6f899d"
  telemetry: "#9ab0c2"
  trace-white: "#e9f3fb"
  signal-cyan: "#35d8ff"
  inspection-yellow: "#ffd42a"
  human-coral: "#ff695f"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(3.4rem, 3.65vw, 4.5rem)"
    fontWeight: 500
    lineHeight: 0.85
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "JetBrains Mono, Consolas, monospace"
    fontSize: "0.65rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  instrument: "0px"
  micro: "4px"
  round: "999px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "48px"
components:
  button-primary:
    backgroundColor: "{colors.inspection-yellow}"
    textColor: "{colors.vacuum}"
    typography: "{typography.label}"
    rounded: "{rounded.instrument}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.signal-cyan}"
    typography: "{typography.label}"
    rounded: "{rounded.instrument}"
    padding: "0 20px"
    height: "48px"
---

# Design System: Cérebro Amigo — Signal Boundary

## Overview

**Creative North Star: "Signal Boundary"**

The interface borrows the precision and drama of a particle-detector event display, translated into a trustworthy full-stack AI system. Signals travel through visible layers; each transformation, safeguard and ownership boundary can be inspected. The world feels engineered rather than decorated and alive rather than clinical-cold.

The reusable signature is a concentric system field crossed by a small number of purposeful signal tracks. Tracks always represent a true relationship or transition. Human review is not a footnote: it is a visible boundary where automation stops.

**Key Characteristics:**

- Near-black instrument field with steel-blue structural layers.
- Signal Cyan for system flow, Inspection Yellow for active proof and Human Coral for safety boundaries.
- Condensed technical display type, calm humanist body copy and tabular mono notation.
- Concentric system topology on wide screens; linearized, numbered traces on small screens.
- Precise motion that reveals causality, never ambient motion without meaning.

## Colors

The palette is a committed dark instrument field. Structural blues create depth; the three signal colors have fixed semantic roles and never become decorative confetti.

### Primary

- **Signal Cyan:** active system paths, primary architecture states and selected technical layers.

### Secondary

- **Inspection Yellow:** the currently inspected event, proof or primary recruiter action.

### Tertiary

- **Human Coral:** physician review, clinical safety boundaries and human authority.

### Neutral

- **Vacuum:** page ground.
- **Vacuum Soft:** inset instrument planes.
- **Detector Steel / Detector Line:** structural rings, rails and inactive system geometry.
- **Trace White:** primary copy.
- **Telemetry:** captions, supporting copy and metadata.

**The Three Signals Rule.** Cyan means flow, yellow means inspection and coral means human/safety. Never exchange their roles.

## Typography

**Display Font:** Barlow Condensed with a narrow sans fallback.

**Body Font:** Inter with a neutral sans fallback.

**Label/Mono Font:** JetBrains Mono with a system monospace fallback.

**Character:** Barlow Condensed carries the scale and authority of scientific instrumentation without spending horizontal space. Inter restores calm readability. JetBrains Mono is reserved for evidence—architecture labels, ADR references, paths and status—not technical costume.

### Hierarchy

- **Display** (500, fluid 54–72px, 0.85): recruiter thesis and major section statements, uppercase.
- **Headline** (500, fluid 43–74px, 0.94): case-study chapter titles.
- **Body** (400, 15px, 1.65): explanatory copy with a maximum practical measure near 70 characters.
- **Label** (500, 9–11px, tracked uppercase): paths, layers, controls and evidence metadata.

**The Evidence Label Rule.** Uppercase mono labels must name a real layer, state, decision or source.

## Layout

The wide-screen model is a three-rail instrument: narrative and actions on the left, a dominant vertical signal stack in the center and synchronized implementation evidence on the right. The system stack uses seven elliptical planes and one continuous beam. Dense evidence is interrupted by quieter governance and case-study passages.

At 1240px the evidence rail becomes a two-column readout below the instrument. Below 860px the page linearizes into narrative, stack and evidence. Below 520px evidence paths move under their layer description and governance becomes a single trace.

## Elevation & Depth

Depth comes from nested planes, opacity, occlusion and narrowly luminous tracks. Detector discs use a soft downward shadow to separate stacked layers. No glass panels or ambient glow clouds are used.

**The Instrument Depth Rule.** Every layer must describe structure, state or causality.

## Shapes

Concentric ellipses, radial segments, fine rails and square technical panels define the form. Buttons and evidence panels use machined square corners. Circular badges are reserved for layer numbers and signal origins. The brain mark stays recognizable beside the otherwise industrial system.

## Components

### Buttons

- **Shape:** square instrument control with a minimum 48px height.
- **Primary:** Inspection Yellow field, Vacuum text and a directional arrow.
- **Secondary:** transparent field with a Signal Cyan keyline and external-action glyph.
- **Hover / Focus:** horizontal response on hover; two-pixel yellow keyboard focus with external offset.

### Cards / Containers

- **Corner Style:** square; these are readouts, not cards.
- **Background:** translucent Vacuum Soft only when it helps labels remain legible over the detector.
- **Shadow Strategy:** no shadow on flat evidence panels; detector planes alone carry depth.
- **Border:** one-pixel Detector Line rail.

### Navigation

Navigation uses tracked evidence labels on a full-width top rail. Hover reveals one thin cyan trace. The mobile page deliberately keeps the mark and removes the low-value nav row because the narrative itself provides the route.

### Signal Stack

Seven elliptical planes map to Next.js, .NET, Python/LangGraph, Azure PostgreSQL/RLS, the Vercel frontend, Azure Container Apps in `eastus2`, and Human Review. The public runtime contains fictional demo data only and makes no Brazilian data-residency claim. AWS is previous/reference architecture, not a current hosting plane. A cyan beam crosses the first six layers; the final plane changes to Human Coral to mark the limit of autonomy. Motion is limited to proof orbits and is removed under reduced-motion preferences.

## Do's and Don'ts

### Do:

- **Do** make real architecture the first visual artifact.
- **Do** show where automation ends and physician responsibility begins.
- **Do** use motion to trace a real signal through true system boundaries.
- **Do** pair technical density with short, calm human passages.
- **Do** preserve keyboard access, reduced motion and a fully legible static state.

### Don't:

- **Don't** turn psychiatric data into spectacle or imply diagnosis through visualization.
- **Don't** fabricate metrics, customers, benchmarks or clinical outcomes.
- **Don't** use concentric geometry without a true system mapping.
- **Don't** fall back to a generic hero plus bento-card grid.
- **Don't** obscure patient, physician, demo or contact access behind the case study.
