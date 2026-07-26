# NexUI API Reference — Internal
## @yugnex/nexui@2.0.1 + @yugnex/nexui-react@2.0.1

Source of truth for Aanya and all agents generating UI code.
Derived from published type definitions — no guessing.

---

## Install

```bash
bun add @yugnex/nexui @yugnex/nexui-react
```

Peer requirements: `react >=18.0.0`, `react-dom >=18.0.0`

---

## Setup — Next.js 16 (apps/web AND generated apps)

### 1. Root layout (`app/layout.tsx`)

```tsx
'use client'
import '@yugnex/nexui/nexui-utils.css'
import { NexuiProvider } from '@yugnex/nexui-react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NexuiProvider theme="void">
          {children}
        </NexuiProvider>
      </body>
    </html>
  )
}
```

### 2. CRITICAL — SSR rule

Web Components require `document` to register. They do not exist on the server.
**Every file that imports a NexUI component MUST start with `'use client'`.**
No exceptions. Server Components cannot use NexUI components directly.

---

## Themes

Two themes only:

| Value | Description |
|---|---|
| `"void"` | Dark — deep space palette. Default. Use for NexSidi platform. |
| `"terminal"` | Dark green terminal aesthetic. |

```tsx
const { theme, setTheme } = useNexui() // hook for switching
```

---

## Provider

```tsx
import { NexuiProvider, useNexui, type NexuiTheme } from '@yugnex/nexui-react'

<NexuiProvider
  theme="void"              // optional, default "void"
  onThemeChange={(t) => {}} // optional
>
  {children}
</NexuiProvider>
```

---

## Primitives

Import path: `@yugnex/nexui-react`

### Button

```tsx
import { Button } from '@yugnex/nexui-react'

<Button
  variant="primary"   // "primary" | "secondary" | "ghost" | "danger" | "outline" | "accent" | "live"
  size="md"           // "sm" | "md" | "lg"
  loading={false}
  disabled={false}
  icon-only={false}
  type="button"       // "button" | "submit" | "reset"
  onClick={() => {}}
>
  Click me
</Button>
```

### Input

```tsx
import { Input } from '@yugnex/nexui-react'

<Input
  type="text"
  label="Email"
  placeholder="you@example.com"
  helper="We'll never share your email"
  error="Invalid email"      // shows error state + message
  size="md"                  // "sm" | "md" | "lg"
  disabled={false}
  required={false}
  value={value}
  onChange={(e) => setValue(e.target.value)}
  onFocus={() => {}}
  onBlur={() => {}}
/>
```

### Badge

```tsx
import { Badge } from '@yugnex/nexui-react'

<Badge
  variant="default"  // "default" | "accent" | "live" | "success" | "error" | "warning" | "muted"
  size="md"          // "sm" | "md"
  dot={false}        // show dot indicator only (no text)
>
  In Progress
</Badge>
```

### Panel

```tsx
import { Panel } from '@yugnex/nexui-react'

<Panel
  variant="surface"  // "void" | "base" | "surface" | "elevated" | "overlay" | "accent" | "live" | "success" | "error" | "warning"
  padding="md"       // "none" | "xs" | "sm" | "md" | "lg" | "xl"
  elevation="1"      // "0" | "1" | "2" | "3" | "4"
>
  Content
</Panel>
```

### Avatar

```tsx
import { Avatar } from '@yugnex/nexui-react'

<Avatar
  src="/user.jpg"
  name="Amit Sharma"  // used for initials fallback
  size="md"           // "xs" | "sm" | "md" | "lg" | "xl"
  status="online"     // "online" | "away" | "busy" | "offline"
  shape="circle"      // "circle" | "square"
/>
```

### Progress

```tsx
import { Progress } from '@yugnex/nexui-react'

<Progress
  value={75}          // 0–100
  variant="linear"    // "linear" | "circular"
  size="md"           // "sm" | "md" | "lg"
  color="accent"      // "accent" | "live" | "success" | "error" | "warning"
  label="Uploading"
  show-value={true}
/>
```

