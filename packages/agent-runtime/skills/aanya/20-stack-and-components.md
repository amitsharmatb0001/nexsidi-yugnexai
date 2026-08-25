STACK (non-negotiable):
- Next.js 16.2 / TypeScript / React 19
- UI: @yugnex/core — the NexSidi in-house UI runtime (styling engine + theme system).
  Individual component SOURCE FILES are already vendored into components/nexui/*.tsx
  by the scaffold (shadcn/ui-style: these are YOUR OWN project files, not an
  installed package) — import each component from its own file via the "@/..."
  alias, e.g. import { Button } from "@/components/nexui/button". There is no
  barrel/index file re-exporting everything from one path — import each
  component from its own file.
  Components available: Button, Card (+ CardHeader/CardTitle/CardDescription/
              CardBody/CardFooter), Input, Badge, Checkbox, Modal (+ ModalContent/
              ModalHeader/ModalTitle/ModalDescription/ModalFooter), Tabs
              (+ TabsList/TabsTrigger/TabsPanel), Select (+ SelectField), Tooltip,
              Switch, Progress, Skeleton, Avatar, Separator
  There is NO Panel and NO Spinner component in this library — see "PANEL &
  SPINNER" inside NEXUI COMPONENT API below for the real replacement patterns.
  Theme: StyleRegistry + ThemeProvider (from @yugnex/core/client) wrap the app
  in layout.tsx (already in scaffold) — this project's colors are already wired
  in via createTheme(); do NOT add a second theme/provider or re-wrap the app.
  NEVER use Tailwind, shadcn/ui, @radix-ui, or any external UI library
  NEVER use @apply in CSS — use the css()/theme object from @yugnex/core (see
  NEXUI CSS VARIABLES below), or raw var(--nx-color-*)/var(--nx-space-*)/
  var(--nx-radius-*) CSS variables directly
  IMPORTANT: these components do NOT submit parent forms automatically on
  click. Always add onClick={handleSubmit} directly to your form's Button
  components to submit forms explicitly.
- Auth: Custom JWT authentication. You MUST write/generate:
  1. A custom sign-up/sign-in page (using custom API calls to the backend /api/v1/auth/login and /api/v1/auth/register).
  2. Parse the backend auth response correctly — the backend wraps ALL responses in a { success: boolean, data: {...} } envelope. For auth endpoints the token is at body.data.token, NOT body.token. Example:
       const body = await res.json();
       if (!res.ok || !body.success) { setError(body.error ?? "Request failed"); return; }
       const token = body.data.token;  // CORRECT — body.data.token, not body.token
       document.cookie = `token=${token}; path=/`;
  3. Store the JWT token in cookies (e.g., set 'token' cookie) or localStorage.
  4. Include the token as an Authorization Bearer header in all backend API requests.
- API calls: see the MODE-specific instructions at the end of this prompt for
  whether to call the backend now or use mock data instead

NEXUI COMPONENT API — COMPLETE REFERENCE (verified directly against each
component's real source file — do NOT read the vendor source yourself,
everything you need is here; do NOT assume any prop from the OLD
@yugnex/nexui-react API still applies — several are renamed or gone):

  // Button — props: variant? "solid"|"outline"|"ghost"|"soft" (default
  //   "solid" — NOT "primary", that value does not exist), tone?
  //   "primary"|"destructive" (default "primary"), size? "sm"|"md"|"lg"
  //   (default "md"), isLoading? (boolean — renders its own inline spinner
  //   and disables the button; no separate Spinner needed), asChild? (boolean
  //   — renders your single child element, e.g. a Next.js <Link>, with
  //   Button's classes/ref instead of a <button>).
  import { Button } from "@/components/nexui/button";
  <Button variant="solid" tone="primary" size="md">Click</Button>   // primary CTA
  <Button variant="ghost" size="sm">Cancel</Button>                  // ghost button
  <Button variant="outline" tone="destructive">Delete</Button>       // destructive action
  <Button isLoading>Saving…</Button>                                 // built-in loading spinner

  // Card — plain container components: no custom props beyond standard HTML
  //   attributes + className. Card/CardBody/CardFooter render a <div>,
  //   CardHeader a <div>, CardTitle an <h3>, CardDescription a <p>.
  import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from "@/components/nexui/card";
  <Card>
    <CardHeader><CardTitle>Title</CardTitle><CardDescription>Subtitle</CardDescription></CardHeader>
    <CardBody>...content...</CardBody>
    <CardFooter><Button size="sm">Save</Button></CardFooter>
  </Card>

  // Input — props: label? (ReactNode), description? (ReactNode, helper text
  //   below the field), error? (ReactNode, replaces description when set),
  //   plus every native <input> attribute (value, onChange, placeholder, type...).
  import { Input } from "@/components/nexui/input";
  <Input label="Title" placeholder="Enter..." value={v} onChange={(e) => setV(e.target.value)} />
  <Input label="Email" type="email" error={emailError} />

  // Badge — props: variant? "solid"|"soft"|"outline" (default "solid"), tone?
  //   "primary"|"secondary"|"success"|"warning"|"destructive" (default
  //   "primary" — success/warning are TONES, not variants), size? "sm"|"md".
  import { Badge } from "@/components/nexui/badge";
  <Badge variant="soft" tone="success">Done</Badge>       // success badge
  <Badge variant="soft" tone="warning">Pending</Badge>    // pending badge

  // Checkbox — props: checked? (boolean | "indeterminate"), defaultChecked?,
  //   onCheckedChange? (checked: boolean | "indeterminate") => void — NOT
  //   onChange. No built-in label prop — wrap it in your own <label> so the
  //   label text is clickable too.
  import { Checkbox } from "@/components/nexui/checkbox";
  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
    <Checkbox checked={done} onCheckedChange={(c) => setDone(c === true)} />
    Complete
  </label>

  PANEL & SPINNER — NO EQUIVALENT COMPONENT EXISTS IN THIS LIBRARY. Do not
  import either name; they will not resolve.
  - Generic layout surface (replaces the old Panel component): call css() from
    @yugnex/core directly, ONCE at module scope (not inside the component
    body — every vendored component builds its own classnames this same way):
      import { css, themeVars as theme } from "@yugnex/core";
      const panelClass = css({
        padding: theme.space[6],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.card,
        border: `1px solid ${theme.color.border}`,
      });
      // then: <div className={panelClass}>...</div>
    Reserve Card/CardHeader/CardBody/CardFooter for genuinely card-shaped
    content (a bordered block with title+description+body+footer). Use
    css() for every other wrapper that just needs padding/background/radius.
  - Button-scoped loading (replaces the old standalone spinner component
    previously used inside a button): use Button's own isLoading prop —
    <Button isLoading>Saving…</Button> — it already renders an inline
    spinner; do not add a separate one next to it.
  - Non-button loading states (a page or section fetching data): prefer
    Skeleton — a content-shaped placeholder, closer to what modern design
    systems recommend over a bare spinner —
    <Skeleton shape="rect" width="100%" height="120px" />. Only when
    neither Button's isLoading nor Skeleton genuinely fits, build a small
    inline spinner using the same keyframes()/css() technique NexUI's own
    button.tsx uses internally for its isLoading state, adapted for
    standalone use:
      import { css, keyframes, themeVars as theme } from "@yugnex/core";
      const spin = keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });
      const spinnerClass = css({
        width: "1.5rem", height: "1.5rem", borderRadius: "9999px",
        border: `2px solid ${theme.color.border}`,
        borderTopColor: theme.color.primary,
        animation: `${spin} 0.6s linear infinite`,
      });
      // then: <span className={spinnerClass} aria-hidden="true" />

  // Modal — a compound component, controlled via open/onOpenChange (NOT
  //   onClose). There is no title/footer/size/closeable prop — compose
  //   ModalHeader/ModalTitle/ModalDescription/ModalFooter as children of
  //   ModalContent instead.
  import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from "@/components/nexui/modal";
  <Modal open={isOpen} onOpenChange={setOpen}>
    <ModalContent>
      <ModalHeader><ModalTitle>Edit task</ModalTitle></ModalHeader>
      ...form fields...
      <ModalFooter><Button onClick={save}>Save</Button></ModalFooter>
    </ModalContent>
  </Modal>

  // Select — a DATA-DRIVEN dropdown: pass an options array as a prop. There
  //   is NO SelectItem/SelectGroup compound-children API. Props: options
  //   ({ value, label, description?, disabled?, group? }[], required), value?/
  //   defaultValue?/onValueChange? (value: string) => void, placeholder?
  //   (default "Select…"), disabled?, label? (accessible name), id?. Use
  //   SelectField (same props plus fieldLabel?/description?/error?) for a
  //   version with a visible label rendered above the control.
  import { SelectField } from "@/components/nexui/select";
  <SelectField
    fieldLabel="Priority"
    placeholder="Choose..."
    value={priority}
    onValueChange={setPriority}
    options={[
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
      { value: "none", label: "None", group: "Other" },
    ]}
  />

  // Tabs — value/onValueChange controlled, or defaultValue uncontrolled. The
  //   panel component is TabsPanel — NOT TabsContent.
  import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/nexui/tabs";
  <Tabs defaultValue="all">
    <TabsList>
      <TabsTrigger value="all">All</TabsTrigger>
      <TabsTrigger value="done">Done</TabsTrigger>
    </TabsList>
    <TabsPanel value="all">...</TabsPanel>
    <TabsPanel value="done">...</TabsPanel>
  </Tabs>

  // Tooltip — props: content (ReactNode, required), children (a single
  //   ReactElement, required — must forward its ref), placement? (Placement,
  //   default "top" — the prop is named "placement", NOT "side"), delay?
  //   (ms, default 200 — NOT 400). No "disabled" prop; conditionally skip
  //   rendering the Tooltip wrapper instead.
  import { Tooltip } from "@/components/nexui/tooltip";
  <Tooltip content="Delete this task" placement="top"><Button variant="ghost" size="sm">X</Button></Tooltip>

  // Switch — props: checked?/defaultChecked? (boolean), onCheckedChange?
  //   (checked: boolean) => void — NOT onChange. No label/size/color props —
  //   wrap it in your own <label>, the same pattern as Checkbox above.
  import { Switch } from "@/components/nexui/switch";
  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
    <Switch checked={enabled} onCheckedChange={setEnabled} />
    Notifications
  </label>

  // Progress — a LINEAR bar only, there is no "circular" variant. Props:
  //   value? (0-max; omit for an indeterminate sliding bar), max? (default
  //   100), size? "sm"|"md"|"lg" (default "md"), tone?
  //   "primary"|"success"|"warning"|"destructive" (default "primary" — the
  //   prop is named "tone", NOT "color"), label? (string, used as the
  //   accessible aria-label only — it is NOT rendered as visible text).
  import { Progress } from "@/components/nexui/progress";
  <Progress value={65} tone="primary" label="Completion" />

  // Skeleton — props: shape? "text"|"circle"|"rect" (default "rect" — the
  //   prop is named "shape", NOT "variant"), animation? "pulse"|"shimmer"|
  //   "none" (default "shimmer"), width?/height? (CSS width/height values),
  //   lines? (number — stacks that many text-shaped lines for shape="text",
  //   the last one rendered shorter, like real prose).
  import { Skeleton } from "@/components/nexui/skeleton";
  <Skeleton shape="text" lines={3} />
  <Skeleton shape="rect" width="100%" height="120px" />
  <Skeleton shape="circle" width={40} height={40} />

  // Avatar — props: src?, alt?, fallback? (string shown when there's no
  //   image or it fails to load — defaults to the first 2 letters of alt,
  //   uppercased), size? (a NUMBER in pixels, default 40 — NOT a
  //   "sm"|"md"|"lg" string).
  import { Avatar } from "@/components/nexui/avatar";
  <Avatar src={user.avatarUrl} alt={user.name} size={40} />

  // Separator — props: orientation? "horizontal"|"vertical" (default
  //   "horizontal"), decorative? (boolean, default true), children?
  //   (optional — renders a centered label with rules on both sides instead
  //   of a plain line).
  import { Separator } from "@/components/nexui/separator";
  <Separator />
  <Separator orientation="vertical" />
  <Separator>OR</Separator>

  // Toast — NOT one of the vendored components (this scaffold does not copy
  //   it into components/nexui/, and its real API — toast()/dismissToast()
  //   functions plus a <ToastViewport /> you would have to mount yourself
  //   near the root, NOT a <ToastProvider>/useToast() hook the way the old
  //   library worked) needs setup this scaffold does not provide. Do NOT
  //   import it. Use an inline Badge, a small css() status surface (see
  //   PANEL above), or plain conditional text for save/error confirmations
  //   instead.

NEXUI CSS VARIABLES (verified against @yugnex/core's real theme tokens —
packages/core/src/theme/{createTheme,tokens}.ts — naming convention is
--nx-{kebab-case-path}, a different naming scheme than the previous UI
library used; only the names listed below exist in this system):
  Prefer the typed theme object inside css({...}) calls —
  import { themeVars as theme } from "@yugnex/core"; theme.color.primary IS
  the exact string var(--nx-color-primary), just with autocomplete/type
  safety. Use the raw var(--nx-*) strings only in a plain .css file (e.g.
  globals.css) where you can't import the theme object.

  Color (24 semantic slots, both light and dark values supplied by the
  project's own ThemeProvider — you never choose light vs. dark yourself):
  var(--nx-color-background)    var(--nx-color-foreground)
  var(--nx-color-card)          var(--nx-color-card-foreground)
  var(--nx-color-popover)       var(--nx-color-popover-foreground)
  var(--nx-color-primary)       var(--nx-color-primary-foreground)
  var(--nx-color-secondary)     var(--nx-color-secondary-foreground)
  var(--nx-color-muted)         var(--nx-color-muted-foreground)
  var(--nx-color-accent)        var(--nx-color-accent-foreground)
  var(--nx-color-destructive)   var(--nx-color-destructive-foreground)
  var(--nx-color-success)       var(--nx-color-success-foreground)
  var(--nx-color-warning)       var(--nx-color-warning-foreground)
  var(--nx-color-border)        var(--nx-color-input)
  var(--nx-color-ring)          var(--nx-color-overlay)

  Spacing/radius (same theme.* access pattern, e.g. theme.space[6] is
  var(--nx-space-6), theme.radius.lg is var(--nx-radius-lg)):
  space scale: 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24 (rem-based)
  radius scale: none, sm, md, lg, xl, full

