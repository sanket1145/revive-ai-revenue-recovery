# REVIVE UI system

REVIVE is a restrained, operations-first interface for high-stakes financial monitoring. Interfaces must feel precise, calm, and auditable rather than decorative. Favor dense but readable information hierarchy, stable layouts, explicit status labels, and clear next actions.

## Required setup

- Import the canonical Tailwind theme once from `styles/revive-theme.css` after Tailwind is loaded.
- Load Inter Tight (400–700) and JetBrains Mono (400–600) in the consumer document head. Use a stylesheet link rather than a remote CSS `@import`. Both token definitions include system fallbacks, so the interface remains usable if fonts are unavailable.
- Import reusable controls from the attached library barrel. Do not reach into preview routes, backend functions, or REVIVE application-specific modules.

## Styling rules

- Use semantic token utilities such as `bg-background`, `bg-panel`, `text-foreground`, `text-muted-foreground`, `border-border`, and `ring-ring`.
- Never copy raw color values into feature code. If a new semantic role is required, add it to the canonical theme first.
- Reserve destructive red for critical incidents, failures, blocked actions, and destructive confirmation. Reserve success green for verified recovery or completed success states.
- Keep cards and controls compact with small radii. Avoid gradients, decorative glow, oversized rounding, and unnecessary animation.
- Use `font-mono` or the `num` utility for identifiers, money, rates, timestamps, and tabular metrics.
- Use visible focus treatment and preserve keyboard navigation. Icon-only controls require accessible names.
- Build actions with the exported `Button` and form primitives instead of raw clickable containers.

## Composition

Prefer semantic page structure and unframed page sections. Cards are for individual records, metrics, dialogs, or tools—not for nesting full sections inside other cards. All controls should accept their native props and remain responsive without changing dimensions as content loads.

```tsx
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/design-system/revive";

export function IncidentSummary() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment success-rate alert</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="outline">Review incident</Button>
      </CardContent>
    </Card>
  );
}
```

Do not infer approval from an AI recommendation. Financial or customer-impacting actions must remain behind an explicit policy result and, when required, a human decision.