### Switch

```tsx
import { Switch } from '@yugnex/nexui-react'

<Switch
  checked={enabled}
  disabled={false}
  label="Enable notifications"
  size="md"           // "sm" | "md" | "lg"
  color="accent"      // "accent" | "live" | "success"
  onChange={(checked) => setEnabled(checked)}
/>
```

### Checkbox

```tsx
import { Checkbox } from '@yugnex/nexui-react'

<Checkbox
  checked={agreed}
  indeterminate={false}
  disabled={false}
  label="I agree to the terms"
  size="md"           // "sm" | "md" | "lg"
  onChange={(checked) => setAgreed(checked)}
/>
```

### Skeleton

```tsx
import { Skeleton } from '@yugnex/nexui-react'

<Skeleton
  variant="text"    // "text" | "circle" | "rect"
  width="200px"
  height="20px"
  lines={3}         // for variant="text", renders N lines
  animate={true}
/>
```

### Separator

```tsx
import { Separator } from '@yugnex/nexui-react'

<Separator
  orientation="horizontal"  // "horizontal" | "vertical"
  variant="default"         // "default" | "strong" | "muted"
  label="OR"                // optional label in middle
/>
```

### Spinner

```tsx
import { Spinner } from '@yugnex/nexui-react'

<Spinner
  size="md"       // "xs" | "sm" | "md" | "lg" | "xl"
  color="accent"  // "accent" | "live" | "success" | "error" | "muted"
  label="Loading" // sr-only accessible label
/>
```

### StatusRing — QA score display

```tsx
import { StatusRing } from '@yugnex/nexui-react'

<StatusRing
  score={87}         // 0–100
  label="QA Score"
  color="#22c55e"    // optional override
  size={80}          // px
/>
```

### TextStream — live streaming text (AI output, build logs)

```tsx
import { TextStream, type TextStreamHandle } from '@yugnex/nexui-react'
import { useRef } from 'react'

const streamRef = useRef<TextStreamHandle>(null)

// Push lines via ref:
streamRef.current?.push('Building frontend...')
streamRef.current?.batch(['Done.', 'Deploying...'])
streamRef.current?.clear()

<TextStream
  ref={streamRef}
  maxRows={50}
  showNumbers={true}
/>
```

---

## Composite Components

### Card

```tsx
import { Card, CardHeader, CardBody, CardFooter } from '@yugnex/nexui-react'

<Card
  variant="surface"   // "base" | "surface" | "elevated"
  hoverable={true}
  onClick={() => {}}
>
  <CardHeader
    title="Service Name"
    subtitle="Short description"
    action={<Button size="sm">View</Button>}
  />
  <CardBody>Content here</CardBody>
  <CardFooter>Footer content</CardFooter>
</Card>
```

### Modal

```tsx
import { Modal } from '@yugnex/nexui-react'

<Modal
  open={isOpen}
  onClose={() => setIsOpen(false)}
  title="Confirm Action"
  size="md"           // "sm" | "md" | "lg" | "xl" | "full"
  closeable={true}
  footer={<Button onClick={() => setIsOpen(false)}>OK</Button>}
>
  Modal content here
</Modal>
```

### Tabs

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@yugnex/nexui-react'

<Tabs defaultValue="services" onChange={(v) => console.log(v)}>
  <TabsList>
    <TabsTrigger value="services">Services</TabsTrigger>
    <TabsTrigger value="products">Products</TabsTrigger>
  </TabsList>
  <TabsContent value="services">Services content</TabsContent>
  <TabsContent value="products">Products content</TabsContent>
</Tabs>
```

### Select

```tsx
import { Select, SelectItem, SelectGroup } from '@yugnex/nexui-react'

<Select
  label="Service"
  placeholder="Choose a service"
  value={selected}
  onChange={(v) => setSelected(v)}
  size="md"    // "sm" | "md" | "lg"
  error="Required"
>
  <SelectGroup label="Web">
    <SelectItem value="web-dev">Web Development</SelectItem>
    <SelectItem value="mobile">Mobile App</SelectItem>
  </SelectGroup>
  <SelectItem value="crm">CRM</SelectItem>
</Select>
```

### Tooltip

```tsx
import { Tooltip } from '@yugnex/nexui-react'

<Tooltip content="This is a tooltip">
  <Button>Hover me</Button>
</Tooltip>
```

### Toast

```tsx
import { ToastProvider, Toaster, useToast } from '@yugnex/nexui-react'

// In layout (alongside NexuiProvider):
<ToastProvider>
  <Toaster />
  {children}
</ToastProvider>

// In any client component:
const { toast } = useToast()
toast({ message: 'Saved successfully', variant: 'success' })
```

---

## Utility Classes (`nexui-utils.css`)

Import once in root layout. Prefix: `nx-`

### Layout

```
nx-flex          nx-flex-col       nx-flex-row
nx-items-start   nx-items-center   nx-items-end
nx-justify-start nx-justify-center nx-justify-between nx-justify-end
nx-flex-wrap     nx-flex-nowrap
nx-grid          nx-grid-1 through nx-grid-6
```

### Spacing (4px base scale)

```
nx-gap-xs  nx-gap-sm  nx-gap-md  nx-gap-lg  nx-gap-xl
nx-p-xs    nx-p-sm    nx-p-md    nx-p-lg    nx-p-xl
nx-m-xs    nx-m-sm    nx-m-md    nx-m-lg    nx-m-xl
```

### Sizing

```
nx-w-full  nx-w-screen  nx-h-full  nx-h-screen  nx-h-screen-half
nx-min-w-0  nx-max-w-sm  nx-max-w-md  nx-max-w-lg  nx-max-w-xl
```

### Positioning

```
nx-relative  nx-absolute  nx-fixed  nx-sticky
```

Z-index tiers (pre-defined): modal=200, toast=300, tooltip=400

### Typography

```
nx-text-xs  nx-text-sm  nx-text-md  nx-text-lg  nx-text-xl  nx-text-2xl  nx-text-3xl
nx-font-light  nx-font-normal  nx-font-medium  nx-font-semibold  nx-font-bold
nx-text-center  nx-text-left  nx-text-right
nx-uppercase  nx-lowercase  nx-capitalize
nx-truncate  nx-line-clamp-2  nx-line-clamp-3
```

### Responsive prefixes

```
sm:nx-flex-col   md:nx-grid-2   lg:nx-grid-3   xl:nx-grid-4
```
Breakpoints: sm=640px, md=768px, lg=1024px, xl=1280px

### Colours (reference CSS custom properties)

```
nx-bg-void    nx-bg-base    nx-bg-surface    nx-bg-elevated
nx-text-primary   nx-text-secondary   nx-text-muted
nx-text-success   nx-text-error   nx-text-warning   nx-text-live
```

### Effects

```
nx-rounded-xs  nx-rounded-sm  nx-rounded-md  nx-rounded-lg  nx-rounded-full
nx-shadow-sm   nx-shadow-md   nx-shadow-lg
nx-opacity-50  nx-opacity-75
nx-animate-spin  nx-animate-fade-in  nx-animate-pulse
nx-transition  nx-transition-colors  nx-transition-all
```

---

## What's NOT in NexUI (do not generate these as NexUI components)

Use plain HTML + utility classes for:
- Data tables → `<table>` with `nx-` spacing utilities
- Dropdown menus → `<details>`/`<summary>` or custom with Panel+Button
- Accordion → `<details>`/`<summary>` elements
- Date picker → `<input type="date">`
- Popover → Tooltip for simple cases; custom Panel + nx-absolute for complex

---

## NexSidi-specific usage

| View | Component |
|---|---|
| Live build log (`build/[id]/page.tsx`) | `TextStream` via ref |
| QA score display | `StatusRing` |
| Pipeline stage status | `Badge variant="live"/"success"/"error"` |
| Build card | `Card variant="elevated"` |
| Agent activity feed | `TextStream` or `Panel variant="live"` |
